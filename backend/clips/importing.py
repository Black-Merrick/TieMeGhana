"""
Bringing filmed footage into the clip library.

Two entry points, one rule. `import_footage` reads a folder on this machine's
own disk, which is what the management command and, historically, the admin's
"Import footage folder" button used. `import_uploads` takes files handed
straight to an HTTP request, which is what the admin's browser upload form
uses.

The second one is not a convenience. Render's free tier has no shell and no
persistent disk: a folder dropped into the running container is gone on the
next deploy, and nobody outside the container can reach it to put files there
in the first place. `import_footage` therefore only ever does anything on a
machine somebody has direct filesystem access to, which in production is
nobody. `import_uploads` is the path that actually works once the app is
deployed, and everyone reviewing clips is doing it through a browser.

Both call the same `_apply_import`, so the rule that matters most is the same
either way: a file whose content has not changed is left completely alone, and
new or changed footage resets an approval, because a consultant approved the
recording that was there before rather than this one. A watcher firing on an
editor save, a browser tab uploading the same batch twice, a second click of
either button, none of them silently un-approve reviewed footage, because none
of them are re-importing anything: the content is unchanged, so nothing
happens.

The comparison is by content hash rather than a filename or a modification
time, because a timestamp changes when nothing about the file does, and two
different files can share the name a browser or a filesystem gives them.
"""

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path

from django.core.files import File
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import UploadedFile

from clips.compression import (
    CompressionResult,
    compress_video,
    compressed_name,
    compression_enabled,
)
from clips.models import ClipKind, ReviewStatus, SignClip, normalize_gloss

logger = logging.getLogger(__name__)

#: Formats a browser can play in a <video> element without transcoding.
VIDEO_SUFFIXES = {".webm", ".mp4", ".m4v", ".mov"}

READ_CHUNK_BYTES = 1024 * 1024

#: A generous ceiling on one uploaded file, checked before anything is read
#: into memory. Filmed GhSL clips are short, a few seconds to under a minute,
#: so a single file this large is far more likely to be the wrong file
#: attached than a real recording, and refusing it plainly beats a browser
#: tab hung for minutes on an upload nobody wanted.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024

#: How many files one upload request accepts. High enough for a full filming
#: session's output in one batch, low enough that a form which forgot its
#: `multiple` attribute fails loudly rather than "uploading" one file forever.
MAX_UPLOAD_FILES = 200


@dataclass
class ImportReport:
    """What an import did, so a caller can report it honestly."""

    created: list[str] = field(default_factory=list)
    replaced: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    #: Footage that had not changed, but that a named reviewer approved in this
    #: upload. The recording was left alone; only its approval changed.
    approved: list[str] = field(default_factory=list)
    #: Glosses whose footage was made smaller, with what that did.
    compressed: dict[str, CompressionResult] = field(default_factory=dict)
    #: Glosses stored as they arrived although compression was on, and why.
    uncompressed: dict[str, str] = field(default_factory=dict)
    ignored: list[str] = field(default_factory=list)

    @property
    def imported(self) -> int:
        return len(self.created) + len(self.replaced)

    @property
    def touched_anything(self) -> bool:
        return bool(self.created or self.replaced or self.approved)


def file_checksum(path: Path) -> str:
    """Hash a file's contents, read in chunks so a large clip is not loaded."""
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        while chunk := handle.read(READ_CHUNK_BYTES):
            digest.update(chunk)

    return digest.hexdigest()


def uploaded_file_checksum(upload: UploadedFile) -> str:
    """
    Hash an uploaded file's contents, and leave it ready to be read again.

    `UploadedFile.chunks()` is what streams a large upload from temporary disk
    storage rather than holding the whole thing in memory, which is what makes
    hashing safe to do on a file nobody has bothered to size-check yet. It
    always starts from the beginning, but does not rewind afterwards, and the
    caller still has to save these bytes into the clip's own field, so this
    leaves the pointer at the start rather than making every caller remember to.
    """
    digest = hashlib.sha256()

    for chunk in upload.chunks(READ_CHUNK_BYTES):
        digest.update(chunk)

    upload.seek(0)
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

    reviewer = _validated_reviewer(approve, reviewer)
    report = ImportReport()

    for path in folder.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_SUFFIXES:
            report.ignored.append(path.name)
            continue

        with path.open("rb") as handle:
            _apply_import(
                gloss=normalize_gloss(path.stem),
                checksum=file_checksum(path),
                source=File(handle),
                filename=path.name,
                report=report,
                approve=approve,
                reviewer=reviewer,
                duration_ms=duration_ms,
            )

    return report


