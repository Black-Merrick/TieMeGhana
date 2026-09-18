"""
Tests for the doctor to patient caption pipeline, SRS FR 1.1 to FR 1.7.

This is the endpoint that turns what a doctor says into a Twi caption and the
GhSL clips that render it. It is the headline demo, so its response shape is a
contract the frontend depends on and is asserted directly.
"""

import time

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from core.language.stub import STUB_TRANSCRIPT


@pytest.fixture(autouse=True)
def stub_provider(settings):
    """
    Force the stub provider for every test in this module.

    Without this a developer with a real key in their .env would have their
    test run hit Khaya, making the suite slow, non deterministic, and dependent
    on someone else's uptime.
    """
    settings.KHAYA_API_KEY = ""


@pytest.fixture
def directional_provider(monkeypatch):
    """
    A provider whose translation is visibly directional.

    The real stub translates by returning the input unchanged, which makes
    English input and its Twi caption identical. That is honest, but it means a
    test cannot tell which of the two the clip lookup actually used. This
    provider tags its output so the direction is observable.
    """
    from core.language.base import Language, LanguageProvider

    class DirectionalStub(LanguageProvider):
        name = "directional-stub"

        def transcribe(self, audio, *, language, content_type=None):
            return "spoken words"

        def translate(self, text, *, source, target):
            return f"{'TWI' if target == Language.TWI else 'EN'}:{text}"

        def synthesize(self, text, *, language):
            return b"audio"

    monkeypatch.setattr(
        "consultations.services.get_language_provider", lambda: DirectionalStub()
    )


@pytest.mark.django_db
class TestSignLookupLanguage:
    """
    GhSL clips are keyed on English glosses, per the SRS definition of Gloss
    and FR 1.5. The Twi caption is what the patient reads. Confusing the two
    means every lookup fails silently, and only against a real translator,
    which is exactly how this was missed at first.
    """

    def test_english_input_looks_up_clips_by_the_english_words(
        self, api_client, directional_provider, make_clip, alphabet
    ):
        make_clip("HEAD")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        )

        body = response.json()
        # The caption the patient reads is Twi.
        assert body["caption"] == "TWI:head"
        # The clips come from the English word, so the sign still matches.
        assert body["sign_lookup_text"] == "head"
        assert body["sequence"]["segments"][0]["match"] == "gloss"

    def test_twi_input_is_translated_to_english_for_clip_lookup(
        self, api_client, directional_provider, make_clip, alphabet
    ):
        make_clip("HEAD")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "head"},
            format="json",
        )

        body = response.json()
        # Twi input is already the caption, no translation needed for display.
        assert body["caption"] == "head"
        # But it must be translated to English before looking up glosses.
        assert body["sign_lookup_text"] == "EN:head"

    def test_a_twi_caption_is_never_used_as_the_gloss_lookup_key(
        self, api_client, directional_provider, make_clip, alphabet
    ):
        # The regression guard. If lookup ever reverts to using the caption,
        # this fails, because the Twi caption carries the TWI: tag.
        make_clip("HEAD")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        )

        assert "TWI:" not in response.json()["sequence"]["source_text"]


@pytest.mark.django_db
class TestCaptionFromTypedText:
    def test_english_text_is_translated_and_resolved_to_clips(
        self, api_client, make_clip, alphabet
    ):
        make_clip("HEAD", duration_ms=900)

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head hurts"},
            format="json",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["transcript"] == "head hurts"
        assert body["translation_applied"] is True
        assert body["caption_language"] == "tw"
        assert [s["token"] for s in body["sequence"]["segments"]] == ["head", "hurts"]
        assert body["sequence"]["segments"][0]["match"] == "gloss"

    def test_twi_text_skips_the_translation_step(self, api_client, alphabet):
        # FR 1.3 translates only if needed. A doctor who already speaks Twi
        # should not have their words round tripped through English.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "wo tiri"},
            format="json",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["translation_applied"] is False
        assert body["caption"] == "wo tiri"

    def test_response_names_the_language_provider_that_produced_it(
        self, api_client, alphabet
    ):
        # So a demo can never present stub output as real Twi translation.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        )

        assert response.json()["language_provider"] == "stub"

    def test_caption_equals_transcript_under_the_stub_provider(
        self, api_client, alphabet
    ):
        # Documents the stub's honest behaviour: it does not invent Twi, so the
        # caption is the untranslated text even though a translation step ran.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head hurts"},
            format="json",
        )

        body = response.json()
        assert body["translation_applied"] is True
        assert body["caption"] == body["transcript"]


