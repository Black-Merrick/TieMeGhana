"""
Tests for the GhSL clip library and the text to sign resolution pipeline.

These cover SRS FR 1.5, FR 1.6, and FR 1.7, plus the clinical safety property
that an unreviewed sign can never reach a patient.
"""

from io import StringIO

import pytest
from django.core.management import call_command
from django.db import IntegrityError
from django.urls import reverse

from clips.body_locations import BODY_LOCATION_GLOSSES
from clips.emergency import CRITICAL_ALERT_GLOSSES
from clips.models import ClipKind, SignClip
from clips.services import resolve_sign_sequence, tokenize


class TestTokenize:
    """
    FR 1.5 begins with tokenizing the caption. Twi is the caption language, so
    the tokenizer has to survive characters English does not have.
    """

    def test_splits_a_sentence_into_lowercase_tokens(self):
        assert tokenize("The head hurts") == ["the", "head", "hurts"]

    def test_keeps_twi_characters_intact(self):
        # ɛ and ɔ are ordinary letters in Twi. A tokenizer that stripped them
        # would silently mangle most real captions this app produces.
        assert tokenize("mepɛ sɛ") == ["mepɛ", "sɛ"]

    def test_punctuation_never_becomes_a_token(self):
        # A stray "?" token would fingerspell as a missing letter clip and show
        # the patient a spurious gap in the middle of a question.
        assert tokenize("Does it hurt, here?") == ["does", "it", "hurt", "here"]

    def test_returns_no_tokens_for_text_with_no_words(self):
        assert tokenize("   ...  ") == []


@pytest.mark.django_db
class TestSignClipModel:
    def test_gloss_is_stored_uppercase_regardless_of_input(self, make_clip):
        # The gloss is the lookup key, per the SRS definition. Normalizing on
        # save makes lookup one exact match rather than a case insensitive
        # query, and stops two clips differing only by case.
        clip = make_clip("head")

        clip.refresh_from_db()
        assert clip.gloss == "HEAD"

    def test_two_clips_cannot_share_a_gloss(self, make_clip):
        make_clip("HEAD")

        with pytest.raises(IntegrityError):
            make_clip("head")

    def test_clip_awaiting_consultant_review_is_not_resolvable(self, make_clip):
        # An incorrect medical sign carries real clinical consequences, so an
        # unreviewed clip must be invisible to the resolver, not merely
        # discouraged.
        make_clip("HEAD", approved=False)

        assert not SignClip.objects.resolvable().exists()

    def test_clip_without_footage_is_not_resolvable(self, make_clip):
        # A row can exist before the sign is filmed, so the library doubles as
        # a record of which signs still need footage. Those rows must never be
        # served as if they were playable.
        make_clip("HEAD", filmed=False)

        assert not SignClip.objects.resolvable().exists()

    def test_approved_and_filmed_clip_is_resolvable(self, make_clip):
        make_clip("HEAD")

        assert SignClip.objects.resolvable().count() == 1

    def test_awaiting_footage_lists_glosses_still_to_be_filmed(self, make_clip):
        make_clip("HEAD")
        make_clip("CHEST", filmed=False)

        assert [clip.gloss for clip in SignClip.objects.awaiting_footage()] == ["CHEST"]


