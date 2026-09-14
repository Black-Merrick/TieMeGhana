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
        settings.LANGUAGE_PROVIDER = "auto"

        assert isinstance(get_language_provider(), StubLanguageProvider)

    def test_khaya_is_used_when_an_api_key_is_configured(self, settings):
        settings.KHAYA_API_KEY = "a-key"
        settings.LANGUAGE_PROVIDER = "auto"

        assert isinstance(get_language_provider(), KhayaLanguageProvider)

    def test_stub_can_be_forced_even_with_a_valid_api_key(self, settings):
        # The project runs on a metered free tier, so ordinary development must
        # not spend translation credit. This override is what makes the key
        # safe to leave configured. See ADR 015.
        settings.KHAYA_API_KEY = "a-key"
        settings.LANGUAGE_PROVIDER = "stub"

        assert isinstance(get_language_provider(), StubLanguageProvider)

    def test_forcing_khaya_without_a_key_fails_loudly(self, settings):
        # Asking for the real provider and silently getting the stub would mean
        # a verification run quietly proved nothing.
        settings.KHAYA_API_KEY = ""
        settings.LANGUAGE_PROVIDER = "khaya"

        with pytest.raises(ValueError):
            get_language_provider()

    def test_an_unrecognized_provider_name_is_rejected(self, settings):
        settings.LANGUAGE_PROVIDER = "not-a-provider"

        with pytest.raises(ValueError):
            get_language_provider()

    def test_every_provider_reports_its_own_name(self, settings):
        # Exposed all the way to the API response so a demo can never present
        # stub output as though it came from real Twi translation.
        settings.LANGUAGE_PROVIDER = "auto"

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

    def test_translation_uses_v2_because_v1_is_past_its_sunset_date(self, monkeypatch):
        # Khaya's v1 translate endpoint answers with `deprecation: true` and a
        # sunset date of 2026-09-06, already passed, so it can be withdrawn
        # without notice. This test is the guard against someone reverting to
        # it and the demo failing on the day. See ADR 013.
        captured = {}

        def fake_post(url, **kwargs):
            captured["url"] = url
            return _FakeResponse(200, "Ne ti yɛ no ya")

        monkeypatch.setattr(requests, "post", fake_post)

        KhayaLanguageProvider(api_key="a-key").translate(
            "the head hurts", source=Language.ENGLISH, target=Language.TWI
        )

        assert captured["url"].endswith("/v2/translate")
        assert "/v1/translate" not in captured["url"]

    def test_synthesize_returns_the_raw_audio_body(self, monkeypatch):
        # Khaya returns audio/wav bytes, not JSON, so this path must not go
        # through the text parsing used by the other two operations.
        monkeypatch.setattr(
            requests, "post", lambda url, **kwargs: _FakeResponse(200, "RIFFWAVE")
        )

        audio = KhayaLanguageProvider(api_key="a-key").synthesize(
            "Ne ti yɛ no ya", language=Language.TWI
        )

        assert audio == b"RIFFWAVE"

    def test_transcribe_sends_the_language_as_a_query_parameter(self, monkeypatch):
        captured = {}

        def fake_post(url, **kwargs):
            captured["url"] = url
            captured["params"] = kwargs.get("params", {})
            captured["data"] = kwargs.get("data")
            return _FakeResponse(200, "wo tiri")

        monkeypatch.setattr(requests, "post", fake_post)

        KhayaLanguageProvider(api_key="a-key").transcribe(
            b"audio-bytes", language=Language.TWI
        )

        assert captured["url"].endswith("/asr/v1/transcribe")
        assert captured["params"]["language"] == "tw"
        assert captured["data"] == b"audio-bytes"

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


class TestKhayaAudioFormat:
    """
    Browsers do not agree on a recording format. Chrome and Firefox produce
    WebM with Opus, Safari on iOS produces MP4, and NFR 6 lists both. Khaya is
    told which one it is receiving rather than being left to guess.
    """

    def test_transcribe_forwards_the_recorded_format(self, monkeypatch):
        captured = {}

        def fake_post(url, **kwargs):
            captured["headers"] = kwargs.get("headers", {})
            return _FakeResponse(200, "wo tiri")

        monkeypatch.setattr(requests, "post", fake_post)

        KhayaLanguageProvider(api_key="a-key").transcribe(
            b"audio", language=Language.TWI, content_type="audio/webm;codecs=opus"
        )

        assert captured["headers"]["Content-Type"] == "audio/webm;codecs=opus"

    def test_transcribe_falls_back_to_raw_bytes_when_format_is_unknown(
        self, monkeypatch
    ):
        captured = {}

        def fake_post(url, **kwargs):
            captured["headers"] = kwargs.get("headers", {})
            return _FakeResponse(200, "wo tiri")

        monkeypatch.setattr(requests, "post", fake_post)

        KhayaLanguageProvider(api_key="a-key").transcribe(
            b"audio", language=Language.TWI
        )

        assert captured["headers"]["Content-Type"] == "application/octet-stream"