@pytest.mark.django_db
class TestThePipelineIsTimed:
    """
    NFR 1's five second budget, made measurable rather than assumed.

    `pipeline_ms` is a real elapsed time reading, not a placeholder, which the
    slow provider below exists to prove: a value that never moved would still
    make every other assertion here pass.
    """

    def test_a_response_reports_how_long_the_pipeline_took(self, api_client, alphabet):
        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head hurts"},
            format="json",
        )

        pipeline_ms = response.json()["pipeline_ms"]
        assert isinstance(pipeline_ms, int)
        assert pipeline_ms >= 0
        # The stub does no I/O at all, so a real provider outage or a slow
        # network is the only thing that could push this anywhere near the
        # five second budget. Generous, not tight: the point is catching a
        # pipeline that regressed to doing real work per request, not timing
        # the stub to the millisecond.
        assert pipeline_ms < 1000

    def test_the_reading_is_real_elapsed_time_not_a_placeholder(
        self, api_client, alphabet, monkeypatch
    ):
        from core.language.base import LanguageProvider

        class SlowStub(LanguageProvider):
            name = "slow-stub"

            def transcribe(self, audio, *, language, content_type=None):
                return "spoken words"

            def translate(self, text, *, source, target):
                # Long enough to be unmistakable against scheduler jitter, and
                # nowhere near NFR 1's own five second budget.
                time.sleep(0.2)
                return text

            def synthesize(self, text, *, language):
                return b"audio"

        monkeypatch.setattr(
            "consultations.services.get_language_provider", lambda: SlowStub()
        )

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head hurts"},
            format="json",
        )

        # One translate call is on the path for English input: the caption to
        # Twi. Loose lower bound, not an exact one, because CI schedulers are
        # not real time and a tight assertion would be flaky rather than
        # meaningful.
        assert response.json()["pipeline_ms"] >= 150

    def test_a_failed_pipeline_still_logs_its_duration(
        self, api_client, alphabet, monkeypatch, caplog
    ):
        # The finally block's whole reason to exist: a request that fails
        # partway through is exactly the one a developer chasing a slow or
        # broken demo needs the duration of, and it never reaches the
        # response body that the other two tests read from.
        from core.language import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("simulated outage")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        with caplog.at_level("INFO", logger="consultations.services"):
            api_client.post(
                reverse("caption"),
                # Twi input needs the English translation to resolve signs at
                # all, so this is the case that actually raises rather than
                # degrading, per build_caption's own docstring.
                {"source_language": "tw", "text": "wo tiri"},
                format="json",
            )

        assert any(
            "Caption pipeline finished in" in message for message in caplog.messages
        )


@pytest.mark.django_db
class TestCaptionFromSpokenAudio:
    def test_audio_is_transcribed_then_resolved(self, api_client, alphabet):
        audio = SimpleUploadedFile("speech.webm", b"audio", content_type="audio/webm")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "audio": audio},
            format="multipart",
        )

        assert response.status_code == 200
        assert response.json()["transcript"] == STUB_TRANSCRIPT


