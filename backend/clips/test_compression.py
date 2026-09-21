"""
Making an uploaded clip small.

Real video through the real ffmpeg wherever the point is what comes out (its
size, its shape, whether it will start playing), because a mock of the encoder
would prove only that the mock was called. Skipped, as the stitching tests are,
on a machine with no ffmpeg. The cases that are about what happens when there
is none, or when the file is not a video, need no video at all.
"""

import json
import subprocess
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from clips import compression
from clips.compression import (
    MAX_DIMENSION,
    CompressionResult,
    compress_video,
    compressed_name,
    describe_saving,
)
from clips.importing import import_uploads
from clips.models import ReviewStatus, SignClip

needs_ffmpeg = pytest.mark.skipif(
    not compression.ffmpeg_available(), reason="ffmpeg is not installed"
)


@pytest.fixture(autouse=True)
def compression_on(settings):
    settings.CLIP_COMPRESSION_ENABLED = True


def make_video(
    tmp_path: Path, name="in.mp4", size="720x1280", seconds=2, fps=30, audio=True
):
    """A real video, filmed the way a phone films: large, with a sound track."""
    path = tmp_path / name
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={size}:rate={fps}:duration={seconds}",
    ]
    if audio:
        command += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    command += ["-c:v", "libx264", "-b:v", "3M", "-pix_fmt", "yuv420p"]
    if audio:
        command += ["-c:a", "aac"]
    command.append(str(path))
    subprocess.run(command, check=True)
    return path


def upload(path: Path, name=None) -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name or path.name, path.read_bytes(), content_type="video/mp4"
    )


def probe(path: Path) -> dict:
    output = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(output)


def written(tmp_path: Path, result: CompressionResult) -> Path:
    path = tmp_path / "out.mp4"
    path.write_bytes(result.data)
    return path


@needs_ffmpeg
class TestWhatComesOut:
    def test_it_is_much_smaller(self, tmp_path):
        source = make_video(tmp_path)

        result = compress_video(upload(source))

        assert result.compressed
        assert result.compressed_size < result.original_size / 3
        assert result.saved_bytes == result.original_size - result.compressed_size

    def test_it_is_h264_in_an_mp4_that_every_phone_plays(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path)))

        streams = probe(written(tmp_path, result))["streams"]
        video = next(stream for stream in streams if stream["codec_type"] == "video")
        assert video["codec_name"] == "h264"
        assert video["profile"] == "Main"
        assert video["pix_fmt"] == "yuv420p"

    def test_the_sound_track_is_dropped(self, tmp_path):
        # The player mutes every clip, and a sign has no sound worth its weight.
        source = make_video(tmp_path, audio=True)
        assert {s["codec_type"] for s in probe(source)["streams"]} == {"video", "audio"}

        result = compress_video(upload(source))

        kinds = {s["codec_type"] for s in probe(written(tmp_path, result))["streams"]}
        assert kinds == {"video"}

    def test_a_portrait_clip_stays_portrait_and_fits_the_limit(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path, size="720x1280")))

        video = probe(written(tmp_path, result))["streams"][0]
        assert video["height"] == MAX_DIMENSION
        assert video["width"] < video["height"]
        assert video["width"] % 2 == 0

    def test_a_landscape_clip_stays_landscape_and_fits_the_limit(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path, size="1920x1080")))

        video = probe(written(tmp_path, result))["streams"][0]
        assert video["width"] == MAX_DIMENSION
        assert video["height"] < video["width"]
        assert video["height"] % 2 == 0

    def test_the_proportions_are_kept(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path, size="720x1280")))

        video = probe(written(tmp_path, result))["streams"][0]
        assert video["width"] / video["height"] == pytest.approx(720 / 1280, abs=0.01)

    def test_a_small_clip_is_never_enlarged(self, tmp_path):
        source = make_video(tmp_path, size="320x568", seconds=2)

        result = compress_video(upload(source))

        if result.compressed:
            video = probe(written(tmp_path, result))["streams"][0]
            assert (video["width"], video["height"]) == (320, 568)

    def test_it_starts_playing_before_it_has_all_arrived(self, tmp_path):
        # The index at the front of the file. Without it a browser must have the
        # whole file before it can show a frame.
        result = compress_video(upload(make_video(tmp_path)))

        head = result.data[:4096]
        assert b"moov" in head
        assert head.index(b"moov") < (
            result.data.index(b"mdat") if b"mdat" in result.data else len(result.data)
        )

    def test_a_high_frame_rate_is_thinned(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path, fps=60)))

        rate = probe(written(tmp_path, result))["streams"][0]["r_frame_rate"]
        numerator, denominator = rate.split("/")
        assert int(numerator) / int(denominator) <= 30.5

    def test_a_normal_frame_rate_is_not_invented(self, tmp_path):
        # The fps filter resamples to whatever it is given: a 25 frame clip must
        # not be padded out to 30.
        result = compress_video(upload(make_video(tmp_path, fps=25)))

        rate = probe(written(tmp_path, result))["streams"][0]["r_frame_rate"]
        numerator, denominator = rate.split("/")
        assert int(numerator) / int(denominator) == pytest.approx(25, abs=0.5)

    def test_it_reports_the_real_length(self, tmp_path):
        result = compress_video(upload(make_video(tmp_path, seconds=3)))

        assert result.duration_ms == pytest.approx(3000, abs=150)

    def test_metadata_from_the_phone_is_not_carried_over(self, tmp_path):
        source = tmp_path / "located.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=720x1280:rate=30:duration=1",
                "-metadata",
                "location=+05.6037-000.1870/",
                "-metadata",
                "comment=filmed on a phone",
                "-c:v",
                "libx264",
                "-b:v",
                "3M",
                str(source),
            ],
            check=True,
        )

        result = compress_video(upload(source))

        assert b"+05.6037" not in result.data
        assert b"filmed on a phone" not in result.data

    def test_the_source_is_left_ready_to_be_read_again(self, tmp_path):
        source = upload(make_video(tmp_path))

        compress_video(source)

        assert source.tell() == 0

    def test_a_folder_file_is_compressed_too(self, tmp_path):
        # The same function serves a file on disk, for the folder importer.
        from django.core.files import File

        path = make_video(tmp_path)
        with path.open("rb") as handle:
            result = compress_video(File(handle))

        assert result.compressed


