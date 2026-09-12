"""
Tests for refusing a sentence that would change meaning, ADR 033.

The failure these prevent is the worst one the system can produce: a patient
shown a sentence that means something other than what the doctor typed, with
nothing on screen to say so. The doctor does not read GhSL and the patient
never saw the typed words, so neither of them can catch it.

Most of these are about refusing, not rendering.
"""

import pytest

from clips.safety import BLOCKING, SAFE_TO_DROP, TokenRisk, classify
from clips.services import resolve_sign_sequence


class TestClassification:
    def test_negation_blocks(self):
        # The case that started this. "no pain" losing "no" means "pain".
        for word in ["no", "not", "never", "without", "cannot", "stop"]:
            assert classify(word) == TokenRisk.BLOCKING, word

    def test_dosage_words_block(self):
        # "Take two tablets" losing "two" is a dosing error, not a typo.
        for word in ["one", "two", "three", "half", "double"]:
            assert classify(word) == TokenRisk.BLOCKING, word

    def test_digits_block_however_they_are_written(self):
        # A dose, a count of days, a temperature. Any number is a quantity.
        for token in ["2", "10", "37"]:
            assert classify(token) == TokenRisk.BLOCKING, token

    def test_frequency_and_timing_block(self):
        # "Take after food" and "take before food" are different
        # instructions, and losing either word leaves neither.
        for word in ["twice", "daily", "before", "after", "every"]:
            assert classify(word) == TokenRisk.BLOCKING, word

    def test_severity_blocks(self):
        # Severity is what a doctor uses to decide urgency, so losing it turns
        # a description into a bare symptom.
        for word in ["severe", "mild", "worse", "better", "very"]:
            assert classify(word) == TokenRisk.BLOCKING, word

    def test_articles_and_copulas_are_droppable(self):
        # GhSL has no articles and no copula. "Do you have pain" is signed
        # roughly PAIN YOU, so leaving these out is more natural, not broken.
        for word in ["the", "a", "is", "are", "do", "does"]:
            assert classify(word) == TokenRisk.DROPPABLE, word

    def test_prepositions_are_not_droppable(self):
        # "Pain in chest" and "pain on chest" are different clinical
        # statements, so a preposition is not noise.
        for word in ["in", "on", "at", "with"]:
            assert classify(word) != TokenRisk.DROPPABLE, word

    def test_deictics_are_not_droppable(self):
        # "Does it hurt here" depends entirely on "here".
        for word in ["here", "this", "that"]:
            assert classify(word) != TokenRisk.DROPPABLE, word

    def test_clinical_words_are_content(self):
        for word in ["pain", "head", "fever", "vomit", "medicine"]:
            assert classify(word) == TokenRisk.CONTENT, word

    def test_the_two_lists_never_overlap(self):
        # A word cannot be both safe to lose and unsafe to lose.
        assert BLOCKING.isdisjoint(SAFE_TO_DROP)


@pytest.mark.django_db
class TestRefusingUnsafeSentences:
    def test_a_missing_negation_stops_the_sentence(self, make_clip, alphabet):
        # The live bug this closes. Before, "no pain" and "pain" produced the
        # same video, and the patient answered the opposite question.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("no pain")

        assert sequence.blocking_tokens == ["no"]
        assert sequence.is_safe_to_show is False

    def test_a_missing_negation_is_never_fingerspelled(self, make_clip, alphabet):
        # Spelling "no" to a patient who may not be print literate is not a
        # rendering of "no", and assuming they followed it is the same risk in
        # a different shape.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("no pain")

        assert "no" not in sequence.fingerspelled_tokens

    def test_a_missing_dose_stops_the_sentence(self, make_clip, alphabet):
        make_clip("TABLET")

        sequence = resolve_sign_sequence("take two tablet")

        assert "two" in sequence.blocking_tokens
        assert sequence.is_safe_to_show is False

    def test_a_signed_negation_is_fine(self, make_clip, alphabet):
        # The refusal is about absence, not about the word. Once "no" is
        # filmed, the sentence is shown normally.
        make_clip("NO")
        make_clip("PAIN")

        sequence = resolve_sign_sequence("no pain")

        assert sequence.blocking_tokens == []
        assert sequence.is_safe_to_show is True
        assert sequence.back_translation == ["NO", "PAIN"]

    def test_a_missing_content_word_stops_the_sentence(self, make_clip):
        # Without an alphabet it cannot even be spelled. A patient shown a
        # fragment may guess at the rest, which ADR 022 already refuses for a
        # partial answer grid.
        make_clip("HEAD")

        sequence = resolve_sign_sequence("head vomit")

        assert sequence.unavailable_tokens == ["vomit"]
        assert sequence.is_safe_to_show is False

    def test_an_empty_sentence_is_not_shown(self):
        assert resolve_sign_sequence("the a is").is_safe_to_show is False