@pytest.mark.django_db
class TestResolveSignSequence:
    """FR 1.5, FR 1.6, and FR 1.7, the retrieval pipeline itself."""

    def test_matches_each_token_to_its_gloss_clip(self, make_clip, alphabet):
        make_clip("HEAD")
        make_clip("HURTS")

        sequence = resolve_sign_sequence("head hurts")

        assert [segment.match for segment in sequence.segments] == ["gloss", "gloss"]
        assert [segment.clips[0].gloss for segment in sequence.segments] == [
            "HEAD",
            "HURTS",
        ]

    def test_preserves_caption_word_order(self, make_clip, alphabet):
        # FR 1.7 stitches clips into one video. Order carries the meaning of a
        # sentence, so a resolver that returned a set would be useless.
        make_clip("HEAD")
        make_clip("HURTS")

        sequence = resolve_sign_sequence("hurts head")

        assert [segment.token for segment in sequence.segments] == ["hurts", "head"]

    def test_unmatched_word_falls_back_to_fingerspelling(self, alphabet):
        # FR 1.6. Fingerspelling is what keeps an incomplete clip library
        # usable rather than silently dropping words.
        sequence = resolve_sign_sequence("cat")

        segment = sequence.segments[0]
        assert segment.match == "fingerspell"
        assert [clip.gloss for clip in segment.clips] == ["C", "A", "T"]

    def test_fingerspelling_reports_which_words_had_no_sign(self, make_clip, alphabet):
        # The doctor needs to know a word was spelled rather than signed, since
        # a spelled clinical term may not be understood by the patient.
        make_clip("HEAD")

        sequence = resolve_sign_sequence("head cat")

        assert sequence.fingerspelled_tokens == ["cat"]

    def test_token_is_unavailable_when_a_letter_clip_is_missing(self):
        # With no alphabet seeded, fingerspelling cannot complete. Reporting
        # this explicitly is what lets the UI show an honest coverage gap
        # instead of a partial word the patient would misread.
        sequence = resolve_sign_sequence("cat")

        segment = sequence.segments[0]
        assert segment.match == "unavailable"
        assert segment.clips == ()
        assert sequence.unavailable_tokens == ["cat"]

    def test_unreviewed_clip_is_never_used_even_when_the_gloss_matches(
        self, make_clip, alphabet
    ):
        # The single most important safety property in this module.
        make_clip("HEAD", approved=False)

        sequence = resolve_sign_sequence("head")

        assert sequence.segments[0].match == "fingerspell"

    def test_total_duration_sums_every_clip_in_order(self, make_clip, alphabet):
        make_clip("HEAD", duration_ms=900)

        sequence = resolve_sign_sequence("head cat")

        # 900 for the sign, plus three 200ms letter clips for the spelled word.
        assert sequence.total_duration_ms == 1500

    def test_empty_text_produces_an_empty_sequence(self, alphabet):
        sequence = resolve_sign_sequence("   ")

        assert sequence.segments == ()
        assert sequence.total_duration_ms == 0

    def test_resolution_cost_does_not_grow_with_sentence_length(
        self, make_clip, alphabet, django_assert_num_queries
    ):
        # NFR 1 allows five seconds end to end for the whole pipeline, most of
        # which is spent on speech recognition and translation. A per token
        # query would make a long sentence miss that budget, so lookups are
        # batched and this test locks that in.
        #
        # Four: word glosses, reviewed aliases for what did not match, the
        # alphabet for fingerspelling, and the phrase clips. Constant however
        # long the sentence is, which is the property being pinned.
        make_clip("HEAD")

        with django_assert_num_queries(4):
            resolve_sign_sequence("head chest stomach arm leg back hurts badly today")


@pytest.mark.django_db
class TestClipApi:
    def test_lists_only_clips_that_are_reviewed_and_filmed(self, api_client, make_clip):
        make_clip("HEAD")
        make_clip("CHEST", approved=False)
        make_clip("ARM", filmed=False)

        response = api_client.get(reverse("clip-list"))

        assert response.status_code == 200
        assert [clip["gloss"] for clip in response.json()] == ["HEAD"]

    def test_clips_cannot_be_created_through_the_api(self, api_client):
        # Locks in the design stated in the SRS: the clip library is admin
        # managed and consultant reviewed. An API that accepted new clips would
        # be a path for unreviewed medical signs to reach a patient.
        response = api_client.post(
            reverse("clip-list"),
            {"gloss": "HEAD", "kind": ClipKind.WORD},
            format="json",
        )

        assert response.status_code == 405
        assert not SignClip.objects.exists()

    def test_clips_cannot_be_deleted_through_the_api(self, api_client, make_clip):
        clip = make_clip("HEAD")

        response = api_client.delete(reverse("clip-detail", args=[clip.pk]))

        assert response.status_code == 405
        assert SignClip.objects.filter(pk=clip.pk).exists()


