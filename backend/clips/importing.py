"""
Bringing filmed footage into the clip library.

Shared by the management command and the admin button, so the two cannot drift
apart. Importing from a folder is the same operation whoever asks for it, and
the rule that matters most is the same either way: a file that has not changed
is left completely alone.

That rule exists because re-importing a clip resets its approval to pending,
deliberately, since a consultant approved the recording that was there before
rather than the new one. Without the guard, anything that re-ran an import, a
watcher firing on an editor save, a file sync touching timestamps, a second
click of the admin button, would silently un-approve reviewed footage and a
doctor would just see sentences start being refused mid consultation.

The comparison is by content hash rather than modification time, because a
timestamp changes when nothing about the file does.
"""

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path

from django.core.files import File

from clips.models import ClipKind, ReviewStatus, SignClip

logger = logging.getLogger(__name__)

#: Formats a browser can play in a <video> element without transcoding.
VIDEO_SUFFIXES = {".webm", ".mp4", ".m4v", ".mov"}

READ_CHUNK_BYTES = 1024 * 1024


@dataclass
class ImportReport:
    """What an import did, so a caller can report it honestly."""

    created: list[str] = field(default_factory=list)
    replaced: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    ignored: list[str] = field(default_factory=list)

    @property
    def imported(self) -> int:
        return len(self.created) + len(self.replaced)

    @property
    def touched_anything(self) -> bool:
        return bool(self.created or self.replaced)


def file_checksum(path: Path) -> str:
    """Hash a file's contents, read in chunks so a large clip is not loaded."""
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        while chunk := handle.read(READ_CHUNK_BYTES):
            digest.update(chunk)

    return digest.hexdigest()


def import_footage(
    folder: Path,
    *,
    approve: bool = False,
    reviewer: str = "",
    duration_ms: int | None = None,
) -> ImportReport:
    """
    Import every video in a folder, skipping anything already imported.

    Raises ValueError for a folder that does not exist, or for an approval with
    no reviewer named, because an approval nobody signed is not a review.
    """
    if not folder.is_dir():
        raise ValueError(f"Not a folder: {folder}")

    reviewer = reviewer.strip()
    if approve and not reviewer:
        raise ValueError(
            "Approving footage requires naming the GhSL fluent consultant who "
            "checked it."
        )

    report = ImportReport()

    for path in folder.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_SUFFIXES:
            report.ignored.append(path.name)
            continue

        _import_one(
            path, report, approve=approve, reviewer=reviewer, duration_ms=duration_ms
        )

    return report


def _kind_for(gloss: str) -> str:
    """
    Guess a new clip's kind from its filename.

    A one character gloss is a fingerspelling letter. Getting that wrong would
    let a letter be matched as a whole word sign and break the FR 1.6 fallback.

    An underscored gloss is a phrase, `what_is_your_name.mp4`, which is how a
    whole sentence filmed as one clip arrives. Only applied to a new clip: an
    existing row keeps its kind, so the prompts and emergency alerts that also
    carry underscores are not reclassified underneath them.

    A guess, so the admin can correct it. It cannot be more than a guess from a
    filename alone.
    """
    if len(gloss) == 1:
        return ClipKind.LETTER
    if "_" in gloss:
        return ClipKind.PHRASE
    return ClipKind.WORD


def _import_one(
    path: Path,
    report: ImportReport,
    *,
    approve: bool,
    reviewer: str,
    duration_ms: int | None,
) -> None:
    """Import one file, or leave it alone if its contents are already stored."""
    gloss = path.stem.strip().upper()
    checksum = file_checksum(path)

    clip = SignClip.objects.filter(gloss=gloss).first()

    # The guard. Same contents already imported, so nothing is touched at all,
    # and in particular the existing approval survives.
    if clip is not None and clip.source_checksum == checksum and clip.video:
        report.unchanged.append(gloss)
        return

    is_new = clip is None
    if is_new:
        clip = SignClip(gloss=gloss, kind=_kind_for(gloss))

    with path.open("rb") as handle:
        clip.video.save(path.name, File(handle), save=False)

    clip.source_checksum = checksum

    if duration_ms is not None:
        clip.duration_ms = duration_ms

    # New or replaced footage is unapproved, because a consultant approved the
    # recording that was there before rather than this one.
    clip.review_status = ReviewStatus.APPROVED if approve else ReviewStatus.PENDING
    clip.reviewed_by = reviewer if approve else ""
    clip.save()

    (report.created if is_new else report.replaced).append(gloss)
    logger.info("Imported %s from %s", gloss, path.name)
