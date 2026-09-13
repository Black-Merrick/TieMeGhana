import os

import pytest
from django.urls import reverse

from prescriptions.models import Prescription, PrescriptionItem, new_reference

pytestmark = pytest.mark.django_db


def one_item(**overrides):
    return {
        "medicine": "Paracetamol",
        "dosage": "one tablet",
        "frequency": "twice a day",
        **overrides,
    }


def issue(api_client, items=None):
    response = api_client.post(
        reverse("prescription-issue"),
        {"items": items or [one_item()]},
        format="json",
    )
    assert response.status_code == 201, response.json()
    return response.json()


class TestIssuing:
    """FR 6.1, the doctor's final instructions become an ordered playlist."""

    def test_a_prescription_is_issued_with_a_reference(self, api_client):
        body = issue(api_client)

        assert body["reference"]
        assert Prescription.objects.filter(reference=body["reference"]).exists()

    def test_items_keep_the_order_they_were_given_in(self, api_client):
        body = issue(
            api_client,
            [
                one_item(medicine="Paracetamol"),
                one_item(medicine="Amoxicillin"),
                one_item(medicine="Zinc"),
            ],
        )

        assert [item["position"] for item in body["items"]] == [1, 2, 3]
        assert [item["medicine"] for item in body["items"]] == [
            "Paracetamol",
            "Amoxicillin",
            "Zinc",
        ]

    def test_an_empty_prescription_is_refused(self, api_client):
        # It would produce a QR code resolving to an empty screen, which the
        # patient cannot tell apart from a technical failure.
        response = api_client.post(
            reverse("prescription-issue"), {"items": []}, format="json"
        )

        assert response.status_code == 400

    def test_the_same_medicine_twice_is_refused(self, api_client):
        # Far likelier a double submission than a genuine instruction to take
        # two lots of one drug, and the patient cannot tell which it was.
        response = api_client.post(
            reverse("prescription-issue"),
            {"items": [one_item(), one_item()]},
            format="json",
        )

        assert response.status_code == 400

    def test_nothing_is_saved_when_one_item_is_invalid(self, api_client):
        # A prescription that saved three of its four medicines is the most
        # dangerous outcome available: it looks complete to whoever scans it.
        response = api_client.post(
            reverse("prescription-issue"),
            {"items": [one_item(), one_item(medicine="Zinc", dosage="")]},
            format="json",
        )

        assert response.status_code == 400
        assert not Prescription.objects.exists()
        assert not PrescriptionItem.objects.exists()

    def test_the_caption_is_translated_once_and_stored(self, api_client):
        # Signs are resolved on every read. Captions are not, because Khaya
        # credit is metered per ADR 015 and a patient replaying their own
        # prescription must not spend any.
        body = issue(api_client)
        item = PrescriptionItem.objects.get()

        assert item.caption
        assert item.caption_language == "tw"
        assert body["items"][0]["caption"] == item.caption

    def test_a_translation_outage_still_issues_the_prescription(
        self, api_client, monkeypatch
    ):
        # The signs are what the patient reads and they do not depend on the
        # translation, so refusing to issue would withhold the useful part over
        # the loss of the less useful one.
        from core.language import LanguageError
        from core.language.stub import StubLanguageProvider

        def fail(self, text, *, source, target):
            raise LanguageError("simulated outage")

        monkeypatch.setattr(StubLanguageProvider, "translate", fail)

        body = issue(api_client)

        assert body["items"][0]["caption_language"] == "en"
        assert body["items"][0]["caption"] == body["items"][0]["instruction"]

    def test_the_caption_names_the_provider_that_produced_it(self, api_client):
        # ADR 011. The stub returns its input unchanged, so a caption it
        # produced is English text that would otherwise be labelled Twi and
        # shown as a translation. Found by an end to end check against the dev
        # server: the payload came back caption_language "tw" reading English,
        # with nothing in it to tell the two apart.
        body = issue(api_client)

        assert body["items"][0]["caption_provider"] == "stub"

    def test_the_provider_is_stored_not_read_back_from_settings(
        self, api_client, settings
    ):
        # A prescription is read back weeks later, by which time the setting
        # may have changed. What matters is which provider produced the caption
        # that is actually stored, not which one is configured now.
        reference = issue(api_client)["reference"]
        settings.LANGUAGE_PROVIDER = "khaya"

        body = api_client.get(reverse("prescription-playlist", args=[reference])).json()

        assert body["items"][0]["caption_provider"] == "stub"

    def test_the_doctor_is_told_when_an_item_cannot_be_signed(self, api_client):
        # The whole point of returning the playlist at issue time. With no
        # clips filmed nothing resolves, and the doctor has to learn that while
        # the patient is still in the room.
        body = issue(api_client)

        assert body["is_fully_signable"] is False
        assert body["unsignable_positions"] == [1]