class TestWhenItCannotOrShouldNot:
    def test_a_file_that_is_not_a_video_is_kept_as_it_arrived(self):
        garbage = SimpleUploadedFile(
            "hurt.mp4", b"pretend-video", content_type="video/mp4"
        )

        result = compress_video(garbage)

        # Whether or not ffmpeg is installed, and CI has none: the file is kept
        # as it arrived, and the reason is given. The reason's wording differs
        # by cause, and is pinned for the ffmpeg case in the next test.
        assert result.data is None
        assert not result.compressed
        assert result.reason
        assert garbage.tell() == 0

    @needs_ffmpeg
    def test_it_says_a_file_that_is_not_a_video_could_not_be_read(self):
        garbage = SimpleUploadedFile(
            "hurt.mp4", b"pretend-video", content_type="video/mp4"
        )

        result = compress_video(garbage)

        assert "could not be read as a video" in result.reason

    def test_without_ffmpeg_the_original_is_kept_and_it_says_so(self, monkeypatch):
        monkeypatch.setattr(compression, "ffmpeg_available", lambda: False)

        result = compress_video(SimpleUploadedFile("a.mp4", b"x" * 500))

        assert result.data is None
        assert "ffmpeg is not installed" in result.reason

    def test_a_timeout_keeps_the_original_and_says_so(self, monkeypatch):
        monkeypatch.setattr(compression, "ffmpeg_available", lambda: True)

        def slow(*args, **kwargs):
            raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

        monkeypatch.setattr(compression.subprocess, "run", slow)

        result = compress_video(SimpleUploadedFile("a.mp4", b"x" * 500))

        assert result.data is None
        assert "too long" in result.reason

    def test_a_missing_binary_at_run_time_keeps_the_original(self, monkeypatch):
        monkeypatch.setattr(compression, "ffmpeg_available", lambda: True)

        def missing(*args, **kwargs):
            raise FileNotFoundError("ffmpeg")

        monkeypatch.setattr(compression.subprocess, "run", missing)

        result = compress_video(SimpleUploadedFile("a.mp4", b"x" * 500))

        assert result.data is None

    def test_it_can_be_switched_off(self, settings):
        settings.CLIP_COMPRESSION_ENABLED = False

        result = compress_video(SimpleUploadedFile("a.mp4", b"x" * 500))

        assert result.data is None
        assert "switched off" in result.reason

    @needs_ffmpeg
    def test_a_clip_already_as_small_as_it_gets_is_kept_as_it_is(self, tmp_path):
        # Never worse. Squeezed once already, a second pass can come out larger.
        first = compress_video(upload(make_video(tmp_path, seconds=1)))
        small = tmp_path / "small.mp4"
        small.write_bytes(first.data)

        again = compress_video(upload(small))

        assert not again.compressed or again.compressed_size < again.original_size


