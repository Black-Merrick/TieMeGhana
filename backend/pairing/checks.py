"""
A guard for the one deployment mistake that would make pairing fail at random.

Pairing keeps its handshake in the process cache (ADR 053). That is only correct
while there is one process: with several, the doctor's device can mint a code on
one and the patient's phone ask for it on another, and be told it does not exist.
Nothing else in the app cares how many workers run, so nothing else would notice,
and the symptom, a code that sometimes works, is close to undiagnosable from a
ward. So it is said at startup.
"""

import os

from django.conf import settings
from django.core.checks import Tags, Warning, register


def worker_count() -> int:
    try:
        return int(os.environ.get("WEB_CONCURRENCY", "1") or 1)
    except ValueError:
        return 1


@register(Tags.caches)
def pairing_needs_one_process_or_a_shared_cache(app_configs, **kwargs):
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    if worker_count() > 1 and "locmem" in backend.lower():
        return [
            Warning(
                f"WEB_CONCURRENCY is {worker_count()} but the cache is per process.",
                hint=(
                    "Pairing keeps its handshake in the cache, so a code minted "
                    "by one worker is not found by another and pairing fails "
                    "at random. Run one worker with threads (GUNICORN_THREADS), "
                    "or configure a cache all workers share."
                ),
                id="pairing.W001",
            )
        ]
    return []
