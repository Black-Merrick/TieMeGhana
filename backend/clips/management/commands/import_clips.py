"""
Import filmed GhSL footage into the clip library.

Point it at a folder of recordings named by gloss, `head.webm`, `hurt.mp4`,
`a.webm`, and each file is attached to its gloss. Importing deliberately does
NOT approve anything: approval means a GhSL fluent consultant vouched for the
sign, and no script is in a position to do that.

`--watch` leaves it running, so during a filming session a clip appears in the
library as soon as it lands in the folder.
"""

import time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from clips.importing import VIDEO_SUFFIXES, ImportReport, import_footage
from clips.models import SignClip

#: How often --watch looks at the folder. Polling rather than a filesystem
#: watcher, so there is no extra dependency and it behaves the same on every
#: platform and over a network share.
WATCH_INTERVAL_SECONDS = 3


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
        parser.add_argument(
            "--watch",
            action="store_true",
            help=(
                "Keep running and import new or changed files as they appear. "
                "For filming sessions. Stop with Ctrl-C."
            ),
        )

    def handle(self, *args, **options):
        folder = Path(options["folder"])
        settings = {
            "approve": options["approve"],
            "reviewer": options["reviewer"],
            "duration_ms": options["duration_ms"],
        }

        # Validated once, up front. In --watch mode a bad folder or a nameless
        # approval should fail immediately rather than on every poll.
        try:
            report = import_footage(folder, **settings)
        except ValueError as error:
            raise CommandError(str(error)) from error

        self._report(report)

        if not options["watch"]:
            if not report.imported and not report.unchanged:
                raise CommandError(
                    f"No video files in {folder}. "
                    f"Expected one of: {', '.join(sorted(VIDEO_SUFFIXES))}"
                )
            self._report_library()
            return

        self._watch(folder, settings)

    def _watch(self, folder: Path, settings: dict) -> None:
        self.stdout.write(
            self.style.SUCCESS(
                f"\nWatching {folder} every {WATCH_INTERVAL_SECONDS}s. "
                "Drop a clip in and it will be imported. Ctrl-C to stop."
            )
        )

        try:
            while True:
                time.sleep(WATCH_INTERVAL_SECONDS)

                report = import_footage(folder, **settings)
                # Only speak when something happened. A watcher that printed
                # every poll would bury the one line that matters.
                if report.touched_anything:
                    self._report(report)
                    self._report_library()
        except KeyboardInterrupt:
            self.stdout.write("\nStopped watching.")

    def _report(self, report: ImportReport) -> None:
        for gloss in report.created:
            self.stdout.write(self.style.SUCCESS(f"  new       {gloss}"))
        for gloss in report.replaced:
            self.stdout.write(
                self.style.WARNING(f"  replaced  {gloss}, approval reset")
            )
        if report.unchanged:
            self.stdout.write(
                f"  unchanged {len(report.unchanged)} clip(s), left alone"
            )
        if report.ignored:
            self.stdout.write(
                f"  ignored   {len(report.ignored)} non video file(s): "
                f"{', '.join(sorted(report.ignored))}"
            )

    def _report_library(self) -> None:
        resolvable = SignClip.objects.resolvable().count()
        awaiting_review = SignClip.objects.awaiting_review().count()
        awaiting_footage = SignClip.objects.awaiting_footage().count()

        self.stdout.write("")
        self.stdout.write(f"Ready for clinical use: {resolvable}")
        self.stdout.write(f"Filmed, awaiting consultant review: {awaiting_review}")
        self.stdout.write(f"Not yet filmed: {awaiting_footage}")

        if awaiting_review:
            self.stdout.write(
                self.style.WARNING(
                    "\nImported footage is not usable yet. A GhSL fluent "
                    "consultant must approve it, in the Django admin or by "
                    're running with --approve --reviewer "Their Name".'
                )
            )
