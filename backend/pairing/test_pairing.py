"""
The handshake itself: a code, one offer, one answer, and cleanup.

Nothing here exercises real WebRTC. This server never parses or acts on an
SDP body, only holds it for the other device to collect, so the tests treat
it as an opaque string throughout, exactly as the view does.
"""

from django.urls import reverse

from pairing.throttling import PairingCreateThrottle


def create_code(api_client):
    response = api_client.post(reverse("pairing-create"))
    assert response.status_code == 201, response.json()
    return response.json()["code"]


class TestOpeningAPairing:
    def test_creating_a_pairing_returns_a_fresh_code(self, api_client):
        body = api_client.post(reverse("pairing-create")).json()

        assert isinstance(body["code"], str)
        assert len(body["code"]) == 6

    def test_two_pairings_do_not_share_a_code(self, api_client):
        first = create_code(api_client)
        second = create_code(api_client)

        assert first != second

    def test_a_code_reports_how_long_it_stays_open(self, api_client):
        body = api_client.post(reverse("pairing-create")).json()

        assert body["expires_in"] == 600

    def test_creating_codes_past_the_limit_is_refused(self, api_client, monkeypatch):
        # Bounds a runaway script minting codes without limit. See
        # PairingCreateThrottle; the real rate is generous, this is a low
        # one so the test is fast and unambiguous about which call tripped
        # it, the same pattern prescriptions/tests.py uses for its own
        # throttle.
        monkeypatch.setattr(PairingCreateThrottle, "rate", "2/hour", raising=False)

        statuses = [
            api_client.post(reverse("pairing-create")).status_code for _ in range(3)
        ]

        assert statuses == [201, 201, 429]

    def test_polling_for_an_offer_is_not_throttled(self, api_client, monkeypatch):
        # Only minting a fresh code is limited. Two already paired devices
        # polling each other every second or so while they connect must
        # never be the request that gets rate limited, and neither should
        # anyone else sharing their hospital wifi's NAT gateway address.
        monkeypatch.setattr(PairingCreateThrottle, "rate", "1/hour", raising=False)
        code = create_code(api_client)

        # That one create already spent the only request this hour allows,
        # but polling for the offer is a different endpoint, unthrottled.
        for _ in range(5):
            response = api_client.get(reverse("pairing-offer", args=[code]))
            assert response.status_code == 200


class TestTheHandshake:
    """One offer, posted by the doctor's device and collected by the
    patient's, then one answer the other way."""

    def test_the_offer_is_not_there_until_it_is_posted(self, api_client):
        code = create_code(api_client)

        body = api_client.get(reverse("pairing-offer", args=[code])).json()

        assert body == {"sdp": None}

    def test_a_posted_offer_is_collected_by_the_other_device(self, api_client):
        code = create_code(api_client)

        posted = api_client.post(
            reverse("pairing-offer", args=[code]),
            {"sdp": "v=0 offer-body"},
            format="json",
        )
        assert posted.status_code == 204

        collected = api_client.get(reverse("pairing-offer", args=[code])).json()
        assert collected == {"sdp": "v=0 offer-body"}

    def test_the_answer_is_independent_of_the_offer(self, api_client):
        code = create_code(api_client)
        api_client.post(
            reverse("pairing-offer", args=[code]), {"sdp": "offer"}, format="json"
        )

        answered = api_client.post(
            reverse("pairing-answer", args=[code]), {"sdp": "answer"}, format="json"
        )
        assert answered.status_code == 204

        assert api_client.get(reverse("pairing-offer", args=[code])).json() == {
            "sdp": "offer"
        }
        assert api_client.get(reverse("pairing-answer", args=[code])).json() == {
            "sdp": "answer"
        }

    def test_posting_the_offer_twice_replaces_it_rather_than_refusing(self, api_client):
        # A doctor's browser retrying a POST that timed out on a flaky
        # hospital connection must never be refused for trying again.
        code = create_code(api_client)
        api_client.post(
            reverse("pairing-offer", args=[code]), {"sdp": "first try"}, format="json"
        )

        retried = api_client.post(
            reverse("pairing-offer", args=[code]), {"sdp": "second try"}, format="json"
        )

        assert retried.status_code == 204
        assert api_client.get(reverse("pairing-offer", args=[code])).json() == {
            "sdp": "second try"
        }

    def test_an_empty_sdp_is_refused(self, api_client):
        code = create_code(api_client)

        response = api_client.post(
            reverse("pairing-offer", args=[code]), {"sdp": ""}, format="json"
        )

        assert response.status_code == 400


class TestAnUnknownOrExpiredCode:
    """A code that was never issued and one that has been ended look
    identical to whichever device is asking: not found."""

    def test_every_endpoint_refuses_a_code_that_was_never_issued(self, api_client):
        made_up = "ZZZZZZ"

        assert (
            api_client.get(reverse("pairing-offer", args=[made_up])).status_code == 404
        )
        assert (
            api_client.post(
                reverse("pairing-offer", args=[made_up]), {"sdp": "x"}, format="json"
            ).status_code
            == 404
        )
        assert (
            api_client.get(reverse("pairing-answer", args=[made_up])).status_code == 404
        )

    def test_a_code_stops_working_once_ended(self, api_client):
        code = create_code(api_client)

        ended = api_client.delete(reverse("pairing-end", args=[code]))
        assert ended.status_code == 204

        assert api_client.get(reverse("pairing-offer", args=[code])).status_code == 404

    def test_ending_an_already_gone_code_is_not_an_error(self, api_client):
        # Idempotent: the caller's intent, that nothing of this code's should
        # be left behind, is already satisfied either way.
        response = api_client.delete(reverse("pairing-end", args=["NEVERISSUED"]))

        assert response.status_code == 204


class TestEndingAPairing:
    def test_ending_clears_the_offer_and_answer_too(self, api_client):
        code = create_code(api_client)
        api_client.post(
            reverse("pairing-offer", args=[code]), {"sdp": "offer"}, format="json"
        )
        api_client.post(
            reverse("pairing-answer", args=[code]), {"sdp": "answer"}, format="json"
        )

        api_client.delete(reverse("pairing-end", args=[code]))

        assert api_client.get(reverse("pairing-offer", args=[code])).status_code == 404
        assert api_client.get(reverse("pairing-answer", args=[code])).status_code == 404
