"""
Tests for the clinical question bank, SRS FR 2.4 to FR 2.7.

A question carries no filmed clip of its own. It is stitched from the word
clips already in the library, exactly as a caption is, so adding a question
costs no new filming. See ADR 021.

Two properties are called out explicitly by the SRS and the engineering
standards, and both are tested directly: deleting a question must delete its
answer options, and `/api/questions/` must return options nested inside each
question, because the frontend depends on that exact shape.
"""

from io import StringIO

import pytest
from django.core.management import call_command
from django.db import IntegrityError
from django.urls import reverse

from questions.models import AnswerOption, ClinicalQuestion, QuestionType
from questions.services import NOD_INSTRUCTION_GLOSS, resolve_question_sequences


@pytest.fixture
def make_question(db):
    def _make_question(
        english_text="Where does it hurt?",
        *,
        question_type=QuestionType.SELECTION,
        is_active=True,
        category="intake",
        order=0,
    ):
        return ClinicalQuestion.objects.create(
            english_text=english_text,
            question_type=question_type,
            is_active=is_active,
            category=category,
            order=order,
        )

    return _make_question


@pytest.fixture
def make_option(db, make_clip):
    """
    Add an answer option to a question.

    Positions are assigned automatically by default, because grid positions are
    unique per question and a test about cascade deletion should not have to
    think about layout to avoid a constraint error.
    """

    def _make_option(question, english_text="Head", *, gloss="HEAD", order=None):
        return AnswerOption.objects.create(
            question=question,
            english_text=english_text,
            clip=make_clip(gloss),
            order=question.options.count() if order is None else order,
        )

    return _make_option


@pytest.mark.django_db
class TestClinicalQuestionModel:
    def test_active_questions_are_in_the_bank(self, make_question):
        make_question()

        assert ClinicalQuestion.objects.active().count() == 1

    def test_retired_question_leaves_the_bank(self, make_question):
        make_question(is_active=False)

        assert not ClinicalQuestion.objects.active().exists()

    def test_a_question_needs_no_clip_of_its_own(self, make_question):
        # ADR 021. This is what makes adding a question free in filming terms,
        # so it is asserted rather than left implicit.
        question = make_question("Do you have fever?")

        assert not hasattr(question, "prompt_clip")

    def test_questions_keep_the_order_the_bank_defines(self, make_question):
        # The bank is a clinical checklist. Intake questions asked out of order
        # make the consultation harder to follow for both people.
        make_question("Second", order=2)
        make_question("First", order=1)

        assert [q.english_text for q in ClinicalQuestion.objects.all()] == [
            "First",
            "Second",
        ]