@pytest.mark.django_db
class TestCaptionValidation:
    def test_rejects_a_request_with_neither_text_nor_audio(self, api_client):
        response = api_client.post(
            reverse("caption"), {"source_language": "en"}, format="json"
        )

        assert response.status_code == 400

    def test_rejects_a_request_with_both_text_and_audio(self, api_client):
        # Ambiguous input. Guessing which one the doctor meant could caption
        # something they did not say.
        audio = SimpleUploadedFile("speech.webm", b"audio", content_type="audio/webm")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head", "audio": audio},
            format="multipart",
        )

        assert response.status_code == 400

    def test_rejects_an_unsupported_source_language(self, api_client):
        # FR 1.1 offers English or Twi only. Silently defaulting would caption
        # in a language the doctor did not choose.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "fr", "text": "la tete"},
            format="json",
        )

        assert response.status_code == 400

    def test_rejects_a_request_with_no_source_language(self, api_client):
        response = api_client.post(reverse("caption"), {"text": "head"}, format="json")

        assert response.status_code == 400


@pytest.mark.django_db
class TestCaptionProviderFailure:
    def test_returns_service_unavailable_when_the_provider_fails(
        self, api_client, settings, monkeypatch
    ):
        # The doctor needs to know to type instead, so a provider outage must
        # not surface as a generic 500 that looks like our bug.
        #
        # Twi input, and that matters. With English there is nothing to
        # translate for the sign lookup, so the signs resolve anyway and the
        # request now succeeds with an untranslated caption. Twi is the case
        # where translation failing really does leave nothing to show.
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("provider down")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "ti"},
            format="json",
        )

        assert response.status_code == 503
        assert "language" in response.json()["detail"].lower()


@pytest.mark.django_db
class TestSpokenAudioFormat:
    def test_the_recorded_format_reaches_the_provider(self, api_client, monkeypatch):
        # Chrome records WebM, iOS Safari records MP4. Whether transcription
        # works at all can depend on the provider knowing which it received.
        captured = {}

        from core.language.stub import StubLanguageProvider

        def capture(self, audio, *, language, content_type=None):
            captured["content_type"] = content_type
            return "spoken words"

        monkeypatch.setattr(StubLanguageProvider, "transcribe", capture)

        audio = SimpleUploadedFile(
            "utterance.webm", b"audio", content_type="audio/webm"
        )
        api_client.post(
            reverse("caption"),
            {"source_language": "tw", "audio": audio},
            format="multipart",
        )

        assert captured["content_type"] == "audio/webm"


@pytest.mark.django_db
class TestCaptionFailureIsDiagnosable:
    def test_the_provider_error_is_logged_for_diagnosis(
        self, api_client, monkeypatch, caplog
    ):
        # The doctor gets a short message, but the provider's own error has to
        # reach a log or a failure cannot be diagnosed without spending
        # metered credit to reproduce it.
        #
        # Twi input, because that is the case where a translation failure is
        # still fatal. English input now degrades to an untranslated caption
        # and keeps the signs.
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("Khaya returned 400 for /asr/v1/transcribe")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        with caplog.at_level("WARNING", logger="consultations.views"):
            api_client.post(
                reverse("caption"),
                {"source_language": "tw", "text": "ti"},
                format="json",
            )

        assert "asr/v1/transcribe" in caplog.text

    def test_the_provider_error_never_reaches_the_client(self, api_client, monkeypatch):
        # A provider message can quote the utterance back, and the utterance is
        # clinical content, so it stays server side.
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("failed on text: patient has HIV")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "patient has HIV"},
            format="json",
        )

        assert response.status_code == 503
        assert "HIV" not in response.json()["detail"]


@pytest.mark.django_db
class TestTranscriptSource:
    """
    The stub invents a transcript for spoken audio rather than merely leaving
    it untranslated. That is a stronger claim to have to disclose, so the
    response says which of the two happened.
    """

    def test_typed_input_is_reported_as_typed(self, api_client, alphabet):
        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "ti"},
            format="json",
        )

        assert response.json()["transcript_source"] == "typed"

    def test_spoken_input_is_reported_as_spoken(self, api_client, alphabet):
        audio = SimpleUploadedFile("a.webm", b"audio", content_type="audio/webm")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "audio": audio},
            format="multipart",
        )

        assert response.json()["transcript_source"] == "spoken"
