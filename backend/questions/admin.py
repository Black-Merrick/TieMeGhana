from django.contrib import admin

from questions.models import AnswerOption, ClinicalQuestion
from questions.services import resolve_question_sequences


class AnswerOptionInline(admin.TabularInline):
    """
    Answer options edited alongside their question.

    Inline rather than a separate admin page, because an option only means
    anything in the context of its question, and editing them apart makes it
    easy to leave a selection question with no answers at all.
    """

    model = AnswerOption
    extra = 0
    autocomplete_fields = ["clip"]


@admin.register(ClinicalQuestion)
class ClinicalQuestionAdmin(admin.ModelAdmin):
    """
    Where the clinical question bank is curated.

    This is the only way a question enters the system, per SRS section 4.3, so
    the columns answer the questions a reviewer actually has: is this askable
    yet, and does it have answers.
    """

    list_display = [
        "english_text",
        "question_type",
        "category",
        "coverage",
        "is_active",
    ]
    list_filter = ["question_type", "category", "is_active"]
    search_fields = ["english_text", "twi_text"]
    ordering = ["order", "id"]
    inlines = [AnswerOptionInline]

    @admin.display(description="GhSL coverage")
    def coverage(self, question: ClinicalQuestion) -> str:
        """
        How much of this question can actually be signed today.

        The question is stitched from word clips, so its coverage changes as
        footage is filmed. Showing it here is what tells a reviewer which
        questions are still unusable without opening the app.
        """
        sequence = resolve_question_sequences([question])[question.pk]
        if not sequence.segments:
            return "no words"

        signed = sum(1 for segment in sequence.segments if segment.clips)
        return f"{signed} of {len(sequence.segments)} words"
