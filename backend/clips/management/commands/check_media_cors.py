"""
Say whether the media server lets the app keep its videos for offline replay.

The app can only store a sign video in the service worker's cache, and play it
back out of it with no connection, if the server the videos come from sends
CORS headers. Without them it still plays every clip, streamed from the
network, exactly as before; it just cannot keep them (ADR 054). This asks the
server the way a browser on the app's origin would, and reports what it said,
so switching CORS on can be checked in a second instead of by wondering why
nothing is cached.

    python manage.py check_media_cors
    python manage.py check_media_cors --origin https://tiemeghana.netlify.app

Needs no credentials: it asks for one public clip. Exits non-zero when CORS is
missing, so it can sit in a deploy check.
"""

import urllib.error
import urllib.request

from django.core.management.base import BaseCommand, CommandError

from clips.models import SignClip

EXPECTED_EXPOSED = {"content-length", "content-range", "accept-ranges"}


def probe(url: str, origin: str, timeout: float = 15.0) -> dict:
    """
    Ask for the first byte of `url` the way a browser on `origin` would, and
    return the response headers, lower cased, with the status.
    """
    request = urllib.request.Request(
        url,
        headers={
            "Origin": origin,
            "Range": "bytes=0-0",
            # Not Python's default, which Cloudflare answers with a 403 as a
            # scripted client: that made a working bucket look broken.
            "User-Agent": "Mozilla/5.0 (compatible; TieMeGhana-cors-check)",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return {"status": response.status, "headers": headers}
    except urllib.error.HTTPError as error:
        headers = {key.lower(): value for key, value in (error.headers or {}).items()}
        return {"status": error.code, "headers": headers}


def verdict(result: dict, origin: str) -> tuple[bool, list[str]]:
    """Whether the response would let a browser on `origin` keep the video."""
    headers = result["headers"]
    problems = []

    allowed = headers.get("access-control-allow-origin", "")
    if allowed not in ("*", origin):
        problems.append(
            "no Access-Control-Allow-Origin for this origin"
            + (f" (it sent {allowed!r})" if allowed else "")
        )

    exposed = {
        name.strip().lower()
        for name in headers.get("access-control-expose-headers", "").split(",")
        if name.strip()
    }
    if allowed and not EXPECTED_EXPOSED <= exposed and "*" not in exposed:
        missing = ", ".join(sorted(EXPECTED_EXPOSED - exposed))
        problems.append(f"Access-Control-Expose-Headers is missing {missing}")

    if result["status"] not in (200, 206):
        problems.append(f"the server answered {result['status']}")

    return not problems, problems


class Command(BaseCommand):
    help = "Check that the media server sends the CORS headers offline replay needs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--origin",
            default="http://localhost:5183",
            help="The address the app is served from. Default: %(default)s",
        )
        parser.add_argument(
            "--url",
            default="",
            help="A clip to ask for. Default: the first approved clip.",
        )

    def handle(self, *args, **options):
        origin = options["origin"].rstrip("/")
        url = options["url"]

        if not url:
            clip = SignClip.objects.resolvable().first()
            if clip is None:
                raise CommandError("There is no approved clip to ask about yet.")
            url = clip.video.url

        if url.startswith("/"):
            self.stdout.write(
                self.style.SUCCESS(
                    f"{url} is served by this app itself, so CORS does not apply."
                )
            )
            return

        self.stdout.write(f"Asking {url}\nas a browser on {origin} would...")
        try:
            result = probe(url, origin)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise CommandError(f"Could not reach it: {error}") from error

        ok, problems = verdict(result, origin)
        if ok:
            self.stdout.write(
                self.style.SUCCESS(
                    "CORS is on. Devices on this origin can keep the videos "
                    "for offline replay."
                )
            )
            return

        for problem in problems:
            self.stdout.write(self.style.ERROR(f"  - {problem}"))
        self.stdout.write(
            "Videos still play, streamed from the network. To keep them for "
            "offline replay, add the CORS policy in DEPLOY.md to the bucket."
        )
        raise CommandError("CORS is not set up on the media server.")
