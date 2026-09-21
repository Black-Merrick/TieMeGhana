"""
The claim this app exists to make good on: nothing here is ever saved.

Mirrors `core/test_no_transcript_endpoint.py`'s own reasoning: a guarantee
made of absences is the strongest kind and the easiest to lose quietly, so
absence is asserted directly rather than trusted to hold because nobody has
broken it yet.
"""

from pathlib import Path

from django.apps import apps
from django.core.cache import cache
from django.urls import reverse


def test_the_app_has_no_models_module():
    # The structural half of "never a database row": there is no model this
    # data could even be written to.
    assert apps.get_app_config("pairing").models_module is None


def test_the_app_has_no_migrations_directory():
    app_dir = Path(apps.get_app_config("pairing").path)

    assert not (app_dir / "migrations").exists()


def test_every_cache_write_carries_a_timeout(api_client, monkeypatch):
    """
    A `cache.set` with no timeout lives until something evicts it, which on
    the default `LocMemCache` can be a long time on a quiet server. Spied
    rather than inferred from behaviour, so a future call that forgets the
    timeout fails here instead of merely outliving its ten minutes in
    practice.
    """
    calls = []
    real_set = cache.set

    def spy(key, value, timeout=None, **kwargs):
        calls.append(timeout)
        return real_set(key, value, timeout=timeout, **kwargs)

    monkeypatch.setattr(cache, "set", spy)

    response = api_client.post(reverse("pairing-create"))
    code = response.json()["code"]
    api_client.post(reverse("pairing-offer", args=[code]), {"sdp": "x"}, format="json")
    api_client.post(reverse("pairing-answer", args=[code]), {"sdp": "y"}, format="json")

    assert calls, "expected at least one cache.set call"
    assert all(
        timeout for timeout in calls
    ), f"every cache.set here must carry a real timeout, got {calls}"


def test_an_sdp_body_never_reaches_the_logs(api_client, caplog):
    code = api_client.post(reverse("pairing-create")).json()["code"]
    distinctive_sdp = "v=0 o=- 000 IN IP4 0.0.0.0 THIS-MUST-NEVER-BE-LOGGED"

    with caplog.at_level("DEBUG"):
        api_client.post(
            reverse("pairing-offer", args=[code]),
            {"sdp": distinctive_sdp},
            format="json",
        )

    assert distinctive_sdp not in caplog.text


def test_a_pairing_code_never_reaches_the_logs(api_client, caplog):
    with caplog.at_level("DEBUG"):
        response = api_client.post(reverse("pairing-create"))
        code = response.json()["code"]
        api_client.get(reverse("pairing-offer", args=[code]))

    assert code not in caplog.text
