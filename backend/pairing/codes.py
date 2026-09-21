"""The short code a patient types in to join a doctor's device."""

import secrets

# No 0/O, 1/I/L: read aloud across a hospital room, or copied off a screen at
# arm's length, without anyone guessing which character was meant.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6


def generate_code() -> str:
    """
    A fresh six character code.

    `secrets`, not `random`: for the few minutes a code is live it is
    functionally a bearer credential onto the consultation, so it is drawn
    from a cryptographically secure source rather than one meant for
    simulations and games.
    """
    return "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
