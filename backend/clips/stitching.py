"""
Concatenating a resolved sequence into one real video file, FR 1.7.

ADR 008 originally returned an ordered playlist and left the player to make the
joins invisible. Two buffers made the picture continuous, but the result is
still several videos: the control bar shows each clip's own length, the
timeline restarts at every word, and the patient sees "0:01 / 0:01" rather than
one sentence. ADR 031 accepts that and stitches for real.

Each stitched file is cached under a key derived from the exact ordered clips it
contains, so a sentence is encoded once and every later request for the same
sentence is served from disk. That is what keeps this inside NFR 1's five
second budget in practice.
"""

import hashlib
import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

#: Bumping this invalidates every cached file, for when the encode changes.
STITCH_FORMAT_VERSION = "v1"

STITCHED_SUBDIRECTORY = "stitched"

# Every clip is normalized to this before concatenation. Clips are filmed on
# different phones, so without a common size, aspect ratio and frame rate the
# concat filter refuses outright or produces a stretched result.
TARGET_WIDTH = 640
TARGET_HEIGHT = 480
TARGET_FPS = 25

# Generous, because this runs once per distinct sentence and a timeout part way
# through would leave a truncated file in the cache.
ENCODE_TIMEOUT_SECONDS = 120


def ffmpeg_available() -> bool:
    """Whether ffmpeg is on the path, so callers can fall back rather than fail."""
    return shutil.which("ffmpeg") is not None


@dataclass(frozen=True)
class StillFrame:
    """
    A photograph held on screen for a few seconds, as part of a stitched run.

    Used by prescriptions: the picture of the medicine plays first, then the
    signs for its dose. A patient who cannot read a drug name matches the
    photograph to the box in their hand, which is a better identifier for them
    than eleven fingerspelled letters.
    """

    path: Path
    seconds: float


def stitch_key(clip_paths: list[str]) -> str:
    """
    The cache key for one ordered run of clips.

    Order is part of the key, because "head hurts" and "hurts head" are
    different sentences that happen to use the same clips. Hashed rather than
    joined so the filename stays short whatever the sentence length.
    """
    material = "\n".join([STITCH_FORMAT_VERSION, *clip_paths])
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def stitched_video_url(sequence) -> str | None:
    """
    Concatenate a resolved sequence into one file and return its URL.

    Returns None when there is nothing to stitch, when ffmpeg is unavailable,
    or when encoding fails. Every one of those is a fallback to playlist
    playback rather than an error: the patient still sees the signs, just as
    several clips instead of one video.
    """
    clips = [clip for segment in sequence.segments for clip in segment.clips]
    if len(clips) < 2:
        # A single clip is already one continuous video, and stitching it would
        # re-encode it for no gain.
        return None

    sources = [_media_path(clip.video_url) for clip in clips]
    if any(source is None or not source.exists() for source in sources):
        logger.warning("Cannot stitch, one or more clip files are missing.")
        return None

    key = stitch_key([str(source) for source in sources])
    destination = _stitched_directory() / f"{key}.mp4"

    if destination.exists():
        return _stitched_url(destination.name)

    if not ffmpeg_available():
        logger.info(
            "ffmpeg is not installed, so sequences play as a clip playlist "
            "rather than one stitched video. Install ffmpeg to enable it."
        )
        return None

    if not _encode(sources, destination):
        return None

    return _stitched_url(destination.name)


def _encode(sources: list[Path], destination: Path) -> bool:
    """
    Run ffmpeg, writing to a temporary file first.

    Written aside and moved into place only on success, because a failed or
    interrupted encode would otherwise leave a truncated file under a cache key
    that is then trusted forever.
    """
    working = destination.with_suffix(".partial.mp4")

    try:
        subprocess.run(
            _ffmpeg_command(sources, working),
            check=True,
            capture_output=True,
            timeout=ENCODE_TIMEOUT_SECONDS,
        )
    except subprocess.CalledProcessError as error:
        logger.warning(
            "Stitching failed: %s", error.stderr.decode(errors="replace")[-500:]
        )
        working.unlink(missing_ok=True)
        return False
    except subprocess.TimeoutExpired:
        logger.warning("Stitching timed out after %ss.", ENCODE_TIMEOUT_SECONDS)
        working.unlink(missing_ok=True)
        return False

    working.replace(destination)
    return True


