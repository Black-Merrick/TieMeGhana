import os

import pytest
from django.urls import reverse

from prescriptions.models import Prescription, PrescriptionItem, new_reference
from prescriptions.throttling import PrescriptionIssueThrottle

pytestmark = pytest.mark.django_db


def photo(size=(600, 400), with_gps=False):
    """
    A JPEG upload, optionally carrying the metadata a phone would write.

    Built rather than read from a fixture file so the EXIF test can state what
    it is stripping instead of trusting a checked in binary to still contain
    it.
    """
    import io

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    image = Image.new("RGB", size, (200, 120, 60))
    buffer = io.BytesIO()

    if with_gps:
        exif = Image.Exif()
        # Make, model and capture time, which is the metadata a phone writes
        # alongside the GPS block. The assertion is that the saved file has no
        # EXIF at all, so it covers the coordinates without this fixture having
        # to hand build a valid GPS IFD.
        exif[271] = "TestPhone"
        exif[272] = "Model X"
        exif[306] = "2026:09:13 18:40:00"
        image.save(buffer, format="JPEG", exif=exif)
    else:
        image.save(buffer, format="JPEG")

    buffer.seek(0)
    return SimpleUploadedFile("drug.jpg", buffer.read(), content_type="image/jpeg")


def one_item(**overrides):
    return {
        "medicine": "Paracetamol",
        # Structured rather than typed, per ADR 049: one tablet, twice a day.
        "amount": "1",
        "unit": "TABLET",
        "frequency_choice": "TWICE",
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
            {"items": [one_item(), one_item(medicine="Zinc", unit="")]},
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


class TestIssuingIsRateLimited:
    """
    ADR 044's known limitation, mitigated rather than left undocumented:
    issuing has no account to check, so a runaway script is bounded by a rate
    limit instead. See PrescriptionIssueThrottle.

    Rate changed here with `monkeypatch.setattr(..., "rate", ...)`, not
    `settings.REST_FRAMEWORK`. DRF's `SimpleRateThrottle.THROTTLE_RATES` is a
    class attribute read once, the first time `rest_framework.throttling` is
    imported, and never rereads `settings` after that: a `settings` override
    changes what `django.conf.settings.REST_FRAMEWORK` holds, but the class
    attribute other tests already froze earlier in the run keeps pointing at
    the old dict. Setting `.rate` directly skips that dict lookup entirely, per
    `SimpleRateThrottle.__init__`, so it is not exposed to the same staleness.
    """

    def test_issuing_past_the_limit_is_refused(self, api_client, monkeypatch):
        # A rate low enough to hit in a handful of requests, not the real
        # sixty an hour, so the test is fast and unambiguous about which
        # request tripped it.
        monkeypatch.setattr(PrescriptionIssueThrottle, "rate", "3/hour", raising=False)

        statuses = [
            api_client.post(
                reverse("prescription-issue"),
                {"items": [one_item(medicine=f"Medicine {i}")]},
                format="json",
            ).status_code
            for i in range(4)
        ]

        assert statuses == [201, 201, 201, 429]

    def test_the_playlist_is_not_throttled(self, api_client, monkeypatch):
        # Only issuing creates a row. A patient replaying their own
        # prescription, possibly many times as they rewatch one step, must
        # never be the request that gets rate limited.
        monkeypatch.setattr(PrescriptionIssueThrottle, "rate", "1/hour", raising=False)

        reference = issue(api_client)["reference"]
        # That one issue already spent the only request this hour allows.
        second_issue = api_client.post(
            reverse("prescription-issue"),
            {"items": [one_item()]},
            format="json",
        )
        assert second_issue.status_code == 429

        for _ in range(5):
            response = api_client.get(
                reverse("prescription-playlist", args=[reference])
            )
            assert response.status_code == 200


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
            [one_item(amount="2", unit="TABLET", frequency_choice="ONCE")],
        )

        sequence = body["items"][0]["sequence"]
        assert sequence["is_safe_to_show"] is False
        assert "two" in sequence["blocking_tokens"]

    def test_an_unfilmed_frequency_refuses_the_whole_instruction(
        self, api_client, make_clip
    ):
        for gloss in ("PARACETAMOL", "TABLET", "ONE"):
            make_clip(gloss)

        body = issue(
            api_client, [one_item(amount="1", unit="TABLET", frequency_choice="TWICE")]
        )

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

        def fake_stitch(sources, material):
            asked["material"] = material
            return "/media/stitched/abc.mp4"

        monkeypatch.setattr(services, "stitch", fake_stitch)
        for gloss in ("PARACETAMOL", "ONE", "TABLET", "TWICE", "DAY", "ZINC"):
            make_clip(gloss)

        body = issue(
            api_client,
            [
                one_item(),
                one_item(medicine="Zinc"),
            ],
        )

        assert body["is_fully_signable"] is True
        assert body["video_url"] == "/media/stitched/abc.mp4"
        # Both medicines, in order, in one file.
        joined = " ".join(asked["material"])
        assert "paracetamol" in joined
        assert "zinc" in joined
        assert joined.index("paracetamol") < joined.index("zinc")

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


