"""
Selecting the language provider for the current configuration.

Callers ask for a provider and get whichever one the environment supports.
Nothing in the app branches on whether a Khaya key exists, which is what keeps
the credential free path a first class case rather than a degraded one.
"""

from django.conf import settings

from core.language.base import Language, LanguageError, LanguageProvider
from core.language.khaya import build_khaya_provider
from core.language.stub import StubLanguageProvider

__all__ = [
    "Language",
    "LanguageError",
    "LanguageProvider",
    "get_language_provider",
]

AUTO = "auto"
STUB = "stub"
KHAYA = "khaya"

VALID_CHOICES = (AUTO, STUB, KHAYA)


def get_language_provider() -> LanguageProvider:
    """
    Return the provider named by `LANGUAGE_PROVIDER`.

    `auto`, the default, uses Khaya when a key is configured and the stub
    otherwise. `stub` forces the stub even with a valid key, which is what
    makes it safe to leave the key in place while developing against a metered
    free tier. `khaya` forces the real provider and raises without a key, so a
    verification run cannot silently prove nothing.

    Deliberately not cached. The provider is cheap to build, and a cached one
    would ignore a settings change, which is exactly what tests do when they
    switch between the two.
    """
    choice = getattr(settings, "LANGUAGE_PROVIDER", AUTO)

    if choice not in VALID_CHOICES:
        raise ValueError(
            f"LANGUAGE_PROVIDER must be one of {VALID_CHOICES}, got {choice!r}."
        )

    if choice == STUB:
        return StubLanguageProvider()

    if choice == KHAYA:
        # build_khaya_provider raises when the key is missing, which is the
        # loud failure this branch exists to produce.
        return build_khaya_provider()

    return build_khaya_provider() if settings.KHAYA_API_KEY else StubLanguageProvider()
