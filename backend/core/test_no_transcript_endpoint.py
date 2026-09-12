"""
NFR 4 and FR 4.2, asserted against the API surface itself.

The transcript is stored only on the patient's own device. That promise is kept
by there being nowhere to send one, not by a permission that could be
misconfigured, so these tests walk the whole URL configuration and fail if a
route appears that could carry a consultation record.

Deliberately tests about absence. Those are easy to forget to write, and this
is the one property the project's privacy claim rests on.
"""

from django.urls import get_resolver

# Words that would suggest a route carrying a consultation record. `session` is
# included because a session log is the shape this would most likely take.
TRANSCRIPT_WORDS = ("transcript", "session", "consultation-log", "exchange")


def _all_routes(resolver=None, prefix=""):
    """
    Every route the project serves, as (path, name) pairs.

    Paths are raw patterns, so router registered routes arrive as regular
    expressions. That is fine for a substring check and avoids normalizing
    them, which is how the first version of this test broke itself: stripping
    `^` everywhere also gutted the character class in `[^/.]`.
    """
    resolver = resolver or get_resolver()
    routes = []

    for pattern in resolver.url_patterns:
        path = f"{prefix}{pattern.pattern}"
        if hasattr(pattern, "url_patterns"):
            routes.extend(_all_routes(pattern, path))
        else:
            routes.append((path, pattern.name))

    return routes


def test_no_route_could_carry_a_transcript():
    """
    Nothing in the URL configuration accepts or returns a transcript.

    If this fails, a route has appeared that could send a consultation record
    to a server. That is not a bug to fix quietly: it contradicts FR 4.2 and
    NFR 4 and needs a decision record before it goes further.
    """
    offenders = [
        (path, name)
        for path, name in _all_routes()
        if any(word in f"{path} {name or ''}".lower() for word in TRANSCRIPT_WORDS)
    ]

    assert offenders == [], (
        "These routes look like they carry a consultation transcript, which "
        f"FR 4.2 and NFR 4 forbid: {offenders}"
    )


def test_the_api_surface_is_the_one_we_expect():
    """
    Pin the named API surface, so a new endpoint is a deliberate act.

    The privacy claim rests on what the server cannot do, and an endpoint added
    without thought is how that erodes. Adding a name to this list is fine.
    Noticing that you added one is the point.
    """
    names = sorted(
        name for path, name in _all_routes() if path.startswith("api/") and name
    )

    assert names == [
        "caption",
        "clip-body-locations",
        "clip-by-gloss",
        "clip-detail",
        "clip-list",
        "health",
        "sign-sequence",
        "speak",
    ]
