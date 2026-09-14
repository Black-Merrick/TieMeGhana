"""
Speaking a patient's response aloud, SRS FR 3.1 to FR 3.5.

Every patient response goes out as audio, whether the patient typed it or
tapped it. FR 3.5 is explicit about the tapped case: the doctor's hands are on
the patient rather than the screen, so the answer has to be audible without
them looking.
"""

from dataclasses import dataclass

from core.language import Language, get_language_provider


@dataclass(frozen=True)
class SpokenResponse:
    """One patient response, rendered as speech for the hearing listener."""

    source_language: str
    output_language: str
    spoken_text: str
    translation_applied: bool
    language_provider: str
    audio: bytes
    audio_media_type: str


def speak_response(
    *,
    text: str,
    source_language: Language,
    output_language: Language,
) -> SpokenResponse:
    """
    Translate a patient response if needed, then render it as speech.

    The output language is the hearing listener's, set once per session by the
    doctor or nurse per FR 3.4, and it is theirs rather than the patient's: the
    point is that whoever is listening understands, regardless of which of the
    two languages they speak.

    Raises `LanguageError` if translation or synthesis fails, which the view
    turns into a 503 so the doctor is told to read the screen instead.
    """
    provider = get_language_provider()

    needs_translation = source_language != output_language
    spoken_text = (
        provider.translate(text, source=source_language, target=output_language)
        if needs_translation
        else text
    )

    return SpokenResponse(
        source_language=str(source_language),
        output_language=str(output_language),
        spoken_text=spoken_text,
        translation_applied=needs_translation,
        language_provider=provider.name,
        audio=provider.synthesize(spoken_text, language=output_language),
        audio_media_type=provider.synthesis_media_type,
    )
