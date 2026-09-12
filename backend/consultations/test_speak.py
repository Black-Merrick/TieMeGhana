"""
Tests for speaking a patient response aloud, SRS FR 3.1 to FR 3.5.

The property that matters most is FR 3.5: a tapped answer must be spoken too,
not only a typed one, because the doctor's hands are on the patient rather than
the screen.
"""

import base64

import pytest
from django.urls import reverse

from core.language.stub import STUB_AUDIO


@pytest.fixture
def directional_provider(monkeypatch):
    """A provider whose translation direction is visible in its output."""
    from core.language.base import Language, LanguageProvider

    class DirectionalStub(LanguageProvider):
        name = "directional-stub"

        def transcribe(self, audio, *, language, content_type=None):
            return "spoken words"

        def translate(self, text, *, source, target):
            return f"{'TWI' if target == Language.TWI else 'EN'}:{text}"

        def synthesize(self, text, *, language):
            return f"audio:{text}".encode()

    monkeypatch.setattr(
        "consultations.response_service.get_language_provider",
        lambda: DirectionalStub(),
    )


@pytest.mark.django_db
class TestSpeakingAResponse:
    def test_speaks_a_typed_response_in_the_listeners_language(self, api_client):
        # FR 3.1 and 3.4. The patient typed it, the hearing listener hears it.
        response = api_client.post(
            reverse("speak"),
            {"text": "my head hurts", "source_language": "en", "output_language": "en"},
            format="json",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["spoken_text"] == "my head hurts"
        assert base64.b64decode(body["audio_base64"]) == STUB_AUDIO

    def test_translates_when_the_listener_speaks_the_other_language(
        self, api_client, directional_provider
    ):
        # FR 3.2. A patient answering in Twi must still be understood by a
        # doctor who only speaks English.
        response = api_client.post(
            reverse("speak"),
            {"text": "wo tiri", "source_language": "tw", "output_language": "en"},
            format="json",
        )

        body = response.json()
        assert body["spoken_text"] == "EN:wo tiri"
        assert body["translation_applied"] is True

    def test_skips_translation_when_both_languages_match(
        self, api_client, directional_provider
    ):
        # Round tripping through the other language would lose meaning for no
        # benefit, and spend metered credit doing it.
        response = api_client.post(
            reverse("speak"),
            {"text": "wo tiri", "source_language": "tw", "output_language": "tw"},
            format="json",
        )

        body = response.json()
        assert body["spoken_text"] == "wo tiri"
        assert body["translation_applied"] is False

    def test_speaks_what_was_translated_rather_than_the_original(
        self, api_client, directional_provider
    ):
        # Synthesising the untranslated text would produce audio in a language
        # the listener may not speak, while reporting success.
        response = api_client.post(
            reverse("speak"),
            {"text": "wo tiri", "source_language": "tw", "output_language": "en"},
            format="json",
        )

        audio = base64.b64decode(response.json()["audio_base64"]).decode()
        assert audio == "audio:EN:wo tiri"

    def test_reports_the_media_type_so_the_browser_can_play_it(self, api_client):
        response = api_client.post(
            reverse("speak"),
            {"text": "yes", "source_language": "en", "output_language": "en"},
            format="json",
        )

        assert response.json()["audio_media_type"] == "audio/wav"

    def test_names_the_provider_that_produced_the_audio(self, api_client):
        # ADR 011. Stub audio is silence, and the interface has to be able to
        # say so rather than presenting it as speech.
        response = api_client.post(
            reverse("speak"),
            {"text": "yes", "source_language": "en", "output_language": "en"},
            format="json",
        )

        assert response.json()["language_provider"] == "stub"

    def test_the_stub_returns_audio_a_browser_can_actually_play(self):
        # Real silence, not a placeholder byte string, so the playback flow and
        # its vibration feedback can be demonstrated without a Khaya key.
        assert STUB_AUDIO.startswith(b"RIFF")
        assert STUB_AUDIO[8:12] == b"WAVE"
        assert len(STUB_AUDIO) > 44


@pytest.mark.django_db
class TestSpeakValidation:
    def test_rejects_blank_text(self, api_client):
        response = api_client.post(
            reverse("speak"),
            {"text": "   ", "source_language": "en", "output_language": "en"},
            format="json",
        )

        assert response.status_code == 400

    def test_requires_the_listeners_language(self, api_client):
        # Defaulting it would risk speaking Twi at someone who only reads
        # English, and reporting that as a successful exchange.
        response = api_client.post(
            reverse("speak"),
            {"text": "yes", "source_language": "en"},
            format="json",
        )

        assert response.status_code == 400

    def test_rejects_an_unsupported_language(self, api_client):
        response = api_client.post(
            reverse("speak"),
            {"text": "oui", "source_language": "fr", "output_language": "en"},
            format="json",
        )

        assert response.status_code == 400


@pytest.mark.django_db
class TestSpeakFailure:
    def test_returns_service_unavailable_when_synthesis_fails(
        self, api_client, monkeypatch
    ):
        # The doctor's next action is to read the screen, so an outage must not
        # look like a generic bug.
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, language):
            raise LanguageError("tts down")

        monkeypatch.setattr(StubLanguageProvider, "synthesize", fail)

        response = api_client.post(
            reverse("speak"),
            {"text": "yes", "source_language": "en", "output_language": "en"},
            format="json",
        )

        assert response.status_code == 503

    def test_the_provider_error_is_logged_but_never_returned(
        self, api_client, monkeypatch, caplog
    ):
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, language):
            raise LanguageError("tts refused: patient has HIV")

        monkeypatch.setattr(StubLanguageProvider, "synthesize", fail)

        with caplog.at_level("WARNING", logger="consultations.views"):
            response = api_client.post(
                reverse("speak"),
                {
                    "text": "patient has HIV",
                    "source_language": "en",
                    "output_language": "en",
                },
                format="json",
            )

        assert "tts refused" in caplog.text
        assert "HIV" not in response.json()["detail"]
