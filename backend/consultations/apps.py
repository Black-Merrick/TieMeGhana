from django.apps import AppConfig


class ConsultationsConfig(AppConfig):
    """
    The live exchange between a doctor and a patient during a consultation.

    Named `consultations` rather than the `sessions_log` the engineering
    standards anticipated, because ADR 002 moved the transcript to the
    patient's own device. There is no server side log for an app to own, only
    the live exchange, and the name should say which of the two this is.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "consultations"
