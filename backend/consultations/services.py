"""
The doctor to patient caption pipeline, SRS FR 1.1 to FR 1.7.

One function chains the whole flow: speech to text, text to Twi, Twi to GhSL
clips. It is a single call rather than three endpoints because NFR 1 allows
five seconds end to end, and three round trips from a phone on a hospital
network would spend most of that budget on latency alone.
"""

from dataclasses import dataclass

from clips.services import SignSequence, resolve_sign_sequence
from core.language import Language, get_language_provider

# The patient always reads Twi, so the caption target never varies. FR 1.1
# chooses the doctor's *input* language, not the patient's output language.
CAPTION_LANGUAGE = Language.TWI


@dataclass(frozen=True)
class Caption:
    """One doctor utterance, fully rendered for the patient's screen."""

    source_language: str
    transcript: str
    caption: str
    caption_language: str
    translation_applied: bool
    language_provider: str
    sequence: SignSequence


def build_caption(
    *,
    source_language: Language,
    text: str | None = None,
    audio: bytes | None = None,
) -> Caption:
    """
    Turn what the doctor said into a Twi caption and the clips that render it.

    Raises `LanguageError` if speech recognition or translation fails, which the
    view turns into a 503 so the doctor is told to type instead. A failure here
    is not a bad caption, it is no caption, and the two need different handling.
    """
    provider = get_language_provider()

    transcript = (
        provider.transcribe(audio, language=source_language)
        if audio is not None
        else text
    )

    # FR 1.3 translates only when needed. A doctor already speaking Twi should
    # not have their words round tripped through English, which would lose
    # meaning for no benefit.
    needs_translation = source_language != CAPTION_LANGUAGE
    caption = (
        provider.translate(transcript, source=source_language, target=CAPTION_LANGUAGE)
        if needs_translation
        else transcript
    )

    return Caption(
        source_language=str(source_language),
        transcript=transcript,
        caption=caption,
        caption_language=str(CAPTION_LANGUAGE),
        translation_applied=needs_translation,
        language_provider=provider.name,
        sequence=resolve_sign_sequence(caption),
    )
