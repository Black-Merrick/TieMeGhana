"""
The fixed phrases emergency mode speaks, and the gate on which may be spoken.

Emergency mode has no free text, so its vocabulary is known in advance and is
translated once rather than at the moment of a tap. These tests are mostly
about the second half of that: an unreviewed clinical translation must not
reach a clinician's ear during triage.
"""

import pytest
from django.urls import reverse

from clips import emergency_speech
from clips.body_locations import BODY_LOCATIONS
from clips.emergency import CRITICAL_ALERTS


class TestTheVocabularyIsComplete:
    def test_every_alert_can_be_spoken(self):
        for gloss, _, _ in CRITICAL_ALERTS:
            assert gloss in emergency_speech.PHRASES, gloss

    def test_every_body_location_can_be_spoken(self):
        # A location a patient can point to but the app cannot say is a tap
        # that produces silence, which in an emergency reads as a broken app.
        for gloss, _ in BODY_LOCATIONS:
            assert gloss in emergency_speech.PHRASES, gloss

    def test_every_pain_level_can_be_spoken(self):
        for level in range(1, 6):
            assert f"PAIN_{level}" in emergency_speech.PHRASES

    def test_every_phrase_is_a_sentence_not_a_label(self):
        # A tap on the head used to say "Pain in the head". A bare noun is bad
        # English and worse input to a translator: asked for "Waist" the
        # service returned "Waist a ɔyɛ ɔkwasea", and for "Throat" it returned
        # "Throat na ɔkyerɛwee". Sentences fixed every one of those.
        for key, (english, _, _) in emergency_speech.PHRASES.items():
            assert len(english.split()) >= 3, f"{key}: {english!r} is a label"
            assert english[0].isupper(), key

    def test_every_phrase_is_what_the_patient_would_say(self):
        # First person, because the patient is the one speaking. A record
        # reading "Head" says where they pointed; "I have a headache" says what
        # they told the clinician.
        for key, (english, _, _) in emergency_speech.PHRASES.items():
            assert english.startswith(("I ", "My ", "The ")), f"{key}: {english!r}"

    def test_nothing_says_paining_me(self):
        # Not standard English, and the form a translator handles worst.
        for key, (english, _, _) in emergency_speech.PHRASES.items():
            assert "paining" not in english.lower(), key


