"""
A plural or "-s" form of a word reaches the sign for the word.

GhSL, like most sign languages, does not mark plural on a noun or the third
person on a verb: GO is GOES and BRING is BRINGS. The clip library is filmed once
per sign, so typing or saying "brings" must show the BRING clip and not spell the
word out, or refuse the sentence, for want of a clip named "brings".

And the other half, which is the one that matters for a patient: nothing that
carries clinical meaning is ever rewritten into something else.
"""

import pytest

from clips.inflection import base_form, blocking_reading, readings
from clips.models import ClipKind
from clips.services import resolve_sign_sequence


class TestReadings:
    """What a word may be the plural or "-s" form of."""

    @pytest.mark.parametrize(
        ("typed", "reads_as"),
        [
            ("brings", "bring"),
            ("goes", "go"),
            ("pains", "pain"),
            ("tablets", "tablet"),
            ("medicines", "medicine"),
            ("watches", "watch"),
            ("boxes", "box"),
            ("allergies", "allergy"),
            ("eyes", "eye"),
            ("days", "day"),
            ("legs", "leg"),
            ("knives", "knife"),
            ("children", "child"),
            ("women", "woman"),
            ("feet", "foot"),
            ("has", "have"),
        ],
    )
    def test_offers_the_word_it_is_a_form_of(self, typed, reads_as):
        assert reads_as in readings(typed)

    def test_the_likeliest_reading_comes_first(self):
        assert readings("goes")[0] == "go"
        assert readings("horses")[0] == "horse"
        assert readings("watches")[0] == "watch"

    @pytest.mark.parametrize(
        "word",
        [
            "class",  # ends in ss
            "virus",  # ends in us
            "diagnosis",  # ends in is
            "arthritis",
            "nervous",
            "news",  # not "new"
            "series",
            "diabetes",
            "always",
            "sometimes",
            "gas",  # too short to be a plural
            "bus",
            "yes",
            "his",
            "this",
            "is",
            "us",
            "as",
        ],
    )
    def test_leaves_a_word_that_only_looks_like_a_plural(self, word):
        assert readings(word) == []

    def test_never_reduces_to_a_stem_of_one_or_two_letters(self):
        # "toes" is not "to", and "ties" is not "ti".
        assert "to" not in readings("toes")
        assert "toe" in readings("toes")

    def test_leaves_a_word_that_is_already_singular(self):
        assert readings("bring") == []
        assert readings("head") == []

    def test_leaves_twi_alone(self):
        # These endings mean nothing in Twi, and a Twi word ending in "s" is
        # not a plural.
        assert readings("mepɛs") == []

    def test_leaves_digits_alone(self):
        assert readings("2s") == []


class TestNothingThatCarriesMeaningIsRewritten:
    """The safety classifier's words are never turned into another word."""

    @pytest.mark.parametrize(
        "word",
        ["times", "twice", "once", "every", "morning", "less", "does", "was", "is"],
    )
    def test_a_word_the_classifier_knows_has_no_readings(self, word):
        # "times" reading as "time" would turn "three times a day" into a
        # sentence with no frequency in it.
        assert readings(word) == []

    def test_a_number_has_no_readings(self):
        assert readings("2s") == []
        assert readings("10s") == []


class TestBlockingReadings:
    """The plural of a word that stops a sentence stops it too."""

    @pytest.mark.parametrize(
        "word",
        ["stops", "avoids", "refuses", "doubles", "halves", "nights", "mornings"],
    )
    def test_is_the_blocking_word_it_is_a_form_of(self, word):
        assert blocking_reading(word)

    @pytest.mark.parametrize("word", ["brings", "pains", "tablets", "goes", "head"])
    def test_an_ordinary_word_is_not(self, word):
        assert not blocking_reading(word)


class TestBaseForm:
    def test_reduces_a_form_to_the_word_it_is_a_form_of(self):
        assert base_form("names") == "name"
        assert base_form("goes") == "go"

    def test_leaves_the_rest_as_it_is(self):
        assert base_form("name") == "name"
        assert base_form("times") == "times"
        assert base_form("not") == "not"


