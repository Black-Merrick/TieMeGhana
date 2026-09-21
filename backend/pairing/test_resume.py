"""
Finding each other again after a reload.

A rendezvous the two devices made up themselves, registered here so the doctor's
device and the patient's phone can find each other after either of them
reloads. What is pinned: it is well formed and unguessable, registering it
clears whatever the last connection left behind, it lives for a visit and no
longer, and once the doctor closes it the phone is told for good.
"""

import pytest
from django.core.cache import cache
from django.urls import reverse

from pairing.throttling import PairingResumeThrottle
from pairing.views import RESUME_TTL_SECONDS

TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA"  # 22 characters, what 16 random bytes encode to


def register(api_client, token=TOKEN):
    return api_client.post(reverse("pairing-resume"), {"token": token}, format="json")


class TestRegistering:
    def test_a_well_formed_name_opens_a_rendezvous(self, api_client):
        assert register(api_client).status_code == 204

    def test_the_offer_and_answer_slots_then_work_under_that_name(self, api_client):
        register(api_client)

        posted = api_client.post(
            reverse("pairing-offer", args=[TOKEN]), {"sdp": "offer"}, format="json"
        )
        fetched = api_client.get(reverse("pairing-offer", args=[TOKEN]))

        assert posted.status_code == 204
        assert fetched.json() == {"sdp": "offer"}

    @pytest.mark.parametrize(
        "token",
        [
            "short",
            "a" * 21,
            "a" * 65,
            "has spaces in it 1234567",
            "slash/inside/the/name/xx",
            "",
        ],
    )
    def test_a_name_too_short_or_oddly_shaped_is_refused(self, api_client, token):
        # Too little entropy to be the only thing between a stranger and a
        # consultation, or not usable as a key.
        assert register(api_client, token).status_code == 400

    def test_no_name_at_all_is_refused(self, api_client):
        response = api_client.post(reverse("pairing-resume"), {}, format="json")

        assert response.status_code == 400

    def test_registering_again_clears_what_the_last_connection_left(self, api_client):
        # A phone that comes back first must not answer an offer from a
        # doctor's device that has gone.
        register(api_client)
        api_client.post(
            reverse("pairing-offer", args=[TOKEN]), {"sdp": "old offer"}, format="json"
        )
        api_client.post(
            reverse("pairing-answer", args=[TOKEN]),
            {"sdp": "old answer"},
            format="json",
        )

        register(api_client)

        assert api_client.get(reverse("pairing-offer", args=[TOKEN])).json() == {
            "sdp": None
        }
        assert api_client.get(reverse("pairing-answer", args=[TOKEN])).json() == {
            "sdp": None
        }

    def test_registering_again_keeps_the_rendezvous_open(self, api_client):
        register(api_client)

        register(api_client)

        assert api_client.get(reverse("pairing-offer", args=[TOKEN])).status_code == 200

    def test_it_lives_for_the_visit_and_no_longer(self, api_client, monkeypatch):
        seen = []
        real_set = cache.set

        def spy(key, value, timeout=None, **kwargs):
            seen.append((key, timeout))
            return real_set(key, value, timeout=timeout, **kwargs)

        monkeypatch.setattr(cache, "set", spy)

        register(api_client)

        assert (f"pairing:{TOKEN}:session", RESUME_TTL_SECONDS) in seen
        assert RESUME_TTL_SECONDS == 4 * 60 * 60

    def test_an_unregistered_name_is_not_found_not_ended(self, api_client):
        # The phone waits when the doctor's device has not re-registered yet.
        response = api_client.get(reverse("pairing-offer", args=[TOKEN]))

        assert response.status_code == 404


class TestClosing:
    def test_closing_makes_every_endpoint_say_the_consultation_ended(self, api_client):
        register(api_client)

        assert (
            api_client.post(reverse("pairing-close", args=[TOKEN])).status_code == 204
        )

        assert api_client.get(reverse("pairing-offer", args=[TOKEN])).status_code == 410
        assert (
            api_client.get(reverse("pairing-answer", args=[TOKEN])).status_code == 410
        )
        assert (
            api_client.post(
                reverse("pairing-offer", args=[TOKEN]), {"sdp": "x"}, format="json"
            ).status_code
            == 410
        )

    def test_a_closed_rendezvous_cannot_be_reopened(self, api_client):
        register(api_client)
        api_client.post(reverse("pairing-close", args=[TOKEN]))

        assert register(api_client).status_code == 410

    def test_closing_clears_the_offer_and_answer_too(self, api_client):
        register(api_client)
        api_client.post(
            reverse("pairing-offer", args=[TOKEN]), {"sdp": "o"}, format="json"
        )

        api_client.post(reverse("pairing-close", args=[TOKEN]))

        assert cache.get(f"pairing:{TOKEN}:offer") is None
        assert cache.get(f"pairing:{TOKEN}:session") is None

    def test_the_marker_holds_nothing_but_the_fact(self, api_client):
        register(api_client)
        api_client.post(reverse("pairing-close", args=[TOKEN]))

        assert cache.get(f"pairing:{TOKEN}:ended") is True

    def test_closing_is_repeatable(self, api_client):
        register(api_client)

        assert (
            api_client.post(reverse("pairing-close", args=[TOKEN])).status_code == 204
        )
        assert (
            api_client.post(reverse("pairing-close", args=[TOKEN])).status_code == 204
        )

    def test_closing_a_name_that_is_not_well_formed_writes_nothing(self, api_client):
        # Otherwise anyone could fill the cache with keys of their choosing.
        response = api_client.post(reverse("pairing-close", args=["tiny"]))

        assert response.status_code == 400
        assert cache.get("pairing:tiny:ended") is None

    def test_one_consultation_ending_does_not_end_another(self, api_client):
        other = "Zz9_-aB3cD4eF5gH6iJ7kL"
        register(api_client)
        register(api_client, other)

        api_client.post(reverse("pairing-close", args=[TOKEN]))

        assert api_client.get(reverse("pairing-offer", args=[other])).status_code == 200


class TestRateLimit:
    def test_registering_past_the_limit_is_refused(self, api_client, monkeypatch):
        monkeypatch.setattr(PairingResumeThrottle, "rate", "2/hour", raising=False)

        statuses = [register(api_client).status_code for _ in range(3)]

        assert statuses == [204, 204, 429]

    def test_polling_is_still_not_throttled(self, api_client, monkeypatch):
        monkeypatch.setattr(PairingResumeThrottle, "rate", "1/hour", raising=False)
        register(api_client)

        statuses = {
            api_client.get(reverse("pairing-offer", args=[TOKEN])).status_code
            for _ in range(5)
        }

        assert statuses == {200}
