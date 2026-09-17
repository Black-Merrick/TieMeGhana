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

    `MIXED` is not a third language. It is the doctor declaring that one
    utterance contains both, which is how clinical Ghanaian English and Twi are
    actually spoken: much medical vocabulary has no Twi word, plenty of Twi has
    no single English one, and a speaker moves between them inside a sentence
    without noticing. Asking them to pick one forces a lie, and the system then
    acts on it confidently.

    Crucially it is a statement about *input*, never a target. There is no
    mixed voice to synthesize with and no `mixed-tw` translation direction, so
    it must never reach a provider: see `is_provider_language`, which is
    enforced in the provider itself rather than trusted to callers.
    """

    ENGLISH = "en"
    TWI = "tw"
    MIXED = "mixed"

    @property
    def is_provider_language(self) -> bool:
        """
        Whether a speech or translation service can be asked for this language.

        False only for `MIXED`. Checked before every provider call, because the
        value is interpolated straight into Khaya's request as a language code:
        "mixed" or "mixed-tw" would be a metered request that either errors or,
        worse, is quietly treated as something else and returns confident
        nonsense the doctor has no way to spot.
        """
        return self is not Language.MIXED


class LanguageError(RuntimeError):
    """
    A language operation could not be completed.

    Typed so a caller can tell a provider outage apart from a bad caption. The
    two need different handling: an outage should tell the doctor to retry or
    type instead, a bad caption should not.
    """


class LanguageQuotaExceeded(LanguageError):
    """
    The provider is reachable and the credential is good, but the allowance is
    spent.

    Kept apart from a general `LanguageError` because the two need opposite
    advice and the difference is hours long. An outage is worth retrying in a
    moment. A spent quota is not: Khaya's free tier answers 403 with "Out of
    call volume quota. Quota will be replenished in 14:19:29", and telling a
    clinician mid consultation to try again is sending them to do it for the
    rest of the day.
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