@pytest.mark.django_db
class TestQuestionSignVideo:
    """FR 2.4, the question played to the patient as a stitched GhSL video."""

    def test_question_is_stitched_from_the_word_clips_in_the_library(
        self, make_question, make_clip
    ):
        make_clip("DO")
        make_clip("YOU")
        make_clip("FEVER")
        question = make_question("Do you fever?", question_type=QuestionType.YES_NO)

        sequence = resolve_question_sequences([question])[question.pk]

        assert [segment.match for segment in sequence.segments] == [
            "gloss",
            "gloss",
            "gloss",
        ]

    def test_words_with_no_sign_are_reported_rather_than_dropped(
        self, make_question, alphabet
    ):
        # Same honesty as a caption. A word silently missing from a clinical
        # question changes what the patient was asked.
        question = make_question("Do you vomit?", question_type=QuestionType.YES_NO)

        sequence = resolve_question_sequences([question])[question.pk]

        assert sequence.fingerspelled_tokens == ["do", "you", "vomit"]

    def test_yes_no_question_ends_with_the_instruction_to_nod(
        self, make_question, make_clip
    ):
        # FR 2.6 requires the app to instruct the patient in sign video to nod
        # or shake. One reviewed clip is appended rather than filmed into each
        # question separately.
        make_clip("FEVER")
        make_clip(NOD_INSTRUCTION_GLOSS)
        question = make_question("Fever?", question_type=QuestionType.YES_NO)

        sequence = resolve_question_sequences([question])[question.pk]

        assert sequence.segments[-1].clips[0].gloss == NOD_INSTRUCTION_GLOSS

    def test_selection_question_gets_no_nod_instruction(self, make_question, make_clip):
        # The patient taps an option instead, so telling them to nod would be a
        # second, contradictory instruction.
        make_clip("HEAD")
        make_clip(NOD_INSTRUCTION_GLOSS)
        question = make_question("Head?", question_type=QuestionType.SELECTION)

        sequence = resolve_question_sequences([question])[question.pk]

        assert all(
            segment.clips[0].gloss != NOD_INSTRUCTION_GLOSS
            for segment in sequence.segments
            if segment.clips
        )

    def test_nod_instruction_is_skipped_until_it_is_filmed(
        self, make_question, make_clip
    ):
        # Degrades rather than failing. The doctor still sees the written
        # instruction on their own screen.
        make_clip("FEVER")
        make_clip(NOD_INSTRUCTION_GLOSS, filmed=False)
        question = make_question("Fever?", question_type=QuestionType.YES_NO)

        sequence = resolve_question_sequences([question])[question.pk]

        assert len(sequence.segments) == 1

    def test_resolving_the_whole_bank_costs_a_constant_number_of_queries(
        self, make_question, make_clip, django_assert_max_num_queries
    ):
        # The doctor opens the whole bank at once. Resolving each question
        # separately would be two queries each, which they would feel.
        make_clip("HEAD")
        questions = [make_question(f"Head {n}?", order=n) for n in range(6)]

        with django_assert_max_num_queries(3):
            resolve_question_sequences(questions)


@pytest.mark.django_db
class TestAnswerOptionCascade:
    def test_deleting_a_question_deletes_its_answer_options(
        self, make_question, make_option
    ):
        # Called out by ENGINEERING_STANDARDS.md section 4: an orphaned option
        # row would silently corrupt the Guided Interrogation flow, because the
        # grid would offer an answer belonging to no question.
        question = make_question()
        make_option(question, "Head", gloss="HEAD")
        make_option(question, "Chest", gloss="CHEST")
        assert AnswerOption.objects.count() == 2

        question.delete()

        assert AnswerOption.objects.count() == 0

    def test_deleting_one_question_leaves_another_question_options_alone(
        self, make_question, make_option
    ):
        keep = make_question("Keep")
        remove = make_question("Remove")
        make_option(keep, "Head", gloss="HEAD")
        make_option(remove, "Chest", gloss="CHEST")

        remove.delete()

        assert [o.english_text for o in AnswerOption.objects.all()] == ["Head"]

    def test_two_options_on_one_question_cannot_share_a_position(
        self, make_question, make_option
    ):
        # A grid with an ambiguous order would render differently between
        # devices, so a patient and doctor could be looking at different
        # layouts while discussing "the second one".
        question = make_question()
        make_option(question, "Head", gloss="HEAD", order=1)

        with pytest.raises(IntegrityError):
            make_option(question, "Chest", gloss="CHEST", order=1)


