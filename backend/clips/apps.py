from django.apps import AppConfig


class ClipsConfig(AppConfig):
    """
    The reviewed library of Ghanaian Sign Language clips, and the pipeline that
    turns caption text into an ordered sequence of them.

    This is the retrieval half of the approach recorded in ADR 001, and it is
    the only place in the system that decides which footage a patient sees.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "clips"