@pytest.mark.django_db
class TestDroppingSafely:
    def test_articles_are_left_out_rather_than_spelled(self, make_clip, alphabet):
        # Spelling "the" letter by letter would waste the patient's attention
        # on a word GhSL does not use.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("the pain")

        assert sequence.omitted_tokens == ["the"]
        assert sequence.back_translation == ["PAIN"]

    def test_a_sentence_of_signs_and_dropped_words_is_safe(self, make_clip, alphabet):
        make_clip("PAIN")
        make_clip("HEAD")

        sequence = resolve_sign_sequence("do you have the pain in head")

        assert sequence.is_safe_to_show is True

    def test_dropped_words_are_still_reported(self, make_clip, alphabet):
        # The doctor is told what was left out even though it was safe, so
        # nothing about the rendering is hidden from them.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("is the pain")

        assert set(sequence.omitted_tokens) == {"is", "the"}


@pytest.mark.django_db
class TestConfirmation:
    def test_a_fully_signed_sentence_needs_no_confirmation(self, make_clip, alphabet):
        # Friction where there is no risk would train the doctor to tap
        # through the confirmation without reading it.
        make_clip("HEAD")
        make_clip("PAIN")

        sequence = resolve_sign_sequence("head pain")

        assert sequence.is_safe_to_show is True
        assert sequence.needs_confirmation is False

    def test_a_sentence_with_dropped_words_is_confirmed(self, make_clip, alphabet):
        make_clip("PAIN")

        sequence = resolve_sign_sequence("the pain")

        assert sequence.needs_confirmation is True

    def test_a_sentence_with_spelled_words_is_confirmed(self, make_clip, alphabet):
        # A spelled clinical term may not be understood, so the doctor should
        # see that it was spelled rather than signed.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("pain nausea")

        assert sequence.fingerspelled_tokens == ["nausea"]
        assert sequence.needs_confirmation is True

    def test_an_unsafe_sentence_is_not_offered_for_confirmation(
        self, make_clip, alphabet
    ):
        # There is nothing to confirm. It cannot be shown at all, so offering
        # a button would invite someone to override the refusal.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("no pain")

        assert sequence.needs_confirmation is False


@pytest.mark.django_db
class TestBackTranslation:
    def test_reports_exactly_what_the_patient_will_see(self, make_clip, alphabet):
        # Showing the doctor their own typed text would prove nothing. The
        # point is to surface the difference between what was typed and what
        # will actually be signed.
        make_clip("HEAD")
        make_clip("PAIN")

        sequence = resolve_sign_sequence("is the head pain")

        assert sequence.back_translation == ["HEAD", "PAIN"]

    def test_words_outside_the_droppable_list_are_spelled_not_dropped(
        self, make_clip, alphabet
    ):
        # "you" and "have" are not on the droppable list, so they are spelled
        # rather than silently removed. That is the conservative default:
        # spelling is noise the doctor can see and rephrase around, whereas
        # dropping a word they did not expect to lose is invisible.
        #
        # Both are arguably safe to drop, since GhSL expresses "you" by
        # pointing and has no "have". Whether to add them is a clinical
        # judgment for the team's Deaf member and the GhSL consultant, not one
        # to make here. See ADR 033.
        make_clip("PAIN")

        sequence = resolve_sign_sequence("you have pain")

        assert "you" in sequence.fingerspelled_tokens
        assert "have" in sequence.fingerspelled_tokens
        assert sequence.is_safe_to_show is True

    def test_includes_spelled_letters_in_order(self, make_clip, alphabet):
        make_clip("PAIN")

        sequence = resolve_sign_sequence("pain ab")

        assert sequence.back_translation == ["PAIN", "A", "B"]