class TestPhotographingTheMedicine:
    """
    FR 6.1, the medicine identified by a picture rather than by its name.

    A patient who cannot read a drug name can match a photograph to the box in
    their hand, which makes the picture the better identifier for exactly the
    people this app is for. It also removes the weakest link in a signed
    prescription: a drug name has no sign and has to be fingerspelled letter by
    letter.
    """

    def test_an_item_can_carry_a_photograph_instead_of_a_name(self, api_client):
        response = api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        )

        assert response.status_code == 201, response.json()
        item = response.json()["items"][0]
        assert item["image_url"].endswith(".jpg")
        assert item["medicine"] == ""

    def test_an_item_with_neither_a_name_nor_a_photograph_is_refused(self, api_client):
        # It would identify nothing. The patient would be shown a dose with no
        # way to tell which medicine it belongs to.
        response = api_client.post(
            reverse("prescription-issue"),
            {"items": [{"amount": "1", "unit": "TABLET", "frequency_choice": "TWICE"}]},
            format="json",
        )

        assert response.status_code == 400

    def test_the_drug_name_is_left_out_of_the_signed_sentence(self, api_client):
        # The point of the photograph. Including the name as well would mean
        # fingerspelling letters the patient has already been shown, and would
        # pull an unfilmable word into a sentence the safety gate would refuse.
        api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        )

        item = PrescriptionItem.objects.get()
        assert item.instruction == "one tablet, twice a day"

    def test_a_named_item_still_signs_its_name(self, api_client):
        issue(api_client)

        item = PrescriptionItem.objects.get()
        assert item.instruction.startswith("Paracetamol")

    def test_an_unnamed_item_is_still_called_something(self, api_client):
        # The printed slip and the patient's screen both need a heading, and an
        # empty one reads as a rendering fault rather than as a deliberate
        # absence.
        body = api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        ).json()

        assert body["items"][0]["label"] == "Medicine 1"

    def test_camera_metadata_is_not_kept(self, api_client):
        # A phone writes the GPS coordinates of where a photograph was taken
        # into its EXIF, and on a hospital device that is the hospital. This
        # payload is handed to anyone who scans the QR code, so the image is
        # re-encoded from its pixels rather than stored as it arrived.
        from PIL import Image

        api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(with_gps=True),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        )

        saved = Image.open(PrescriptionItem.objects.get().image.path)
        assert not saved.getexif()

    def test_a_large_photograph_is_shrunk(self, api_client):
        # A phone camera produces something a patient would then download over
        # a hospital connection to look at a picture of a box.
        from PIL import Image

        from prescriptions.images import MAX_EDGE

        api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(size=(3000, 2000)),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        )

        saved = Image.open(PrescriptionItem.objects.get().image.path)
        assert max(saved.size) <= MAX_EDGE

    def test_a_file_that_is_not_an_image_is_refused(self, api_client):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": SimpleUploadedFile(
                    "notes.pdf", b"%PDF-1.4 not an image", content_type="image/jpeg"
                ),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        )

        assert response.status_code == 400

    def test_two_photographs_are_not_treated_as_duplicates(self, api_client):
        # The duplicate check compares names. Two photographs cannot be told
        # apart without looking at them, and refusing one because another also
        # has no name would block a prescription entered entirely by picture.
        response = api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
                "items[1]image": photo(),
                "items[1]amount": "2",
                "items[1]unit": "SPOON",
                "items[1]frequency_choice": "ONCE",
            },
            format="multipart",
        )

        assert response.status_code == 201, response.json()
        assert len(response.json()["items"]) == 2

    def test_the_photograph_plays_before_the_dose(
        self, api_client, make_clip, monkeypatch
    ):
        # Picture, then instruction. The patient sees which box, then what to
        # do with it, and nothing has to be read.
        from prescriptions import services

        asked = {}

        def fake_stitch(sources, material):
            asked["material"] = material
            return "/media/stitched/abc.mp4"

        monkeypatch.setattr(services, "stitch", fake_stitch)
        for gloss in ("ONE", "TABLET", "TWICE", "DAY"):
            make_clip(gloss)

        reference = api_client.post(
            reverse("prescription-issue"),
            {
                "items[0]image": photo(),
                "items[0]amount": "1",
                "items[0]unit": "TABLET",
                "items[0]frequency_choice": "TWICE",
            },
            format="multipart",
        ).json()["reference"]

        api_client.get(reverse("prescription-playlist", args=[reference]))

        kinds = [entry.split(":")[0] for entry in asked["material"]]
        assert kinds[0] == "still"
        assert set(kinds[1:]) == {"clip"}

    def test_holding_the_photograph_longer_produces_a_different_file(self):
        # The duration is part of what the file contains, so it has to be part
        # of what the cache is addressed by, or changing it would serve the
        # previous encode forever.
        from clips.stitching import stitch_key

        assert stitch_key(["still:/a.jpg:3"]) != stitch_key(["still:/a.jpg:5"])


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
            # What to call the item when the doctor gave no name, so no screen
            # ever shows an empty heading.
            "label",
            # A path under /media to a photograph of the medicine. Re-encoded
            # on upload, so it carries none of the camera metadata a phone
            # would have written into it.
            "image_url",
            # This medicine alone as one file: the photograph, then the dose.
            "video_url",
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


