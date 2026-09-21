"""Rate limiting for prescription issuing, the known limitation in ADR 044."""

from rest_framework.throttling import AnonRateThrottle


class PrescriptionIssueThrottle(AnonRateThrottle):
    """
    Caps issuing rather than authenticating it.

    ADR 044 decided against an account on the doctor facing side: it would
    defeat FR 6.2, a Deaf patient replaying their own prescription without one,
    and it would protect nothing, because the payload identifies nobody. What
    is worth limiting instead is a script creating rows without bound, which is
    a storage nuisance rather than a disclosure, and rate limiting is the
    mitigation ADR 044 names alongside that decision.

    Not `ScopedRateThrottle`: that reads `view.throttle_scope` off the view,
    and DRF's `@api_view` decorator does not forward that attribute from a
    plain function to the `APIView` it wraps, so it would silently throttle
    nothing. A fixed `scope` here, the same pattern `AnonRateThrottle` itself
    uses, does not depend on an attribute that is never actually set.
    """

    scope = "prescription-issue"
