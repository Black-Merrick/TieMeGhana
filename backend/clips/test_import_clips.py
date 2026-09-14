"""
Tests for importing filmed GhSL footage into the library.

This is the command that turns a folder of recorded clips into resolvable
signs. Its most important behaviour is what it refuses to do: importing
footage must never approve it, because approval means a GhSL fluent consultant
vouched for the sign, and no script can do that.
"""

from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from clips.models import ClipKind, ReviewStatus, SignClip


@pytest.fixture
def clip_folder(tmp_path):
    """A folder of pretend footage, named the way the command expects."""
    folder = tmp_path / "footage"
    folder.mkdir()
    (folder / "head.webm").write_bytes(b"pretend-video")
    (folder / "hurt.mp4").write_bytes(b"pretend-video")
    (folder / "a.webm").write_bytes(b"pretend-video")
    (folder / "notes.txt").write_text("not a video")
    return folder


def run_import(folder, **options):
    out = StringIO()
    call_command("import_clips", str(folder), stdout=out, **options)
    return out.getvalue()


@pytest.mark.django_db
class TestImportClips:
    def test_attaches_footage_to_a_gloss_already_in_the_library(self, clip_folder):
        SignClip.objects.create(gloss="HEAD", kind=ClipKind.WORD)

        run_import(clip_folder)

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.video
        assert SignClip.objects.count() == 3

    def test_creates_a_row_for_footage_the_library_did_not_expect(self, clip_folder):
        # Filming may get ahead of the seeded vocabulary, and losing that
        # footage silently would be worse than adding a row for it.
        run_import(clip_folder)

        assert SignClip.objects.filter(gloss="HURT").exists()

    def test_importing_never_approves_footage(self, clip_folder):
        # The safety property. A script cannot vouch for a medical sign, so
        # imported footage stays unusable until a consultant approves it.
        run_import(clip_folder)

        assert SignClip.objects.count() == 3
        assert not SignClip.objects.resolvable().exists()
        assert SignClip.objects.awaiting_review().count() == 3

    def test_approving_requires_naming_the_reviewer(self, clip_folder):
        # ADR 009 makes review a recorded fact. An approval with nobody's name
        # against it is not a review, it is a blank cheque.
        with pytest.raises(CommandError):
            run_import(clip_folder, approve=True)

        assert not SignClip.objects.resolvable().exists()

    def test_approves_and_records_the_reviewer_when_named(self, clip_folder):
        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.APPROVED
        assert clip.reviewed_by == "Ama Mensah, GhSL"
        assert clip.is_resolvable

    def test_a_single_character_filename_becomes_a_fingerspelling_letter(
        self, clip_folder
    ):
        # The alphabet is imported the same way as words, and a letter matched
        # as a whole word sign would break the FR 1.6 fallback.
        run_import(clip_folder)

        assert SignClip.objects.get(gloss="A").kind == ClipKind.LETTER

    def test_ignores_files_that_are_not_video(self, clip_folder):
        run_import(clip_folder)

        assert not SignClip.objects.filter(gloss="NOTES").exists()

    def test_re_importing_replaces_the_footage_and_resets_review(self, clip_folder):
        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")

        (clip_folder / "head.webm").write_bytes(b"corrected-video")
        run_import(clip_folder)

        clip = SignClip.objects.get(gloss="HEAD")
        # Replacing footage invalidates the previous approval. The consultant
        # approved the old recording, not this one.
        assert clip.review_status == ReviewStatus.PENDING
        assert not clip.is_resolvable

    def test_records_duration_when_given(self, clip_folder):
        run_import(clip_folder, duration_ms=750)

        assert SignClip.objects.get(gloss="HEAD").duration_ms == 750

    def test_reports_a_missing_folder_clearly(self, tmp_path):
        with pytest.raises(CommandError):
            run_import(tmp_path / "does-not-exist")

    def test_reports_what_it_imported(self, clip_folder):
        output = run_import(clip_folder)

        assert "3" in output