class TestTheDoseIsWrittenNotTyped:
    """
    ADR 049. A prescription is a dose, a time, a relation to food and sometimes
    a length of course, and the sentence is built from those rather than typed.

    The point is not tidiness. A typed instruction could be any wording at all,
    most of which has no chance of resolving to signs, and the doctor found out
    only after the prescription was issued. A generated one is drawn from a
    vocabulary known in advance, so once those clips exist every prescription
    the app can produce is signable.
    """

    def test_one_tablet_twice_a_day(self, api_client):
        body = issue(api_client)

        item = body["items"][0]
        assert item["dosage"] == "one tablet"
        assert item["frequency"] == "twice a day"

    def test_a_count_greater_than_one_reads_as_plural(self, api_client):
        # The caption is read by a pharmacist, and "two tablet" reads as a
        # mistake in a document people have to trust.
        body = issue(api_client, [one_item(amount="2", unit="TABLET")])

        assert body["items"][0]["dosage"] == "two tablets"

    def test_half_takes_the_singular(self, api_client):
        body = issue(api_client, [one_item(amount="HALF", unit="TABLET")])

        assert body["items"][0]["dosage"] == "half tablet"

    def test_times_of_day_read_in_the_order_of_the_day(self, api_client):
        # Not the order they were ticked. The sentence should read the way the
        # day runs.
        body = issue(
            api_client,
            [
                one_item(
                    times=["EVENING", "MORNING"],
                    frequency_choice="",
                )
            ],
        )

        assert body["items"][0]["frequency"] == "morning and evening"

    def test_three_times_of_day_are_listed_properly(self, api_client):
        body = issue(
            api_client,
            [
                one_item(
                    times=["MORNING", "AFTERNOON", "EVENING"],
                    frequency_choice="",
                )
            ],
        )

        assert body["items"][0]["frequency"] == "morning, afternoon and evening"

    def test_specific_times_win_over_a_count(self, api_client):
        # They say strictly more. A patient told "morning and evening" knows
        # when; one told "twice a day" has to decide, and may take both
        # together.
        body = issue(
            api_client,
            [one_item(times=["MORNING", "NIGHT"], frequency_choice="TWICE")],
        )

        assert body["items"][0]["frequency"] == "morning and night"

    def test_the_relation_to_food_is_included(self, api_client):
        body = issue(api_client, [one_item(meal="AFTER")])

        assert body["items"][0]["frequency"] == "twice a day, after food"

    def test_the_length_of_the_course_is_included_in_words(self, api_client):
        # "for five days", not "for 5 days": the resolver matches words, and a
        # digit has no sign to match.
        body = issue(api_client, [one_item(days=5)])

        assert body["items"][0]["frequency"] == "twice a day, for five days"

    def test_everything_together(self, api_client):
        body = issue(
            api_client,
            [
                one_item(
                    amount="2",
                    unit="SPOON",
                    times=["MORNING", "NIGHT"],
                    frequency_choice="",
                    meal="BEFORE",
                    days=3,
                )
            ],
        )

        item = body["items"][0]
        assert item["dosage"] == "two spoons"
        assert item["frequency"] == "morning and night, before food, for three days"
        assert item["instruction"] == (
            "Paracetamol, two spoons, morning and night, before food, for three days"
        )

    def test_a_dose_with_no_schedule_is_refused(self, api_client):
        # Half an instruction, and the kind of gap a patient fills in by
        # guessing.
        response = api_client.post(
            reverse("prescription-issue"),
            {"items": [{"medicine": "Zinc", "amount": "1", "unit": "TABLET"}]},
            format="json",
        )

        assert response.status_code == 400

    def test_a_wording_outside_the_vocabulary_cannot_be_sent(self, api_client):
        # The whole point. There is no way to enter something the app cannot
        # then sign.
        response = api_client.post(
            reverse("prescription-issue"),
            {
                "items": [
                    {
                        "medicine": "Zinc",
                        "amount": "1",
                        "unit": "PUFF",
                        "frequency_choice": "TWICE",
                    }
                ]
            },
            format="json",
        )

        assert response.status_code == 400

    def test_the_filming_list_covers_every_word_a_prescription_can_use(self):
        # The list is derived from the vocabulary rather than written out
        # again, so it cannot fall behind what a prescription can contain.
        from clips.safety import TokenRisk, classify
        from clips.services import tokenize
        from prescriptions.dosing import (
            AMOUNTS,
            FREQUENCIES,
            MEALS,
            TIMES_OF_DAY,
            UNITS,
            dosage_phrase,
            filming_vocabulary,
            frequency_phrase,
        )

        covered = set(filming_vocabulary())

        for amount in AMOUNTS:
            for unit in UNITS:
                for token in tokenize(dosage_phrase(amount, unit)):
                    if classify(token) == TokenRisk.DROPPABLE:
                        continue
                    assert token in covered, token

        for times in ([], ["MORNING"], list(TIMES_OF_DAY)):
            for frequency in [""] + list(FREQUENCIES):
                for meal in [""] + list(MEALS):
                    for days in (None, 5):
                        phrase = frequency_phrase(times, frequency, meal, days)
                        for token in tokenize(phrase):
                            # Droppable words need no clip: the safety gate
                            # leaves them out of the signed sentence, because
                            # GhSL does not use them.
                            if classify(token) == TokenRisk.DROPPABLE:
                                continue
                            assert token in covered, token
