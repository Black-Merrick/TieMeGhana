from django.db import models

from clips.models import SignClip


class QuestionType(models.TextChoices):
    """
    How the patient answers, which decides what the app renders.

    The distinction is behavioural, not cosmetic. A selection question shows a
    grid of sign videos to tap, FR 2.5. A yes or no question asks the patient
    to nod or shake their head, which the doctor observes in person and then
    confirms on their own screen, FR 2.6 and FR 2.7.
    """

    SELECTION = "selection", "Patient taps a sign video answer"
    YES_NO = "yes_no", "Patient nods or shakes, doctor confirms"


class ClinicalQuestionQuerySet(models.QuerySet):
    def active(self):
        """Questions currently in the bank, whatever their clip coverage."""
        return self.filter(is_active=True)

    def with_options(self):
        """
        Prefetch answer options and their clips.

        The doctor opens the bank mid consultation, so a query per option would
        make a realistic bank slow on a hospital connection.
        """
        return self.prefetch_related("options__clip")


class ClinicalQuestion(models.Model):
    """
    One question from the pre reviewed clinical bank, FR 2.4.

    The English text is what the doctor reads when choosing from the bank. The
    patient never reads it: the question is played to them as a stitched GhSL
    video, resolved from these words through the clip library exactly as a
    caption is.

    That is why a question needs no filmed clip of its own. It reuses the word
    clips already being recorded, so adding a question costs no new filming.
    See ADR 021.
    """

    english_text = models.CharField(
        max_length=200,
        help_text=(
            "What the doctor reads, and the text the GhSL video is stitched "
            "from. Prefer words that exist in the clip library."
        ),
    )
    twi_text = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional Twi caption, for a patient who also reads Twi.",
    )
    question_type = models.CharField(
        max_length=16, choices=QuestionType.choices, default=QuestionType.SELECTION
    )
    category = models.CharField(
        max_length=60,
        blank=True,
        help_text="Groups the bank for the doctor, for example intake or pain.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Clear this to retire a question without deleting its history.",
    )
    order = models.PositiveIntegerField(
        default=0, help_text="Position in the bank. The bank is a clinical checklist."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ClinicalQuestionQuerySet.as_manager()

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.english_text


class AnswerOption(models.Model):
    """
    One tappable answer in a selection question's grid, FR 2.5.

    The patient taps a sign video, for example a body location, not a text
    label, because they may not read print at all.
    """

    question = models.ForeignKey(
        ClinicalQuestion,
        on_delete=models.CASCADE,
        related_name="options",
        help_text="Deleting the question deletes its options, never orphans them.",
    )
    english_text = models.CharField(
        max_length=120, help_text="What the doctor reads. The patient sees the clip."
    )
    clip = models.ForeignKey(
        SignClip,
        on_delete=models.PROTECT,
        related_name="answer_options",
        help_text="The answer signed in GhSL, which is what the patient taps.",
    )
    order = models.PositiveIntegerField(
        default=0, help_text="Position in the grid, so the layout is deterministic."
    )

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            # A grid with an ambiguous order would render differently between
            # devices, so the doctor and the patient could be looking at
            # different layouts while discussing "the second one".
            models.UniqueConstraint(
                fields=["question", "order"], name="unique_option_position"
            )
        ]

    def __str__(self) -> str:
        return f"{self.question.english_text}: {self.english_text}"