class TestReplay:
    """FR 6.2 and FR 6.3, a scanned reference resolves to the playlist."""

    def test_a_reference_resolves_to_its_playlist(self, api_client):
        reference = issue(api_client)["reference"]

        response = api_client.get(reverse("prescription-playlist", args=[reference]))

        assert response.status_code == 200
        assert response.json()["items"][0]["medicine"] == "Paracetamol"

    def test_an_unknown_reference_is_a_404(self, api_client):
        response = api_client.get(
            reverse("prescription-playlist", args=["not-a-real-reference"])
        )

        assert response.status_code == 404

    def test_replay_needs_no_account(self, api_client):
        # The reference is the capability. Requiring an account would stop a
        # Deaf patient replaying their own prescription at home, which is the
        # requirement, and would protect nothing: the payload identifies nobody.
        reference = issue(api_client)["reference"]

        assert (
            api_client.get(
                reverse("prescription-playlist", args=[reference])
            ).status_code
            == 200
        )

    def test_replay_spends_no_translation_credit(self, api_client, monkeypatch):
        # If replay translated, every time a patient opened their prescription
        # it would cost metered Khaya credit, and offline replay would be
        # impossible. A translate that fails the test proves nothing calls it.
        from core.language.stub import StubLanguageProvider

        reference = issue(api_client)["reference"]

        def explode(self, text, *, source, target):
            raise AssertionError("replay must not translate: ADR 015, metered credit")

        monkeypatch.setattr(StubLanguageProvider, "translate", explode)

        response = api_client.get(reverse("prescription-playlist", args=[reference]))

        assert response.status_code == 200
        assert response.json()["items"][0]["caption_language"] == "tw"

    def test_a_long_prescription_costs_no_more_lookups_than_a_short_one(
        self, api_client, django_assert_max_num_queries
    ):
        # A prescription of six medicines must open as fast as one of two, or
        # the patient waits on the pharmacy counter for a progress bar.
        reference = issue(
            api_client,
            [one_item(medicine=f"Medicine {n}") for n in range(6)],
        )["reference"]

        with django_assert_max_num_queries(6):
            api_client.get(reverse("prescription-playlist", args=[reference]))

    def test_a_newly_filmed_sign_improves_an_existing_prescription(
        self, api_client, make_clip
    ):
        # ADR 043. Signs are resolved on read, so the prescription is rendered
        # by the clip library as it is now, not as it was at issue time.
        # Everything but the medicine name is filmed, so the one token under
        # test is the only thing missing.
        for gloss in ("ONE", "TABLET", "TWICE", "DAY"):
            make_clip(gloss)
        reference = issue(api_client)["reference"]

        before = api_client.get(
            reverse("prescription-playlist", args=[reference])
        ).json()
        make_clip("PARACETAMOL")
        after = api_client.get(
            reverse("prescription-playlist", args=[reference])
        ).json()

        assert before["items"][0]["sequence"]["unavailable_tokens"] == ["paracetamol"]
        assert after["items"][0]["sequence"]["unavailable_tokens"] == []

    def test_a_withdrawn_sign_stops_playing_immediately(self, api_client, make_clip):
        # The direction that matters for safety. A consultant who withdraws a
        # sign has to be able to stop it playing everywhere, including in
        # prescriptions issued before they withdrew it.
        for gloss in ("ONE", "TABLET", "TWICE", "DAY"):
            make_clip(gloss)
        clip = make_clip("PARACETAMOL")
        reference = issue(api_client)["reference"]

        from clips.models import ReviewStatus

        clip.review_status = ReviewStatus.PENDING
        clip.save()

        after = api_client.get(
            reverse("prescription-playlist", args=[reference])
        ).json()

        assert after["items"][0]["sequence"]["unavailable_tokens"] == ["paracetamol"]