@pytest.mark.django_db
class TestUnchangedFootageIsLeftAlone:
    """
    The guard that makes repeated imports safe.

    Re-importing resets approval on purpose, because a consultant approved the
    recording that was there before. So anything that re-runs an import, the
    watcher polling, a file sync touching timestamps, a second click of the
    admin button, would silently un-approve reviewed footage and the doctor
    would just see sentences start being refused mid consultation.
    """

    def test_a_second_import_of_the_same_file_keeps_the_approval(self, clip_folder):
        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")

        run_import(clip_folder)

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.APPROVED
        assert clip.reviewed_by == "Ama Mensah, GhSL"
        assert clip.is_resolvable

    def test_a_second_import_reports_the_files_as_unchanged(self, clip_folder):
        run_import(clip_folder)

        output = run_import(clip_folder)

        assert "unchanged" in output

    def test_changed_footage_still_resets_the_approval(self, clip_folder):
        # The guard must not become a way for corrected footage to keep an
        # approval it was never given.
        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")

        (clip_folder / "head.webm").write_bytes(b"corrected-recording")
        run_import(clip_folder)

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.PENDING
        assert not clip.is_resolvable

    def test_the_checksum_is_of_the_contents_not_the_timestamp(self, clip_folder):
        # A timestamp changes when nothing about the file does, which is
        # exactly the case the guard exists to survive.
        import os

        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")
        os.utime(clip_folder / "head.webm", (0, 0))

        run_import(clip_folder)

        assert SignClip.objects.get(gloss="HEAD").review_status == (
            ReviewStatus.APPROVED
        )

    def test_a_file_restored_to_its_earlier_contents_is_recognised(self, clip_folder):
        run_import(clip_folder)
        original = (clip_folder / "head.webm").read_bytes()
        (clip_folder / "head.webm").write_bytes(b"different")
        run_import(clip_folder, approve=True, reviewer="Ama Mensah, GhSL")

        # Back to what was imported first, which is not what is stored now.
        (clip_folder / "head.webm").write_bytes(original)
        run_import(clip_folder)

        # Contents differ from the stored checksum, so it is a replacement.
        assert SignClip.objects.get(gloss="HEAD").review_status == (
            ReviewStatus.PENDING
        )


@pytest.mark.django_db
class TestImportFromTheAdmin:
    """
    The button, for the person adding footage in a hospital who has no
    terminal. Same code path as the command, so the two cannot diverge.
    """

    @pytest.fixture
    def admin_client(self, django_user_model, client):
        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client.login(username="reviewer", password="pw")
        return client

    def test_a_post_imports_the_footage_folder(
        self, admin_client, clip_folder, settings
    ):
        settings.FOOTAGE_DIR = clip_folder

        admin_client.post("/admin/clips/signclip/import-footage/")

        assert SignClip.objects.filter(gloss="HEAD").exists()

    def test_importing_from_the_admin_approves_nothing(
        self, admin_client, clip_folder, settings
    ):
        # A button cannot vouch for a medical sign any more than a script can.
        settings.FOOTAGE_DIR = clip_folder

        admin_client.post("/admin/clips/signclip/import-footage/")

        assert not SignClip.objects.resolvable().exists()

    def test_a_get_changes_nothing(self, admin_client, clip_folder, settings):
        # Importing replaces footage and resets approvals, so it must not be
        # reachable by anything that follows links, such as a crawler or a
        # browser prefetch.
        settings.FOOTAGE_DIR = clip_folder

        admin_client.get("/admin/clips/signclip/import-footage/")

        assert not SignClip.objects.exists()

    def test_a_missing_folder_is_reported_rather_than_raised(
        self, admin_client, tmp_path, settings
    ):
        settings.FOOTAGE_DIR = tmp_path / "not-there"

        response = admin_client.post(
            "/admin/clips/signclip/import-footage/", follow=True
        )

        assert response.status_code == 200
        assert not SignClip.objects.exists()

    def test_it_needs_a_logged_in_admin(self, client, clip_folder, settings):
        settings.FOOTAGE_DIR = clip_folder

        client.post("/admin/clips/signclip/import-footage/")

        assert not SignClip.objects.exists()
