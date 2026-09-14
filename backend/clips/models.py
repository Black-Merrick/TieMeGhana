import re

from django.db import models

#: Anything separating words in a gloss. A phrase may be typed with spaces in
#: the admin, hyphens in a filename, or underscores, and all three mean the
#: same clip.
GLOSS_SEPARATORS = re.compile(r"[\s\-_]+")


def normalize_gloss(gloss: str) -> str:
    """Canonical form of a gloss: uppercase, single underscores between words."""
    return GLOSS_SEPARATORS.sub("_", gloss.strip()).strip("_").upper()


def gloss_tokens(gloss: str) -> tuple[str, ...]:
    """
    The lowercase word sequence a gloss covers.

    Tolerant of separators rather than assuming the canonical form, so a row
    written before normalization existed still resolves.
    """
    return tuple(part for part in GLOSS_SEPARATORS.split(gloss.lower()) if part)


class ClipKind(models.TextChoices):
    """
    What a clip is for, which determines how the resolver may use it.

    Separating LETTER from WORD is what makes the FR 1.6 fingerspelling
    fallback possible: the resolver needs to look up an alphabet without
    risking a letter clip being matched as if it were a whole word sign.
    """

    WORD = "word", "Word sign"
    #: A whole phrase signed as one clip, e.g. WHAT_IS_YOUR_NAME. Preferred
    #: over stitching the same words individually, see ADR 038.
    PHRASE = "phrase", "Phrase sign"
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
    source_checksum = models.CharField(
        max_length=64,
        blank=True,
        editable=False,
        help_text=(
            "Hash of the imported file. Lets a repeated import recognise "
            "unchanged footage and leave its approval alone."
        ),
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

    def clean_fields(self, exclude=None):
        """
        Normalize the gloss before anything is validated against it.

        Here as well as in `save`, and the reason is a 500 the admin used to
        throw. Normalizing only on save meant a gloss typed as "tablet" was
        checked for uniqueness as "tablet", found nothing, passed validation,
        and then became "TABLET" on the way to a database that already had one.
        The doctor got an IntegrityError page instead of "Sign clip with this
        Gloss already exists", which is the same information delivered as a
        crash.

        Normalizing here puts the value the database will see in front of every
        check that runs against it.
        """
        if self.gloss:
            self.gloss = normalize_gloss(self.gloss)

        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        """
        Normalize the gloss before storing it.

        Doing this on save rather than at query time means lookup is one exact
        match instead of a case insensitive scan, and two clips cannot end up
        differing only by capitalization.

        Spaces and hyphens become underscores, so a phrase typed naturally in
        the admin, "how are you doing", is stored as the one form the resolver
        looks for. Without this the row saved cleanly, showed as approved, and
        could never match anything, which is a worse failure than a rejected
        form: it looks finished and does nothing.

        Kept as well as `clean_fields`, not instead of it. Plenty of paths never
        call full_clean: `objects.create`, the footage importer, and every test
        that builds a row directly. Normalizing in only one of the two would
        leave one of those writing a gloss nothing can match.
        """
        self.gloss = normalize_gloss(self.gloss)
        super().save(*args, **kwargs)

    @property
    def is_resolvable(self) -> bool:
        """Whether this single clip may be shown, mirroring the queryset rule."""
        return bool(self.video) and self.review_status == ReviewStatus.APPROVED


class ClipAlias(models.Model):
    """
    Another word that means the same sign, ADR 034.

    A doctor writes "how are you doing" when the library has FEELING. Rather
    than guessing at the similarity, a GhSL fluent consultant records that
    "doing" and "feeling" are interchangeable in this clinical context, and the
    resolver then matches either.

    An alias is a clinical equivalence claim, so it carries its own reviewer
    rather than inheriting the clip's. Approving footage says the sign is
    correct; it does not say which other English words that sign may stand for.
    An alias with no reviewer is ignored entirely.
    """

    clip = models.ForeignKey(
        SignClip,
        on_delete=models.CASCADE,
        related_name="aliases",
        help_text="The sign this word also means.",
    )
    term = models.CharField(
        max_length=64,
        unique=True,
        help_text=(
            "The alternative word, stored uppercase. Unique across the whole "
            "library, because one word cannot mean two different signs."
        ),
    )
    reviewed_by = models.CharField(
        max_length=120,
        blank=True,
        help_text=(
            "The GhSL fluent consultant who confirmed this word and the sign "
            "mean the same thing clinically. Leave empty and the alias is "
            "ignored."
        ),
    )
    notes = models.TextField(
        blank=True, help_text="Why these are interchangeable, or any caveat."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = models.Manager()

    class Meta:
        ordering = ["term"]
        verbose_name = "clip alias"
        verbose_name_plural = "clip aliases"

    def __str__(self) -> str:
        return f"{self.term} -> {self.clip.gloss}"

    def clean_fields(self, exclude=None):
        """Normalize before validation, for the reason SignClip does."""
        if self.term:
            self.term = self.term.strip().upper()

        super().clean_fields(exclude=exclude)

    def save(self, *args, **kwargs):
        """Normalize the term, for the same reason the gloss is normalized."""
        self.term = self.term.strip().upper()
        super().save(*args, **kwargs)

    @property
    def is_usable(self) -> bool:
        """An unreviewed alias is not an equivalence anyone has vouched for."""
        return bool(self.reviewed_by.strip())
