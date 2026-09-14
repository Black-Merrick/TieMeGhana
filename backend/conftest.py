"""
Shared pytest fixtures.

Anything more than one app's tests need lives here, so fixtures are defined
once rather than copied between test modules as the feature apps grow.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    """A DRF test client for exercising API contracts the frontend depends on."""
    return APIClient()


@pytest.fixture(autouse=True)
def never_write_to_real_media_storage(settings, tmp_path):
    """
    Force local, throwaway media storage for every test.

    Media goes to a Cloudflare R2 bucket when `R2_*` is configured, per
    ADR 050, and a developer with a working deployment has exactly that in
    their `.env`. Without this fixture every clip fixture, every uploaded
    photograph and every stitched video in the suite is an HTTP round trip to
    that bucket.

    Two things go wrong, and the second is the serious one. The suite becomes
    slow and dependent on someone else's uptime: it went from fifteen seconds
    to not finishing. And it writes hundreds of junk objects into the bucket
    the live app reads from, under names the app may later try to serve.

    Autouse, and sited next to the language provider fixture below, because
    both guard the same mistake: a test reaching a real service because a
    developer happened to have credentials configured.
    """
    settings.STORAGES = {
        **settings.STORAGES,
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    }
    # A fresh directory per test, so nothing accumulates in backend/media and
    # no test can see a file another test wrote.
    settings.MEDIA_ROOT = tmp_path / "media"


@pytest.fixture(autouse=True)
def never_call_a_real_language_service(settings):
    """
    Force the stub language provider for every test.

    Khaya's free tier is metered, so a test that reached it would spend real
    credit, and would also make the suite slow and dependent on someone else's
    uptime. Autouse means this holds even if a developer has a key in their
    .env, rather than relying on each test module to remember.

    Tests about provider selection itself override these two settings
    explicitly, which is the only place that should.
    """
    settings.LANGUAGE_PROVIDER = "stub"
    settings.KHAYA_API_KEY = ""


@pytest.fixture(autouse=True)
def isolated_media_root(settings, tmp_path):
    """
    Point MEDIA_ROOT at a temporary directory for every test.

    Autouse because clip tests upload files, and without this they would write
    into the developer's real media directory and leave rubbish behind that
    later shows up in the admin as if it were real footage.
    """
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = media_root
    return media_root


@pytest.fixture
def make_clip(db):
    """
    Build a SignClip, defaulting to one that is usable in a sign sequence.

    A clip is only usable when a GhSL fluent consultant has approved it and the
    footage actually exists, so the factory takes those two conditions as
    separate switches. Tests that care about the unusable cases flip them
    individually rather than constructing a model instance by hand.
    """
    from clips.models import ClipKind, ReviewStatus, SignClip

    def _make_clip(
        gloss,
        *,
        kind=ClipKind.WORD,
        approved=True,
        filmed=True,
        duration_ms=800,
    ):
        # An unfilmed clip stores an empty string rather than NULL, so a single
        # `exclude(video="")` covers every not yet filmed row.
        video = (
            SimpleUploadedFile(
                f"{gloss.lower()}.webm", b"placeholder-bytes", content_type="video/webm"
            )
            if filmed
            else ""
        )
        return SignClip.objects.create(
            gloss=gloss,
            kind=kind,
            video=video,
            duration_ms=duration_ms if filmed else None,
            review_status=(ReviewStatus.APPROVED if approved else ReviewStatus.PENDING),
            reviewed_by="Test Consultant" if approved else "",
        )

    return _make_clip


@pytest.fixture
def alphabet(make_clip):
    """
    The fingerspelling alphabet, needed by the FR 1.6 fallback.

    Provided as a fixture because most sequence tests need letters present but
    are not themselves about the alphabet.
    """
    # Imported here, not at module level, because conftest is loaded before
    # Django's app registry is ready.
    from clips.models import ClipKind

    return {
        letter: make_clip(letter, kind=ClipKind.LETTER, duration_ms=200)
        for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    }
