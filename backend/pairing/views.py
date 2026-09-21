"""
The handshake before a doctor's device and a patient's own device connect
directly to each other, and nothing after it. See ADR 053.

Every value here lives in the process cache with a short timeout, never in a
database, and nothing in this module logs a code or an SDP body past the
request that carried it: for the few minutes a pairing is open, a code is
functionally a bearer credential onto the consultation, and log files
routinely outlive a ten minute window.
"""

from django.core.cache import cache
from django.http import Http404
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from pairing.codes import generate_code
from pairing.serializers import RendezvousSerializer, SdpSerializer
from pairing.throttling import PairingCreateThrottle, PairingResumeThrottle

# Ten minutes: long enough for a doctor to read a code aloud and a patient to
# type it in without racing a clock, short enough that a code left on screen
# after the two devices connect, or after nobody ever joins, stops being
# usable on its own well before anyone would think to worry about it.
PAIRING_TTL_SECONDS = 600

# Four hours, the same window a visit is treated as live for on the device
# (VISIT_MAX_AGE_MS in the frontend). Only a rendezvous registered for
# reconnecting after a reload lives this long, and it is the length of the
# visit it belongs to and no longer: it is closed the moment the visit ends.
RESUME_TTL_SECONDS = 4 * 60 * 60


def _session_key(code: str) -> str:
    return f"pairing:{code}:session"


def _offer_key(code: str) -> str:
    return f"pairing:{code}:offer"


def _answer_key(code: str) -> str:
    return f"pairing:{code}:answer"


def _ended_key(code: str) -> str:
    return f"pairing:{code}:ended"


class ConsultationEnded(APIException):
    """
    410, not 404: this rendezvous did exist, and the doctor ended the visit.

    Told apart from a rendezvous that is merely not open yet, because a
    patient's phone reconnecting after a reload has to know whether to keep
    waiting for the doctor's device to come back or to stop for good.
    """

    status_code = 410
    default_detail = "This consultation has ended."
    default_code = "consultation_ended"


def _require_open_pairing(code: str) -> None:
    """
    410 for a consultation the doctor ended. 404 for a code that was never
    issued, has expired, or was closed.
    """
    if cache.get(_ended_key(code)):
        raise ConsultationEnded
    if not cache.get(_session_key(code)):
        raise Http404


@api_view(["POST"])
@throttle_classes([PairingCreateThrottle])
def create_pairing(request):
    """
    Open a pairing, FR unnumbered (this feature). The doctor's device calls
    this once, before it has anything to offer yet, purely to reserve a code.
    """
    code = generate_code()
    cache.set(_session_key(code), True, timeout=PAIRING_TTL_SECONDS)
    return Response({"code": code, "expires_in": PAIRING_TTL_SECONDS}, status=201)


@api_view(["POST"])
@throttle_classes([PairingResumeThrottle])
def resume_pairing(request):
    """
    Register, or re-register, the rendezvous two paired devices use to find
    each other again after either of them reloads.

    The name is a long random token the two devices made up and swapped over
    their own connection, so this server never issued it and cannot be
    asked to guess it. Registering clears any offer and answer left from the
    last connection, because a phone that came back first would otherwise
    answer a description of a device that has gone. Idempotent, and safe to
    call again and again: a doctor's device does so after every drop.

    Refused with 410 once the visit was closed, so nothing can quietly reopen
    a consultation the doctor ended.
    """
    serializer = RendezvousSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    token = serializer.validated_data["token"]

    if cache.get(_ended_key(token)):
        raise ConsultationEnded

    cache.delete_many([_offer_key(token), _answer_key(token)])
    cache.set(_session_key(token), True, timeout=RESUME_TTL_SECONDS)
    return Response(status=204)


@api_view(["POST"])
@throttle_classes([PairingResumeThrottle])
def close_pairing(request, code):
    """
    The doctor ended the visit: discard the rendezvous and leave a marker that
    it ended, so a phone that was offline at the time finds out when it comes
    back instead of waiting for a doctor's device that will never return.

    The marker holds nothing but the fact, and expires with the window the
    rendezvous itself would have. Only a well formed rendezvous name is
    accepted, so this cannot be used to fill the cache with arbitrary keys.
    """
    serializer = RendezvousSerializer(data={"token": code})
    serializer.is_valid(raise_exception=True)

    cache.delete_many([_session_key(code), _offer_key(code), _answer_key(code)])
    cache.set(_ended_key(code), True, timeout=RESUME_TTL_SECONDS)
    return Response(status=204)


def _sdp_slot(request, code, key):
    """
    Shared shape for the offer and answer endpoints: POST to place one SDP
    blob in the slot, GET to collect whatever is there.

    POST is overwrite tolerant rather than create once. A doctor's browser
    retrying a POST that timed out on a flaky hospital connection should
    never be refused for trying again with the same content.

    GET distinguishes "nothing here yet" from "this code does not exist",
    because the two mean different things to whichever device is polling:
    keep waiting, or stop and tell the person the code was wrong.
    """
    _require_open_pairing(code)

    if request.method == "POST":
        serializer = SdpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cache.set(
            key(code), serializer.validated_data["sdp"], timeout=PAIRING_TTL_SECONDS
        )
        return Response(status=204)

    return Response({"sdp": cache.get(key(code))})


@api_view(["GET", "POST"])
def offer(request, code):
    """The doctor's device posts its offer here; the patient's device polls it."""
    return _sdp_slot(request, code, _offer_key)


@api_view(["GET", "POST"])
def answer(request, code):
    """The patient's device posts its answer here; the doctor's device polls it."""
    return _sdp_slot(request, code, _answer_key)


@api_view(["DELETE"])
def end_pairing(request, code):
    """
    Discard a pairing outright, rather than waiting on its TTL.

    Called by whichever device notices the peer connection is up, so the
    handshake data is gone within moments of no longer being needed rather
    than merely expiring eventually. Idempotent: ending an already gone or
    never issued code is not an error, since the caller's intent, that
    nothing of this code's should be left behind, is already satisfied.
    """
    cache.delete_many([_session_key(code), _offer_key(code), _answer_key(code)])
    return Response(status=204)
