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
from pathlib import Path

from django.conf import settings
from django.db import transaction

from clips.services import SignSequence, resolve_sign_sequences
from clips.stitching import StillFrame, stitch
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
    label: str
    image_url: str | None
    dosage: str
    frequency: str
    instruction: str
    caption: str
    caption_language: str
    caption_provider: str
    sequence: SignSequence

    @property
    def video_url(self) -> str | None:
        """
        This medicine alone, as one file: its photograph, then its dose.

        The picture is part of the video rather than sitting above it, because
        the video is what leaves the app. A patient who saves it to their phone
        gets a file that says which medicine it is; one holding only the signs
        is a dose with nothing attached to it, and a gallery of those is
        unreadable.

        None when the instruction cannot be signed safely, for the reason in
        ADR 033: a file cannot say that part of it is missing.
        """
        if not self.sequence.is_safe_to_show:
            return None

        still = _still_frame(self.image_url)
        clips = [
            path
            for segment in self.sequence.segments
            for clip in segment.clips
            if (path := _media_path(clip.video_url)) is not None
        ]

        if not clips:
            return None

        sources = ([still] if still else []) + clips
        material = ([f"still:{still.path}:{still.seconds:g}"] if still else []) + [
            f"clip:{path}" for path in clips
        ]

        stitched = stitch(sources, material)
        if stitched:
            return stitched

        # One source, so there was nothing to concatenate. With no photograph
        # that single clip is already the whole instruction and can be served
        # as it is; with one it would be a picture and no dose, which is worse
        # than offering nothing.
        return None if still else self.sequence.segments[0].clips[0].video_url


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

        Each medicine contributes its photograph, held for a few seconds, and
        then the signs for its dose: picture, instruction, picture, instruction.
        That order is the point of the photograph. The patient sees which box,
        then what to do with it, and nothing has to be read.

        None unless every item can be signed safely. A single file cannot say
        that one medicine is missing from it, so a prescription with a refused
        item would be saved to the gallery looking complete, which is the exact
        harm ADR 033 refuses sentences to avoid. When it is None the patient
        saves the items individually instead, and the refused one visibly has
        nothing to save.
        """
        if not self.items or not self.is_fully_signable:
            return None

        sources = []
        # What the cache is addressed by. A still's duration belongs in it as
        # well as its path: changing how long a photograph is held has to
        # produce a different file rather than serve the previous one.
        material = []

        for item in self.items:
            still = _still_frame(item.image_url)
            if still is not None:
                sources.append(still)
                material.append(f"still:{still.path}:{still.seconds:g}")

            for segment in item.sequence.segments:
                for clip in segment.clips:
                    path = _media_path(clip.video_url)
                    if path is None:
                        # A clip the resolver offered but the filesystem does
                        # not have. Nothing to stitch, and a file missing one
                        # medicine's signs must not be saved as complete.
                        return None

                    sources.append(path)
                    material.append(f"clip:{path}")

        return stitch(sources, material)


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
            medicine=item.get("medicine", ""),
            amount=item["amount"],
            unit=item["unit"],
            times=item.get("times") or [],
            frequency_choice=item.get("frequency_choice", ""),
            meal=item.get("meal", ""),
            days=item.get("days"),
        )

        # The wording is generated from the structure, never typed, so the
        # caption a pharmacist reads and the sentence the patient watches are
        # built from the same words. ADR 049.
        row.write_instruction()

        # Saved through the field so the file lands in MEDIA_ROOT under its own
        # name. Already validated, stripped of metadata and resized by
        # `clean_medicine_image` before it reaches here.
        image = item.get("image")
        if image:
            row.image = image
        (
            row.caption,
            row.caption_language,
            row.caption_provider,
        ) = _translate_instruction(row.instruction)
        rows.append(row)

    # Saved one at a time rather than with bulk_create. bulk_create does reach
    # FileField.pre_save and would write the images, but that is a subtlety to
    # rely on rather than a guarantee to read, and a prescription has a handful
    # of items. The whole loop is inside one transaction either way, so a
    # partial list still cannot be left behind.
    for row in rows:
        row.save()

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
                label=item.label,
                image_url=item.image.url if item.image else None,
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


# How long a photograph of a medicine is held on screen.
#
# Long enough to look from the screen to the box in your hand and back, short
# enough that a prescription of five medicines is not a minute of stills. The
# same value is part of the stitching cache key, so changing it produces new
# files rather than serving the old ones.
STILL_SECONDS = 3.0


def _media_path(media_url: str | None) -> Path | None:
    """Turn a /media/... URL into the file behind it."""
    if not media_url or not media_url.startswith(settings.MEDIA_URL):
        return None

    path = Path(settings.MEDIA_ROOT) / media_url[len(settings.MEDIA_URL) :]
    return path if path.exists() else None


def _still_frame(image_url: str | None) -> StillFrame | None:
    """The photograph for one medicine, as a held frame, when there is one."""
    path = _media_path(image_url)
    return None if path is None else StillFrame(path=path, seconds=STILL_SECONDS)
