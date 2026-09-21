"""Rate limiting for creating a pairing code."""

from rest_framework.throttling import AnonRateThrottle


class PairingCreateThrottle(AnonRateThrottle):
    """
    Bounds how many codes one device can mint, not how often two paired
    devices may poll each other.

    Mirrors `prescriptions.throttling.PrescriptionIssueThrottle`: a fixed
    `scope` rather than `ScopedRateThrottle`, because DRF's `@api_view`
    decorator does not forward `throttle_scope` from a plain function to the
    `APIView` it builds, so `ScopedRateThrottle` would silently throttle
    nothing here.

    Deliberately not applied to the offer/answer polling endpoints. Several
    devices on one hospital wifi commonly share a NAT gateway's public
    address, and a strict per IP limit there risks throttling the doctor and
    patient's own legitimate poll, once every second or two, while they wait
    to connect, along with everyone else on the same network.
    """

    scope = "pairing-create"


class PairingResumeThrottle(AnonRateThrottle):
    """
    Bounds registering and closing rendezvous names, which a doctor's device
    does once per reconnect and not otherwise.

    Generous, since a device on a poor connection can drop and rejoin many
    times in a visit, and several on one hospital network share an address.
    It exists to stop a script writing unlimited keys, not to pace a person.
    """

    scope = "pairing-resume"
