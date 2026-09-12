from rest_framework import viewsets
from rest_framework.response import Response

from questions.models import ClinicalQuestion
from questions.serializers import ClinicalQuestionSerializer
from questions.services import resolve_question_sequences


class ClinicalQuestionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read only access to the clinical question bank.

    Read only is the structural constraint SRS section 4.3 asks for: the bank
    is a fixed, pre reviewed list, not an open text field, so an unreviewed
    clinical question has no route to a patient. Tests assert that writes are
    rejected rather than trusting that nobody will try.
    """

    serializer_class = ClinicalQuestionSerializer

    def get_queryset(self):
        # Options and their clips prefetched, so opening the bank is a constant
        # number of queries rather than one per option.
        return ClinicalQuestion.objects.active().with_options()

    def list(self, request, *args, **kwargs):
        """
        Return the bank with every question's GhSL video already resolved.

        Questions are fetched once and resolved once, then handed to the
        serializer with the result. Resolving inside the serializer would run
        per question, and building the context from the queryset separately
        would evaluate and resolve the whole bank twice.
        """
        questions = list(self.filter_queryset(self.get_queryset()))
        return Response(self._serialize(questions, many=True))

    def retrieve(self, request, *args, **kwargs):
        question = self.get_object()
        return Response(self._serialize([question], many=False))

    def _serialize(self, questions, *, many):
        """Serialize questions alongside the sequences resolved for them."""
        context = {
            "request": self.request,
            "view": self,
            "format": self.format_kwarg,
            "sequences": resolve_question_sequences(questions),
        }
        target = questions if many else questions[0]
        return self.serializer_class(target, many=many, context=context).data
