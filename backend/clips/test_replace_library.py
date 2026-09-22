"""
Replacing the clip library with a folder of real recordings.

This command deletes footage from the database and from storage, which makes it
the most destructive thing in the project. These tests hold the two properties
that matter: it changes nothing without being told twice, and what it deletes is
only ever footage and the rows that footage was the whole point of. The team's
record of what still needs filming, a consultant's reviewed alias, and a
patient's prescription photographs all survive it.
"""

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import CommandError, call_command

from clips.models import ClipAlias, ClipKind, ReviewStatus, SignClip

BYTES = b"pretend-this-is-a-recording"


@pytest.fixture
def folder(tmp_path):
    """A folder of recordings, named the way the team names its footage."""

    def _folder(names, contents=None):
        made = tmp_path / "footage"
        made.mkdir(exist_ok=True)
        for index, name in enumerate(names):
            body = (contents or {}).get(name, BYTES + bytes([index]))
            (made / name).write_bytes(body)
        return made

    return _folder


def run(folder, **options):
    call_command("replace_clip_library", str(folder), yes=True, **options)


def plan(folder, **options):
    call_command("replace_clip_library", str(folder), **options)


@pytest.mark.django_db
class TestItRefusesToGuess:
    def test_a_folder_that_is_not_there(self, tmp_path):
        with pytest.raises(CommandError, match="Not a folder"):
            run(tmp_path / "nowhere")

    def test_a_folder_with_no_recordings_in_it(self, folder):
        with pytest.raises(CommandError, match="No video files"):
            run(folder(["notes.txt"]))

    def test_an_approval_with_nobody_named(self, folder):
        # An approval is a person vouching for a sign. Without a name it is
        # nobody's clinical judgment, which is the ADR 033 property in a script.
        with pytest.raises(CommandError, match="GhSL fluent consultant"):
            run(folder(["hurt.mp4"]), approve=True)


@pytest.mark.django_db
class TestThePlanChangesNothing:
    def test_without_yes_the_library_is_untouched(self, folder, make_clip):
        make_clip("HURT")

        plan(folder(["pain.mp4"]))

        clip = SignClip.objects.get(gloss="HURT")
        assert clip.video
        assert clip.review_status == ReviewStatus.APPROVED
        assert not SignClip.objects.filter(gloss="PAIN").exclude(video="").exists()

    def test_the_plan_names_the_database_and_the_storage(self, folder, capsys):
        # The one mistake this command could make is being pointed at
        # production while someone believed it was local.
        plan(folder(["pain.mp4"]))

        printed = capsys.readouterr().out
        assert "database" in printed
        assert "storage" in printed


@pytest.mark.django_db
class TestOldFootageGoes:
    def test_the_stored_file_is_deleted(self, folder, make_clip):
        old = make_clip("ABOUT").video.name
        assert default_storage.exists(old)

        run(folder(["pain.mp4"]))

        assert not default_storage.exists(old)

    def test_a_row_whose_footage_went_loses_its_approval(self, folder, make_clip):
        # The consultant approved the recording, not the word, so the approval
        # cannot survive the recording being thrown away.
        make_clip("HEAD")

        run(folder(["pain.mp4"]))

        head = SignClip.objects.get(gloss="HEAD")
        assert not head.video
        assert head.review_status == ReviewStatus.PENDING
        assert head.reviewed_by == ""

    def test_an_object_no_row_points_at_is_deleted(self, folder):
        # Django renames rather than overwrites when a name is taken, so a
        # library replaced a few times leaves copies nothing can reach.
        default_storage.save("clips/orphan.mp4", ContentFile(b"left-behind"))

        run(folder(["pain.mp4"]))

        assert not default_storage.exists("clips/orphan.mp4")

    def test_the_stitched_cache_is_emptied(self, folder):
        default_storage.save("stitched/abc123.mp4", ContentFile(b"old-sentence"))

        run(folder(["pain.mp4"]))

        assert not default_storage.exists("stitched/abc123.mp4")

    def test_a_prescription_photograph_is_not_touched(self, folder):
        # Those belong to a patient's prescription, not to the clip library.
        kept = default_storage.save("medicines/box.jpg", ContentFile(b"a-photo"))

        run(folder(["pain.mp4"]))

        assert default_storage.exists(kept)


