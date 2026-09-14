"""
Copy media already on this machine into the configured storage.

Needed once, when a project that has been running on local disk switches to a
bucket. The database rows point at storage names like `clips/head.webm`, and
with R2 configured those names are looked for in the bucket: a clip left behind
on disk is a clip the app cannot find and a sign the patient never sees.

Idempotent, so running it twice is harmless and running it after filming more
footage picks up only what is new. See ADR 050.
"""

import pathlib

from django.conf import settings
from django.core.files.base import File
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from clips.stitching import STITCHED_SUBDIRECTORY


class Command(BaseCommand):
    help = "Upload files under MEDIA_ROOT into the configured media storage."

    def add_arguments(self, parser):
        parser.add_argument(
            "--include-stitched",
            action="store_true",
            help=(
                "Also upload the stitched video cache. Off by default: those "
                "files are derived, addressed by the clips they contain, and "
                "rebuilt on demand, so uploading them moves bytes that will be "
                "regenerated anyway."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be uploaded without uploading anything.",
        )

    def handle(self, *args, **options):
        root = pathlib.Path(settings.MEDIA_ROOT)

        if not root.exists():
            self.stdout.write("Nothing to upload: MEDIA_ROOT does not exist.")
            return

        backend = settings.STORAGES["default"]["BACKEND"]
        if backend.endswith("FileSystemStorage"):
            # Uploading disk to disk would copy every file onto itself. Refused
            # rather than performed, because the likeliest reason to be here
            # with local storage configured is a .env that was not picked up.
            self.stdout.write(
                self.style.WARNING(
                    "Media storage is still local disk, so there is nowhere to "
                    "upload to. Set R2_BUCKET and R2_ACCOUNT_ID in backend/.env "
                    "first, see SETUP_GUIDE.md."
                )
            )
            return

        uploaded = skipped = 0

        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue

            name = path.relative_to(root).as_posix()

            if not options["include_stitched"] and name.startswith(
                f"{STITCHED_SUBDIRECTORY}/"
            ):
                continue

            if default_storage.exists(name):
                skipped += 1
                continue

            if options["dry_run"]:
                self.stdout.write(f"  would upload {name}")
                uploaded += 1
                continue

            with path.open("rb") as handle:
                # Saved under the name it already has, not a generated one, so
                # the rows in the database keep pointing at the same file.
                default_storage.save(name, File(handle))

            self.stdout.write(f"  uploaded {name}")
            uploaded += 1

        verb = "would upload" if options["dry_run"] else "uploaded"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {uploaded}, already present {skipped}")
        )
