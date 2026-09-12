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


def get_language_provider() -> LanguageProvider:
    """
    Return the real provider when credentials exist, the stub otherwise.

    Deliberately not cached. The provider is cheap to build, and a cached one
    would ignore a settings change, which is exactly what tests do when they
    switch between the two.
    """
    if settings.KHAYA_API_KEY:
        return build_khaya_provider()
    return StubLanguageProvider()