class TestUnreviewedTwiIsNotSpeakable:
    """
    The gate. Machine translation of single clinical words is visibly
    unreliable: "Nose" came back as "Nose", and "Waist" as "Waist a ɔyɛ
    ɔkwasea". Reading either to a clinician during triage is worse than
    reading English.
    """

    def test_a_phrase_with_no_reviewer_is_not_speakable(self):
        # The gate is per phrase, like a clip's own reviewer, so signing off
        # "Ti" for "Head" does not also release "Waist a ɔyɛ ɔkwasea".
        assert all(
            not phrase["tw_reviewed"]
            for phrase in emergency_speech.all_spoken_phrases()
            if not phrase["reviewed_by"].strip()
        )

    def test_a_reviewer_releases_only_their_own_phrase(self, monkeypatch):
        monkeypatch.setitem(
            emergency_speech.PHRASES, "HEAD", ("Head", "Ti", "A Twi Speaker")
        )

        released = emergency_speech.spoken_phrase("HEAD")
        held = emergency_speech.spoken_phrase("HEART")

        assert released["tw_reviewed"] is True
        assert held["tw_reviewed"] is False

    def test_review_cannot_release_a_phrase_that_kept_its_english(self, monkeypatch):
        # A second pair of eyes on the reviewer. Signing off "Nose" for "Nose"
        # is a mistake, and the cheap automatic check still catches it.
        monkeypatch.setitem(
            emergency_speech.PHRASES, "NOSE", ("Nose", "Nose", "A Twi Speaker")
        )

        assert emergency_speech.spoken_phrase("NOSE")["tw_reviewed"] is False

    def test_a_translation_that_kept_the_english_word_is_flagged(self):
        assert emergency_speech._looks_untranslated("Nose", "Nose")
        assert emergency_speech._looks_untranslated("Throat", "Throat na ɔkyerɛwee")

    def test_a_real_translation_is_not_flagged(self):
        assert not emergency_speech._looks_untranslated("Head", "Ti")
        assert not emergency_speech._looks_untranslated("Heart", "Akoma")

    def test_empty_twi_is_flagged(self):
        assert emergency_speech._looks_untranslated("Head", "")
        assert emergency_speech._looks_untranslated("Head", "   ")

    def test_short_words_do_not_trigger_a_false_flag(self):
        # "Ear" and "Eye" are three letters. A substring check that counted
        # them would flag any Twi that happened to contain those letters.
        assert not emergency_speech._looks_untranslated("Ear", "Aso")
        assert not emergency_speech._looks_untranslated("Eye", "Aniwa")

    def test_two_phrases_must_not_say_the_same_thing(self):
        # The dangerous failure, and a real one: "I have a little pain" and "I
        # have moderate pain" both came back as "Mete yea kakra". A clinician
        # hearing the same sentence for two different pain levels has no way to
        # know which the patient meant, so both sides are withheld.
        collided = {
            phrase["key"]
            for phrase in emergency_speech.all_spoken_phrases()
            if phrase["tw_collides"]
        }

        assert {"PAIN_2", "PAIN_3"} <= collided
        assert all(
            not emergency_speech.spoken_phrase(key)["tw_reviewed"] for key in collided
        )

    def test_a_collision_is_not_reported_for_an_empty_translation(self):
        # Every unfilled phrase would otherwise collide with every other one.
        assert not emergency_speech._collides_with_another_phrase("HEAD", "")

    def test_the_known_failures_are_all_caught(self):
        flagged = {
            phrase["key"]
            for phrase in emergency_speech.all_spoken_phrases()
            if phrase["tw_looks_untranslated"]
        }

        # Nothing should fail this any more: these were all bare nouns, and
        # they are sentences now. The check stays because the failure was not
        # theoretical and costs nothing to keep.
        assert flagged == set(), flagged


@pytest.mark.django_db
class TestTheEndpoint:
    def test_it_serves_every_phrase(self, api_client):
        response = api_client.get(reverse("clip-emergency-speech"))

        assert response.status_code == 200
        assert len(response.json()["phrases"]) == len(emergency_speech.PHRASES)

    def test_each_phrase_carries_both_languages_and_its_status(self, api_client):
        phrases = api_client.get(reverse("clip-emergency-speech")).json()["phrases"]
        head = next(p for p in phrases if p["key"] == "HEAD")

        assert head["en"] == "I have a headache"
        assert head["tw"] == "Me ti pae me"
        assert "tw_reviewed" in head

    def test_it_reports_what_is_pending_review(self, api_client):
        # So the interface can say so once, quietly, rather than leaving a
        # clinician wondering why some taps are read in English.
        body = api_client.get(reverse("clip-emergency-speech")).json()

        assert "NOSE" in body["pending_review"]

    def test_unreviewed_twi_is_still_served_so_it_can_be_corrected(self, api_client):
        # Withholding a bad translation would make it harder to fix rather
        # than safer. It is served, flagged, and not spoken. PAIN_2 is the
        # clearest case: its Twi is the same as PAIN_3's.
        phrases = api_client.get(reverse("clip-emergency-speech")).json()["phrases"]
        pain = next(p for p in phrases if p["key"] == "PAIN_2")

        assert pain["tw"] == "Mete yea kakra"
        assert pain["tw_collides"] is True
        assert pain["tw_reviewed"] is False

    def test_it_needs_no_database_row(self, api_client):
        # The whole point: emergency mode's vocabulary is a constant, so this
        # answers with an empty clip library and, therefore, offline.
        assert api_client.get(reverse("clip-emergency-speech")).status_code == 200
