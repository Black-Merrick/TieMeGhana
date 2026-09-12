from rest_framework import serializers

from clips.serializers import SignClipSerializer, SignSequenceSerializer
from questions.models import AnswerOption, ClinicalQuestion, QuestionType


class AnswerOptionSerializer(serializers.ModelSerializer):
    """One tappable answer, with the sign video the patient actually taps."""

    clip = SignClipSerializer(read_only=True)
    is_playable = serializers.SerializerMethodField()

    class Meta:
        model = AnswerOption
        fields = ["id", "english_text", "clip", "is_playable", "order"]

    def get_is_playable(self, option) -> bool:
        return option.clip.is_resolvable


class ClinicalQuestionSerializer(serializers.ModelSerializer):
    """
    One question from the bank, with its answer options nested inside it.

    Nesting is a deliberate contract rather than a convenience: the doctor
    opens the bank and needs the whole thing, questions and answers together,
    in one request. A separate options endpoint would mean a round trip per
    question on a hospital connection, mid consultation.
    """

    options = AnswerOptionSerializer(many=True, read_only=True)
    prompt_sequence = serializers.SerializerMethodField()
    is_playable = serializers.SerializerMethodField()

    class Meta:
        model = ClinicalQuestion
        fields = [
            "id",
            "english_text",
            "twi_text",
            "question_type",
            "category",
            "prompt_sequence",
            "is_playable",
            "options",
            "order",
        ]

    def get_prompt_sequence(self, question):
        """
        The question as a stitched GhSL video.

        Resolved once for the whole bank and passed in through context, rather
        than resolved here, because a serializer method runs per object and
        would turn one batched lookup into one per question.
        """
        sequence = self.context["sequences"][question.pk]
        return SignSequenceSerializer(sequence).data

    def get_is_playable(self, question):
        """
        Whether this question can safely be asked as it stands.

        Reported rather than used to hide the question, so the doctor sees that
        a question exists but cannot be signed yet. Hiding it would make the gap
        invisible and look like the bank is simply small.

        A selection question additionally needs **every** answer option filmed.
        A partial grid is worse than no grid: if "where does it hurt" can only
        offer three body parts, the patient taps the nearest wrong one, and the
        doctor has no way to tell that from a correct answer.
        """
        sequence = self.context["sequences"][question.pk]
        if not any(segment.clips for segment in sequence.segments):
            return False

        if question.question_type == QuestionType.SELECTION:
            options = list(question.options.all())
            return bool(options) and all(
                option.clip.is_resolvable for option in options
            )

        return True