@pytest.mark.django_db
class TestTheNewFootageArrives:
    def test_each_recording_becomes_a_clip(self, folder):
        run(folder(["pain.mp4", "hurt.mp4"]))

        assert set(
            SignClip.objects.exclude(video="").values_list("gloss", flat=True)
        ) == {"PAIN", "HURT"}

    def test_an_underscored_name_is_a_phrase_not_a_word(self, folder):
        # What the user asked for: i_am_pregnant is a sentence, and a word sign
        # matched a token at a time would never play it.
        run(folder(["i_am_pregnant.mp4"]))

        assert SignClip.objects.get(gloss="I_AM_PREGNANT").kind == ClipKind.PHRASE

    def test_a_name_with_spaces_becomes_one_gloss(self, folder):
        run(folder(["Do you have pain before.mp4"]))

        assert SignClip.objects.filter(gloss="DO_YOU_HAVE_PAIN_BEFORE").exists()

    def test_a_row_already_filed_as_a_word_is_corrected_to_a_phrase(
        self, folder, make_clip
    ):
        # Kind is only guessed for a new row, so without this the sentence
        # would keep the kind it was first filed under.
        make_clip("I_AM_PREGNANT", kind=ClipKind.WORD)

        run(folder(["i_am_pregnant.mp4"]))

        assert SignClip.objects.get(gloss="I_AM_PREGNANT").kind == ClipKind.PHRASE

    def test_an_alert_row_keeps_its_kind(self, folder, make_clip):
        # An alert is chosen by the feature that uses it, not by a filename.
        make_clip("CANNOT_BREATHE", kind=ClipKind.ALERT)

        run(folder(["cannot_breathe.mp4"]))

        assert SignClip.objects.get(gloss="CANNOT_BREATHE").kind == ClipKind.ALERT

    def test_nothing_is_approved_unless_asked(self, folder):
        run(folder(["pain.mp4"]))

        assert SignClip.objects.get(gloss="PAIN").review_status == ReviewStatus.PENDING
        assert not SignClip.objects.resolvable().exists()

    def test_approving_records_who_checked_it(self, folder):
        run(folder(["pain.mp4"]), approve=True, reviewer="Ama Mensah, GhSL")

        pain = SignClip.objects.get(gloss="PAIN")
        assert pain.review_status == ReviewStatus.APPROVED
        assert pain.reviewed_by == "Ama Mensah, GhSL"


@pytest.mark.django_db
class TestTwoNamesOneRecording:
    """
    Two different signs are usually not one recording: a take was reused, or a
    file was copied to the wrong name. Either way a patient could be shown a
    sign that says something else.
    """

    def test_identical_files_are_left_awaiting_review(self, folder):
        same = folder(
            ["of.mp4", "off.mp4"], contents={"of.mp4": BYTES, "off.mp4": BYTES}
        )

        run(same, approve=True, reviewer="Ama Mensah, GhSL")

        assert [
            clip.review_status
            for clip in SignClip.objects.filter(gloss__in=["OF", "OFF"])
        ] == [ReviewStatus.PENDING, ReviewStatus.PENDING]

    def test_they_are_still_imported(self, folder):
        same = folder(
            ["of.mp4", "off.mp4"], contents={"of.mp4": BYTES, "off.mp4": BYTES}
        )

        run(same, approve=True, reviewer="Ama Mensah, GhSL")

        assert (
            SignClip.objects.filter(gloss__in=["OF", "OFF"]).exclude(video="").count()
            == 2
        )

    def test_the_consultant_can_say_they_are_one_sign(self, folder):
        same = folder(
            ["afternoon.mp4", "evening.mp4"],
            contents={"afternoon.mp4": BYTES, "evening.mp4": BYTES},
        )

        run(same, approve=True, reviewer="Ama Mensah, GhSL", identical_ok=True)

        assert SignClip.objects.resolvable().count() == 2

    def test_the_rest_of_the_library_is_still_approved(self, folder):
        mixed = folder(
            ["of.mp4", "off.mp4", "pain.mp4"],
            contents={"of.mp4": BYTES, "off.mp4": BYTES},
        )

        run(mixed, approve=True, reviewer="Ama Mensah, GhSL")

        assert SignClip.objects.get(gloss="PAIN").review_status == ReviewStatus.APPROVED