@pytest.mark.django_db
class TestSignSequenceApi:
    """
    The response shape here is a contract the frontend player depends on, so
    it is asserted directly rather than inferred from the serializer.
    """

    def test_returns_ordered_segments_with_playable_clip_urls(
        self, api_client, make_clip, alphabet
    ):
        make_clip("HEAD", duration_ms=900)

        response = api_client.post(
            reverse("sign-sequence"), {"text": "head hurts"}, format="json"
        )

        assert response.status_code == 200
        body = response.json()
        assert body["source_text"] == "head hurts"
        assert [segment["token"] for segment in body["segments"]] == ["head", "hurts"]
        assert body["segments"][0]["match"] == "gloss"
        assert body["segments"][0]["clips"][0]["video_url"].endswith(".webm")
        assert body["segments"][1]["match"] == "fingerspell"
        assert body["fingerspelled_tokens"] == ["hurts"]

    def test_rejects_a_request_with_blank_text(self, api_client):
        response = api_client.post(
            reverse("sign-sequence"), {"text": "  "}, format="json"
        )

        assert response.status_code == 400

    def test_rejects_a_request_missing_the_text_field(self, api_client):
        response = api_client.post(reverse("sign-sequence"), {}, format="json")

        assert response.status_code == 400


@pytest.mark.django_db
class TestSeedClipsCommand:
    def test_seeding_never_produces_a_clip_that_could_reach_a_patient(self):
        # The safety property that matters. Seeding records what the project
        # needs, it does not fabricate reviewed footage, so nothing it creates
        # may be resolvable.
        call_command("seed_clips", stdout=StringIO())

        assert SignClip.objects.exists()
        assert not SignClip.objects.resolvable().exists()

    def test_seeding_twice_creates_no_duplicates(self):
        # Safe to re run after adding vocabulary, without disturbing footage or
        # approvals already recorded against existing rows.
        call_command("seed_clips", stdout=StringIO())
        first_count = SignClip.objects.count()

        call_command("seed_clips", stdout=StringIO())

        assert SignClip.objects.count() == first_count

    def test_seeding_preserves_footage_and_approval_already_recorded(self, make_clip):
        make_clip("HEAD", duration_ms=900)

        call_command("seed_clips", stdout=StringIO())

        clip = SignClip.objects.get(gloss="HEAD")
        assert clip.is_resolvable
        assert clip.duration_ms == 900

    def test_seeds_a_full_fingerspelling_alphabet(self):
        # FR 1.6 is unusable without every letter, so a partial alphabet is a
        # real defect rather than a cosmetic gap.
        call_command("seed_clips", stdout=StringIO())

        letters = set(
            SignClip.objects.filter(kind=ClipKind.LETTER).values_list(
                "gloss", flat=True
            )
        )
        assert set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") <= letters


@pytest.mark.django_db
class TestClipByGloss:
    """
    Fetching a named clip, which is how the frontend gets the FR 2.1 literacy
    prompt without storing database ids.
    """

    def test_returns_the_clip_for_a_known_gloss(self, api_client, make_clip):
        make_clip("CAN_YOU_READ_AND_WRITE", kind=ClipKind.PROMPT, duration_ms=3000)

        response = api_client.get(
            reverse("clip-by-gloss", args=["CAN_YOU_READ_AND_WRITE"])
        )

        assert response.status_code == 200
        assert response.json()["gloss"] == "CAN_YOU_READ_AND_WRITE"
        assert response.json()["kind"] == ClipKind.PROMPT

    def test_gloss_lookup_ignores_case(self, api_client, make_clip):
        make_clip("CAN_YOU_READ_AND_WRITE", kind=ClipKind.PROMPT)

        response = api_client.get(
            reverse("clip-by-gloss", args=["can_you_read_and_write"])
        )

        assert response.status_code == 200

    def test_unfilmed_prompt_is_not_found_rather_than_returned_empty(
        self, api_client, make_clip
    ):
        # A caller must not be able to mistake "not filmed yet" for "played
        # successfully", which for the literacy check would mean asking the
        # patient nothing and then acting on their answer.
        make_clip("CAN_YOU_READ_AND_WRITE", kind=ClipKind.PROMPT, filmed=False)

        response = api_client.get(
            reverse("clip-by-gloss", args=["CAN_YOU_READ_AND_WRITE"])
        )

        assert response.status_code == 404

    def test_unreviewed_prompt_is_not_found(self, api_client, make_clip):
        make_clip("CAN_YOU_READ_AND_WRITE", kind=ClipKind.PROMPT, approved=False)

        response = api_client.get(
            reverse("clip-by-gloss", args=["CAN_YOU_READ_AND_WRITE"])
        )

        assert response.status_code == 404

    def test_unknown_gloss_is_not_found(self, api_client):
        response = api_client.get(reverse("clip-by-gloss", args=["NOT_A_GLOSS"]))

        assert response.status_code == 404

    def test_a_prompt_clip_is_never_matched_while_tokenizing_a_caption(
        self, make_clip, alphabet
    ):
        # A system prompt is not a word the doctor can say. If it were matched
        # as one, a caption containing it would play the app's own question at
        # the patient in the middle of a consultation.
        make_clip("PROMPT", kind=ClipKind.PROMPT)

        sequence = resolve_sign_sequence("prompt")

        assert sequence.segments[0].match == "fingerspell"


