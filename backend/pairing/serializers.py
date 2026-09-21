from rest_framework import serializers


class SdpSerializer(serializers.Serializer):
    """
    One WebRTC SDP blob, offer or answer, whichever endpoint receives it.

    No further structure asked of it. This server never parses or acts on the
    session description, only holds it for the other device to collect, so
    there is nothing to validate beyond "some text arrived." An SDP with
    every gathered ICE candidate already baked in (non trickle ICE, see
    ADR 053) still comfortably fits an ordinary consultation's worth of
    candidates well under this ceiling.
    """

    sdp = serializers.CharField(max_length=20000, trim_whitespace=False)


class RendezvousSerializer(serializers.Serializer):
    """
    The name of a rendezvous the two devices agreed on themselves.

    Sixteen random bytes as URL safe base64 is twenty two characters, so that
    is the floor: a name shorter than that carries too little entropy to be
    the only thing between a stranger and a consultation. The ceiling and the
    alphabet keep it usable as a cache key and a URL segment, nothing more.
    """

    token = serializers.RegexField(r"^[A-Za-z0-9_-]{22,64}$")
