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
