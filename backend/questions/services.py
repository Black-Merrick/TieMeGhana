"""
Turning clinical questions into the GhSL video a patient watches.

A question carries no filmed clip of its own. It is stitched from the word
clips already in the library, the same way a caption is, which is what makes
adding a question cost no new filming. See ADR 021.
"""

from clips.models import SignClip
from clips.services import SignSequence, resolve_sign_sequences, with_appended_clip
from questions.models import ClinicalQuestion, QuestionType

# FR 2.6 requires the app to instruct the patient, in sign video, to nod or
# shake their head. That instruction is one reviewed clip appended to every yes
# or no question, rather than filmed separately into each one.
NOD_INSTRUCTION_GLOSS = "NOD_OR_SHAKE"


def resolve_question_sequences(
    questions: list[ClinicalQuestion],
) -> dict[int, SignSequence]:
    """
    Resolve the GhSL video for every question in one pass.

    Batched deliberately. The doctor opens the whole bank at once, so resolving
    each question separately would cost two queries per question and make the
    bank slow to open mid consultation.
    """
    if not questions:
        return {}

    sequences = resolve_sign_sequences([q.english_text for q in questions])

    # Looked up once for the whole bank, not once per question.
    instruction = (
        SignClip.objects.resolvable().filter(gloss=NOD_INSTRUCTION_GLOSS).first()
    )

    resolved = {}
    for question, sequence in zip(questions, sequences, strict=True):
        if question.question_type == QuestionType.YES_NO and instruction is not None:
            sequence = with_appended_clip(sequence, instruction)
        resolved[question.pk] = sequence

    return resolved
