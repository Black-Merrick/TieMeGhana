"""
The container must collect static files in the mode it will run in.

A fault that reached production and was invisible from everywhere except the
one page it broke. `collectstatic` ran in the Docker build with no
DJANGO_DEBUG set, so settings chose development and wrote plain files with no
`staticfiles.json`. The container then started with DJANGO_DEBUG=0, which
selects WhiteNoise's manifest backend, and that backend refuses to resolve any
name the missing manifest does not contain.

Every admin page answered 500. Nothing else did: the health check was green,
the API served captions, the patient screens worked. So the deploy looked
healthy while the one page a GhSL consultant needs in order to approve clips
was broken, and an unapproved clip never plays.

Verified in a real container before and after: with the manifest removed,
health returns 200 and /admin/login/ returns 500, which is exactly what
production returned. With it present, the admin returns 200.
"""

import re
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"


def _collectstatic_command() -> str:
    """The collectstatic line, with any shell continuations folded in."""
    text = DOCKERFILE.read_text().replace("\\\n", " ")
    line = next((line for line in text.splitlines() if "collectstatic" in line), "")
    return re.sub(r"\s+", " ", line)


class TestStaticFilesAreBuiltForProduction:
    def test_collectstatic_runs_in_the_mode_the_container_will_run_in(self):
        command = _collectstatic_command()

        assert command, "The Dockerfile no longer runs collectstatic at all."
        assert "DJANGO_DEBUG=0" in command, (
            "collectstatic must run with DJANGO_DEBUG=0 so the staticfiles "
            "manifest is written. Without it the image ships no "
            "staticfiles.json, and every admin page answers 500 at runtime "
            "while the health check stays green."
        )

    def test_it_has_a_secret_key_so_the_build_cannot_fail_on_settings(self):
        # collectstatic loads settings, and settings in production mode are
        # entitled to insist on a key. Supplying a throwaway one keeps the
        # build from depending on a real secret being present at build time.
        assert "DJANGO_SECRET_KEY=" in _collectstatic_command()

    def test_the_build_key_is_not_mistaken_for_a_real_one(self):
        # It is baked into an image layer, so it must be obviously worthless.
        command = _collectstatic_command()
        match = re.search(r"DJANGO_SECRET_KEY=(\S+)", command)

        assert match, command
        assert re.search(r"build|not[-_]?a[-_]?(real|runtime)", match.group(1), re.I), (
            f"{match.group(1)!r} reads like it might be a real key. The build "
            "value is visible in the image and must say plainly that it is not."
        )
