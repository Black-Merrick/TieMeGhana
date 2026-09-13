"""
Prescription playlists, SRS FR 6.1 to FR 6.4.

What the doctor sends home with the patient: an ordered list of medicines, each
with a dosage and a frequency, replayable in GhSL from a QR code.

Two decisions shape this module, both recorded as ADRs.

The instruction is stored as words, never as clip ids. See ADR 043: the signs
are resolved fresh on every read, so a sign withdrawn by a consultant stops
playing everywhere immediately, and a sign filmed next month improves a
prescription issued today.

There is no field here that identifies a patient. See ADR 044: FR 6.4 is
enforced by what the row can hold, not by a permission check on who may read
it. The unguessable reference is the only key, and it grants access to nothing
but medicine names and dosages.
"""

import secrets

from django.db import models

# 16 bytes, url safe, so roughly 22 characters. Long enough that guessing one
# is not a thing that happens, short enough for a QR code to stay coarse
# grained and scannable on a cheap phone camera in a hospital corridor.
REFERENCE_BYTES = 16


def new_reference() -> str:
    """
    A fresh, unguessable prescription reference.

    `secrets` rather than `random`, because this string is the only thing
    standing between a stranger and someone's medicine list. `random` is seeded
    predictably and is documented as unsuitable for exactly this.
    """
    return secrets.token_urlsafe(REFERENCE_BYTES)


class Prescription(models.Model):
    """
    One set of take home instructions, FR 6.1.

    Deliberately almost empty. Every field that a prescription might plausibly
    carry, the patient's name, their visit, the consultation it came from, is
    absent on purpose: see the module docstring and ADR 044.
    """

    reference = models.CharField(
        max_length=64,
        unique=True,
        default=new_reference,
        editable=False,
        help_text=(
            "The opaque key in the QR code, FR 6.3. Unguessable, and tied to "
            "no patient record."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # No expiry. A course of treatment can run for months, and a playlist that
    # stops working while the patient is still taking the medicine is a harm.
    # There is also nothing here worth expiring: the row cannot identify anyone.

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"Prescription {self.reference} ({self.items.count()} items)"


class PrescriptionItem(models.Model):
    """
    One medicine on the list, FR 6.1 and FR 6.3.

    Split into three fields rather than held as one sentence because they are
    three different kinds of fact and the patient needs all three to survive
    rendering. A dropped dosage or a dropped frequency is the difference between
    one tablet and four, which is why the safety gate in ADR 033 treats
    quantities and frequencies as blocking rather than droppable.
    """

    prescription = models.ForeignKey(
        Prescription,
        related_name="items",
        on_delete=models.CASCADE,
    )
    position = models.PositiveSmallIntegerField(
        help_text="Order on the list. The playlist plays in this order."
    )
    # Optional, because the photograph can identify the medicine instead, and
    # for a patient who does not read print it identifies it better: they can
    # match a picture to the box in their hand, where a drug name has no sign
    # and has to be fingerspelled letter by letter.
    #
    # One of the two is always present. The serializer enforces that, because
    # an item with neither identifies nothing at all.
    medicine = models.CharField(max_length=120, blank=True)

    image = models.ImageField(
        upload_to="medicines/",
        blank=True,
        help_text=(
            "A photograph of the medicine, shown to the patient before its "
            "dose. Re-encoded on upload to strip camera metadata, which on a "
            "phone includes where the photograph was taken."
        ),
    )
    dosage = models.CharField(
        max_length=120, help_text='How much, for example "one tablet".'
    )
    frequency = models.CharField(
        max_length=120, help_text='How often, for example "twice a day".'
    )

    # The Twi caption is translated once, when the prescription is issued, and
    # stored. Signs are resolved fresh on every read and captions are not, and
    # the asymmetry is deliberate: a withdrawn sign must stop playing
    # immediately, whereas the Twi for "one tablet, twice a day" does not
    # change. Translating on read would also spend metered Khaya credit every
    # time a patient replays their own prescription, which ADR 015 exists to
    # avoid, and would make offline replay impossible.
    caption = models.CharField(
        max_length=400,
        blank=True,
        help_text="The instruction in the patient's reading language.",
    )
    caption_language = models.CharField(
        max_length=8,
        default="en",
        help_text=(
            "Language the caption is actually in. English when translation was "
            "unreachable at issue time, so the interface can say so rather "
            "than presenting untranslated text as Twi."
        ),
    )
    caption_provider = models.CharField(
        max_length=32,
        default="",
        help_text=(
            "Which provider produced the caption, per ADR 011. The stub "
            "returns its input unchanged, so without this the interface would "
            "present English text as Twi with nothing to distinguish it from a "
            "real translation. Stored rather than derived, because the "
            "prescription is read back long after the setting may have changed."
        ),
    )

    class Meta:
        ordering = ("position",)
        constraints = [
            models.UniqueConstraint(
                fields=("prescription", "position"),
                name="unique_position_per_prescription",
            )
        ]

    def __str__(self) -> str:
        return f"{self.label}, {self.dosage}, {self.frequency}"

    @property
    def label(self) -> str:
        """What to call this item in writing, when there is no drug name."""
        return self.medicine or f"Medicine {self.position}"

    @property
    def instruction(self) -> str:
        """
        The words to be signed and captioned.

        Joined here rather than at each call site so that the sentence the
        patient sees signed is provably the same sentence the safety gate
        checked. Two call sites building it separately is how the two drift.

        The drug name is left out when there is a photograph, and that is the
        point of the photograph: the picture says which medicine, the signs say
        what to do with it. Including the name as well would mean fingerspelling
        eleven letters the patient has already been shown, and would pull an
        unfilmable word into a sentence the safety gate would then refuse.
        """
        if self.image and not self.medicine:
            return f"{self.dosage}, {self.frequency}"

        return f"{self.medicine}, {self.dosage}, {self.frequency}"
