"""
Tests for the media uploader, ADR 050.

Written after a five byte `how_are_you_doing.mp4` sat in the bucket while the
real 342KB file sat on disk. The command had checked only whether the name
existed, reported the clip as already present, and exited successfully. The
phrase resolved correctly and played nothing, and there was no failure anywhere
to look at.

The uploader had no tests at all, which is how a name-only check survived.
"""

import pytest
from django.core.files.storage import FileSystemStorage
from django.core.management import call_command

from clips.management.commands import upload_media


class FakeBucketStorage(FileSystemStorage):
    """
    Stands in for R2.

    A subclass rather than FileSystemStorage itself, because the command
    refuses to run when the configured backend is local disk, and that refusal
    is matched on the class name.
    """


@pytest.fixture
def bucket(tmp_path, settings):
    """A configured storage that is not local disk as far as the command sees."""
    location = tmp_path / "bucket"
    location.mkdir()
    settings.STORAGES = {
        **settings.STORAGES,
        "default": {
            "BACKEND": f"{FakeBucketStorage.__module__}.FakeBucketStorage",
            "OPTIONS": {"location": str(location)},
        },
    }
    return location


@pytest.fixture
def media(tmp_path, settings):
    """The local MEDIA_ROOT the command reads from."""
    root = tmp_path / "media"
    (root / "clips").mkdir(parents=True)
    settings.MEDIA_ROOT = str(root)
    return root


class TestUploadingWhatIsMissing:
    def test_a_file_not_in_storage_is_uploaded(self, media, bucket, capsys):
        (media / "clips" / "ask.mp4").write_bytes(b"real video bytes")

        call_command("upload_media")

        assert (bucket / "clips" / "ask.mp4").read_bytes() == b"real video bytes"
        assert "uploaded 1" in capsys.readouterr().out

    def test_a_file_already_present_at_the_same_size_is_left_alone(
        self, media, bucket, capsys
    ):
        (media / "clips" / "ask.mp4").write_bytes(b"same")
        (bucket / "clips").mkdir()
        (bucket / "clips" / "ask.mp4").write_bytes(b"same")

        call_command("upload_media")

        assert "already present 1" in capsys.readouterr().out

    def test_the_stitched_cache_is_skipped(self, media, bucket):
        (media / "stitched").mkdir()
        (media / "stitched" / "abc.mp4").write_bytes(b"derived")

        call_command("upload_media")

        assert not (bucket / "stitched" / "abc.mp4").exists()

    def test_local_storage_is_refused_rather_than_copied_onto_itself(
        self, media, settings, capsys
    ):
        # The likeliest reason to be here with local storage configured is a
        # .env that was not picked up, so this is refused rather than performed.
        settings.STORAGES = {
            **settings.STORAGES,
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        }
        (media / "clips" / "ask.mp4").write_bytes(b"x")

        call_command("upload_media")

        assert "nowhere to upload to" in capsys.readouterr().out


class TestAFileThatIsPresentButDifferent:
    """
    The case the command used to miss entirely.

    Reported, and deliberately not repaired on its own. The bucket is not a copy
    of the laptop: a prescription photograph is uploaded straight to storage by
    the running service and never exists locally, so a local file that differs
    is usually this machine being out of date. Replacing on mismatch would have
    overwritten a real 107KB photograph with a 5KB stale copy.
    """

    @pytest.fixture(autouse=True)
    def a_truncated_object(self, media, bucket):
        (media / "clips" / "ask.mp4").write_bytes(b"the whole video")
        (bucket / "clips").mkdir()
        (bucket / "clips" / "ask.mp4").write_bytes(b"tr")

    def test_it_is_reported(self, capsys):
        call_command("upload_media")

        out = capsys.readouterr().out
        assert "1 file(s) differ in size" in out
        assert "clips/ask.mp4" in out

    def test_it_is_not_replaced_without_being_asked(self, bucket):
        call_command("upload_media")

        assert (bucket / "clips" / "ask.mp4").read_bytes() == b"tr"

    def test_naming_it_replaces_it(self, bucket, capsys):
        call_command("upload_media", replace=["clips/ask.mp4"])

        assert (bucket / "clips" / "ask.mp4").read_bytes() == b"the whole video"
        assert "replaced 1" in capsys.readouterr().out

    def test_replacing_keeps_the_name_the_database_points_at(self, bucket):
        # Saving over an existing name can pick a free name instead, which
        # would leave the truncated object exactly where the rows still point.
        call_command("upload_media", replace=["clips/ask.mp4"])

        assert sorted(p.name for p in (bucket / "clips").iterdir()) == ["ask.mp4"]

    def test_a_dry_run_changes_nothing(self, bucket):
        call_command("upload_media", replace=["clips/ask.mp4"], dry_run=True)

        assert (bucket / "clips" / "ask.mp4").read_bytes() == b"tr"


class TestReplacingSomethingThatIsNotThere:
    def test_a_name_with_no_local_copy_is_reported(self, media, bucket, capsys):
        # A mistyped name would otherwise report a successful run that repaired
        # nothing at all.
        call_command("upload_media", replace=["clips/typo.mp4"])

        assert "no local copy" in capsys.readouterr().err


class TestReadingTheStoredSize:
    def test_a_backend_that_raises_is_treated_as_needing_re_upload(
        self, monkeypatch, bucket
    ):
        # Being wrong this way costs bandwidth. Being wrong the other way costs
        # a sign the patient never sees.
        monkeypatch.setattr(
            upload_media.default_storage,
            "size",
            lambda name: (_ for _ in ()).throw(OSError("no such key")),
        )

        assert upload_media._stored_size("clips/ask.mp4") is None