@pytest.mark.django_db
class TestQuestionApi:
    def test_returns_answer_options_nested_inside_each_question(
        self, api_client, make_question, make_option
    ):
        # ENGINEERING_STANDARDS.md section 4 names this as an API contract the
        # frontend assumes, so it is asserted rather than inferred from the
        # serializer.
        question = make_question()
        make_option(question, "Head", gloss="HEAD", order=1)
        make_option(question, "Chest", gloss="CHEST", order=2)

        response = api_client.get(reverse("question-list"))

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert [o["english_text"] for o in body[0]["options"]] == ["Head", "Chest"]

    def test_each_option_carries_a_playable_sign_video(
        self, api_client, make_question, make_option
    ):
        # FR 2.5 has the patient tap a sign video, not a text label, so a
        # missing URL here would leave them choosing between blank boxes.
        question = make_question()
        make_option(question, "Head", gloss="HEAD")

        response = api_client.get(reverse("question-list"))

        option = response.json()[0]["options"][0]
        assert option["clip"]["video_url"].endswith(".webm")

    def test_each_question_carries_its_stitched_sign_video(
        self, api_client, make_question, make_clip
    ):
        make_clip("HEAD")
        make_question("Head?", question_type=QuestionType.YES_NO)

        body = api_client.get(reverse("question-list")).json()

        segments = body[0]["prompt_sequence"]["segments"]
        assert segments[0]["clips"][0]["video_url"].endswith(".webm")

    def test_reports_whether_a_question_can_be_signed_at_all(
        self, api_client, make_question, make_clip
    ):
        # Reported rather than used to hide the question, so the doctor sees the
        # gap instead of a bank that merely looks small.
        make_clip("HEAD")
        make_question("Head?", question_type=QuestionType.YES_NO, order=0)
        make_question("Xylophone?", question_type=QuestionType.YES_NO, order=1)

        body = api_client.get(reverse("question-list")).json()

        assert body[0]["is_playable"] is True
        assert body[1]["is_playable"] is False

    def test_lists_only_active_questions(self, api_client, make_question):
        make_question("In the bank", order=0)
        make_question("Retired", is_active=False, order=1)

        response = api_client.get(reverse("question-list"))

        assert [q["english_text"] for q in response.json()] == ["In the bank"]

    def test_yes_no_questions_report_their_type_and_carry_no_options(
        self, api_client, make_question
    ):
        # FR 2.6 answers a yes or no question by the patient nodding, observed
        # in person, so there is no grid to render and the frontend branches on
        # this field.
        make_question("Do you have fever?", question_type=QuestionType.YES_NO)

        body = api_client.get(reverse("question-list")).json()

        assert body[0]["question_type"] == QuestionType.YES_NO
        assert body[0]["options"] == []

    def test_questions_cannot_be_created_through_the_api(self, api_client):
        # SRS section 4.3 makes the bank a fixed, pre reviewed list rather than
        # an open text field, so an unreviewed clinical question has no route
        # to a patient.
        response = api_client.post(
            reverse("question-list"),
            {"english_text": "Made up question", "question_type": "yes_no"},
            format="json",
        )

        assert response.status_code == 405
        assert not ClinicalQuestion.objects.exists()

    def test_questions_cannot_be_deleted_through_the_api(
        self, api_client, make_question
    ):
        question = make_question()

        response = api_client.delete(reverse("question-detail", args=[question.pk]))

        assert response.status_code == 405
        assert ClinicalQuestion.objects.filter(pk=question.pk).exists()

    def test_opening_the_bank_costs_a_constant_number_of_queries(
        self, api_client, make_question, make_option, django_assert_max_num_queries
    ):
        # The doctor opens the bank mid consultation. A query per question or
        # per option would make a realistic bank slow on a hospital connection.
        for index in range(4):
            question = make_question(f"Question {index}?", order=index)
            make_option(question, "Head", gloss=f"HEAD{index}")

        with django_assert_max_num_queries(6):
            api_client.get(reverse("question-list"))


@pytest.mark.django_db
class TestSeedQuestionsCommand:
    def test_seeding_creates_the_bank(self):
        call_command("seed_questions", stdout=StringIO())

        assert ClinicalQuestion.objects.active().exists()

    def test_seeded_questions_show_nothing_until_footage_exists(self):
        # Same honesty as the clip library. Seeding records the bank, it does
        # not fabricate reviewed GhSL footage.
        call_command("seed_questions", stdout=StringIO())

        questions = list(ClinicalQuestion.objects.active())
        sequences = resolve_question_sequences(questions)

        assert all(
            not any(segment.clips for segment in sequences[q.pk].segments)
            for q in questions
        )

    def test_seeding_twice_creates_no_duplicates(self):
        call_command("seed_questions", stdout=StringIO())
        first = ClinicalQuestion.objects.count()
        first_options = AnswerOption.objects.count()

        call_command("seed_questions", stdout=StringIO())

        assert ClinicalQuestion.objects.count() == first
        assert AnswerOption.objects.count() == first_options

    def test_selection_questions_get_answer_options(self):
        # A selection question with no options would render an empty grid, so
        # the patient would have nothing to tap.
        call_command("seed_questions", stdout=StringIO())

        for question in ClinicalQuestion.objects.filter(
            question_type=QuestionType.SELECTION
        ):
            assert question.options.exists()

    def test_yes_no_questions_get_no_options(self):
        # FR 2.6 answers these by nodding, so a grid would be a second,
        # contradictory way to answer the same question.
        call_command("seed_questions", stdout=StringIO())

        for question in ClinicalQuestion.objects.filter(
            question_type=QuestionType.YES_NO
        ):
            assert not question.options.exists()

    def test_seeds_the_nod_instruction_gloss_for_filming(self):
        # FR 2.6 needs this one clip, and the library is the footage tracker.
        from clips.models import SignClip

        call_command("seed_questions", stdout=StringIO())

        assert SignClip.objects.filter(gloss=NOD_INSTRUCTION_GLOSS).exists()

    def test_option_positions_are_unique_within_a_question(self):
        call_command("seed_questions", stdout=StringIO())

        for question in ClinicalQuestion.objects.all():
            positions = list(question.options.values_list("order", flat=True))
            assert len(positions) == len(set(positions))


