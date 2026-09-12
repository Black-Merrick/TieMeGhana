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

# GhSL clips are keyed on English glosses, per the SRS definition of Gloss and
# FR 1.5. So the text used to look up signs is English, and it is NOT the Twi
# caption. Resolving from the caption would tokenize Twi words against English
# glosses and never match, which is invisible against a translator that returns
# its input unchanged and total against a real one.
SIGN_LOOKUP_LANGUAGE = Language.ENGLISH


@dataclass(frozen=True)
class Caption:
    """One doctor utterance, fully rendered for the patient's screen."""

    source_language: str
    transcript: str
    caption: str
    caption_language: str
    sign_lookup_text: str
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

    # Two different renderings of the same utterance, for two different
    # audiences. The caption is Twi because that is what the patient reads. The
    # lookup text is English because that is what the clip library is keyed on.
    # FR 1.3 translates only when needed, so whichever of the two already
    # matches the transcript costs no call, and the other costs exactly one.
    caption = _rendered_in(
        transcript, provider, source=source_language, target=CAPTION_LANGUAGE
    )
    sign_lookup_text = _rendered_in(
        transcript, provider, source=source_language, target=SIGN_LOOKUP_LANGUAGE
    )

    return Caption(
        source_language=str(source_language),
        transcript=transcript,
        caption=caption,
        caption_language=str(CAPTION_LANGUAGE),
        sign_lookup_text=sign_lookup_text,
        translation_applied=source_language != CAPTION_LANGUAGE,
        language_provider=provider.name,
        sequence=resolve_sign_sequence(sign_lookup_text),
    )


def _rendered_in(text, provider, *, source: Language, target: Language) -> str:
    """Return the text in the target language, translating only if it differs."""
    if source == target:
        return text
    return provider.translate(text, source=source, target=target)