@pytest.mark.django_db
class TestResolvingAPluralToTheSingularClip:
    def test_a_plural_reaches_the_singular_clip(self, make_clip, alphabet):
        make_clip("BRING")

        sequence = resolve_sign_sequence("brings")

        segment = sequence.segments[0]
        assert segment.match == "gloss"
        assert [clip.gloss for clip in segment.clips] == ["BRING"]

    def test_go_and_goes_are_the_same_sign(self, make_clip, alphabet):
        make_clip("GO")

        assert [
            clip.gloss
            for text in ("go", "goes")
            for clip in resolve_sign_sequence(text).segments[0].clips
        ] == ["GO", "GO"]

    def test_the_segment_still_reports_the_word_that_was_typed(
        self, make_clip, alphabet
    ):
        # The doctor reads back what will be shown: the typed word, and the
        # gloss the patient will see for it.
        make_clip("BRING")

        sequence = resolve_sign_sequence("he brings medicine")

        brings = next(s for s in sequence.segments if s.token == "brings")
        assert brings.clips[0].gloss == "BRING"
        assert "BRING" in sequence.back_translation

    def test_it_is_not_spelled_out(self, make_clip, alphabet):
        make_clip("BRING")

        sequence = resolve_sign_sequence("brings")

        assert sequence.fingerspelled_tokens == []
        assert sequence.unavailable_tokens == []
        assert sequence.is_safe_to_show

    def test_an_exact_clip_beats_the_singular(self, make_clip, alphabet):
        # A clip for the plural itself, where a sign really differs, is used.
        make_clip("BRING")
        make_clip("BRINGS")

        assert resolve_sign_sequence("brings").segments[0].clips[0].gloss == "BRINGS"

    def test_a_reviewed_alias_beats_the_singular(self, make_clip, alphabet):
        from clips.models import ClipAlias

        make_clip("BRING")
        carry = make_clip("CARRY")
        ClipAlias.objects.create(clip=carry, term="brings", reviewed_by="A. Consultant")

        assert resolve_sign_sequence("brings").segments[0].clips[0].gloss == "CARRY"

    def test_an_unreviewed_singular_clip_is_still_never_used(self, make_clip, alphabet):
        # The single most important safety property in the resolver, and it
        # holds for a form reached by reading as much as for a typed one.
        make_clip("BRING", approved=False)

        sequence = resolve_sign_sequence("brings")

        assert sequence.segments[0].match == "fingerspell"

    def test_an_unfilmed_singular_clip_is_still_never_used(self, make_clip, alphabet):
        make_clip("BRING", filmed=False)

        assert resolve_sign_sequence("brings").segments[0].match == "fingerspell"

    def test_no_clip_at_all_falls_back_as_before(self, alphabet):
        assert resolve_sign_sequence("brings").segments[0].match == "fingerspell"

    def test_only_a_word_clip_is_reached_not_a_letter_or_a_phrase(
        self, make_clip, alphabet
    ):
        make_clip("BRING", kind=ClipKind.PHRASE)

        assert resolve_sign_sequence("brings").segments[0].match == "fingerspell"

    def test_reaches_the_first_reading_that_has_a_clip(self, make_clip, alphabet):
        make_clip("WATCH")

        assert resolve_sign_sequence("watches").segments[0].clips[0].gloss == "WATCH"

    def test_it_costs_no_extra_query(
        self, make_clip, alphabet, django_assert_num_queries
    ):
        # The readings are fetched in the same query as the words.
        make_clip("BRING")

        with django_assert_num_queries(4):
            resolve_sign_sequence("brings goes pains tablets medicines")


@pytest.mark.django_db
class TestNoMeaningIsChangedByIt:
    def test_times_is_not_read_as_time(self, make_clip, alphabet):
        # "Three times a day" must not lose its frequency to a clip for TIME.
        make_clip("TIME")

        sequence = resolve_sign_sequence("times")

        assert sequence.segments[0].match == "blocked"
        assert not sequence.is_safe_to_show

    def test_the_plural_of_a_blocking_word_without_a_clip_stops_the_sentence(
        self, make_clip, alphabet
    ):
        make_clip("MEDICINE")

        sequence = resolve_sign_sequence("avoids medicine")

        assert sequence.segments[0].match == "blocked"
        assert sequence.blocking_tokens == ["avoids"]
        assert not sequence.is_safe_to_show

    def test_it_is_not_fingerspelled(self, alphabet):
        # A negation or a quantity spelled to a patient who may not read is not
        # a rendering of it.
        for word in ("stops", "halves", "doubles"):
            assert resolve_sign_sequence(word).segments[0].match == "blocked"

    def test_the_plural_of_a_blocking_word_uses_its_clip_when_there_is_one(
        self, make_clip, alphabet
    ):
        # The word is signable, so nothing is missing: STOP is shown for "stops".
        make_clip("STOP")

        sequence = resolve_sign_sequence("stops")

        assert sequence.segments[0].match == "gloss"
        assert sequence.segments[0].clips[0].gloss == "STOP"
        assert sequence.is_safe_to_show

    def test_an_ordinary_missing_word_is_still_fingerspelled(self, alphabet):
        assert resolve_sign_sequence("tablets").segments[0].match == "fingerspell"

    def test_news_is_not_new(self, make_clip, alphabet):
        make_clip("NEW")

        assert resolve_sign_sequence("news").segments[0].match == "fingerspell"

    def test_a_negation_still_stops_the_sentence(self, make_clip, alphabet):
        make_clip("BRING")

        sequence = resolve_sign_sequence("do not brings")

        assert "not" in sequence.blocking_tokens
        assert not sequence.is_safe_to_show

    def test_a_droppable_word_is_still_dropped(self, make_clip, alphabet):
        make_clip("BRING")

        sequence = resolve_sign_sequence("the patient brings")

        assert [s.token for s in sequence.segments if s.match == "omitted"] == ["the"]


@pytest.mark.django_db
class TestPhrases:
    def test_a_phrase_is_reached_through_the_plural_of_one_of_its_words(
        self, make_clip, alphabet
    ):
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("what is your names")

        assert sequence.segments[0].match == "phrase"
        assert sequence.segments[0].token == "what is your names"

    def test_the_exact_phrase_still_matches(self, make_clip, alphabet):
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE)

        assert resolve_sign_sequence("what is your name").segments[0].match == "phrase"

    def test_a_phrase_with_a_plural_in_its_own_gloss_matches_the_singular(
        self, make_clip, alphabet
    ):
        make_clip("SHOW_YOUR_HANDS", kind=ClipKind.PHRASE)

        assert resolve_sign_sequence("show your hand").segments[0].match == "phrase"

    def test_a_phrase_does_not_match_a_different_sentence(self, make_clip, alphabet):
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE)

        assert resolve_sign_sequence("what is your age").segments[0].match != "phrase"
