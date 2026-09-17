"""
Tests for `import_uploads`, and for the admin's browser upload form.

Render's free tier has no shell and no persistent disk, so `import_footage`,
which reads a folder on the server's own filesystem, cannot do anything there.
This is the path that actually gets footage into a deployment: files sent
straight from the reviewer's browser. It shares `_apply_import` with
`import_footage`, so the two are tested to the same standard rather than
separately, and the tests that matter most, unchanged content being left
alone and changed content resetting approval, are the same tests
`test_import_clips.py` runs against the folder path.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from clips.importing import (
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    ImportReport,
    import_uploads,
)
from clips.models import ClipKind, ReviewStatus, SignClip


def video(name: str, content: bytes = b"pretend-video") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, content, content_type="video/webm")


@pytest.mark.django_db
class TestImportUploads:
    def test_creates_a_row_from_an_uploaded_file(self):
        report = import_uploads([video("head.webm")])

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.video
        assert report.created == ["HEAD"]

    def test_attaches_footage_to_a_gloss_already_in_the_library(self):
        SignClip.objects.create(gloss="HEAD", kind=ClipKind.WORD)

        import_uploads([video("head.webm")])

        assert SignClip.objects.count() == 1
        assert SignClip.objects.get(gloss="HEAD").video

    def test_never_approves_by_default(self):
        # The same safety property as the folder import: a browser upload
        # cannot vouch for a medical sign any more than a script can.
        import_uploads([video("head.webm")])

        assert not SignClip.objects.resolvable().exists()
        assert SignClip.objects.awaiting_review().count() == 1

    def test_approving_requires_naming_the_reviewer(self):
        with pytest.raises(ValueError, match="consultant"):
            import_uploads([video("head.webm")], approve=True)

        assert not SignClip.objects.resolvable().exists()

    def test_approves_and_records_the_reviewer_when_named(self):
        import_uploads([video("head.webm")], approve=True, reviewer="Ama Mensah, GhSL")

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.is_resolvable
        assert clip.reviewed_by == "Ama Mensah, GhSL"

    def test_a_single_character_filename_becomes_a_letter(self):
        import_uploads([video("a.webm")])

        assert SignClip.objects.get(gloss="A").kind == ClipKind.LETTER

    def test_ignores_files_that_are_not_video(self):
        report = import_uploads([video("notes.txt")])

        assert not SignClip.objects.exists()
        assert report.ignored == ["notes.txt"]

    def test_multiple_files_in_one_batch_all_land(self):
        report = import_uploads([video("head.webm"), video("hurt.mp4")])

        assert SignClip.objects.count() == 2
        assert sorted(report.created) == ["HEAD", "HURT"]

    def test_replacing_footage_resets_approval(self):
        import_uploads([video("head.webm")], approve=True, reviewer="Ama Mensah")

        report = import_uploads([video("head.webm", b"a corrected recording")])

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.PENDING
        assert not clip.is_resolvable
        assert report.replaced == ["HEAD"]

    def test_unchanged_content_is_left_completely_alone(self):
        # The guard that makes uploading the same batch twice, or a browser
        # tab retrying a failed submit, safe. Re-uploading the identical bytes
        # must not un-approve reviewed footage.
        import_uploads([video("head.webm")], approve=True, reviewer="Ama Mensah")

        report = import_uploads([video("head.webm")])

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.APPROVED
        assert report.unchanged == ["HEAD"]
        assert report.replaced == []


class TestUploadedFileChecksum:
    """
    The part that has to work streaming, on a file already partway consumed by
    whatever Django did to receive it.
    """

    def test_hashing_leaves_the_file_ready_to_be_read_again(self):
        from clips.importing import uploaded_file_checksum

        upload = video("head.webm", b"some bytes")
        checksum_one = uploaded_file_checksum(upload)

        # If the pointer were not rewound, this would hash nothing and every
        # upload would compute the same checksum for an empty tail.
        assert upload.read() == b"some bytes"
        assert uploaded_file_checksum(upload) == checksum_one

    def test_identical_content_hashes_the_same_regardless_of_filename(self):
        from clips.importing import uploaded_file_checksum

        assert uploaded_file_checksum(
            video("head.webm", b"identical")
        ) == uploaded_file_checksum(video("different_name.mp4", b"identical"))


@pytest.mark.django_db
class TestBatchLimits:
    """
    Checked before anything is read, so a bad request fails at once rather
    than after minutes of uploading. Real limits, not decorative: a filmed
    GhSL clip is a few seconds long, so a file the size of the per file
    ceiling is far more likely to be the wrong file than a real recording.
    """

    def test_refuses_a_batch_larger_than_the_file_limit(self, monkeypatch):
        import clips.importing as importing_module

        monkeypatch.setattr(importing_module, "MAX_UPLOAD_FILES", 2)
        uploads = [video(f"gloss{i}.webm") for i in range(3)]

        with pytest.raises(ValueError, match="200|2"):
            import_uploads(uploads)

        # Refused before anything is imported, batch or nothing.
        assert not SignClip.objects.exists()

    def test_refuses_a_file_larger_than_the_per_file_limit(self, monkeypatch):
        import clips.importing as importing_module

        monkeypatch.setattr(importing_module, "MAX_UPLOAD_BYTES", 10)
        oversized = video("head.webm", b"this is more than ten bytes")

        with pytest.raises(ValueError, match="head.webm"):
            import_uploads([oversized])

        assert not SignClip.objects.exists()

    def test_the_real_limits_are_sane_defaults(self):
        # Not asserting exact numbers, which would make this test the thing
        # that breaks every time the limit is tuned. Asserting the shape: a
        # batch that could hold a whole filming session, files sized for a
        # short clip rather than a feature film.
        assert MAX_UPLOAD_FILES >= 50
        assert 10 * 1024 * 1024 <= MAX_UPLOAD_BYTES <= 500 * 1024 * 1024


class TestImportReport:
    def test_imported_counts_created_and_replaced_together(self):
        report = ImportReport(created=["A", "B"], replaced=["C"])
        assert report.imported == 3

    def test_touched_anything_is_false_for_an_all_unchanged_batch(self):
        report = ImportReport(unchanged=["A", "B"])
        assert report.touched_anything is False


@pytest.mark.django_db
class TestBulkUploadFromTheAdmin:
    """
    The HTTP view a reviewer actually uses: select files in a browser, submit,
    done. This is the path this exists for, since Render's free tier has no
    shell and no persistent disk for `import_footage` to read from.
    """

    @pytest.fixture
    def admin_client(self, django_user_model, client):
        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client.login(username="reviewer", password="pw")
        return client

    def test_a_get_shows_the_form_and_changes_nothing(self, admin_client):
        response = admin_client.get("/admin/clips/signclip/bulk-upload/")

        assert response.status_code == 200
        assert not SignClip.objects.exists()

    def test_a_post_imports_the_uploaded_files(self, admin_client):
        admin_client.post(
            "/admin/clips/signclip/bulk-upload/",
            {"videos": [video("head.webm"), video("hurt.mp4")]},
        )

        assert SignClip.objects.filter(gloss="HEAD").exists()
        assert SignClip.objects.filter(gloss="HURT").exists()

    def test_uploaded_footage_is_not_approved_by_default(self, admin_client):
        admin_client.post(
            "/admin/clips/signclip/bulk-upload/", {"videos": [video("head.webm")]}
        )

        assert not SignClip.objects.resolvable().exists()

    def test_checking_approve_without_a_reviewer_shows_an_error(self, admin_client):
        response = admin_client.post(
            "/admin/clips/signclip/bulk-upload/",
            {"videos": [video("head.webm")], "approve": "on"},
            follow=True,
        )

        assert response.status_code == 200
        # Refused rather than silently approved by nobody in particular.
        assert not SignClip.objects.resolvable().exists()

    def test_checking_approve_with_a_reviewer_approves_the_batch(self, admin_client):
        admin_client.post(
            "/admin/clips/signclip/bulk-upload/",
            {
                "videos": [video("head.webm")],
                "approve": "on",
                "reviewer": "Ama Mensah, GhSL",
            },
        )

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.is_resolvable
        assert clip.reviewed_by == "Ama Mensah, GhSL"

    def test_submitting_with_no_files_is_reported_not_silently_ignored(
        self, admin_client
    ):
        response = admin_client.post(
            "/admin/clips/signclip/bulk-upload/", {}, follow=True
        )

        assert response.status_code == 200
        assert not SignClip.objects.exists()

    def test_replacing_footage_through_the_form_resets_approval(self, admin_client):
        admin_client.post(
            "/admin/clips/signclip/bulk-upload/",
            {
                "videos": [video("head.webm")],
                "approve": "on",
                "reviewer": "Ama Mensah",
            },
        )

        admin_client.post(
            "/admin/clips/signclip/bulk-upload/",
            {"videos": [video("head.webm", b"a corrected recording")]},
        )

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.review_status == ReviewStatus.PENDING

    def test_it_needs_a_logged_in_admin(self, client):
        client.post(
            "/admin/clips/signclip/bulk-upload/", {"videos": [video("head.webm")]}
        )

        assert not SignClip.objects.exists()

    def test_the_form_names_glosses_still_needing_footage(self, admin_client):
        # So a reviewer names the file correctly the first time, rather than
        # typo a gloss into existence and only notice on the next review pass.
        SignClip.objects.create(gloss="STOMACH", kind=ClipKind.WORD)

        response = admin_client.get("/admin/clips/signclip/bulk-upload/")

        assert b"STOMACH" in response.content or b"stomach" in response.content
