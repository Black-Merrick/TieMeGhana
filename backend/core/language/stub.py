"""
A deterministic language provider for tests, CI, and credential free clones.

This is a real working implementation, not a placeholder that raises. The whole
app has to be runnable without a Khaya key, otherwise every test would depend
on a live service and a network blip would look like a regression.
"""

from core.language.base import Language, LanguageProvider

# What the stub "hears". A fixed clinical sentence, so the caption pipeline has
# something meaningful to resolve against the seeded vocabulary end to end.
STUB_TRANSCRIPT = "the head hurts today"

# A recognizable, tiny payload. Never played to anyone, it only has to prove
# the synthesis step ran and returned bytes.
STUB_AUDIO = b"stub-audio"


class StubLanguageProvider(LanguageProvider):
    """
    Returns fixed, honest output.

    Notably `translate` returns the input unchanged rather than inventing Twi.
    Fabricated translation would be worse than none: it would look correct in a
    demo and be wrong in front of a Twi speaking judge. Callers distinguish
    this case by the provider name, which is reported in every API response.
    """

    name = "stub"

    def transcribe(self, audio: bytes, *, language: Language) -> str:
        return STUB_TRANSCRIPT

    def translate(self, text: str, *, source: Language, target: Language) -> str:
        return text

    def synthesize(self, text: str, *, language: Language) -> bytes:
        return STUB_AUDIO