class TestNaming:
    @pytest.mark.parametrize(
        "name,expected",
        [
            ("hurt.mov", "hurt.mp4"),
            ("hurt.webm", "hurt.mp4"),
            ("hurt.mp4", "hurt.mp4"),
            ("what_is_your_name.M4V", "what_is_your_name.mp4"),
        ],
    )
    def test_the_name_follows_what_the_file_now_is(self, name, expected):
        assert compressed_name(name) == expected

    def test_a_saving_is_described_in_plain_units(self):
        result = CompressionResult(
            data=b"x", original_size=4_400_000, compressed_size=600_000
        )

        assert describe_saving(result) == "4.2 MB to 0.6 MB"

    def test_a_very_small_result_is_described_in_kilobytes(self):
        result = CompressionResult(
            data=b"x", original_size=1_038_603, compressed_size=113_924
        )
        tiny = CompressionResult(
            data=b"x", original_size=1_038_603, compressed_size=60_000
        )

        assert describe_saving(result) == "1.0 MB to 0.1 MB"
        assert describe_saving(tiny) == "1.0 MB to 59 KB"


@needs_ffmpeg
@pytest.mark.django_db
class TestBulkUpload:
    def test_a_stored_clip_is_the_small_one(self, tmp_path):
        source = make_video(tmp_path, name="hurt.mp4")

        report = import_uploads([upload(source)])

        clip = SignClip.objects.get(gloss="HURT")
        assert clip.video.size < source.stat().st_size / 3
        assert list(report.compressed) == ["HURT"]
        assert report.uncompressed == {}

    def test_the_file_is_stored_as_an_mp4_whatever_came_in(self, tmp_path):
        source = make_video(tmp_path, name="hurt.mp4")

        import_uploads([upload(source, name="hurt.mov")])

        assert SignClip.objects.get(gloss="HURT").video.name.endswith(".mp4")

    def test_the_real_length_is_recorded(self, tmp_path):
        source = make_video(tmp_path, name="hurt.mp4", seconds=3)

        import_uploads([upload(source)])

        assert SignClip.objects.get(gloss="HURT").duration_ms == pytest.approx(
            3000, abs=150
        )

    def test_an_explicit_length_is_not_overridden(self, tmp_path):
        source = make_video(tmp_path, name="hurt.mp4", seconds=3)

        import_uploads([upload(source)], duration_ms=1234)

        assert SignClip.objects.get(gloss="HURT").duration_ms == 1234

    def test_uploading_the_same_file_again_is_still_recognised_as_unchanged(
        self, tmp_path
    ):
        # The checksum is of what was uploaded, not of what was stored, or the
        # second upload would look like a replacement and reset the approval.
        source = make_video(tmp_path, name="hurt.mp4")
        import_uploads([upload(source)], approve=True, reviewer="Ama Mensah")

        report = import_uploads([upload(source)])

        assert report.unchanged == ["HURT"]
        assert SignClip.objects.get(gloss="HURT").review_status == ReviewStatus.APPROVED

    def test_it_never_approves_by_being_compressed(self, tmp_path):
        import_uploads([upload(make_video(tmp_path, name="hurt.mp4"))])

        assert not SignClip.objects.resolvable().exists()

    def test_a_file_that_cannot_be_compressed_is_stored_and_reported(self):
        report = import_uploads(
            [SimpleUploadedFile("hurt.mp4", b"pretend-video", content_type="video/mp4")]
        )

        clip = SignClip.objects.get(gloss="HURT")
        assert clip.video
        assert "HURT" in report.uncompressed
        assert report.compressed == {}


