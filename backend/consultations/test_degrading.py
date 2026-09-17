"""
What survives when the language service does not.

Written after production returned 503 for every caption. Khaya's free tier had
answered 403 "Out of call volume quota. Quota will be replenished in 14:19:29",
and two separate faults turned that into a dead app rather than a degraded one.

The first was advice. The interface said "Could not reach the language service.
Try again", which is exactly wrong for a spent allowance: the replenishment is
measured in hours, and a clinician mid consultation would have retried all day.

The second was worse. An English question needs no translation to resolve its
signs, because the clip library is keyed on English. The signs were already
resolved. The request still failed, and the doctor lost the sign video because
the Twi subtitle beside it could not be fetched.
"""

import pytest
from django.urls import reverse

from core.language.base import LanguageError, LanguageQuotaExceeded
from core.language.stub import StubLanguageProvider


@pytest.fixture
def translation_fails(monkeypatch):
    """Every translation raises, as it does when the allowance is spent."""

    def fail(self, text, *, source, target):
        raise LanguageQuotaExceeded("Out of call volume quota.")

    monkeypatch.setattr(StubLanguageProvider, "translate", fail)


@pytest.mark.django_db
class TestTheSignsSurviveAFailedCaption:
    """
    The signs are the app. The caption is the subtitle beside them.
    """

    def test_the_request_succeeds(self, api_client, translation_fails, make_clip):
        make_clip("HEAD")

        response = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        )

        assert response.status_code == 200

    def test_the_signs_still_resolve_and_play(
        self, api_client, translation_fails, make_clip
    ):
        # The whole point. English needs no translation to reach the library,
        # so losing the translator must not lose the video.
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        matches = [segment["match"] for segment in body["sequence"]["segments"]]
        assert matches == ["gloss"]

    def test_the_patient_reads_the_doctors_own_words(
        self, api_client, translation_fails, make_clip
    ):
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        assert body["caption"] == "head"

    def test_untranslated_text_is_never_labelled_as_twi(
        self, api_client, translation_fails, make_clip
    ):
        # ADR 011 in another costume. Calling the doctor's English "Twi" would
        # teach a patient to trust a caption nobody translated.
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        assert body["caption_language"] != "tw"
        assert body["translation_applied"] is False

    def test_the_reason_is_reported_so_the_screen_can_explain_it(
        self, api_client, translation_fails, make_clip
    ):
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        assert body["caption_problem"] == "quota"

    def test_an_outage_is_reported_differently_from_a_spent_quota(
        self, api_client, monkeypatch, make_clip
    ):
        # Only one of the two is worth trying again, and the difference is
        # hours, so the interface must be able to tell them apart.
        def fail(self, text, *, source, target):
            raise LanguageError("connection reset")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        assert body["caption_problem"] == "unavailable"

    def test_nothing_is_reported_when_the_caption_worked(self, api_client, make_clip):
        make_clip("HEAD")

        body = api_client.post(
            reverse("caption"),
            {"source_language": "en", "text": "head"},
            format="json",
        ).json()

        assert body["caption_problem"] == ""


@pytest.mark.django_db
class TestWhatStillCannotSurvive:
    """
    The other half. Degrading is right where something is left to show, and
    dishonest where nothing is.
    """

    def test_twi_input_still_fails_because_the_signs_cannot_be_reached(
        self, api_client, translation_fails
    ):
        # The library is keyed on English, so Twi input needs the translator
        # before anything can be looked up. There is no video to fall back to.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "ti"},
            format="json",
        )

        assert response.status_code == 503

    def test_the_quota_message_does_not_quote_the_consultation(
        self, api_client, translation_fails
    ):
        # A provider message can echo the utterance, and the utterance is
        # clinical content.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "tw", "text": "patient has HIV"},
            format="json",
        )

        assert "HIV" not in response.json()["detail"]


class TestTellingTheTwoFailuresApart:
    def test_a_spent_quota_is_recognised_from_khayas_own_answer(self):
        from core.language.khaya import _is_quota_exhausted

        class Response:
            status_code = 403
            text = (
                '{ "statusCode": 403, "message": "Out of call volume quota. '
                'Quota will be replenished in 14:19:29." }'
            )

        assert _is_quota_exhausted(Response())

    def test_a_revoked_key_is_not_mistaken_for_a_spent_quota(self):
        # Also a 403, and it needs the opposite response: waiting will never
        # fix it, and somebody has to go and look at the credential.
        from core.language.khaya import _is_quota_exhausted

        class Response:
            status_code = 403
            text = '{ "statusCode": 403, "message": "Access denied due to invalid subscription key." }'

        assert not _is_quota_exhausted(Response())

    def test_other_failures_are_not_quota_failures(self):
        from core.language.khaya import _is_quota_exhausted

        class Response:
            status_code = 500
            text = "Internal server error"

        assert not _is_quota_exhausted(Response())
