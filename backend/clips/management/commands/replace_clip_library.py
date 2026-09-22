"""
Replace the library's footage with a folder of recordings.

For the day the real filming arrives and the placeholders have to go. Importing
alone cannot do it: `import_clips` adds and replaces by name, so a recording
that is no longer wanted keeps playing, and the stored objects it left behind
stay in the bucket costing money and turning up in listings. This deletes the
old footage, from the database and from storage, and imports the folder in its
place, compressed on the way in like any other upload.

It is deliberately hard to run by accident. With no `--yes` it prints exactly
what it would delete, import and leave alone, and stops. Media storage is
chosen by environment variables, so the plan also names the database and the
bucket it is about to change: the one mistake this command could make is being
pointed at production while someone believed it was local.

What it does, and why:

- **Every clip row's footage is deleted**, from storage and from the row, and
  its approval is reset. An approval is a consultant vouching for a particular
  recording, so it cannot survive that recording being thrown away.
- **Objects under `clips/` that no row points at are deleted too.** Django
  renames a file rather than overwriting when a name is taken, so a library
  replaced a few times leaves copies nothing can reach.
- **The stitched cache is emptied.** It holds whole sentences encoded from the
  old clips, addressed by the files they were made from, so every entry is
  either stale or unreachable. It is a cache: it rebuilds on demand.
- **The kind is corrected from the filename.** `i_am_pregnant.mp4` is a phrase,
  not a word, and a row that already existed as a word would otherwise keep
  that kind and be matched one token at a time. Only where the filename is
  unambiguous (an underscore, or a single character).
- **Each emergency alert is given its sentence's recording**, per ALERT_PHRASES,
  so one file serves both the phrase the doctor can write and the card the
  patient taps in triage.
- **Rows left with nothing are deleted**, unless they are part of the seeded
  catalogue, which is the team's record of what still needs filming.
- **Two files with identical bytes are not approved**, unless the consultant
  says so with `--identical-ok`. Two different signs are usually not one
  recording: a take was reused or a file copied to the wrong name, and a patient
  must not be shown a sign that says something else while nobody has checked.
  Some pairs genuinely do share a sign, which is why it is a flag and not a
  refusal.
"""

from collections import defaultdict
from pathlib import Path

from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from clips.compression import describe_saving
from clips.emergency import ALERT_PHRASES
from clips.importing import (
    VIDEO_SUFFIXES,
    file_checksum,
    import_footage,
    kind_for_gloss,
)
from clips.management.commands.seed_clips import ALERTS, LETTERS, PROMPTS, WORDS
from clips.models import ClipAlias, ClipKind, ReviewStatus, SignClip, normalize_gloss

#: Everything `seed_clips` creates. These rows are the record of what still
#: needs filming, so they survive a replacement with no footage rather than
#: being deleted and forgotten.
CATALOGUE = (
    {*(normalize_gloss(gloss) for gloss in LETTERS)}
    | {*(normalize_gloss(gloss) for gloss in WORDS)}
    | {*(normalize_gloss(gloss) for gloss in ALERTS)}
    | {*(normalize_gloss(gloss) for gloss in PROMPTS)}
)

#: Folders of stored media. `clips` is the footage this command owns, `stitched`
#: a cache derived from it. `medicines` holds photographs attached to real
#: prescriptions and is never touched.
FOOTAGE_PREFIX = "clips"
DERIVED_PREFIXES = ("stitched",)