@pytest.mark.django_db
class TestUnfilmedAnswerOptions:
    """
    The state the bank is actually in before filming: options exist, footage
    does not. This reached a 500 in the browser while every test passed,
    because the option fixture always created filmed clips.
    """

    def test_an_unfilmed_option_has_no_video_url_rather_than_erroring(
        self, api_client, make_question, make_clip
    ):
        question = make_question(question_type=QuestionType.SELECTION)
        AnswerOption.objects.create(
            question=question,
            english_text="Head",
            clip=make_clip("HEAD", filmed=False),
            order=0,
        )

        response = api_client.get(reverse("question-list"))

        assert response.status_code == 200
        assert response.json()[0]["options"][0]["clip"]["video_url"] is None

    def test_each_option_reports_whether_it_can_be_shown(
        self, api_client, make_question, make_clip, make_option
    ):
        question = make_question(question_type=QuestionType.SELECTION)
        make_option(question, "Head", gloss="HEAD")
        AnswerOption.objects.create(
            question=question,
            english_text="Chest",
            clip=make_clip("CHEST", filmed=False),
            order=1,
        )

        options = api_client.get(reverse("question-list")).json()[0]["options"]

        assert [o["is_playable"] for o in options] == [True, False]

    def test_a_selection_question_with_a_partial_grid_is_not_playable(
        self, api_client, make_question, make_clip, make_option
    ):
        # The clinical safety property. If only some body parts can be shown,
        # the patient taps the nearest wrong one and the doctor cannot tell
        # that from a correct answer, so a partial grid must not be offered.
        make_clip("WHERE")
        question = make_question("Where hurt?", question_type=QuestionType.SELECTION)
        make_option(question, "Head", gloss="HEAD")
        AnswerOption.objects.create(
            question=question,
            english_text="Chest",
            clip=make_clip("CHEST", filmed=False),
            order=1,
        )

        body = api_client.get(reverse("question-list")).json()

        assert body[0]["is_playable"] is False

    def test_a_selection_question_with_a_complete_grid_is_playable(
        self, api_client, make_question, make_clip, make_option
    ):
        make_clip("WHERE")
        question = make_question("Where hurt?", question_type=QuestionType.SELECTION)
        make_option(question, "Head", gloss="HEAD")
        make_option(question, "Chest", gloss="CHEST")

        body = api_client.get(reverse("question-list")).json()

        assert body[0]["is_playable"] is True

    def test_a_selection_question_with_no_options_is_not_playable(
        self, api_client, make_question, make_clip
    ):
        # An empty grid gives the patient nothing to tap.
        make_clip("WHERE")
        make_question("Where hurt?", question_type=QuestionType.SELECTION)

        body = api_client.get(reverse("question-list")).json()

        assert body[0]["is_playable"] is False

    def test_the_whole_seeded_bank_serializes_without_footage(self, api_client):
        # Exactly the browser's situation right now. Nothing is filmed, and the
        # bank must still load rather than returning a 500.
        call_command("seed_questions", stdout=StringIO())

        response = api_client.get(reverse("question-list"))

        assert response.status_code == 200
        assert len(response.json()) == 9
        assert all(q["is_playable"] is False for q in response.json())
