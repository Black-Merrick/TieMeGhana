"""
Making an uploaded clip small before it is stored.

A clip filmed on a phone is far bigger than a sign needs to be. The one that
prompted this was 720 by 1280 at 3.3 megabits with an audio track, for two and
a half seconds of hands: a megabyte, for a file the player shows muted at the
size of a card. Every clip is fetched over a hospital connection, once by the
doctor's device and once by the patient's phone, and again by every device that
warms the library, so the size of each is paid for many times over. Making
each one small at the single moment it is uploaded is the cheapest place to do
it.

What is done, and why each part:

- H.264 in an MP4, which every phone and browser plays and most decode in
  hardware. Not WebM: smaller is not worth a clip that will not play on the
  device in the patient's hand.
- No audio. The player mutes every clip, and a sign has no sound that means
  anything, so the track is only weight.
- The longer side capped at 720, never enlarged. A signer's hands are read on
  a screen a few inches wide, and the extra pixels are not what makes a sign
  clear. Orientation is kept: a portrait clip stays portrait.
- Constant quality (CRF), not a fixed bitrate, so a still, simple shot is
  very small and a fast one gets the bits it needs. Quality that varies with
  the content is the point of GhSL, where a finger movement is what carries
  the meaning, and 27 is high enough that fingers stay distinct.
- `faststart`, which moves the index to the front of the file. Without it a
  browser cannot begin playing until the whole file has arrived, which is the
  opposite of what smaller was for.

Never in the way of an upload. If ffmpeg is missing, the file is not a video it
can read, or the encode fails or times out, the original is stored as it
arrived and the result says so. A reviewer with a clip to get in must not be
blocked by an optimisation, and must not be left thinking it was applied when
it was not.

And never worse. If the result is not smaller than what came in, which happens
with a clip that was already exported small, the original is kept.
"""

import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

#: The longer side of the picture, in pixels, and the most it is ever scaled to.
MAX_DIMENSION = 720

#: Constant rate factor for libx264. Lower is better quality and bigger.
CRF = 27

#: A frame rate above this is thinned to it. Phones film at 30 or 60.
MAX_FPS = 30

#: Per file. Generous, because a deployment's free CPU is slow and a timeout
#: part way through an encode loses the whole thing, but finite, so one bad file
#: cannot hold an admin request open for ever.
ENCODE_TIMEOUT_SECONDS = 180

#: What comes out, whatever went in.
OUTPUT_SUFFIX = ".mp4"


@dataclass(frozen=True)
class CompressionResult:
    """
    What compressing one file did.

    `data` is the smaller file's bytes, or None when the original should be
    kept, and `reason` then says why in words a reviewer can act on. Sizes are
    always filled in, so the admin can report what was saved.
    """

    data: bytes | None
    original_size: int
    compressed_size: int | None = None
    duration_ms: int | None = None
    reason: str = ""

    @property
    def compressed(self) -> bool:
        return self.data is not None

    @property
    def saved_bytes(self) -> int:
        if self.compressed_size is None:
            return 0
        return max(0, self.original_size - self.compressed_size)


def compression_enabled() -> bool:
    """Whether uploads are compressed at all, so it can be switched off."""
    return bool(getattr(settings, "CLIP_COMPRESSION_ENABLED", True))


def ffmpeg_available() -> bool:
    """Whether both tools are on the path, so callers can fall back, not fail."""
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def compressed_name(filename: str) -> str:
    """`hurt.mov` becomes `hurt.mp4`: the name follows what the file now is."""
    return Path(filename).stem + OUTPUT_SUFFIX


def _ffmpeg_command(
    source: Path, destination: Path, source_fps: float | None
) -> list[str]:
    # Fit inside MAX_DIMENSION on the longer side without enlarging, keeping
    # the proportions, and land on even numbers, which H.264 requires. `a` is
    # the aspect ratio after any rotation the phone recorded, so a clip filmed
    # upright is scaled as the upright picture it is.
    scale = (
        f"scale='if(gt(a,1),min({MAX_DIMENSION},iw),-2)'"
        f":'if(gt(a,1),-2,min({MAX_DIMENSION},ih))'"
    )
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-vf",
        # Thinned only when the phone filmed faster than a sign needs. The fps
        # filter always resamples to what it is given, so applying it to a 25
        # frame clip would invent five frames a second rather than cap it.
        scale
        + (f",fps={MAX_FPS}" if source_fps and source_fps > MAX_FPS + 0.5 else ""),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        str(CRF),
        # Main profile, not High: the widest set of phones decode it in
        # hardware, which is the difference between smooth and stuttering on
        # the cheapest handsets this app is meant to reach.
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        # Metadata from the phone (location, device) is not carried over.
        "-map_metadata",
        "-1",
        str(destination),
    ]


