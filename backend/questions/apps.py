from django.apps import AppConfig


class QuestionsConfig(AppConfig):
    """
    The clinical question bank that drives Guided Interrogation Mode.

    SRS section 4.3 makes this a fixed, pre reviewed list rather than an open
    text field, which is what structurally prevents an unreviewed or inaccurate
    sign video from being generated on the fly for a patient.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "questions"