@pytest.mark.django_db
class TestTheEmergencyAlerts:
    def test_an_alert_is_given_the_recording_of_the_sentence_it_says(self, folder):
        # The footage is named for the sentence, I_am_pregnant.mp4, and the
        # alert is a clinical identifier, PREGNANCY. One recording serves both.
        run(folder(["i_am_pregnant.mp4"]), approve=True, reviewer="Ama Mensah, GhSL")

        alert = SignClip.objects.get(gloss="PREGNANCY")
        assert alert.kind == ClipKind.ALERT
        assert alert.video
        assert alert.review_status == ReviewStatus.APPROVED

    def test_the_phrase_keeps_its_own_recording_too(self, folder):
        run(folder(["i_cannot_breathe.mp4"]), approve=True, reviewer="Ama Mensah, GhSL")

        phrase = SignClip.objects.get(gloss="I_CANNOT_BREATHE")
        assert phrase.kind == ClipKind.PHRASE
        assert phrase.video

    def test_each_holds_its_own_file_rather_than_sharing_one(self, folder):
        # Otherwise deleting the phrase would silently empty the alert. The
        # copy is named after the alert, not after the sentence: the bucket is
        # configured to overwrite a name rather than rename around it, so
        # reusing the phrase's filename is how the two came to share an object
        # in production while this test passed on local storage.
        run(folder(["i_am_pregnant.mp4"]))

        phrase = SignClip.objects.get(gloss="I_AM_PREGNANT")
        alert = SignClip.objects.get(gloss="PREGNANCY")
        assert phrase.video.name == "clips/i_am_pregnant.mp4"
        assert alert.video.name == "clips/pregnancy.mp4"
        assert default_storage.exists(phrase.video.name)
        assert default_storage.exists(alert.video.name)

    def test_footage_named_for_the_alert_itself_wins(self, folder):
        # Somebody filmed the alert card on purpose. A copy derived from a
        # sentence must not overwrite it.
        run(folder(["pregnancy.mp4", "i_am_pregnant.mp4"]))

        alert = SignClip.objects.get(gloss="PREGNANCY")
        assert alert.video.name == "clips/pregnancy.mp4"
        assert alert.source_checksum

    def test_an_unapproved_sentence_leaves_the_alert_unapproved(self, folder):
        run(folder(["i_am_pregnant.mp4"]))

        assert (
            SignClip.objects.get(gloss="PREGNANCY").review_status
            == ReviewStatus.PENDING
        )

    def test_an_alert_whose_sentence_was_not_filmed_is_left_alone(self, folder):
        run(folder(["pain.mp4"]))

        assert not SignClip.objects.filter(gloss="PREGNANCY").exclude(video="").exists()


@pytest.mark.django_db
class TestWhatSurvives:
    def test_a_seeded_row_stays_as_a_record_of_what_needs_filming(self, folder):
        # The library doubles as the team's list of signs still to record, so a
        # replacement must not quietly shorten that list.
        call_command("seed_clips")
        before = SignClip.objects.awaiting_footage().count()

        run(folder(["pain.mp4"]))

        head = SignClip.objects.get(gloss="HEAD")
        assert not head.video
        assert head.gloss in SignClip.objects.awaiting_footage().values_list(
            "gloss", flat=True
        )
        # One fewer: PAIN is seeded, and now it is filmed.
        assert SignClip.objects.awaiting_footage().count() == before - 1

    def test_the_alphabet_survives(self, folder, alphabet):
        run(folder(["pain.mp4"]))

        assert SignClip.objects.filter(kind=ClipKind.LETTER).count() >= 26

    def test_a_row_a_reviewed_alias_points_at_survives(self, folder, make_clip):
        # The alias is a consultant's judgment that two words are one sign.
        # Deleting the clip would take that judgment with it.
        feeling = make_clip("FEELING")
        ClipAlias.objects.create(
            clip=feeling, term="doing", reviewed_by="Ama Mensah, GhSL"
        )

        run(folder(["pain.mp4"]))

        assert SignClip.objects.filter(gloss="FEELING").exists()
        assert ClipAlias.objects.filter(term="DOING").exists()

    def test_a_leftover_row_with_no_footage_is_deleted(self, folder, make_clip):
        # A gloss used once in a test, or a plural that has its own rule now.
        make_clip("UPLOADTEST_GLOSS")

        run(folder(["pain.mp4"]))

        assert not SignClip.objects.filter(gloss="UPLOADTEST_GLOSS").exists()

    def test_a_clip_in_the_new_folder_is_never_deleted_as_a_leftover(self, folder):
        run(folder(["pain.mp4"]))

        assert SignClip.objects.get(gloss="PAIN").video


@pytest.mark.django_db
class TestItCanBeRunAgain:
    def test_running_it_twice_leaves_one_copy_of_each_recording(self, folder):
        recordings = folder(["pain.mp4", "hurt.mp4"])

        run(recordings, approve=True, reviewer="Ama Mensah, GhSL")
        run(recordings, approve=True, reviewer="Ama Mensah, GhSL")

        _, stored = default_storage.listdir("clips")
        assert len(stored) == 2
        assert SignClip.objects.resolvable().count() == 2