@pytest.mark.django_db
class TestWithCompressionOff:
    def test_the_file_is_stored_as_it_arrived_and_nothing_is_reported(self, settings):
        settings.CLIP_COMPRESSION_ENABLED = False

        report = import_uploads(
            [
                SimpleUploadedFile(
                    "hurt.webm", b"pretend-video", content_type="video/webm"
                )
            ]
        )

        assert SignClip.objects.get(gloss="HURT").video.name.endswith(".webm")
        assert report.compressed == {} and report.uncompressed == {}


@needs_ffmpeg
@pytest.mark.django_db
class TestTheAdmin:
    @pytest.fixture
    def admin_client(self, django_user_model, client):
        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client.login(username="reviewer", password="pw")
        return client

    @staticmethod
    def form(**overrides):
        data = {
            "gloss": "HURT",
            "kind": "word",
            "review_status": "pending",
            "reviewed_by": "",
            "notes": "",
            "aliases-TOTAL_FORMS": "0",
            "aliases-INITIAL_FORMS": "0",
            "aliases-MIN_NUM_FORMS": "0",
            "aliases-MAX_NUM_FORMS": "1000",
        }
        data.update(overrides)
        return data

    def test_the_bulk_upload_page_reports_what_was_saved(self, admin_client, tmp_path):
        source = make_video(tmp_path, name="hurt.mp4")

        response = admin_client.post(
            reverse("admin:clips_signclip_bulk_upload"),
            {"videos": [upload(source)]},
            follow=True,
        )

        text = " ".join(str(message) for message in response.context["messages"])
        assert "smaller" in text
        assert "MB" in text

    def test_a_recording_added_on_the_clips_own_page_is_made_small(
        self, admin_client, tmp_path
    ):
        source = make_video(tmp_path, name="hurt.mp4")

        response = admin_client.post(
            reverse("admin:clips_signclip_add"),
            self.form(video=upload(source)),
            follow=True,
        )

        clip = SignClip.objects.get(gloss="HURT")
        assert clip.video.size < source.stat().st_size / 3
        assert clip.source_checksum
        assert clip.duration_ms
        assert "made smaller" in " ".join(str(m) for m in response.context["messages"])

    def test_a_recording_replaced_there_is_made_small(self, admin_client, tmp_path):
        clip = SignClip.objects.create(gloss="HURT")
        source = make_video(tmp_path, name="hurt.mp4")

        admin_client.post(
            reverse("admin:clips_signclip_change", args=[clip.pk]),
            self.form(video=upload(source)),
        )

        clip.refresh_from_db()
        assert clip.video.size < source.stat().st_size / 3

    def test_saving_a_note_does_not_encode_the_recording_again(
        self, admin_client, tmp_path
    ):
        clip = SignClip.objects.create(gloss="HURT")
        source = make_video(tmp_path, name="hurt.mp4")
        admin_client.post(
            reverse("admin:clips_signclip_change", args=[clip.pk]),
            self.form(video=upload(source)),
        )
        clip.refresh_from_db()
        stored, size = clip.video.name, clip.video.size

        admin_client.post(
            reverse("admin:clips_signclip_change", args=[clip.pk]),
            self.form(notes="Regional variation in the north."),
        )

        clip.refresh_from_db()
        assert (clip.video.name, clip.video.size) == (stored, size)
        assert clip.notes == "Regional variation in the north."

    def test_a_file_that_cannot_be_compressed_is_stored_with_a_warning(
        self, admin_client
    ):
        response = admin_client.post(
            reverse("admin:clips_signclip_add"),
            self.form(
                video=SimpleUploadedFile(
                    "hurt.mp4", b"pretend-video", content_type="video/mp4"
                )
            ),
            follow=True,
        )

        assert SignClip.objects.get(gloss="HURT").video
        assert "could not be read as a video" in " ".join(
            str(m) for m in response.context["messages"]
        )

    def test_a_recording_added_there_and_uploaded_again_in_bulk_is_unchanged(
        self, admin_client, tmp_path
    ):
        source = make_video(tmp_path, name="hurt.mp4")
        admin_client.post(
            reverse("admin:clips_signclip_add"),
            self.form(
                video=upload(source), review_status="approved", reviewed_by="Ama Mensah"
            ),
        )

        report = import_uploads([upload(source)])

        assert report.unchanged == ["HURT"]
        assert SignClip.objects.get(gloss="HURT").review_status == ReviewStatus.APPROVED
