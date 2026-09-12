"""
Seed the clinical question bank for Guided Interrogation Mode.

The bank is a fixed, pre reviewed list per SRS section 4.3, so it is defined
here in code and reviewed in the repository rather than typed in at runtime.
Everything seeded is inactive for the patient until the GhSL prompt clip for it
is filmed and approved, exactly like the clip library.

Wording here is a starting point for the GhSL consultant review recorded in
BACKLOG.md, not a finished clinical instrument.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from clips.models import ClipKind, SignClip
from questions.models import AnswerOption, ClinicalQuestion, QuestionType
from questions.services import NOD_INSTRUCTION_GLOSS, resolve_question_sequences

# Body locations for "where does it hurt", FR 2.5's worked example. Each entry
# is the English gloss of an existing word clip.
BODY_LOCATIONS = [
    ("Head", "HEAD"),
    ("Ear", "EAR"),
    ("Throat", "THROAT"),
    ("Chest", "CHEST"),
    ("Stomach", "STOMACH"),
    ("Back", "BACK"),
    ("Arm", "ARM"),
    ("Leg", "LEG"),
]

DURATIONS = [
    ("Today", "TODAY"),
    ("Yesterday", "YESTERDAY"),
    ("About a week", "WEEK"),
    ("About a month", "MONTH"),
]

# English wording, type, category, answer options.
#
# Wording is chosen to reuse words the clip library already contains, because
# the question is stitched from those clips. A question full of rare words
# would fingerspell and be hard for the patient to follow.
BANK = [
    ("Where does it hurt?", QuestionType.SELECTION, "intake", BODY_LOCATIONS),
    ("How long have you felt this?", QuestionType.SELECTION, "intake", DURATIONS),
    ("Do you feel nausea?", QuestionType.YES_NO, "symptoms", []),
    ("Do you have fever?", QuestionType.YES_NO, "symptoms", []),
    ("Did you vomit?", QuestionType.YES_NO, "symptoms", []),
    ("Can you breathe?", QuestionType.YES_NO, "symptoms", []),
    ("Are you taking medicine?", QuestionType.YES_NO, "history", []),
    ("Do you have allergy?", QuestionType.YES_NO, "history", []),
    ("Are you pregnant?", QuestionType.YES_NO, "history", []),
]


class Command(BaseCommand):
    help = "Seed the clinical question bank, without approving any footage."

    def handle(self, *args, **options):
        created = 0

        with transaction.atomic():
            # FR 2.6's instruction to nod or shake is one clip appended to every
            # yes or no question, rather than filmed into each one.
            SignClip.objects.get_or_create(
                gloss=NOD_INSTRUCTION_GLOSS, defaults={"kind": ClipKind.PROMPT}
            )

            for order, (text, kind, category, answers) in enumerate(BANK):
                question, is_new = self._seed_question(text, kind, category, order)
                created += int(is_new)
                self._seed_options(question, answers)

        self.stdout.write(
            self.style.SUCCESS(f"Seeded {created} new question(s) of {len(BANK)}.")
        )
        self._report()

    def _seed_question(self, text, question_type, category, order):
        """
        Create the question.

        No prompt clip is created. The question is stitched from the word clips
        already in the library, which is why adding a question costs no new
        filming. See ADR 021.
        """
        return ClinicalQuestion.objects.get_or_create(
            english_text=text,
            defaults={
                "question_type": question_type,
                "category": category,
                "order": order,
            },
        )

    def _seed_options(self, question, answers):
        """
        Attach answer options, each pointing at the word clip that signs it.
        """
        for position, (label, gloss) in enumerate(answers):
            clip, _ = SignClip.objects.get_or_create(
                gloss=gloss, defaults={"kind": ClipKind.WORD}
            )
            AnswerOption.objects.get_or_create(
                question=question,
                order=position,
                defaults={"english_text": label, "clip": clip},
            )

    def _report(self) -> None:
        questions = list(ClinicalQuestion.objects.active())
        sequences = resolve_question_sequences(questions)

        playable = sum(
            1
            for question in questions
            if any(segment.clips for segment in sequences[question.pk].segments)
        )

        self.stdout.write("")
        self.stdout.write(f"Question bank: {len(questions)} active question(s)")
        self.stdout.write(f"  Can be signed at least partly: {playable}")
        self.stdout.write(f"  Nothing to show yet: {len(questions) - playable}")

        if playable < len(questions):
            self.stdout.write(
                self.style.WARNING(
                    "\nQuestions are stitched from the word clips in the library, "
                    "so coverage improves as footage is filmed. No question needs "
                    "a clip of its own."
                )
            )