@pytest.mark.django_db
class TestReviewedAliases:
    """
    ADR 034. A doctor writes "how are you doing" and the library has FEELING.
    A consultant records that they are interchangeable, rather than the system
    guessing at similarity.
    """

    def test_a_reviewed_alias_reaches_the_sign(self, make_clip, alphabet):
        from clips.models import ClipAlias

        feeling = make_clip("FEELING")
        ClipAlias.objects.create(
            clip=feeling, term="doing", reviewed_by="Ama Mensah, GhSL"
        )

        sequence = resolve_sign_sequence("doing")

        assert sequence.back_translation == ["FEELING"]
        assert sequence.is_safe_to_show is True

    def test_an_unreviewed_alias_is_ignored(self, make_clip, alphabet):
        # An alias nobody signed off is nobody's clinical judgment. It would be
        # a guess wearing the appearance of a reviewed equivalence, which is
        # worse than no match at all.
        from clips.models import ClipAlias

        feeling = make_clip("FEELING")
        ClipAlias.objects.create(clip=feeling, term="doing")

        sequence = resolve_sign_sequence("doing")

        assert sequence.back_translation != ["FEELING"]

    def test_an_alias_cannot_route_around_clip_review(self, make_clip, alphabet):
        # Otherwise adding an alias to unapproved footage would show a patient
        # a sign no consultant had cleared.
        from clips.models import ClipAlias

        feeling = make_clip("FEELING", approved=False)
        ClipAlias.objects.create(
            clip=feeling, term="doing", reviewed_by="Ama Mensah, GhSL"
        )

        sequence = resolve_sign_sequence("doing")

        assert sequence.back_translation != ["FEELING"]

    def test_an_alias_cannot_route_around_missing_footage(self, make_clip, alphabet):
        from clips.models import ClipAlias

        feeling = make_clip("FEELING", filmed=False)
        ClipAlias.objects.create(
            clip=feeling, term="doing", reviewed_by="Ama Mensah, GhSL"
        )

        sequence = resolve_sign_sequence("doing")

        assert sequence.back_translation != ["FEELING"]

    def test_the_term_is_normalized_like_a_gloss(self, make_clip, alphabet):
        from clips.models import ClipAlias

        feeling = make_clip("FEELING")
        alias = ClipAlias.objects.create(
            clip=feeling, term="  Doing  ", reviewed_by="Ama Mensah, GhSL"
        )

        alias.refresh_from_db()
        assert alias.term == "DOING"
        assert resolve_sign_sequence("DOING").back_translation == ["FEELING"]

    def test_one_word_cannot_mean_two_different_signs(self, make_clip):
        # An ambiguous alias would resolve differently depending on query
        # order, so the same sentence could sign differently on two devices.
        from django.db import IntegrityError

        from clips.models import ClipAlias

        ClipAlias.objects.create(
            clip=make_clip("FEELING"), term="doing", reviewed_by="Ama, GhSL"
        )

        with pytest.raises(IntegrityError):
            ClipAlias.objects.create(
                clip=make_clip("WORKING"), term="doing", reviewed_by="Ama, GhSL"
            )

    def test_a_real_gloss_always_wins_over_an_alias(self, make_clip, alphabet):
        # If the doctor's exact word is filmed, that sign is used. An alias is
        # a fallback, never a substitution for something that already matches.
        from clips.models import ClipAlias

        make_clip("DOING")
        ClipAlias.objects.create(
            clip=make_clip("FEELING"), term="doing", reviewed_by="Ama, GhSL"
        )

        assert resolve_sign_sequence("doing").back_translation == ["DOING"]

    def test_deleting_a_clip_deletes_its_aliases(self, make_clip):
        # An alias pointing at nothing would be an equivalence to a sign that
        # no longer exists.
        from clips.models import ClipAlias

        feeling = make_clip("FEELING")
        ClipAlias.objects.create(clip=feeling, term="doing", reviewed_by="Ama, GhSL")

        feeling.delete()

        assert not ClipAlias.objects.exists()


