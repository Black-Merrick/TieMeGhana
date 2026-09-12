"""
GhanaNLP Khaya AI provider, per ADR 003.

Endpoint paths and payload shapes are configurable rather than hardcoded,
because they have NOT yet been verified against a live Khaya account. The team
has no API key at the time of writing, so the values below are the documented
shapes and must be confirmed the moment a key arrives. That verification is
tracked in BACKLOG.md.

This is precisely why the provider interface exists: if an endpoint or payload
turns out to differ, the change is confined to this one file and nothing else
in the system moves.
"""

import requests
from django.conf import settings

from core.language.base import Language, LanguageError, LanguageProvider

DEFAULT_BASE_URL = "https://translation-api.ghananlp.org"

# Khaya is fronted by Azure API Management, which expects the credential in
# this header rather than as a bearer token.
API_KEY_HEADER = "Ocp-Apim-Subscription-Key"

# A consultation cannot wait on a hung request. NFR 1 allows five seconds for
# the entire pipeline, so a single call gets well under that and the caller
# falls back to typing if it expires.
REQUEST_TIMEOUT_SECONDS = 4


class KhayaLanguageProvider(LanguageProvider):
    """Twi speech recognition, translation, and synthesis through Khaya AI."""

    name = "khaya"

    def __init__(self, api_key: str, base_url: str | None = None):
        if not api_key:
            # Failing here rather than at the first request means a
            # misconfiguration surfaces at startup, not mid consultation.
            raise ValueError("KhayaLanguageProvider requires an API key.")

        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    def transcribe(self, audio: bytes, *, language: Language) -> str:
        response = self._request(
            "/asr/v1/transcribe",
            params={"language": str(language)},
            data=audio,
            content_type="application/octet-stream",
        )
        return self._read_text(response)

    def translate(self, text: str, *, source: Language, target: Language) -> str:
        response = self._request(
            "/v1/translate",
            json={"in": text, "lang": f"{source}-{target}"},
        )
        return self._read_text(response)

    def synthesize(self, text: str, *, language: Language) -> bytes:
        response = self._request(
            "/tts/v1/tts",
            json={"text": text, "language": str(language)},
        )
        return response.content

    def _request(
        self,
        path: str,
        *,
        json: dict | None = None,
        data: bytes | None = None,
        params: dict | None = None,
        content_type: str = "application/json",
    ):
        """
        Send one request to Khaya, converting every failure into LanguageError.

        Both transport failures and error responses are folded into one error
        type, because from the caller's point of view they mean the same thing:
        the language service is unavailable and the doctor should type instead.
        """
        headers = {API_KEY_HEADER: self._api_key, "Content-Type": content_type}

        try:
            response = requests.post(
                f"{self._base_url}{path}",
                headers=headers,
                json=json,
                data=data,
                params=params,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as error:
            raise LanguageError(f"Khaya request to {path} failed: {error}") from error

        if not response.ok:
            raise LanguageError(
                f"Khaya returned {response.status_code} for {path}: {response.text}"
            )

        return response

    @staticmethod
    def _read_text(response) -> str:
        """
        Pull the text out of a Khaya response.

        Khaya returns a bare JSON string for some operations and an object for
        others, so both are handled rather than assuming one shape and failing
        on the other.
        """
        try:
            payload = response.json()
        except ValueError as error:
            raise LanguageError("Khaya returned a non JSON response.") from error

        if isinstance(payload, str):
            return payload
        if isinstance(payload, dict):
            for key in ("translation", "text", "transcription", "result"):
                value = payload.get(key)
                if isinstance(value, str):
                    return value

        raise LanguageError(f"Khaya response had no recognizable text: {payload!r}")


def build_khaya_provider() -> KhayaLanguageProvider:
    """Construct the provider from Django settings."""
    return KhayaLanguageProvider(
        api_key=settings.KHAYA_API_KEY,
        base_url=getattr(settings, "KHAYA_BASE_URL", None),
    )