def import_uploads(
    uploads: list[UploadedFile],
    *,
    approve: bool = False,
    reviewer: str = "",
    duration_ms: int | None = None,
) -> ImportReport:
    """
    Import a batch of files handed straight to an HTTP request.

    Same rule as `import_footage`, same report shape, and the same two
    failures: a nameless approval and, here, a batch too large to be a
    filming session's output by accident rather than by mistake. Both are
    checked before anything is read, so a bad request fails at once rather
    than after minutes of uploading.
    """
    reviewer = _validated_reviewer(approve, reviewer)

    if len(uploads) > MAX_UPLOAD_FILES:
        raise ValueError(
            f"{len(uploads)} files were sent, and {MAX_UPLOAD_FILES} is the "
            "most this form accepts in one batch. Split the batch, or use "
            "manage.py import_clips from a machine with filesystem access."
        )

    oversized = [upload.name for upload in uploads if upload.size > MAX_UPLOAD_BYTES]
    if oversized:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(
            f"{', '.join(oversized)} exceed{'s' if len(oversized) == 1 else ''} "
            f"the {limit_mb}MB per file limit. A filmed GhSL clip is a few "
            "seconds long; a file this large is more likely to be the wrong "
            "one attached than a real recording."
        )

    report = ImportReport()

    for upload in uploads:
        if Path(upload.name).suffix.lower() not in VIDEO_SUFFIXES:
            report.ignored.append(upload.name)
            continue

        _apply_import(
            gloss=normalize_gloss(Path(upload.name).stem),
            checksum=uploaded_file_checksum(upload),
            source=upload,
            filename=upload.name,
            report=report,
            approve=approve,
            reviewer=reviewer,
            duration_ms=duration_ms,
            approve_unchanged=True,
        )

    return report


def _validated_reviewer(approve: bool, reviewer: str) -> str:
    """The trimmed reviewer name, or a raised ValueError if approval needs one."""
    reviewer = reviewer.strip()
    if approve and not reviewer:
        raise ValueError(
            "Approving footage requires naming the GhSL fluent consultant who "
            "checked it."
        )
    return reviewer


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


def _apply_import(
    *,
    gloss: str,
    checksum: str,
    source,
    filename: str,
    report: ImportReport,
    approve: bool,
    reviewer: str,
    duration_ms: int | None,
    approve_unchanged: bool = False,
) -> None:
    """
    Save one file against its gloss, or leave it alone if nothing has changed.

    The one function both entry points funnel through, and the reason the two
    cannot drift apart: whatever the source, a folder handle or a browser
    upload, the decision of new, replaced, or unchanged is made here once.
    """
    clip = SignClip.objects.filter(gloss=gloss).first()

    # The guard. Same contents already imported, so the footage is not touched
    # and an existing approval survives.
    if clip is not None and clip.source_checksum == checksum and clip.video:
        # One exception, and only for a person at a browser. Uploading a file,
        # ticking "approve" and naming the consultant is an explicit request to
        # approve it, and swallowing that because the same bytes were uploaded
        # once before left a clip "Awaiting review" after the reviewer had
        # approved it, with a message that read like success. It approves and
        # nothing else: the footage is untouched, a clip that is already
        # approved keeps its reviewer, and a REJECTED one stays rejected, since
        # a rejection carries a reason and is undone by the admin's own approve
        # action, not by an upload. Never for a folder import: a watcher run
        # with --approve would otherwise re-approve, on every poll, a clip a
        # consultant had just sent back.
        if approve and approve_unchanged and clip.review_status == ReviewStatus.PENDING:
            clip.review_status = ReviewStatus.APPROVED
            clip.reviewed_by = reviewer
            clip.save()
            report.approved.append(gloss)
            logger.info("Approved unchanged footage for %s", gloss)
            return

        report.unchanged.append(gloss)
        return

    is_new = clip is None
    if is_new:
        clip = SignClip(gloss=gloss, kind=_kind_for(gloss))

    # Made small on the way in, once, so every device that ever fetches it pays
    # for the small one. The checksum below is of what was uploaded, not of what
    # is stored, so uploading the same file again is still recognised as
    # unchanged. Never blocks: a file that cannot be compressed is stored as it
    # arrived, and the report says so.
    result = compress_video(source)
    if result.compressed:
        clip.video.save(compressed_name(filename), ContentFile(result.data), save=False)
        report.compressed[gloss] = result
    else:
        clip.video.save(filename, source, save=False)
        if compression_enabled():
            report.uncompressed[gloss] = result.reason
    clip.source_checksum = checksum

    if duration_ms is not None:
        clip.duration_ms = duration_ms
    elif result.duration_ms:
        # The real length of what was stored, which the sequence's total
        # duration and the player's progress are worked out from. Left empty it
        # read as zero.
        clip.duration_ms = result.duration_ms

    # New or replaced footage is unapproved, because a consultant approved the
    # recording that was there before rather than this one.
    clip.review_status = ReviewStatus.APPROVED if approve else ReviewStatus.PENDING
    clip.reviewed_by = reviewer if approve else ""
    clip.save()

    (report.created if is_new else report.replaced).append(gloss)
    logger.info("Imported %s from %s", gloss, filename)
