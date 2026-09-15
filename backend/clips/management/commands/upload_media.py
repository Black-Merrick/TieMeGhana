"""
Copy media already on this machine into the configured storage.

Needed once, when a project that has been running on local disk switches to a
bucket. The database rows point at storage names like `clips/head.webm`, and
with R2 configured those names are looked for in the bucket: a clip left behind
on disk is a clip the app cannot find and a sign the patient never sees.

Idempotent, so running it twice is harmless and running it after filming more
footage picks up only what is new. See ADR 050.

A name check alone is not enough to call that idempotent. An upload that was
interrupted leaves a truncated object behind, and a name check treats it as
done: the command reports it as already present, exits successfully, and the
clip stays broken. That is how `how_are_you_doing.mp4` sat in the bucket as
five bytes while the real 342KB file sat on disk, with the phrase resolving
correctly and playing nothing at all.

So sizes are compared and differences are reported. They are **not** replaced
on their own. The bucket is not a copy of this laptop: prescription photographs
are uploaded straight to R2 by the running service and never exist here, so a
local file that is smaller than the remote one is usually this machine being
out of date rather than the bucket being corrupt. Replacing on mismatch would
have overwritten a real 107KB prescription photograph with a 5KB stale copy.

`--replace` names the files to overwrite, explicitly, one by one. Repairing a
known-bad object is a deliberate act, not a side effect of a sync.
"""

import pathlib

from django.conf import settings
from django.core.files.base import File
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand

from clips.stitching import STITCHED_SUBDIRECTORY


def _stored_size(name: str) -> int | None:
    """
    The size of an object already in storage, or None if it cannot be read.

    A backend is allowed to raise rather than answer here. None is returned so
    the caller re-uploads, which is the safe way to be wrong: uploading a file
    that was already correct costs bandwidth, where skipping a truncated one
    costs a sign the patient never sees.
    """
    try:
        return default_storage.size(name)
    except Exception:
        return None


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
        parser.add_argument(
            "--replace",
            nargs="+",
            default=[],
            metavar="NAME",
            help=(
                "Storage names to overwrite from the local copy, for example "
                "clips/how_are_you_doing.mp4. Only these are replaced. Without "
                "this, a file already in storage is never overwritten."
            ),
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

        wanted_replaced = set(options["replace"])
        uploaded = skipped = replaced = 0
        differing = []

        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue

            name = path.relative_to(root).as_posix()

            if not options["include_stitched"] and name.startswith(
                f"{STITCHED_SUBDIRECTORY}/"
            ):
                continue

            replacing = name in wanted_replaced

            if default_storage.exists(name) and not replacing:
                if _stored_size(name) != path.stat().st_size:
                    # Recorded rather than acted on. This is the case that
                    # otherwise hides completely: the name is in the bucket, so
                    # it looks complete, and the clip plays as nothing.
                    differing.append(name)
                skipped += 1
                continue

            if options["dry_run"]:
                self.stdout.write(
                    f"  would {'replace' if replacing else 'upload'} {name}"
                )
                uploaded += 1
                continue

            if replacing:
                # Deleted first because saving over an existing name does not
                # reliably overwrite: depending on the backend's settings it
                # picks a free name instead, which would leave the bad object
                # exactly where the database is still pointing.
                default_storage.delete(name)

            with path.open("rb") as handle:
                # Saved under the name it already has, not a generated one, so
                # the rows in the database keep pointing at the same file.
                default_storage.save(name, File(handle))

            if replacing:
                self.stdout.write(self.style.WARNING(f"  replaced {name}"))
                replaced += 1
            else:
                self.stdout.write(f"  uploaded {name}")
                uploaded += 1

        missing = wanted_replaced - {
            p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()
        }
        for name in sorted(missing):
            # Said out loud, because a mistyped name would otherwise report a
            # successful run that repaired nothing.
            self.stderr.write(
                self.style.ERROR(f"  --replace {name}: no local copy, nothing done")
            )

        summary = "would upload" if options["dry_run"] else "uploaded"
        self.stdout.write(
            self.style.SUCCESS(
                f"{summary} {uploaded}, replaced {replaced}, already present {skipped}"
            )
        )

        if differing:
            self.stdout.write(
                self.style.WARNING(
                    f"\n{len(differing)} file(s) differ in size from the local copy. "
                    "Left alone, because the bucket is not a copy of this machine: "
                    "a prescription photograph lives only in storage, so the local "
                    "file is usually the stale one. Check before replacing any:"
                )
            )
            for name in differing:
                self.stdout.write(f"  {name}")