@pytest.mark.django_db
class TestBodyLocations:
    """
    FR 2.5, the one structured answer set left in the app. Everything else the
    doctor asks is typed or spoken and answered yes or no, see ADR 023, but a
    place cannot be answered yes or no.
    """

    def test_returns_every_body_location_whether_filmed_or_not(self, api_client):
        # The caller needs the full set to decide whether the grid is complete,
        # so filtering the unfilmed ones out here would hide the gap.
        response = api_client.get(reverse("clip-body-locations"))

        assert response.status_code == 200
        assert len(response.json()) == len(BODY_LOCATION_GLOSSES)

    def test_reads_head_downwards_rather_than_alphabetically(self, api_client):
        # The grid should read like a body. An alphabetical list would put the
        # arm before the head, which is harder to scan under pressure.
        order = [
            row["id"] for row in api_client.get(reverse("clip-body-locations")).json()
        ]

        assert order.index("HEAD") < order.index("CHEST") < order.index("FOOT")

    def test_a_filmed_location_carries_a_playable_clip(self, api_client, make_clip):
        make_clip("STOMACH", duration_ms=800)

        rows = api_client.get(reverse("clip-body-locations")).json()
        stomach = next(row for row in rows if row["id"] == "STOMACH")

        assert stomach["is_playable"] is True
        assert stomach["clip"]["video_url"].endswith(".webm")

    def test_an_unfilmed_location_reports_that_it_cannot_be_shown(self, api_client):
        rows = api_client.get(reverse("clip-body-locations")).json()

        assert all(row["is_playable"] is False for row in rows)
        assert all(row["clip"] is None for row in rows)

    def test_an_unreviewed_location_is_not_playable(self, api_client, make_clip):
        # Pointing at a body part is a clinical statement, so an unreviewed
        # sign must not be offered any more than an unreviewed caption word.
        make_clip("STOMACH", approved=False)

        rows = api_client.get(reverse("clip-body-locations")).json()
        stomach = next(row for row in rows if row["id"] == "STOMACH")

        assert stomach["is_playable"] is False

    def test_the_set_costs_one_query(self, api_client, django_assert_max_num_queries):
        with django_assert_max_num_queries(1):
            api_client.get(reverse("clip-body-locations"))


