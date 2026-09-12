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


def _silent_wav(milliseconds: int = 400, sample_rate: int = 16000) -> bytes:
    """
    Build a valid, silent WAV file.

    Real silence rather than a placeholder byte string, so the browser can
    actually play it. That matters because the whole point of FR 3.4 is the
    physical feedback around playback: the vibration when speech starts, the
    waveform while it runs, the pulse when it ends. Unplayable bytes would make
    that flow impossible to see without a Khaya key.
    """
    frames = sample_rate * milliseconds // 1000
    data_bytes = frames * 2  # 16 bit mono

    header = b"".join(
        [
            b"RIFF",
            (36 + data_bytes).to_bytes(4, "little"),
            b"WAVEfmt ",
            (16).to_bytes(4, "little"),
            (1).to_bytes(2, "little"),  # uncompressed PCM
            (1).to_bytes(2, "little"),  # mono
            sample_rate.to_bytes(4, "little"),
            (sample_rate * 2).to_bytes(4, "little"),
            (2).to_bytes(2, "little"),
            (16).to_bytes(2, "little"),
            b"data",
            data_bytes.to_bytes(4, "little"),
        ]
    )
    return header + bytes(data_bytes)


#: Silence, so the playback flow works without a Khaya key. The interface warns
#: that it came from the stub, per ADR 011, so it cannot be mistaken for speech.
STUB_AUDIO = _silent_wav()


class StubLanguageProvider(LanguageProvider):
    """
    Returns fixed, honest output.

    Notably `translate` returns the input unchanged rather than inventing Twi.
    Fabricated translation would be worse than none: it would look correct in a
    demo and be wrong in front of a Twi speaking judge. Callers distinguish
    this case by the provider name, which is reported in every API response.
    """

    name = "stub"

    def transcribe(
        self, audio: bytes, *, language: Language, content_type: str | None = None
    ) -> str:
        return STUB_TRANSCRIPT

    def translate(self, text: str, *, source: Language, target: Language) -> str:
        return text

    def synthesize(self, text: str, *, language: Language) -> bytes:
        return STUB_AUDIO
