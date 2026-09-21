"""
The doctor to patient caption pipeline, SRS FR 1.1 to FR 1.7.

One function chains the whole flow: speech to text, text to Twi, Twi to GhSL
clips. It is a single call rather than three endpoints because NFR 1 allows
five seconds end to end, and three round trips from a phone on a hospital
network would spend most of that budget on latency alone.
"""

import logging
import time
from dataclasses import dataclass

from clips.services import SignSequence, resolve_sign_sequence
from core.language import Language, LanguageError, get_language_provider
from core.language.base import LanguageQuotaExceeded

logger = logging.getLogger(__name__)

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
    # "spoken" or "typed". Needed because a stubbed transcript is invented
    # rather than merely untranslated, so the interface has to say something
    # stronger when the doctor spoke than when they typed.
    transcript_source: str
    translation_applied: bool
    # "" when the caption is what it should be. "quota" or "unavailable" when
    # the patient is reading untranslated text, so the interface can say which
    # and give advice that is actually true.
    caption_problem: str
    language_provider: str
    sequence: SignSequence
    # NFR 1's five second budget, measured rather than assumed. Everything
    # from the provider call in, transcription through sign resolution, and
    # nothing outside it: the request parsing before this function is called
    # and the response serialization after it returns are the same for every
    # request regardless of provider, so they would only dilute a number whose
    # whole point is showing where a slow provider or a slow network actually
    # costs time.
    pipeline_ms: int


def build_caption(
    *,
    source_language: Language,
    text: str | None = None,
    audio: bytes | None = None,
    audio_content_type: str | None = None,
) -> Caption:
    """
    Turn what the doctor said into a Twi caption and the clips that render it.

    Raises `LanguageError` only when there is nothing left to show: speech
    recognition failing, or the sign lookup itself failing, which happens when
    the doctor wrote Twi and it could not be turned into the English the clip
    library is keyed on. The view turns that into a 503 and the doctor is told
    to type instead.

    A caption that cannot be translated is not one of those cases. The signs
    still resolve and still play, so the request succeeds and reports the
    problem in `caption_problem` rather than throwing the video away with the
    subtitle.
    """
    provider = get_language_provider()
    # NFR 1's five second budget is spent almost entirely in this function:
    # everything before it is request parsing, which costs the same regardless
    # of provider, and everything after it is serializing a response that is
    # already built. Timed with perf_counter rather than time.time, which can
    # jump backwards on a clock adjustment and turn a fast request into a
    # negative duration in the logs.
    started = time.perf_counter()

    try:
        transcript = (
            provider.transcribe(
                audio, language=source_language, content_type=audio_content_type
            )
            if audio is not None
            else text
        )

        # The signs first, and deliberately in that order. This is the app's
        # primary function, and for English input it needs no translation at
        # all: the library is keyed on English, so the lookup text is the
        # transcript. A failure here is fatal, because there is nothing to
        # show without it.
        sign_lookup_text = _rendered_in(
            transcript, provider, source=source_language, target=SIGN_LOOKUP_LANGUAGE
        )

        # The caption second, and its failure is survivable.
        #
        # This used to bring the whole request down with it. An English
        # question whose signs were already resolved, and needed no
        # translation to resolve, returned 503 because the Twi caption beside
        # the video could not be fetched. The doctor lost the sign video over
        # the subtitle.
        #
        # So a failed caption degrades to the untranslated text and says so.
        # The patient watches the signs, which is what they are there for, and
        # reads the doctor's own words rather than Twi, clearly labelled as
        # untranslated rather than passed off as a translation.
        caption_problem = ""
        try:
            caption = _rendered_in(
                transcript, provider, source=source_language, target=CAPTION_LANGUAGE
            )
        except LanguageQuotaExceeded:
            caption, caption_problem = transcript, "quota"
        except LanguageError:
            caption, caption_problem = transcript, "unavailable"

        sequence = resolve_sign_sequence(sign_lookup_text)
    finally:
        # Logged unconditionally, success or failure, because a request that
        # timed out partway through the provider call is exactly the one a
        # developer chasing a slow demo needs the duration of. The doctor
        # never sees this number; it is server side diagnostics only, per the
        # same reasoning the caption and speak views already log the
        # provider's own error under: real, metered credit should never have
        # to be spent twice to learn what the first attempt already knew.
        pipeline_ms = round((time.perf_counter() - started) * 1000)
        logger.info(
            "Caption pipeline finished in %sms, provider=%s spoken=%s",
            pipeline_ms,
            provider.name,
            audio is not None,
        )

    return Caption(
        source_language=str(source_language),
        transcript=transcript,
        caption=caption,
        # A mixed utterance is shown as the doctor wrote it, and an
        # untranslated one is not Twi either, and saying it is would be the
        # ADR 011 failure in another costume.
        caption_language=str(
            source_language
            if source_language is Language.MIXED or caption_problem
            else CAPTION_LANGUAGE
        ),
        sign_lookup_text=sign_lookup_text,
        transcript_source="spoken" if audio is not None else "typed",
        translation_applied=(
            not caption_problem
            and source_language is not Language.MIXED
            and source_language != CAPTION_LANGUAGE
        ),
        caption_problem=caption_problem,
        language_provider=provider.name,
        sequence=sequence,
        pipeline_ms=pipeline_ms,
    )


def _rendered_in(text, provider, *, source: Language, target: Language) -> str:
    """
    Return the text in the target language, translating only if it differs.

    A mixed utterance is returned untouched, and that is the whole handling of
    code switching rather than a gap in it.

    There is no `mixed-tw` translation direction to ask for, and no way to
    translate half a sentence without first knowing which half is which, which
    would take a Twi lexicon the project does not have. What it does have is a
    safety gate: the sign resolver tokenizes this text against an English keyed
    library, so a Twi word simply does not resolve, and ADR 033 already reports
    an unresolved content word as blocking rather than dropping it. The doctor
    is told precisely which words could not be signed and can rephrase them.

    That is a better outcome than translating the whole string as though it
    were one language, which is what happened before: "Fa paracetamol mmienu"
    declared as Twi went to the translator entire, and it returned something
    fluent and wrong, with nothing on screen to suggest it.
    """
    if source is Language.MIXED or source == target:
        return text
    return provider.translate(text, source=source, target=target)
