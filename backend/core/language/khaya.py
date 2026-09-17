"""
GhanaNLP Khaya AI provider, per ADR 003.

Every path and payload below was verified against a live Khaya account on
2026-09-12. Translation returned real Twi, synthesis returned a genuine WAV,
and transcription rejected deliberately invalid audio with a 400 rather than a
404, confirming the route and credential.

Translation uses v2 deliberately. The v1 endpoint still answers, but it
responds with `deprecation: true` and a `sunset` date of 2026-09-06 that has
already passed, so it could be switched off without notice. See ADR 013.

Paths stay module level constants rather than inline literals so a future
version bump is one edit, which is the whole reason this provider sits behind
an interface.
"""

import requests
from django.conf import settings

from core.language.base import (
    Language,
    LanguageError,
    LanguageProvider,
    LanguageQuotaExceeded,
)

DEFAULT_BASE_URL = "https://translation-api.ghananlp.org"

# v2, not v1. v1 is past its announced sunset date, see the module docstring.
TRANSLATE_PATH = "/v2/translate"
TRANSCRIBE_PATH = "/asr/v1/transcribe"
SYNTHESIZE_PATH = "/tts/v1/tts"

# Khaya is fronted by Azure API Management, which expects the credential in
# this header rather than as a bearer token.
API_KEY_HEADER = "Ocp-Apim-Subscription-Key"

# A consultation cannot wait on a hung request. NFR 1 allows five seconds for
# the entire pipeline, so a single call gets well under that and the caller
# falls back to typing if it expires.
REQUEST_TIMEOUT_SECONDS = 4


def _is_quota_exhausted(response) -> bool:
    """
    Whether this refusal is a spent allowance rather than a broken request.

    Khaya answers 403 with a body naming the quota and when it returns. Matched
    on the message as well as the status, because 403 is also what a revoked or
    wrong key would produce, and those need a completely different answer from
    whoever is holding the phone.
    """
    if response.status_code != 403:
        return False

    return "quota" in response.text.lower()


def _refuse_unless_a_real_language(**languages: Language) -> None:
    """
    Stop `MIXED` from ever being sent to Khaya as a language code.

    Every language argument here is interpolated straight into the request:
    `params={"language": str(language)}` and `lang=f"{source}-{target}"`. So a
    `MIXED` that slipped through would go out as "mixed" or "mixed-tw". That is
    a metered request on a free tier, and the failure it produces is the bad
    kind: either an error mid consultation, or a 200 the doctor cannot tell
    from real Twi.

    A mixed utterance is meant to be passed through untranslated, which is
    `build_caption`'s job. This is the backstop for the day someone adds a code
    path that forgets, because that mistake costs credit and clinical trust
    rather than a test failure.
    """
    for role, language in languages.items():
        if not language.is_provider_language:
            raise LanguageError(
                f"Khaya cannot be asked for {role}={language!s}: it is a "
                "declaration that one utterance mixes English and Twi, not a "
                "language the service can transcribe, translate or speak. Such "
                "text is passed through untranslated instead."
            )


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

    def transcribe(
        self, audio: bytes, *, language: Language, content_type: str | None = None
    ) -> str:
        _refuse_unless_a_real_language(language=language)
        response = self._request(
            TRANSCRIBE_PATH,
            params={"language": str(language)},
            data=audio,
            # Tell Khaya what the browser actually recorded. Falls back to raw
            # bytes when the upload carried no type.
            content_type=content_type or "application/octet-stream",
        )
        return self._read_text(response)

    def translate(self, text: str, *, source: Language, target: Language) -> str:
        _refuse_unless_a_real_language(source=source, target=target)
        response = self._request(
            TRANSLATE_PATH,
            json={"in": text, "lang": f"{source}-{target}"},
        )
        return self._read_text(response)

    def synthesize(self, text: str, *, language: Language) -> bytes:
        _refuse_unless_a_real_language(language=language)
        response = self._request(
            SYNTHESIZE_PATH,
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
            if _is_quota_exhausted(response):
                # Reachable, credential fine, allowance spent. The caller needs
                # to say something different from "try again", because the
                # replenishment is measured in hours.
                raise LanguageQuotaExceeded(
                    f"Khaya quota exhausted for {path}: {response.text}"
                )

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
