"""
Tests for the language provider layer, SRS FR 1.2 and FR 1.3.

The point of this layer is that no test and no CI run ever depends on a live
third party service. A network problem during judging must look like a network
problem, not like a broken app.
"""

import pytest
import requests

from core.language import get_language_provider
from core.language.base import Language, LanguageError
from core.language.khaya import KhayaLanguageProvider
from core.language.stub import StubLanguageProvider


class TestProviderSelection:
    def test_stub_is_used_when_no_api_key_is_configured(self, settings):
        # A fresh clone and every CI run land here, which is why the stub has
        # to be a real working implementation rather than a raising placeholder.
        settings.KHAYA_API_KEY = ""

        assert isinstance(get_language_provider(), StubLanguageProvider)

    def test_khaya_is_used_when_an_api_key_is_configured(self, settings):
        settings.KHAYA_API_KEY = "a-key"

        assert isinstance(get_language_provider(), KhayaLanguageProvider)

    def test_every_provider_reports_its_own_name(self, settings):
        # Exposed all the way to the API response so a demo can never present
        # stub output as though it came from real Twi translation.
        settings.KHAYA_API_KEY = ""
        assert get_language_provider().name == "stub"

        settings.KHAYA_API_KEY = "a-key"
        assert get_language_provider().name == "khaya"


class TestStubProvider:
    def test_transcribe_returns_the_same_text_for_the_same_audio(self):
        # Deterministic, so a test asserting the caption pipeline end to end
        # has a fixed value to assert against.
        provider = StubLanguageProvider()

        first = provider.transcribe(b"audio-bytes", language=Language.ENGLISH)
        second = provider.transcribe(b"audio-bytes", language=Language.ENGLISH)

        assert first == second
        assert first

    def test_translate_returns_the_text_unchanged(self):
        # The stub deliberately does not invent Twi. Fabricated translation
        # would be worse than none, because it would look real in a demo and be
        # wrong in front of a Twi speaking judge.
        provider = StubLanguageProvider()

        assert (
            provider.translate(
                "the head hurts", source=Language.ENGLISH, target=Language.TWI
            )
            == "the head hurts"
        )

    def test_synthesize_returns_audio_bytes(self):
        provider = StubLanguageProvider()

        audio = provider.synthesize("head hurts", language=Language.TWI)

        assert isinstance(audio, bytes)
        assert audio


class TestKhayaProvider:
    """
    Khaya is reached over HTTP, so these tests assert the request we send and
    the way we handle a failure, not the quality of the translation.
    """

    def test_translate_sends_the_subscription_key_and_language_pair(self, monkeypatch):
        captured = {}

        def fake_post(url, **kwargs):
            captured["url"] = url
            captured["headers"] = kwargs.get("headers", {})
            captured["json"] = kwargs.get("json", {})
            return _FakeResponse(200, "wo tiri yɛ wo ya")

        monkeypatch.setattr(requests, "post", fake_post)
        provider = KhayaLanguageProvider(api_key="a-key")

        result = provider.translate(
            "the head hurts", source=Language.ENGLISH, target=Language.TWI
        )

        assert result == "wo tiri yɛ wo ya"
        assert captured["headers"]["Ocp-Apim-Subscription-Key"] == "a-key"
        assert captured["json"]["lang"] == "en-tw"

    def test_translate_raises_a_language_error_on_a_failed_response(self, monkeypatch):
        # Callers must be able to distinguish a provider outage from a bad
        # caption, so the failure is a typed error rather than a bare status.
        monkeypatch.setattr(
            requests, "post", lambda url, **kwargs: _FakeResponse(503, "down")
        )
        provider = KhayaLanguageProvider(api_key="a-key")

        with pytest.raises(LanguageError):
            provider.translate("head", source=Language.ENGLISH, target=Language.TWI)

    def test_translate_raises_a_language_error_when_the_request_cannot_be_sent(
        self, monkeypatch
    ):
        def fail(url, **kwargs):
            raise requests.ConnectionError("no route to host")

        monkeypatch.setattr(requests, "post", fail)
        provider = KhayaLanguageProvider(api_key="a-key")

        with pytest.raises(LanguageError):
            provider.translate("head", source=Language.ENGLISH, target=Language.TWI)

    def test_requires_an_api_key(self):
        # Constructing a real provider with no credential would fail later, at
        # the first request, in the middle of a consultation.
        with pytest.raises(ValueError):
            KhayaLanguageProvider(api_key="")


class _FakeResponse:
    """Minimal stand in for a requests Response, for provider tests."""

    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self._body = body

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    @property
    def text(self) -> str:
        return str(self._body)

    @property
    def content(self) -> bytes:
        return str(self._body).encode()

    def json(self):
        return self._body
