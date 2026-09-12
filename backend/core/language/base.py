"""
The language provider contract, SRS FR 1.2, FR 1.3, and FR 3.4.

Every speech and translation operation in the app goes through this interface.
Nothing calls a third party service directly, so the whole system can run
against a deterministic stub in tests, in CI, and on a fresh clone with no
credentials.
"""

from abc import ABC, abstractmethod
from enum import StrEnum


class Language(StrEnum):
    """
    The languages the system handles.

    Twi is `tw`, matching the ISO code Khaya uses, so the value can be sent to
    the provider without a translation table in between.
    """

    ENGLISH = "en"
    TWI = "tw"


class LanguageError(RuntimeError):
    """
    A language operation could not be completed.

    Typed so a caller can tell a provider outage apart from a bad caption. The
    two need different handling: an outage should tell the doctor to retry or
    type instead, a bad caption should not.
    """


class LanguageProvider(ABC):
    """
    Speech recognition, translation, and speech synthesis for one backend.

    Keyword only arguments throughout, because `translate(text, "en", "tw")`
    reads identically to the reversed, wrong version, and getting the direction
    backwards would produce confidently incorrect Twi.
    """

    #: Reported in API responses so a demo can never pass stub output off as
    #: real Twi. See ADR 011.
    name: str

    #: What `synthesize` returns, so the browser knows how to play it rather
    #: than the media type being assumed somewhere up the stack.
    synthesis_media_type: str = "audio/wav"

    @abstractmethod
    def transcribe(
        self, audio: bytes, *, language: Language, content_type: str | None = None
    ) -> str:
        """
        Transcribe spoken audio into text in the same language, FR 1.2.

        `content_type` is what the browser said it recorded. Chrome and Firefox
        produce WebM with Opus, Safari on iOS produces MP4, so passing it on is
        strictly more information than asserting a single format.
        """

    @abstractmethod
    def translate(self, text: str, *, source: Language, target: Language) -> str:
        """Translate text between English and Twi, FR 1.3."""

    @abstractmethod
    def synthesize(self, text: str, *, language: Language) -> bytes:
        """Render text as spoken audio, FR 3.4."""