def _ffmpeg_command(sources: list, destination: Path) -> list[str]:
    """
    Build the concatenation command.

    Each input is scaled, padded and resampled to a common format before the
    concat filter sees it, because clips filmed on different devices otherwise
    make concat fail or stretch. Padding rather than cropping, so a signer's
    hands are never cut out of frame, and so a photograph of a medicine box
    keeps its shape whichever way the phone was held.

    Audio is dropped entirely. These are sign clips with no meaningful sound,
    and dropping it removes the commonest reason concatenation fails.

    `sources` holds paths and `StillFrame`s. A still becomes a looped input cut
    to its own length, which is how ffmpeg turns one image into a run of
    frames; without the loop it contributes a single frame and vanishes.
    """
    filters = []
    for position in range(len(sources)):
        filters.append(
            f"[{position}:v]"
            f"scale={TARGET_WIDTH}:{TARGET_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={TARGET_WIDTH}:{TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,"
            f"setsar=1,fps={TARGET_FPS}"
            f"[v{position}]"
        )

    streams = "".join(f"[v{position}]" for position in range(len(sources)))
    filters.append(f"{streams}concat=n={len(sources)}:v=1:a=0[out]")

    command = ["ffmpeg", "-y", "-nostdin"]
    for source in sources:
        if isinstance(source, StillFrame):
            command += [
                "-loop",
                "1",
                "-t",
                f"{source.seconds:g}",
                "-i",
                str(source.path),
            ]
        else:
            command += ["-i", str(source)]

    command += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-an",
        "-c:v",
        "libx264",
        # veryfast because a doctor is waiting. The clips are short and small,
        # so the quality cost is not visible in a signed utterance.
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        # Lets the browser start playing before the whole file has downloaded.
        "-movflags",
        "+faststart",
        str(destination),
    ]
    return command


def stitch(sources: list, key_material: list[str]) -> str | None:
    """
    Concatenate a mixed run of stills and clips into one file.

    Shared by the caption pipeline and by prescriptions, so both get the same
    encode, the same cache and the same failure behaviour: None on any problem,
    which every caller treats as a reason to fall back rather than as an error.

    `key_material` is what the cache is addressed by. Passed in rather than
    derived from the paths alone, because a still's duration is part of what
    the file contains: changing how long a photograph is held has to produce a
    different file rather than serve the old one.
    """
    if len(sources) < 2:
        # A single input is already one continuous video, and re-encoding it
        # would cost time for no gain.
        return None

    key = stitch_key(key_material)
    destination = _stitched_directory() / f"{key}.mp4"

    if destination.exists():
        return _stitched_url(destination.name)

    if not ffmpeg_available():
        logger.info(
            "ffmpeg is not installed, so sequences play as a clip playlist "
            "rather than one stitched video. Install ffmpeg to enable it."
        )
        return None

    if not _encode(sources, destination):
        return None

    return _stitched_url(destination.name)


def _stitched_directory() -> Path:
    directory = Path(settings.MEDIA_ROOT) / STITCHED_SUBDIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _stitched_url(filename: str) -> str:
    return f"{settings.MEDIA_URL}{STITCHED_SUBDIRECTORY}/{filename}"


def _media_path(video_url: str) -> Path | None:
    """
    Map a clip's served URL back to the file on disk.

    Anchored to MEDIA_URL rather than assuming a layout, so a URL from outside
    our own media returns None and is refused instead of being read from an
    arbitrary path.
    """
    if not video_url or not video_url.startswith(settings.MEDIA_URL):
        return None

    relative = video_url[len(settings.MEDIA_URL) :]
    return Path(settings.MEDIA_ROOT) / relative