class TestContractions:
    """
    ADR 037. "don't" split into "don" and "t", so the negation disappeared
    before anything could classify it, and the sentence passed the ADR 033
    gate. "do not take the medicine" was refused while "don't take the
    medicine" was not, and the second would have played as TAKE MEDICINE.
    """

    def test_a_contracted_negation_is_still_a_negation(self):
        from clips.services import tokenize

        assert tokenize("don't take it") == ["do", "not", "take", "it"]

    def test_both_ways_of_writing_it_tokenize_the_same(self):
        from clips.services import tokenize

        assert tokenize("don't take") == tokenize("do not take")

    def test_cant_becomes_cannot(self):
        from clips.services import tokenize

        assert tokenize("you can't eat") == ["you", "cannot", "eat"]

    def test_a_curly_apostrophe_is_the_same_word(self):
        # Phone keyboards and word processors produce these, and a doctor
        # pasting from either would otherwise bypass the negation check.
        from clips.services import tokenize

        assert tokenize("don’t take") == ["do", "not", "take"]

    def test_a_possessive_loses_its_affix_rather_than_the_word(self):
        # GhSL does not mark possession with an affix, and leaving the 's in
        # place would make the token unspellable, since there is no letter clip
        # for an apostrophe, refusing the sentence over punctuation.
        from clips.services import tokenize

        assert tokenize("the patient's head") == ["the", "patient", "head"]

    def test_an_unknown_apostrophe_word_keeps_its_letters(self):
        from clips.services import tokenize

        assert tokenize("o'clock") == ["oclock"]


@pytest.mark.django_db
class TestContractedNegationIsRefused:
    def test_a_contracted_negation_stops_the_sentence(self, make_clip, alphabet):
        # The failure this closes. Both TAKE and MEDICINE filmed, so without
        # the fix the sentence would have played as TAKE MEDICINE and passed
        # the gate: the opposite instruction, silently.
        make_clip("TAKE")
        make_clip("MEDICINE")

        sequence = resolve_sign_sequence("don't take medicine")

        assert sequence.blocking_tokens == ["not"]
        assert sequence.is_safe_to_show is False

    def test_the_uncontracted_form_behaves_identically(self, make_clip, alphabet):
        make_clip("TAKE")
        make_clip("MEDICINE")

        contracted = resolve_sign_sequence("don't take medicine")
        spelled_out = resolve_sign_sequence("do not take medicine")

        assert contracted.blocking_tokens == spelled_out.blocking_tokens
        assert contracted.is_safe_to_show == spelled_out.is_safe_to_show

    def test_a_filmed_negation_makes_the_contracted_form_showable(
        self, make_clip, alphabet
    ):
        make_clip("NOT")
        make_clip("TAKE")
        make_clip("MEDICINE")
        make_clip("DO")

        sequence = resolve_sign_sequence("don't take medicine")

        assert sequence.is_safe_to_show is True
        assert "NOT" in sequence.back_translation