@pytest.mark.django_db
class TestCriticalAlerts:
    """
    FR 5.3, the one-tap alerts in Emergency Visual Triage.

    The rule here is the opposite of the body location grid in ADR 022, and
    deliberately so. See ADR 040.
    """

    def test_returns_every_alert_whether_filmed_or_not(self, api_client):
        response = api_client.get(reverse("clip-alerts"))

        assert response.status_code == 200
        assert len(response.json()) == len(CRITICAL_ALERT_GLOSSES)

    def test_an_unfilmed_alert_is_still_offered(self, api_client):
        # Unlike the body location grid, which is withheld when incomplete. An
        # icon a patient half recognises beats having no way to say "cannot
        # breathe" at all.
        rows = api_client.get(reverse("clip-alerts")).json()

        assert all(row["is_playable"] is False for row in rows)
        assert all(row["clip"] is None for row in rows)
        assert len(rows) == len(CRITICAL_ALERT_GLOSSES)

    def test_asthma_is_not_offered(self, api_client):
        # Removed at the team's direction, ADR 041. Asserted rather than just
        # deleted, because FR 5.3 still names it on paper: without this, a
        # future reader reconciling code against the SRS would add it back.
        ids = [row["id"] for row in api_client.get(reverse("clip-alerts")).json()]

        assert "ASTHMA" not in ids

    def test_breathing_comes_first(self, api_client):
        # A responder scans this list under pressure, so the alert that stops a
        # patient breathing is the one they should reach first.
        order = [row["id"] for row in api_client.get(reverse("clip-alerts")).json()]

        assert order[0] == "CANNOT_BREATHE"

    def test_each_alert_carries_an_icon_key(self, api_client):
        # The icon is what a patient recognises when the GhSL clip is missing,
        # so it is part of the contract rather than a frontend detail.
        rows = api_client.get(reverse("clip-alerts")).json()

        assert all(row["icon"] for row in rows)

    def test_the_icon_key_is_not_the_gloss(self, api_client):
        # An icon is a drawing decision and a gloss is a clinical identifier.
        # Coupling them would mean renaming a sign to change a picture.
        rows = api_client.get(reverse("clip-alerts")).json()

        assert all(row["icon"] != row["id"] for row in rows)

    def test_a_filmed_alert_carries_its_clip(self, api_client, make_clip):
        from clips.models import ClipKind

        make_clip("CANNOT_BREATHE", kind=ClipKind.ALERT, duration_ms=1500)

        rows = api_client.get(reverse("clip-alerts")).json()
        alert = next(row for row in rows if row["id"] == "CANNOT_BREATHE")

        assert alert["is_playable"] is True
        assert alert["clip"]["video_url"].endswith(".webm")

    def test_an_unreviewed_alert_clip_is_not_played(self, api_client, make_clip):
        # Offering the alert is safe. Playing an unreviewed sign for it is not,
        # so the alert stays but its clip does not.
        from clips.models import ClipKind

        make_clip("PREGNANCY", kind=ClipKind.ALERT, approved=False)

        rows = api_client.get(reverse("clip-alerts")).json()
        alert = next(row for row in rows if row["id"] == "PREGNANCY")

        assert alert["is_playable"] is False
        assert alert["clip"] is None

    def test_the_set_costs_one_query(self, api_client, django_assert_max_num_queries):
        with django_assert_max_num_queries(1):
            api_client.get(reverse("clip-alerts"))


@pytest.mark.django_db
class TestNormalizingBeforeValidation:
    """
    A gloss is normalized before anything is checked against it, not after.

    Normalizing only on save meant the admin checked uniqueness against what
    was typed and the database against what was stored, so adding "tablet"
    where "TABLET" already existed passed validation and then raised
    IntegrityError. The doctor got a 500 page carrying the same information as
    the field error they should have seen.
    """

    def test_a_differently_typed_duplicate_is_a_field_error_not_a_crash(
        self, make_clip
    ):
        from django.core.exceptions import ValidationError

        from clips.models import SignClip

        make_clip("TABLET")

        with pytest.raises(ValidationError) as raised:
            SignClip(gloss="tablet").full_clean()

        assert "gloss" in raised.value.message_dict

    def test_a_phrase_typed_with_spaces_is_caught_too(self, make_clip):
        # ADR 039. "how are you doing" becomes HOW_ARE_YOU_DOING, so a second
        # one typed the same way has to be refused rather than accepted and
        # then rejected by the database.
        from django.core.exceptions import ValidationError

        from clips.models import ClipKind, SignClip

        make_clip("HOW_ARE_YOU_DOING", kind=ClipKind.PHRASE)

        with pytest.raises(ValidationError):
            SignClip(gloss="how are you doing", kind=ClipKind.PHRASE).full_clean()

    def test_validation_still_normalizes_the_stored_value(self):
        from clips.models import SignClip

        clip = SignClip(gloss="  two tablets ")
        clip.full_clean(exclude=["video"])

        assert clip.gloss == "TWO_TABLETS"

    def test_creating_without_validation_still_normalizes(self):
        # The importer and every test build rows directly, so save has to keep
        # normalizing as well: doing it in only one of the two places would
        # leave one path writing a gloss nothing can match.
        from clips.models import SignClip

        clip = SignClip.objects.create(gloss="two tablets")

        assert clip.gloss == "TWO_TABLETS"

    def test_an_alias_term_is_normalized_before_validation_too(self, make_clip):
        from clips.models import ClipAlias

        alias = ClipAlias(clip=make_clip("FEELING"), term=" doing ")
        alias.full_clean()

        assert alias.term == "DOING"


