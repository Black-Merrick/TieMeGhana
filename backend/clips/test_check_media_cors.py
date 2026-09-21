"""
Asking the media server whether the app may keep its videos.

The network is replaced by a canned response, since what is being tested is the
reading of the answer: which headers make it a yes, and that each way it can be
a no is named. The one real request, against the bucket, is made by a person
running the command.
"""

import urllib.error
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from clips.management.commands import check_media_cors
from clips.management.commands.check_media_cors import verdict
from clips.models import ReviewStatus, SignClip

ORIGIN = "http://localhost:5183"
GOOD = {
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
}


class TestReadingTheAnswer:
    def test_a_wildcard_with_the_range_headers_exposed_is_a_yes(self):
        ok, problems = verdict({"status": 206, "headers": GOOD}, ORIGIN)

        assert ok and problems == []

    def test_naming_this_origin_is_a_yes_too(self):
        headers = {**GOOD, "access-control-allow-origin": ORIGIN}

        assert verdict({"status": 200, "headers": headers}, ORIGIN)[0]

    def test_no_cors_headers_at_all_is_a_no_and_says_so(self):
        ok, problems = verdict({"status": 206, "headers": {}}, ORIGIN)

        assert not ok
        assert "Access-Control-Allow-Origin" in problems[0]

    def test_another_origin_is_a_no_and_says_which_it_sent(self):
        headers = {**GOOD, "access-control-allow-origin": "https://elsewhere.example"}

        ok, problems = verdict({"status": 206, "headers": headers}, ORIGIN)

        assert not ok
        assert "elsewhere.example" in problems[0]

    def test_the_range_headers_not_being_exposed_is_named(self):
        # Without them a browser cannot cut the video into the ranges it asks for.
        headers = {"access-control-allow-origin": "*"}

        ok, problems = verdict({"status": 206, "headers": headers}, ORIGIN)

        assert not ok
        assert any("content-range" in problem for problem in problems)

    def test_an_error_status_is_a_no(self):
        ok, problems = verdict({"status": 403, "headers": GOOD}, ORIGIN)

        assert not ok
        assert "403" in problems[-1]


@pytest.mark.django_db
class TestTheCommand:
    @pytest.fixture(autouse=True)
    def a_clip(self, tmp_path, settings):
        settings.MEDIA_ROOT = tmp_path
        SignClip.objects.create(
            gloss="HURT", video="clips/hurt.mp4", review_status=ReviewStatus.APPROVED
        )

    def run(
        self,
        monkeypatch,
        response=None,
        error=None,
        url="https://cdn.example/clips/hurt.mp4",
        **options,
    ):
        def fake(target, origin, timeout=15.0):
            if error:
                raise error
            return response

        monkeypatch.setattr(check_media_cors, "probe", fake)
        out = StringIO()
        call_command("check_media_cors", "--url", url, stdout=out, **options)
        return out.getvalue()

    def test_says_so_when_it_is_on(self, monkeypatch):
        out = self.run(monkeypatch, response={"status": 206, "headers": GOOD})

        assert "CORS is on" in out

    def test_fails_and_says_why_when_it_is_missing(self, monkeypatch):
        with pytest.raises(CommandError, match="not set up"):
            self.run(monkeypatch, response={"status": 206, "headers": {}})

    def test_reassures_that_videos_still_play(self, monkeypatch):
        out = StringIO()
        monkeypatch.setattr(
            check_media_cors, "probe", lambda *a, **k: {"status": 206, "headers": {}}
        )

        with pytest.raises(CommandError):
            call_command(
                "check_media_cors", "--url", "https://cdn.example/a.mp4", stdout=out
            )

        assert "still play" in out.getvalue()

    def test_an_unreachable_server_is_an_error_not_a_verdict(self, monkeypatch):
        with pytest.raises(CommandError, match="Could not reach"):
            self.run(monkeypatch, error=urllib.error.URLError("no route"))

    def test_a_clip_served_by_the_app_itself_needs_no_cors(self, monkeypatch):
        out = self.run(monkeypatch, url="/media/clips/hurt.mp4")

        assert "CORS does not apply" in out

    def test_it_asks_about_the_first_approved_clip_when_given_none(self, monkeypatch):
        asked = []
        monkeypatch.setattr(
            check_media_cors,
            "probe",
            lambda url, origin, timeout=15.0: asked.append((url, origin))
            or {"status": 206, "headers": GOOD},
        )
        # Served by the app in this test, so nothing is asked, which is the point:
        out = StringIO()
        call_command("check_media_cors", stdout=out)

        assert "CORS does not apply" in out.getvalue()

    def test_it_says_when_there_is_nothing_to_ask_about(self):
        SignClip.objects.all().delete()

        with pytest.raises(CommandError, match="no approved clip"):
            call_command("check_media_cors", stdout=StringIO())

    def test_it_asks_as_the_origin_it_was_given(self, monkeypatch):
        asked = []
        monkeypatch.setattr(
            check_media_cors,
            "probe",
            lambda url, origin, timeout=15.0: asked.append(origin)
            or {"status": 206, "headers": GOOD},
        )

        call_command(
            "check_media_cors",
            "--url",
            "https://cdn.example/a.mp4",
            "--origin",
            "https://tiemeghana.netlify.app/",
            stdout=StringIO(),
        )

        assert asked == ["https://tiemeghana.netlify.app"]