@pytest.mark.django_db
class TestPhraseClips:
    """
    ADR 038. A whole phrase filmed as one clip is preferred over stitching the
    same words, because sign languages have their own grammar: word signs
    played in English order are closer to signed English than to GhSL, and a
    filmed phrase carries facial expression and rhythm that separate word clips
    cannot.
    """

    def test_a_phrase_clip_is_preferred_over_its_individual_words(
        self, make_clip, alphabet
    ):
        from clips.models import ClipKind

        # Every word is filmed, and so is the whole phrase.
        for word in ["WHAT", "IS", "YOUR", "NAME"]:
            make_clip(word)
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE, duration_ms=2500)

        sequence = resolve_sign_sequence("what is your name")

        assert sequence.back_translation == ["WHAT_IS_YOUR_NAME"]
        assert [s.match for s in sequence.segments] == ["phrase"]

    def test_the_words_are_used_when_no_phrase_clip_exists(self, make_clip, alphabet):
        for word in ["WHAT", "IS", "YOUR", "NAME"]:
            make_clip(word)

        sequence = resolve_sign_sequence("what is your name")

        assert sequence.back_translation == ["WHAT", "IS", "YOUR", "NAME"]

    def test_a_contracted_sentence_reaches_the_phrase_clip(self, make_clip, alphabet):
        # "what's your name" expands to "what is your name" before matching,
        # so the doctor's natural phrasing finds the filmed phrase. ADR 037
        # and ADR 038 together.
        from clips.models import ClipKind

        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("what's your name?")

        assert sequence.back_translation == ["WHAT_IS_YOUR_NAME"]

    def test_the_longest_phrase_wins(self, make_clip, alphabet):
        from clips.models import ClipKind

        make_clip("YOUR_NAME", kind=ClipKind.PHRASE)
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("what is your name")

        assert sequence.back_translation == ["WHAT_IS_YOUR_NAME"]

    def test_a_phrase_mixes_with_words_around_it(self, make_clip, alphabet):
        from clips.models import ClipKind

        make_clip("YOUR_NAME", kind=ClipKind.PHRASE)
        make_clip("TELL")

        sequence = resolve_sign_sequence("tell your name")

        assert sequence.back_translation == ["TELL", "YOUR_NAME"]

    def test_a_phrase_covering_a_negation_is_safe_to_show(self, make_clip, alphabet):
        # The negation is signed, as part of the phrase, so ADR 033 has nothing
        # to refuse. A phrase clip is the best way to sign a negation, since a
        # native signer marks it with expression as well as a sign.
        from clips.models import ClipKind

        make_clip("DO_NOT_TAKE_MEDICINE", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("do not take medicine")

        assert sequence.blocking_tokens == []
        assert sequence.is_safe_to_show is True

    def test_an_unreviewed_phrase_is_not_used(self, make_clip, alphabet):
        from clips.models import ClipKind

        for word in ["WHAT", "IS", "YOUR", "NAME"]:
            make_clip(word)
        make_clip("WHAT_IS_YOUR_NAME", kind=ClipKind.PHRASE, approved=False)

        sequence = resolve_sign_sequence("what is your name")

        assert sequence.back_translation == ["WHAT", "IS", "YOUR", "NAME"]

    def test_an_unfilmed_phrase_is_not_used(self, make_clip, alphabet):
        from clips.models import ClipKind

        make_clip("TELL")
        make_clip("YOUR_NAME", kind=ClipKind.PHRASE, filmed=False)
        make_clip("YOUR")
        make_clip("NAME")

        sequence = resolve_sign_sequence("tell your name")

        assert sequence.back_translation == ["TELL", "YOUR", "NAME"]

    def test_a_phrase_is_never_matched_as_a_single_word(self, make_clip, alphabet):
        # A one token gloss is a word sign. Treating it as a phrase would make
        # the phrase lookup shadow the ordinary one for no reason.
        from clips.models import ClipKind

        make_clip("PAIN", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("pain")

        assert sequence.back_translation != ["PAIN"]


@pytest.mark.django_db
class TestGlossNormalization:
    """
    ADR 039. A phrase typed in the admin with spaces, "how are you doing",
    saved cleanly, showed as approved, and could never match anything, because
    the resolver looks for one underscored form. That is a worse failure than a
    rejected form: the row looks finished and silently does nothing.
    """

    def test_a_phrase_typed_with_spaces_is_stored_canonically(self, make_clip):
        from clips.models import ClipKind

        clip = make_clip("how are you doing", kind=ClipKind.PHRASE)

        clip.refresh_from_db()
        assert clip.gloss == "HOW_ARE_YOU_DOING"

    def test_a_phrase_typed_with_spaces_matches(self, make_clip, alphabet):
        # The failure this closes, end to end.
        from clips.models import ClipKind

        make_clip("how are you doing", kind=ClipKind.PHRASE)

        sequence = resolve_sign_sequence("how are you doing")

        assert sequence.back_translation == ["HOW_ARE_YOU_DOING"]
        assert sequence.is_safe_to_show is True

    def test_hyphens_and_underscores_mean_the_same_clip(self, make_clip):
        from clips.models import ClipKind

        hyphenated = make_clip("cannot-breathe", kind=ClipKind.PHRASE)

        hyphenated.refresh_from_db()
        assert hyphenated.gloss == "CANNOT_BREATHE"

    def test_repeated_separators_collapse(self, make_clip):
        from clips.models import ClipKind

        clip = make_clip("how  are__you", kind=ClipKind.PHRASE)

        clip.refresh_from_db()
        assert clip.gloss == "HOW_ARE_YOU"

    def test_stray_separators_at_the_edges_are_dropped(self, make_clip):
        from clips.models import ClipKind

        clip = make_clip(" _your name_ ", kind=ClipKind.PHRASE)

        clip.refresh_from_db()
        assert clip.gloss == "YOUR_NAME"

    def test_an_ordinary_word_is_unaffected(self, make_clip):
        clip = make_clip("head")

        clip.refresh_from_db()
        assert clip.gloss == "HEAD"

    def test_a_filename_with_spaces_imports_canonically(self, tmp_path):
        # Phones and cameras produce filenames with spaces, and the clip
        # should not depend on the doctor renaming them by hand.
        from clips.importing import import_footage
        from clips.models import ClipKind, SignClip

        folder = tmp_path / "footage"
        folder.mkdir()
        (folder / "how are you doing.mp4").write_bytes(b"video")

        import_footage(folder)

        clip = SignClip.objects.get(gloss="HOW_ARE_YOU_DOING")
        # Multi word, so it is guessed as a phrase rather than a word sign.
        assert clip.kind == ClipKind.PHRASE
