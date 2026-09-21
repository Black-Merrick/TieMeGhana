from django.apps import AppConfig


class PairingConfig(AppConfig):
    """
    Getting a doctor's device and a patient's own device onto one WebRTC
    connection, and nothing else.

    No `models.py`, deliberately, the same way `consultations` has none.
    Once two devices are connected, the whole point of choosing a peer to
    peer connection over a server relay is that the consultation itself never
    reaches this server again, not even in transit. This app's only job is
    the handshake beforehand: a short code, and a place for one SDP offer and
    one SDP answer to sit for the few seconds it takes the other device to
    collect them. See ADR 053.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "pairing"

    def ready(self):
        from pairing import checks  # noqa: F401  (registers the system check)