class TestTheDosageIsNeverSilentlyDropped:
    """
    ADR 033, applied to the case it matters most in.

    A dropped quantity or frequency is the difference between one tablet and
    four. The safety gate already treats both as blocking rather than
    droppable; these tests hold that line for prescriptions specifically,
    because this is where being wrong is measured in doses.
    """

    def test_an_unfilmed_quantity_refuses_the_whole_instruction(
        self, api_client, make_clip
    ):
        for gloss in ("PARACETAMOL", "TABLET", "DAY"):
            make_clip(gloss)

        body = issue(
            api_client,
            [one_item(dosage="two tablet", frequency="every day")],
        )

        sequence = body["items"][0]["sequence"]
        assert sequence["is_safe_to_show"] is False
        assert "two" in sequence["blocking_tokens"]

    def test_an_unfilmed_frequency_refuses_the_whole_instruction(
        self, api_client, make_clip
    ):
        for gloss in ("PARACETAMOL", "TABLET", "ONE"):
            make_clip(gloss)

        body = issue(api_client, [one_item(dosage="one tablet", frequency="twice")])

        sequence = body["items"][0]["sequence"]
        assert sequence["is_safe_to_show"] is False
        assert "twice" in sequence["blocking_tokens"]


class TestSavingToThePhonesGallery:
    """
    ADR 046. One video file the patient keeps, rather than a cache they lose.

    A file in the gallery outlives the browser cache, the app, and the
    hospital. These tests hold the rule that decides when one may exist.
    """

    def test_no_whole_prescription_video_when_an_item_is_refused(self, api_client):
        # The important direction. A single file cannot say that one medicine
        # is missing from it, so it would sit in the gallery looking complete.
        body = issue(api_client)

        assert body["is_fully_signable"] is False
        assert body["video_url"] is None

    def test_a_fully_signable_prescription_offers_one_file(
        self, api_client, make_clip, monkeypatch
    ):
        # Stitching itself is covered in clips/tests.py. What matters here is
        # that a prescription asks for one file spanning every medicine, in
        # playlist order.
        from prescriptions import services

        asked = {}

        def fake_stitch(sequence):
            asked["segments"] = [segment.token for segment in sequence.segments]
            return "/media/stitched/abc.mp4"

        monkeypatch.setattr(services, "stitched_video_url", fake_stitch)
        for gloss in ("PARACETAMOL", "ONE", "TABLET", "TWICE", "DAY", "ZINC"):
            make_clip(gloss)

        body = issue(
            api_client,
            [
                one_item(),
                one_item(medicine="Zinc", dosage="one tablet", frequency="twice a day"),
            ],
        )

        assert body["is_fully_signable"] is True
        assert body["video_url"] == "/media/stitched/abc.mp4"
        # Both medicines, in order, in one file.
        assert asked["segments"].count("paracetamol") == 1
        assert asked["segments"].count("zinc") == 1
        assert asked["segments"].index("paracetamol") < asked["segments"].index("zinc")

    def test_the_same_prescription_asks_for_the_same_file(self, api_client, make_clip):
        # The stitching cache is addressed by the clips it contains, so a
        # prescription reopened on the patient's phone must not re-encode.
        for gloss in ("PARACETAMOL", "ONE", "TABLET", "TWICE", "DAY"):
            make_clip(gloss)
        reference = issue(api_client)["reference"]

        first, second = (
            api_client.get(reverse("prescription-playlist", args=[reference])).json()[
                "video_url"
            ]
            for _ in range(2)
        )

        assert first == second

    def test_the_file_url_carries_no_patient_data(self, api_client, make_clip):
        # It is a filename derived from the clips it contains, which is what
        # makes it shareable and cacheable. FR 6.4 applies to it too.
        for gloss in ("PARACETAMOL", "ONE", "TABLET", "TWICE", "DAY"):
            make_clip(gloss)
        body = issue(api_client)

        if body["video_url"] is None:
            pytest.skip(
                "nothing was stitched: either ffmpeg is unavailable, or the "
                "test clips are placeholder bytes rather than real video"
            )

        for forbidden in ("paracetamol", "patient", "name"):
            assert forbidden not in body["video_url"].lower()


