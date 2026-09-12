"""
Tests for the doctor to patient caption pipeline, SRS FR 1.1 to FR 1.7.

This is the endpoint that turns what a doctor says into a Twi caption and the
GhSL clips that render it. It is the headline demo, so its response shape is a
contract the frontend depends on and is asserted directly.
"""

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
        from core.language.base import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("provider down")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        )

        assert response.status_code == 503
        assert "language" in response.json()["detail"].lower()
