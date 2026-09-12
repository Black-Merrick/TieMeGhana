"""
Seed the vocabulary the clip library needs, ahead of filming it.

This creates rows with no footage and no approval, which is exactly the point:
the library becomes the team's record of which signs still need recording and
which still need consultant review, rather than that living in a spreadsheet
nobody updates. Nothing seeded here can reach a patient until someone films it
and a GhSL fluent consultant approves it.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from clips.models import ClipKind, SignClip

# Fingerspelling alphabet for the FR 1.6 fallback. Digits are included because
# dosage instructions are real content, "take 2 times daily" and similar.
LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + list("0123456789")

# A representative hospital intake vocabulary, matching the 30 to 50 sign scope
# the project abstract commits to for the hackathon demo.
#
# Single words only. The tokenizer splits on non word characters, so a
# hyphenated gloss such as HOW-MANY could never be matched from a caption. A
# multi word sign needs phrase level matching, which is deliberately not in
# this sprint.
BODY_PARTS = [
    "HEAD",
    "EYE",
    "EAR",
    "NOSE",
    "MOUTH",
    "THROAT",
    "NECK",
    "CHEST",
    "HEART",
    "STOMACH",
    "BACK",
    "ARM",
    "HAND",
    "LEG",
    "FOOT",
    "SKIN",
]

SYMPTOMS = [
    "PAIN",
    "HURT",
    "FEVER",
    "COUGH",
    "VOMIT",
    "NAUSEA",
    "DIZZY",
    "TIRED",
    "SWELLING",
    "BLEEDING",
    "RASH",
    "ITCH",
    "BREATHE",
]

CLINICAL = [
    "MEDICINE",
    "TABLET",
    "INJECTION",
    "DOCTOR",
    "NURSE",
    "HOSPITAL",
    "PREGNANT",
    "ALLERGY",
    "BLOOD",
    "TEMPERATURE",
]

EVERYDAY = [
    "YES",
    "NO",
    "WHERE",
    "WHEN",
    "TODAY",
    "YESTERDAY",
    "DAY",
    "WEEK",
    "MONTH",
    "MORE",
    "LESS",
    "EAT",
    "DRINK",
    "SLEEP",
]

WORDS = BODY_PARTS + SYMPTOMS + CLINICAL + EVERYDAY

# FR 5.3 names these three explicitly. They are ALERT rather than WORD because
# the patient selects them directly in Emergency Visual Triage Mode, so they
# are never looked up by tokenizing a caption.
ALERTS = ["ASTHMA", "PREGNANCY", "CANNOT_BREATHE"]

# Questions the app asks in its own voice, delivered as sign video only. FR 2.1
# requires the literacy check to carry no text at all, so this clip is the only
# way the question can be asked.
PROMPTS = ["CAN_YOU_READ_AND_WRITE"]


class Command(BaseCommand):
    help = "Seed the GhSL vocabulary the clip library needs, without footage."

    def add_arguments(self, parser):
        parser.add_argument(
            "--report",
            action="store_true",
            help="Report library coverage without creating anything.",
        )

    def handle(self, *args, **options):
        if options["report"]:
            self._report()
            return

        created_total = 0
        with transaction.atomic():
            for kind, glosses in (
                (ClipKind.LETTER, LETTERS),
                (ClipKind.WORD, WORDS),
                (ClipKind.ALERT, ALERTS),
                (ClipKind.PROMPT, PROMPTS),
            ):
                created = self._seed(kind, glosses)
                created_total += created
                self.stdout.write(
                    f"{kind}: {created} new, {len(glosses) - created} already present"
                )

        self.stdout.write(self.style.SUCCESS(f"Seeded {created_total} new gloss(es)."))
        self._report()

    def _seed(self, kind: str, glosses: list[str]) -> int:
        """
        Create any missing glosses of one kind, leaving existing rows alone.

        Idempotent by design, so it is safe to re run after adding words to the
        lists above without disturbing footage or approvals already recorded.
        """
        existing = set(
            SignClip.objects.filter(gloss__in=glosses).values_list("gloss", flat=True)
        )
        missing = [gloss for gloss in glosses if gloss not in existing]

        # bulk_create skips save(), so the gloss normalization that lives there
        # does not run. Normalizing here keeps the stored key consistent even
        # if someone adds a lowercase entry to the lists above.
        SignClip.objects.bulk_create(
            [SignClip(gloss=gloss.strip().upper(), kind=kind) for gloss in missing]
        )
        return len(missing)

    def _report(self) -> None:
        """Print what the library still needs, which is the useful part."""
        total = SignClip.objects.count()
        resolvable = SignClip.objects.resolvable().count()
        awaiting_footage = SignClip.objects.awaiting_footage().count()
        awaiting_review = SignClip.objects.awaiting_review().count()

        self.stdout.write("")
        self.stdout.write(f"Library: {total} gloss(es) total")
        self.stdout.write(f"  Ready for clinical use: {resolvable}")
        self.stdout.write(f"  Filmed, awaiting consultant review: {awaiting_review}")
        self.stdout.write(f"  Not yet filmed: {awaiting_footage}")

        if awaiting_footage:
            self.stdout.write(
                self.style.WARNING(
                    "\nUntil footage exists, captions fall back to fingerspelling, "
                    "or report words as unavailable where letters are missing too."
                )
            )