class TestTheReference:
    """FR 6.3, the QR code carries a de identified reference and nothing else."""

    def test_references_are_unique_across_many_prescriptions(self):
        assert len({new_reference() for _ in range(500)}) == 500

    def test_a_reference_is_long_enough_not_to_be_guessed(self):
        # It is the only thing standing between a stranger and a medicine list.
        assert len(new_reference()) >= 20

    def test_a_reference_is_url_and_qr_safe(self):
        # It travels in a URL inside a QR code. A character needing percent
        # encoding would make the QR larger and harder to scan, and any
        # mismatch between encoder and decoder would break replay entirely.
        assert set(new_reference()) <= set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        )

    def test_two_prescriptions_do_not_get_related_references(self, api_client):
        # A sequential id would let anyone who scanned one prescription walk
        # every other prescription in the hospital by adding one.
        first = issue(api_client)["reference"]
        second = issue(api_client, [one_item(medicine="Zinc")])["reference"]

        assert first != second
        # No shared prefix beyond what chance gives two random strings.
        shared = len(os.path.commonprefix([first, second]))
        assert shared <= 3, f"{first} and {second} share {shared} characters"


class TestFr64ThePrivateTranscriptIsUnreachable:
    """
    FR 6.4, enforced structurally rather than by a permission check.

    There is no field in the payload that could carry transcript data and no
    endpoint that would resolve one, so there is no path to expose it even if a
    permission were misconfigured. These tests pin that, because the guarantee
    is made of absences and absences are what quietly stop being true.
    """

    def test_the_payload_has_exactly_the_fields_we_expect(self, api_client):
        body = issue(api_client)

        assert set(body) == {
            "reference",
            "items",
            "is_fully_signable",
            "unsignable_positions",
            # One file for the whole prescription, ADR 046. A path under
            # /media, carrying no patient data of any kind.
            "video_url",
        }
        assert set(body["items"][0]) == {
            "position",
            "medicine",
            "dosage",
            "frequency",
            "instruction",
            "caption",
            "caption_language",
            "caption_provider",
            "sequence",
        }

    def test_the_model_cannot_hold_a_patient_identifier(self):
        # The defence is that the row has nowhere to put one. Asserted on the
        # model rather than the response, because a field added here would be
        # one edit away from appearing in the payload.
        fields = {field.name for field in PrescriptionItem._meta.get_fields()}
        fields |= {field.name for field in Prescription._meta.get_fields()}

        for forbidden in (
            "patient",
            "patient_name",
            "name",
            "visit",
            "transcript",
            "consultation",
            "phone",
            "address",
        ):
            assert forbidden not in fields, forbidden

    def test_no_prescription_route_looks_like_it_carries_a_transcript(self):
        from prescriptions import urls

        for pattern in urls.urlpatterns:
            text = f"{pattern.pattern} {pattern.name}".lower()
            for word in ("transcript", "record", "history", "consultation"):
                assert word not in text, text

    def test_a_reference_cannot_be_used_to_reach_anything_else(self, api_client):
        # The reference grants access to one playlist. It is not a session, and
        # it must not be accepted anywhere that returns something broader.
        reference = issue(api_client)["reference"]

        response = api_client.get(f"/api/prescriptions/{reference}/items/")

        assert response.status_code == 404