def _probe_fps(path: Path) -> float | None:
    """The clip's frame rate, or None when it cannot be told."""
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=avg_frame_rate",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        numerator, _, denominator = completed.stdout.strip().partition("/")
        return float(numerator) / float(denominator or 1)
    except (subprocess.SubprocessError, ValueError, ZeroDivisionError, OSError):
        return None


def _probe_duration_ms(path: Path) -> int | None:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return round(float(completed.stdout.strip()) * 1000)
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


def compress_video(source) -> CompressionResult:
    """
    Compress one video, given as an uploaded file or any object with `chunks()`
    or `read()`, without changing where it is read from.

    The source is rewound before it is returned, whatever happened, because the
    caller saves the original when this hands nothing back.
    """
    original_size = _size_of(source)

    def keep(reason: str, **extra) -> CompressionResult:
        _rewind(source)
        return CompressionResult(
            data=None, original_size=original_size, reason=reason, **extra
        )

    if not compression_enabled():
        return keep("Compression is switched off.")

    if not ffmpeg_available():
        return keep("ffmpeg is not installed here, so the file was stored as it was.")

    with tempfile.TemporaryDirectory(prefix="tmg-compress-") as directory:
        root = Path(directory)
        incoming = root / "in"
        outgoing = root / f"out{OUTPUT_SUFFIX}"

        _rewind(source)
        with incoming.open("wb") as handle:
            for chunk in _chunks(source):
                handle.write(chunk)

        try:
            subprocess.run(
                _ffmpeg_command(incoming, outgoing, _probe_fps(incoming)),
                check=True,
                capture_output=True,
                timeout=ENCODE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            logger.warning(
                "Compressing a clip timed out after %ss", ENCODE_TIMEOUT_SECONDS
            )
            return keep("Compressing it took too long, so it was stored as it was.")
        except subprocess.CalledProcessError as error:
            logger.warning(
                "ffmpeg could not compress a clip: %s",
                (error.stderr or b"").decode(errors="replace")[-300:],
            )
            return keep("It could not be read as a video, so it was stored as it was.")
        except OSError:
            return keep("ffmpeg could not be run, so the file was stored as it was.")

        if not outgoing.exists() or outgoing.stat().st_size == 0:
            return keep("Compressing produced nothing, so it was stored as it was.")

        compressed_size = outgoing.stat().st_size
        duration_ms = _probe_duration_ms(outgoing)

        if compressed_size >= original_size:
            return keep(
                "It was already as small as it can sensibly be, so it was kept as it was.",
                compressed_size=compressed_size,
                duration_ms=duration_ms,
            )

        _rewind(source)
        return CompressionResult(
            data=outgoing.read_bytes(),
            original_size=original_size,
            compressed_size=compressed_size,
            duration_ms=duration_ms,
        )


def _size_of(source) -> int:
    size = getattr(source, "size", None)
    if isinstance(size, int):
        return size

    _rewind(source)
    total = sum(len(chunk) for chunk in _chunks(source))
    _rewind(source)
    return total


def _chunks(source):
    if hasattr(source, "chunks"):
        yield from source.chunks()
        return
    while chunk := source.read(1024 * 1024):
        yield chunk


def _rewind(source) -> None:
    try:
        source.seek(0)
    except (AttributeError, OSError, ValueError):
        pass


def describe_saving(result: CompressionResult) -> str:
    """`4.2 MB to 0.6 MB`, for the admin's report."""
    return f"{_megabytes(result.original_size)} to {_megabytes(result.compressed_size or 0)}"


def _megabytes(size: int) -> str:
    return (
        f"{size / (1024 * 1024):.1f} MB"
        if size >= 100 * 1024
        else f"{size / 1024:.0f} KB"
    )