class Command(BaseCommand):
    help = "Delete the library's footage and import a folder in its place."

    def add_arguments(self, parser):
        parser.add_argument("folder", help="Folder of recordings named by gloss.")
        parser.add_argument(
            "--reviewer",
            default="",
            help=(
                "The GhSL fluent consultant who checked this footage. Required "
                "with --approve, and recorded against every clip it approves."
            ),
        )
        parser.add_argument(
            "--approve",
            action="store_true",
            help=(
                "Mark the imported clips approved, so they can reach a patient. "
                "Requires --reviewer. Files sharing their bytes with another "
                "file are left awaiting review whatever this says."
            ),
        )
        parser.add_argument(
            "--identical-ok",
            action="store_true",
            help=(
                "Approve files that share their bytes with another file too. "
                "Only where the consultant says the two are one sign in GhSL."
            ),
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Actually do it. Without this, the plan is printed and nothing changes.",
        )

    def handle(self, *args, **options):
        folder = Path(options["folder"])
        if not folder.is_dir():
            raise CommandError(f"Not a folder: {folder}")

        approve = options["approve"]
        reviewer = options["reviewer"].strip()
        if approve and not reviewer:
            raise CommandError(
                "Approving footage requires naming the GhSL fluent consultant "
                "who checked it: --reviewer 'Name'."
            )

        files = self._recordings(folder)
        if not files:
            raise CommandError(
                f"No video files in {folder}. "
                f"Expected one of: {', '.join(sorted(VIDEO_SUFFIXES))}"
            )

        duplicates = self._identical_bytes(files)
        identical_ok = options["identical_ok"]
        self._describe_target()
        self._describe_plan(files, duplicates, approve, reviewer, identical_ok)

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING(
                    "\nNothing has been changed. Run it again with --yes to go ahead."
                )
            )
            return

        self._delete_footage()
        self._delete_orphans()
        self._delete_derived()
        self._import(folder, approve, reviewer, {} if identical_ok else duplicates)
        self._correct_kinds(files)
        self._fill_alerts(files)
        self._delete_empty_rows()
        self._report_library()

    # ---------------------------------------------------------------- planning

    def _recordings(self, folder: Path) -> dict[str, Path]:
        """The folder's video files, by the gloss each one will be stored as."""
        found: dict[str, Path] = {}
        for path in sorted(folder.iterdir()):
            if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES:
                found[normalize_gloss(path.stem)] = path
        return found

    def _identical_bytes(self, files: dict[str, Path]) -> dict[str, list[str]]:
        """
        Glosses whose recordings are byte for byte the same, by digest.

        Two different signs cannot be one recording. Either a file was copied to
        the wrong name or a take was reused, and both are the kind of mistake
        that shows a patient a sign that says something else.
        """
        by_digest: dict[str, list[str]] = defaultdict(list)
        for gloss, path in files.items():
            by_digest[file_checksum(path)].append(gloss)

        return {
            digest: sorted(glosses)
            for digest, glosses in by_digest.items()
            if len(glosses) > 1
        }

    def _describe_target(self) -> None:
        """Say which database and which storage this is about to change."""
        database = connection.settings_dict
        where = database.get("HOST") or database["NAME"]
        bucket = getattr(default_storage, "bucket_name", None)

        self.stdout.write(self.style.MIGRATE_HEADING("About to change"))
        self.stdout.write(
            f"  database  {database['ENGINE'].rsplit('.', 1)[-1]}  {where}"
        )
        self.stdout.write(
            f"  storage   {'bucket ' + bucket if bucket else 'local ' + str(getattr(default_storage, 'location', '?'))}"
        )

    def _describe_plan(
        self,
        files: dict[str, Path],
        duplicates: dict[str, list[str]],
        approve: bool,
        reviewer: str,
        identical_ok: bool,
    ) -> None:
        filmed = SignClip.objects.exclude(video="").count()
        stored = len(self._stored_names(FOOTAGE_PREFIX))
        derived = sum(len(self._stored_names(prefix)) for prefix in DERIVED_PREFIXES)
        shared = (
            set()
            if identical_ok
            else {gloss for glosses in duplicates.values() for gloss in glosses}
        )

        kinds: dict[str, list[str]] = defaultdict(list)
        for gloss in files:
            kinds[kind_for_gloss(gloss)].append(gloss)

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Deleting"))
        self.stdout.write(
            f"  {filmed} clip row(s) lose their footage and their approval"
        )
        self.stdout.write(f"  {stored} stored object(s) under {FOOTAGE_PREFIX}/")
        self.stdout.write(f"  {derived} stitched sentence(s), a cache that rebuilds")

        self.stdout.write("")
        self.stdout.write(
            self.style.MIGRATE_HEADING(f"Importing {len(files)} recording(s)")
        )
        for kind in (ClipKind.PHRASE, ClipKind.WORD, ClipKind.LETTER):
            chosen = sorted(kinds.get(kind, []))
            if chosen:
                self.stdout.write(f"  {kind:7} {len(chosen):3}  {', '.join(chosen)}")

        for gloss, phrase in sorted(ALERT_PHRASES.items()):
            if phrase in files:
                self.stdout.write(f"  alert   {gloss} takes the {phrase} recording")

        if approve:
            self.stdout.write(
                f"  approved by {reviewer}"
                + (f", except {len(shared)} awaiting review" if shared else "")
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    "  awaiting review: nothing imported can reach a patient yet"
                )
            )

        if duplicates:
            self.stdout.write("")
            style = self.style.WARNING if identical_ok else self.style.ERROR
            self.stdout.write(
                style(
                    "Identical recordings, taken as one sign each"
                    if identical_ok
                    else "Identical recordings, left for review"
                )
            )
            for glosses in duplicates.values():
                self.stdout.write(style(f"  {' and '.join(glosses)} are the same file"))

    # ----------------------------------------------------------------- doing it

    def _stored_names(self, prefix: str) -> list[str]:
        """Every object under one folder of storage, by full name."""
        try:
            _, names = default_storage.listdir(prefix)
        except (FileNotFoundError, NotImplementedError):
            return []
        return [f"{prefix}/{name}" for name in names]

    def _delete_stored(self, name: str) -> bool:
        try:
            default_storage.delete(name)
            return True
        except Exception as error:  # pragma: no cover - storage specific
            self.stdout.write(self.style.WARNING(f"  could not delete {name}: {error}"))
            return False

    def _delete_footage(self) -> None:
        """Take the footage off every row, and its approval with it."""
        gone = 0
        for clip in SignClip.objects.exclude(video=""):
            name = clip.video.name
            clip.video = ""
            clip.source_checksum = ""
            clip.duration_ms = None
            # The approval was for the recording being deleted, not for the
            # gloss, so it does not carry over to whatever replaces it.
            clip.review_status = ReviewStatus.PENDING
            clip.reviewed_by = ""
            clip.save()
            if name and self._delete_stored(name):
                gone += 1

        self.stdout.write("")
        self.stdout.write(f"Removed the footage from {gone} clip(s).")

    def _delete_orphans(self) -> None:
        """
        Delete objects under `clips/` that no row points at.

        Django appends a suffix rather than overwriting when a name is taken, so
        a library replaced a few times leaves copies nothing can reach: they are
        invisible to the app, and still paid for.
        """
        referenced = {
            name for name in SignClip.objects.values_list("video", flat=True) if name
        }
        orphans = [
            name
            for name in self._stored_names(FOOTAGE_PREFIX)
            if name not in referenced
        ]

        for name in orphans:
            self._delete_stored(name)

        self.stdout.write(
            f"Deleted {len(orphans)} stored object(s) nothing pointed at."
        )

    def _delete_derived(self) -> None:
        """Empty the stitched cache, which was encoded from the old footage."""
        for prefix in DERIVED_PREFIXES:
            names = self._stored_names(prefix)
            for name in names:
                self._delete_stored(name)
            self.stdout.write(f"Emptied {prefix}/ ({len(names)} file(s), a cache).")

    def _import(
        self,
        folder: Path,
        approve: bool,
        reviewer: str,
        duplicates: dict[str, list[str]],
    ) -> None:
        """
        Import the folder, then withdraw the approval of any shared recording.
        """
        report = import_footage(
            folder, approve=approve, reviewer=reviewer, duration_ms=None
        )

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Imported"))
        for gloss in sorted(report.created + report.replaced):
            result = report.compressed.get(gloss)
            note = (
                describe_saving(result)
                if result
                else report.uncompressed.get(gloss, "as filmed")
            )
            self.stdout.write(f"  {gloss:36} {note}")
        if report.ignored:
            self.stdout.write(
                f"  ignored {len(report.ignored)} non video file(s): "
                f"{', '.join(sorted(report.ignored))}"
            )

        shared = sorted({gloss for glosses in duplicates.values() for gloss in glosses})
        if not shared:
            return

        SignClip.objects.filter(gloss__in=shared).update(
            review_status=ReviewStatus.PENDING, reviewed_by=""
        )
        self.stdout.write(
            self.style.ERROR(
                f"  left awaiting review, identical recordings: {', '.join(shared)}"
            )
        )

    def _correct_kinds(self, files: dict[str, Path]) -> None:
        """
        Make an existing row's kind agree with the filename.

        `kind_for_gloss` only guesses for a new row, so a phrase that was once
        filed as a word keeps that kind and is matched a token at a time instead
        of as the sentence it is. Only where the filename says so plainly: an
        underscore means a phrase, one character means a letter. A row already
        filed as an alert or a prompt is left alone, because those are chosen by
        the feature that uses them and not by a name.
        """
        changed = []
        for gloss in files:
            wanted = kind_for_gloss(gloss)
            clip = SignClip.objects.filter(gloss=gloss).first()
            if clip is None or clip.kind == wanted:
                continue
            if clip.kind in (ClipKind.ALERT, ClipKind.PROMPT):
                continue
            was = clip.kind
            clip.kind = wanted
            clip.save()
            changed.append(f"{gloss} {was} -> {wanted}")

        if changed:
            self.stdout.write("")
            self.stdout.write(self.style.MIGRATE_HEADING("Kind corrected"))
            for line in changed:
                self.stdout.write(f"  {line}")

    def _fill_alerts(self, files: dict[str, Path]) -> None:
        """
        Give each emergency alert the recording of the sentence it says.

        Its own copy, stored under the alert's own gloss, not the phrase's file
        shared by reference: an alert is a clinical identifier that carries its
        own review, and two rows on one object would mean deleting the phrase
        silently emptied the alert. Named after the alert for the same reason,
        because R2 is configured to overwrite a name rather than rename around
        it, so reusing the phrase's filename is exactly how the two would end up
        sharing one object. Skipped for an alert the folder filmed itself:
        footage somebody named for the alert beats a copy derived from a
        sentence. See ADR 056.
        """
        filled = []
        for gloss, phrase in sorted(ALERT_PHRASES.items()):
            if gloss in files:
                continue

            source = SignClip.objects.filter(gloss=phrase).exclude(video="").first()
            if source is None:
                continue

            alert, _ = SignClip.objects.get_or_create(
                gloss=gloss, defaults={"kind": ClipKind.ALERT}
            )
            name = f"{gloss.lower()}{Path(source.video.name).suffix}"
            with source.video.open("rb") as handle:
                alert.video.save(name, handle, save=False)
            alert.source_checksum = source.source_checksum
            alert.duration_ms = source.duration_ms
            alert.review_status = source.review_status
            alert.reviewed_by = source.reviewed_by
            alert.save()
            filled.append(f"{gloss} from {phrase}")

        if filled:
            self.stdout.write("")
            self.stdout.write(self.style.MIGRATE_HEADING("Emergency alerts"))
            for line in filled:
                self.stdout.write(f"  {line}")

    def _delete_empty_rows(self) -> None:
        """
        Delete rows with no footage that nothing else accounts for.

        A seeded row with no footage is the record of a sign still to be filmed
        and is kept. So is one a reviewed alias points at, because that alias is
        a consultant's judgment that two words mean the same sign and deleting
        the clip would take it with it. Anything else with no footage is a
        leftover: a gloss used once in a test, a plural that has its own rule
        now, a sign dropped from the app.
        """
        spoken_for = set(
            ClipAlias.objects.values_list("clip__gloss", flat=True).distinct()
        )
        leftovers = [
            clip
            for clip in SignClip.objects.filter(video="")
            if clip.gloss not in CATALOGUE and clip.gloss not in spoken_for
        ]
        if not leftovers:
            return

        names = sorted(clip.gloss for clip in leftovers)
        SignClip.objects.filter(pk__in=[clip.pk for clip in leftovers]).delete()

        self.stdout.write("")
        self.stdout.write(f"Deleted {len(names)} empty row(s): {', '.join(names)}")

    def _report_library(self) -> None:
        by_kind = defaultdict(int)
        for kind in SignClip.objects.resolvable().values_list("kind", flat=True):
            by_kind[kind] += 1

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("The library now"))
        self.stdout.write(
            "  ready for clinical use: "
            + (
                ", ".join(f"{count} {kind}" for kind, count in sorted(by_kind.items()))
                or "nothing"
            )
        )
        self.stdout.write(
            f"  awaiting review:  {SignClip.objects.awaiting_review().count()}"
        )
        self.stdout.write(
            f"  awaiting footage: {SignClip.objects.awaiting_footage().count()}"
        )
