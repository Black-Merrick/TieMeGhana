"""
Tests for concatenating a sequence into one real video, FR 1.7 and ADR 031.

ffmpeg is not assumed to be installed, here or in CI, so the encode itself is
never run. What is tested is everything around it: the cache key, that a cached
file is reused rather than re-encoded, that a failure falls back to playlist
playback rather than breaking the consultation, and that the command we build
is the one we intend.
"""

import subprocess
from pathlib import Path

import pytest

from clips.services import resolve_sign_sequence
from clips.stitching import _ffmpeg_command, stitch_key, stitched_video_url


@pytest.fixture
def two_word_sequence(make_clip, alphabet):
    """A sequence of two real clip files, the smallest thing worth stitching."""
    make_clip("HEAD", duration_ms=800)
    make_clip("HURTS", duration_ms=800)
    return resolve_sign_sequence("head hurts")


@pytest.fixture
def pretend_ffmpeg(monkeypatch):
    """
    Stand in for ffmpeg, recording the commands it was asked to run.

    Writes the file ffmpeg would have produced, so the caching behaviour is
    exercised without an encoder being installed.
    """
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        Path(command[-1]).write_bytes(b"stitched")
        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setattr("clips.stitching.shutil.which", lambda name: "/ffmpeg")
    monkeypatch.setattr("clips.stitching.subprocess.run", fake_run)
    return calls


class TestStitchKey:
    def test_the_same_clips_in_the_same_order_reuse_one_file(self):
        assert stitch_key(["a.mp4", "b.mp4"]) == stitch_key(["a.mp4", "b.mp4"])

    def test_the_same_clips_in_a_different_order_are_a_different_file(self):
        # "head hurts" and "hurts head" are different sentences that happen to
        # use the same clips, so they cannot share one cached video.
        assert stitch_key(["a.mp4", "b.mp4"]) != stitch_key(["b.mp4", "a.mp4"])

    def test_a_different_clip_is_a_different_file(self):
        assert stitch_key(["a.mp4", "b.mp4"]) != stitch_key(["a.mp4", "c.mp4"])

    def test_the_key_is_short_enough_to_be_a_filename(self):
        # Sentences can be long, and the key becomes the filename.
        assert len(stitch_key([f"clip{n}.mp4" for n in range(50)])) <= 32


class TestFfmpegCommand:
    def test_normalizes_every_input_before_concatenating(self):
        # Clips are filmed on different phones. Without a common size, aspect
        # ratio and frame rate the concat filter refuses or stretches them.
        command = _ffmpeg_command([Path("a.mp4"), Path("b.mp4")], Path("out.mp4"))
        filters = command[command.index("-filter_complex") + 1]

        assert filters.count("scale=640:480") == 2
        assert filters.count("fps=25") == 2
        assert "concat=n=2:v=1:a=0" in filters

    def test_pads_rather_than_crops(self):
        # Cropping to fit could cut a signer's hands out of frame, which would
        # change or destroy the meaning of the sign.
        command = _ffmpeg_command([Path("a.mp4"), Path("b.mp4")], Path("out.mp4"))
        filters = command[command.index("-filter_complex") + 1]

        assert "pad=640:480" in filters
        assert "crop" not in filters

    def test_drops_audio(self):
        # Sign clips carry no meaningful sound, and mismatched audio streams
        # are the commonest reason concatenation fails outright.
        command = _ffmpeg_command([Path("a.mp4")], Path("out.mp4"))

        assert "-an" in command

    def test_lets_the_browser_start_before_the_download_finishes(self):
        command = _ffmpeg_command([Path("a.mp4")], Path("out.mp4"))

        assert "+faststart" in command

    def test_never_waits_for_input(self):
        # ffmpeg prompts before overwriting. A prompt on a web request would
        # hang the encode until it timed out.
        command = _ffmpeg_command([Path("a.mp4")], Path("out.mp4"))

        assert "-y" in command
        assert "-nostdin" in command


@pytest.mark.django_db
class TestStitchedVideoUrl:
    def test_a_single_clip_is_not_stitched(self, make_clip, alphabet):
        # It is already one continuous video, so encoding it would cost time
        # and quality for nothing.
        make_clip("HEAD")
        sequence = resolve_sign_sequence("head")

        assert stitched_video_url(sequence) is None

    def test_an_empty_sequence_is_not_stitched(self):
        assert stitched_video_url(resolve_sign_sequence("")) is None

    def test_falls_back_to_the_playlist_when_ffmpeg_is_missing(
        self, two_word_sequence, monkeypatch
    ):
        # The patient still sees every sign, just as separate clips. A missing
        # tool must not break the consultation.
        monkeypatch.setattr("clips.stitching.shutil.which", lambda name: None)

        assert stitched_video_url(two_word_sequence) is None

    def test_encodes_once_and_serves_the_cached_file_after_that(
        self, two_word_sequence, pretend_ffmpeg
    ):
        # The whole reason this fits inside NFR 1's budget. A repeated sentence
        # must not be re-encoded while a doctor waits.
        first = stitched_video_url(two_word_sequence)
        second = stitched_video_url(two_word_sequence)

        assert first is not None
        assert first == second
        assert len(pretend_ffmpeg) == 1

    def test_returns_a_url_under_media(self, two_word_sequence, pretend_ffmpeg):
        url = stitched_video_url(two_word_sequence)

        assert url.startswith("/media/stitched/")
        assert url.endswith(".mp4")

    def test_a_failed_encode_leaves_nothing_cached(
        self, two_word_sequence, monkeypatch, isolated_media_root
    ):
        # A truncated file under a trusted cache key would be served forever,
        # so the encode writes aside and only moves into place on success.
        def fake_run(command, **kwargs):
            Path(command[-1]).write_bytes(b"truncated")
            raise subprocess.CalledProcessError(1, command, b"", b"broken input")

        monkeypatch.setattr("clips.stitching.shutil.which", lambda name: "/ffmpeg")
        monkeypatch.setattr("clips.stitching.subprocess.run", fake_run)

        assert stitched_video_url(two_word_sequence) is None
        assert list((isolated_media_root / "stitched").glob("*.mp4")) == []

    def test_a_timed_out_encode_leaves_nothing_cached(
        self, two_word_sequence, monkeypatch, isolated_media_root
    ):
        def fake_run(command, **kwargs):
            Path(command[-1]).write_bytes(b"truncated")
            raise subprocess.TimeoutExpired(command, 1)

        monkeypatch.setattr("clips.stitching.shutil.which", lambda name: "/ffmpeg")
        monkeypatch.setattr("clips.stitching.subprocess.run", fake_run)

        assert stitched_video_url(two_word_sequence) is None
        assert list((isolated_media_root / "stitched").glob("*.mp4")) == []

    def test_refuses_a_clip_url_from_outside_our_own_media(
        self, two_word_sequence, monkeypatch
    ):
        # Source paths are anchored to MEDIA_URL rather than assumed, so a URL
        # pointing anywhere else is refused instead of being read off disk.
        from clips.services import ResolvedClip, SignSegment, SignSequence

        monkeypatch.setattr("clips.stitching.shutil.which", lambda name: "/ffmpeg")

        outside = SignSegment(
            token="head",
            match="gloss",
            clips=(
                ResolvedClip(gloss="HEAD", video_url="/etc/passwd", duration_ms=800),
            ),
        )
        sequence = SignSequence(
            source_text="head hurts",
            segments=(outside, two_word_sequence.segments[1]),
        )

        assert stitched_video_url(sequence) is None
