from django.db import models


class ClipKind(models.TextChoices):
    """
    What a clip is for, which determines how the resolver may use it.

    Separating LETTER from WORD is what makes the FR 1.6 fingerspelling
    fallback possible: the resolver needs to look up an alphabet without
    risking a letter clip being matched as if it were a whole word sign.
    """

    WORD = "word", "Word sign"
    LETTER = "letter", "Fingerspelling letter"
    ALERT = "alert", "Emergency alert"
    # A question the app itself asks, such as the FR 2.1 literacy check. Kept
    # separate from WORD so a system prompt can never be matched as an ordinary
    # word while tokenizing a caption.
    PROMPT = "prompt", "System prompt"


class ReviewStatus(models.TextChoices):
    """
    Whether a GhSL fluent consultant has cleared this clip for clinical use.

    An incorrect medical sign carries real consequences, so review is a state
    on the record itself rather than a process happening somewhere outside the
    system where it could be skipped.
    """

    PENDING = "pending", "Awaiting consultant review"
    APPROVED = "approved", "Approved for clinical use"
    REJECTED = "rejected", "Rejected, must not be used"


class SignClipQuerySet(models.QuerySet):
    def resolvable(self):
        """
        Clips the resolver is allowed to show a patient.

        Both conditions matter. Approval means a consultant vouched for the
        sign. Non empty video means the footage exists. A row can satisfy one
        without the other, and neither alone is safe to play.
        """
        return self.filter(review_status=ReviewStatus.APPROVED).exclude(video="")

    def awaiting_footage(self):
        """
        Glosses that have been scoped but not yet filmed.

        The library doubles as the team's footage tracker, so this answers
        "what still needs recording" without a separate spreadsheet.
        """
        return self.filter(video="")

    def awaiting_review(self):
        """Filmed clips that a consultant has not yet cleared."""
        return self.filter(review_status=ReviewStatus.PENDING).exclude(video="")


class SignClip(models.Model):
    """
    One reviewed Ghanaian Sign Language clip, looked up by its English gloss.

    The gloss is the lookup key, per the SRS definition, which is why it is
    unique and normalized. A clip may exist before its footage does, so the
    library can record the vocabulary the project needs ahead of filming it.
    """

    gloss = models.CharField(
        max_length=64,
        unique=True,
        help_text="English word label used as the lookup key. Stored uppercase.",
    )
    kind = models.CharField(
        max_length=16, choices=ClipKind.choices, default=ClipKind.WORD
    )
    video = models.FileField(
        upload_to="clips/",
        blank=True,
        help_text="Leave empty to record a gloss that still needs filming.",
    )
    duration_ms = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Playback length, used to estimate total sequence duration.",
    )
    review_status = models.CharField(
        max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    reviewed_by = models.CharField(
        max_length=120,
        blank=True,
        help_text="Name of the GhSL fluent consultant who approved this sign.",
    )
    notes = models.TextField(
        blank=True,
        help_text="Regional variation, ambiguity, or anything a reviewer flagged.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = SignClipQuerySet.as_manager()

    class Meta:
        ordering = ["gloss"]
        verbose_name = "GhSL clip"
        verbose_name_plural = "GhSL clips"

    def __str__(self) -> str:
        return f"{self.gloss} ({self.get_kind_display()})"

    def save(self, *args, **kwargs):
        """
        Normalize the gloss before storing it.

        Doing this on save rather than at query time means lookup is one exact
        match instead of a case insensitive scan, and two clips cannot end up
        differing only by capitalization.
        """
        self.gloss = self.gloss.strip().upper()
        super().save(*args, **kwargs)

    @property
    def is_resolvable(self) -> bool:
        """Whether this single clip may be shown, mirroring the queryset rule."""
        return bool(self.video) and self.review_status == ReviewStatus.APPROVED
