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
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

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


@contextmanager
def _local_copies(names: list[str]):
    """
    Put the media ffmpeg needs on a real filesystem, and take it away after.

    ffmpeg reads files, and in deployment the media lives in object storage,
    which has no paths. Everything is therefore copied into a temporary
    directory for the length of one encode.

    This is also why stitching works on the names files are stored under rather
    than on the URLs they are served from. A URL only maps back to a path while
    the two happen to share a layout, which stopped being true the moment the
    media moved to a bucket, and a mapping that quietly returns the wrong path
    is worse than one that cannot be written at all.
    """
    with tempfile.TemporaryDirectory(prefix="tmg-stitch-") as directory:
        root = Path(directory)
        copies = []

        for position, name in enumerate(names):
            # Numbered rather than named after the original, because two clips
            # from different folders can share a basename and the second would
            # overwrite the first.
            local = root / f"{position:03d}{Path(name).suffix or '.bin'}"

            with default_storage.open(name, "rb") as source, local.open("wb") as copy:
                shutil.copyfileobj(source, copy)

            copies.append(local)

        yield copies


@dataclass(frozen=True)
class StillFrame:
    """
    A photograph held on screen for a few seconds, as part of a stitched run.

    Used by prescriptions: the picture of the medicine plays first, then the
    signs for its dose. A patient who cannot read a drug name matches the
    photograph to the box in their hand, which is a better identifier for them
    than eleven fingerspelled letters.
    """

    # A storage name while it is being asked for, and a local path once it has
    # been copied out for the encode. Two fields would be two chances to use
    # the wrong one; the copy step rebuilds the frame with the local path.
    name: str | Path
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
    names = [clip.video_name for clip in clips if clip.video_name]

    if len(names) != len(clips):
        logger.warning("Cannot stitch, one or more clips have no stored file.")
        return None

    return stitch(names, names)


def _encode_to_bytes(sources: list) -> bytes | None:
    """
    Run ffmpeg into a temporary file and return what it produced.

    Written to a temporary file rather than streamed, because ffmpeg seeks when
    it finalises an mp4 and cannot write to a pipe with `+faststart`. Returned
    as bytes so nothing partial can reach storage: a failed or interrupted
    encode leaves nothing behind, where writing in place would leave a
    truncated file under a cache key that is then trusted forever.
    """
    with tempfile.TemporaryDirectory(prefix="tmg-encode-") as directory:
        working = Path(directory) / "out.mp4"

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
            return None
        except subprocess.TimeoutExpired:
            logger.warning("Stitching timed out after %ss.", ENCODE_TIMEOUT_SECONDS)
            return None

        return working.read_bytes()


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

    `sources` holds storage names and `StillFrame`s, not paths. Storage may be
    a bucket with no filesystem behind it, so the files are copied locally for
    the encode and the result is written back through the same storage.

    `key_material` is what the cache is addressed by. Passed in rather than
    derived from the names alone, because a still's duration is part of what
    the file contains: changing how long a photograph is held has to produce a
    different file rather than serve the old one.
    """
    if len(sources) < 2:
        # A single input is already one continuous video, and re-encoding it
        # would cost time for no gain.
        return None

    name = f"{STITCHED_SUBDIRECTORY}/{stitch_key(key_material)}.mp4"

    if default_storage.exists(name):
        return default_storage.url(name)

    if not ffmpeg_available():
        logger.info(
            "ffmpeg is not installed, so sequences play as a clip playlist "
            "rather than one stitched video. Install ffmpeg to enable it."
        )
        return None

    # Stills carry their own path once copied locally, so they are rebuilt
    # against the copies rather than the originals.
    wanted = [
        source.name if isinstance(source, StillFrame) else source for source in sources
    ]

    try:
        with _local_copies(wanted) as copies:
            rebuilt = [
                (
                    StillFrame(name=local, seconds=source.seconds)
                    if isinstance(source, StillFrame)
                    else local
                )
                for source, local in zip(sources, copies, strict=True)
            ]

            encoded = _encode_to_bytes(rebuilt)
    except (FileNotFoundError, OSError) as error:
        # A clip the database has and storage does not. Reported rather than
        # raised: the player falls back to the clip playlist, so the patient
        # still sees every sign.
        logger.warning("Cannot stitch, media could not be read: %s", error)
        return None

    if encoded is None:
        return None

    default_storage.save(name, ContentFile(encoded))
    return default_storage.url(name)