@pytest.mark.django_db
class TestStitchingDoesNotAssumeADisk:
    """
    Stitching works on storage names, not on filesystem paths.

    It used to map a clip's served URL back to a path under MEDIA_ROOT, which
    is only correct while the two happen to share a layout. That stopped being
    true the moment media could live in a bucket, and a mapping that quietly
    returns the wrong path is worse than one that cannot be written at all: the
    clips would simply not be found and every sentence would silently fall back
    to playlist playback.
    """

    def test_a_resolved_clip_carries_the_name_it_is_stored_under(self, make_clip):
        from clips.services import resolve_sign_sequence

        make_clip("APPEAR")
        sequence = resolve_sign_sequence("appear")
        clip = sequence.segments[0].clips[0]

        # The name is what storage knows it by, and the URL is where it is
        # served from. On a bucket those are different hosts entirely.
        assert clip.video_name
        assert clip.video_name != clip.video_url

    def test_stitching_reads_through_storage_rather_than_open(
        self, make_clip, monkeypatch
    ):
        # Asserted on the calls rather than the output, because the output
        # needs ffmpeg and real video. What matters is that the files are
        # fetched through the storage API, which is what makes a bucket work.
        from django.core.files.storage import default_storage

        from clips import stitching

        opened = []
        real_open = default_storage.open

        def watched(name, *args, **kwargs):
            opened.append(name)
            return real_open(name, *args, **kwargs)

        monkeypatch.setattr(default_storage, "open", watched)
        monkeypatch.setattr(stitching, "ffmpeg_available", lambda: True)
        monkeypatch.setattr(stitching, "_encode_to_bytes", lambda sources: None)

        clips = [make_clip("APPEAR"), make_clip("ABOUT")]
        names = [clip.video.name for clip in clips]
        stitching.stitch(names, names)

        assert opened == names

    def test_a_missing_file_falls_back_rather_than_raising(self, monkeypatch):
        # A clip the database has and storage does not. The player falls back
        # to the clip playlist, so the patient still sees every sign.
        from clips import stitching

        monkeypatch.setattr(stitching, "ffmpeg_available", lambda: True)

        assert stitching.stitch(["nope/a.webm", "nope/b.webm"], ["a", "b"]) is None

    def test_nothing_partial_reaches_storage_when_encoding_fails(
        self, make_clip, monkeypatch
    ):
        # A truncated file saved under a cache key would be trusted forever,
        # and every later request for that sentence would serve it.
        from django.core.files.storage import default_storage

        from clips import stitching

        monkeypatch.setattr(stitching, "ffmpeg_available", lambda: True)
        monkeypatch.setattr(stitching, "_encode_to_bytes", lambda sources: None)

        clips = [make_clip("APPEAR"), make_clip("ABOUT")]
        names = [clip.video.name for clip in clips]

        assert stitching.stitch(names, names) is None
        assert not default_storage.exists(
            f"{stitching.STITCHED_SUBDIRECTORY}/{stitching.stitch_key(names)}.mp4"
        )

    def test_an_already_stitched_sentence_is_served_rather_than_re_encoded(
        self, make_clip, monkeypatch
    ):
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage

        from clips import stitching

        clips = [make_clip("APPEAR"), make_clip("ABOUT")]
        names = [clip.video.name for clip in clips]
        cached = f"{stitching.STITCHED_SUBDIRECTORY}/{stitching.stitch_key(names)}.mp4"
        default_storage.save(cached, ContentFile(b"already encoded"))

        def refuse(*args, **kwargs):
            raise AssertionError("a cached sentence must not be encoded again")

        monkeypatch.setattr(stitching, "_encode_to_bytes", refuse)

        assert stitching.stitch(names, names) == default_storage.url(cached)
