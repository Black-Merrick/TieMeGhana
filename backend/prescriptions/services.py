"""
Issuing and replaying a prescription, SRS FR 6.1 to FR 6.3.

Two operations, deliberately asymmetric in what they cost.

Issuing translates each instruction once and stores the caption, so it spends
metered Khaya credit exactly once per prescription. Replaying spends none: it
reads the stored captions and resolves the signs from the local clip library,
which is what lets a patient replay their prescription at home, offline, for as
long as they are taking the medicine.
"""

from dataclasses import dataclass

from django.db import transaction

from clips.services import SignSequence, resolve_sign_sequences
from clips.stitching import stitched_video_url
from core.language import Language, LanguageError, get_language_provider
from prescriptions.models import Prescription, PrescriptionItem

# The patient reads Twi, the same target the consultation captions use. FR 6.1
# names Twi captions specifically.
CAPTION_LANGUAGE = Language.TWI


@dataclass(frozen=True)
class PlaylistItem:
    """One medicine, ready to play."""

    position: int
    medicine: str
    dosage: str
    frequency: str
    instruction: str
    caption: str
    caption_language: str
    caption_provider: str
    sequence: SignSequence


@dataclass(frozen=True)
class Playlist:
    """A whole prescription, ready to play. FR 6.1."""

    reference: str
    items: tuple[PlaylistItem, ...]

    @property
    def is_fully_signable(self) -> bool:
        """
        Whether every instruction can be shown in GhSL safely.

        The doctor needs this before they hand over a QR code. A prescription
        where one item cannot be rendered is not a partial success: the patient
        gets a playlist that skips a medicine, or shows one without its dosage,
        and has no way to know something is missing. Someone has to explain
        that item another way, and they can only do that if they are told.
        """
        return all(item.sequence.is_safe_to_show for item in self.items)

    @property
    def unsignable_positions(self) -> tuple[int, ...]:
        """Which items need explaining another way, in playlist order."""
        return tuple(
            item.position for item in self.items if not item.sequence.is_safe_to_show
        )

    @property
    def video_url(self) -> str | None:
        """
        The whole prescription as one downloadable video file.

        This is what a patient saves to their phone's gallery, per ADR 046. A
        file in the gallery outlives the browser cache, the app, and the
        hospital: it plays in whatever video player the phone came with, years
        later, with no network and nothing installed.

        None unless every item can be signed safely. A single file cannot say
        that one medicine is missing from it, so a prescription with a refused
        item would be saved to the gallery looking complete, which is the exact
        harm ADR 033 refuses sentences to avoid. When it is None the patient
        saves the items individually instead, and the refused one visibly has
        nothing to save.
        """
        if not self.items or not self.is_fully_signable:
            return None

        # One sequence spanning every medicine, in playlist order, so the
        # existing content addressed stitching cache covers it unchanged: the
        # same prescription asks for the same file and it is encoded once.
        whole = SignSequence(
            source_text=" ".join(item.instruction for item in self.items),
            segments=tuple(
                segment for item in self.items for segment in item.sequence.segments
            ),
        )

        return stitched_video_url(whole)


def _translate_instruction(instruction: str) -> tuple[str, str, str]:
    """
    Translate one instruction, falling back to English rather than failing.

    A prescription that cannot be issued because a translation service is down
    is worse than one captioned in English: the English caption is still
    readable by the pharmacist and by anyone helping at home, and the GhSL
    signs, which are what the patient actually reads, do not depend on the
    translation at all. So the outage is recorded in the caption language and
    the prescription is still issued.

    Returns the caption, the language it is actually in, and the provider that
    produced it. The provider is part of the answer, not a diagnostic: the stub
    returns its input unchanged, so a caption it produced is English text that
    would otherwise be labelled Twi and shown as a translation. ADR 011.
    """
    provider = get_language_provider()

    try:
        caption = provider.translate(
            instruction, source=Language.ENGLISH, target=CAPTION_LANGUAGE
        )
    except LanguageError:
        return instruction, Language.ENGLISH.value, provider.name

    return caption, CAPTION_LANGUAGE.value, provider.name


@transaction.atomic
def issue_prescription(items: list[dict]) -> Prescription:
    """
    Create a prescription from a list of medicines, FR 6.1.

    Atomic, because a prescription that saved three of its four medicines is
    the most dangerous possible outcome: it looks complete to the patient and
    to whoever scans it. Either the whole list exists or none of it does.
    """
    prescription = Prescription.objects.create()

    rows = []
    for position, item in enumerate(items, start=1):
        row = PrescriptionItem(
            prescription=prescription,
            position=position,
            medicine=item["medicine"],
            dosage=item["dosage"],
            frequency=item["frequency"],
        )
        (
            row.caption,
            row.caption_language,
            row.caption_provider,
        ) = _translate_instruction(row.instruction)
        rows.append(row)

    PrescriptionItem.objects.bulk_create(rows)
    return prescription


def build_playlist(prescription: Prescription) -> Playlist:
    """
    Resolve a stored prescription into something playable, FR 6.1 and FR 6.2.

    Signs are resolved here, on read, rather than stored at issue time. See
    ADR 043. The one sentence version: a sign a consultant withdraws has to
    stop playing everywhere, including in prescriptions issued last month, and
    freezing clip ids at issue time is how it would keep playing instead.

    One clip library lookup covers every item on the list, however long it is,
    so a prescription of six medicines is no more expensive to open than one.
    """
    items = list(prescription.items.all())
    sequences = resolve_sign_sequences([item.instruction for item in items])

    return Playlist(
        reference=prescription.reference,
        items=tuple(
            PlaylistItem(
                position=item.position,
                medicine=item.medicine,
                dosage=item.dosage,
                frequency=item.frequency,
                instruction=item.instruction,
                caption=item.caption,
                caption_language=item.caption_language,
                caption_provider=item.caption_provider,
                sequence=sequence,
            )
            for item, sequence in zip(items, sequences, strict=True)
        ),
    )
