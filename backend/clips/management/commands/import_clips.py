"""
Import filmed GhSL footage into the clip library.

Point it at a folder of recordings named by gloss, `head.webm`, `hurt.mp4`,
`a.webm`, and each file is attached to its gloss. Importing deliberately does
NOT approve anything: approval means a GhSL fluent consultant vouched for the
sign, and no script is in a position to do that.
"""

from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from clips.models import ClipKind, ReviewStatus, SignClip

# Formats a browser can play in a <video> element without transcoding. Anything
# else would import cleanly and then fail silently at playback time.
VIDEO_SUFFIXES = {".webm", ".mp4", ".m4v", ".mov"}


class Command(BaseCommand):
    help = "Import GhSL footage from a folder of files named by gloss."

    def add_arguments(self, parser):
        parser.add_argument(
            "folder", help="Folder of video files named by gloss, e.g. head.webm"
        )
        parser.add_argument(
            "--approve",
            action="store_true",
            help="Mark imported clips approved. Requires --reviewer.",
        )
        parser.add_argument(
            "--reviewer",
            default="",
            help="Name of the GhSL fluent consultant who approved this footage.",
        )
        parser.add_argument(
            "--duration-ms",
            type=int,
            default=None,
            help=(
                "Playback length in milliseconds, applied to every file. "
                "Only affects the estimated sequence duration, playback itself "
                "advances on the video's own end event."
            ),
        )

    def handle(self, *args, **options):
        folder = Path(options["folder"])
        if not folder.is_dir():
            raise CommandError(f"Not a folder: {folder}")

        approve = options["approve"]
        reviewer = options["reviewer"].strip()

        if approve and not reviewer:
            # An approval with nobody's name against it is not a review. ADR 009
            # makes review a recorded fact, so refuse rather than record a
            # nameless approval.
            raise CommandError(
                "--approve requires --reviewer, naming the GhSL fluent "
                "consultant who checked this footage."
            )

        videos = sorted(
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
        )

        if not videos:
            raise CommandError(
                f"No video files in {folder}. "
                f"Expected one of: {', '.join(sorted(VIDEO_SUFFIXES))}"
            )

        imported = 0
        for path in videos:
            self._import_one(
                path,
                approve=approve,
                reviewer=reviewer,
                duration_ms=options["duration_ms"],
            )
            imported += 1
            self.stdout.write(f"  {path.name} -> {path.stem.strip().upper()}")

        self.stdout.write(
            self.style.SUCCESS(f"\nImported {imported} clip(s) from {folder}.")
        )

        skipped = [
            path.name
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() not in VIDEO_SUFFIXES
        ]
        if skipped:
            self.stdout.write(
                f"Ignored {len(skipped)} non video file(s): "
                f"{', '.join(sorted(skipped))}"
            )

        self._report_status(approve)

    def _import_one(self, path: Path, *, approve: bool, reviewer: str, duration_ms):
        """Attach one file to its gloss, creating the gloss if it is new."""
        gloss = path.stem.strip().upper()

        # A one character gloss is a fingerspelling letter. Getting this wrong
        # would let a letter be matched as a whole word sign and break the
        # FR 1.6 fallback.
        kind = ClipKind.LETTER if len(gloss) == 1 else ClipKind.WORD

        clip, _ = SignClip.objects.get_or_create(gloss=gloss, defaults={"kind": kind})

        with path.open("rb") as handle:
            clip.video.save(path.name, File(handle), save=False)

        if duration_ms is not None:
            clip.duration_ms = duration_ms

        # Replacing footage invalidates any previous approval, because the
        # consultant approved the recording that was there before, not this one.
        clip.review_status = ReviewStatus.APPROVED if approve else ReviewStatus.PENDING
        clip.reviewed_by = reviewer if approve else ""
        clip.save()

    def _report_status(self, approved: bool) -> None:
        resolvable = SignClip.objects.resolvable().count()
        awaiting_review = SignClip.objects.awaiting_review().count()
        awaiting_footage = SignClip.objects.awaiting_footage().count()

        self.stdout.write("")
        self.stdout.write(f"Ready for clinical use: {resolvable}")
        self.stdout.write(f"Filmed, awaiting consultant review: {awaiting_review}")
        self.stdout.write(f"Not yet filmed: {awaiting_footage}")

        if not approved and awaiting_review:
            self.stdout.write(
                self.style.WARNING(
                    "\nImported footage is not usable yet. A GhSL fluent "
                    "consultant must approve it, in the Django admin or by "
                    're running with --approve --reviewer "Their Name".'
                )
            )
