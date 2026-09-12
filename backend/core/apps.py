from django.apps import AppConfig


class CoreConfig(AppConfig):
    """
    Cross cutting concerns that are not owned by any single feature app.

    Anything shared by two or more feature apps belongs here rather than being
    duplicated, which is what keeps the vibration vocabulary and the language
    provider single sourced as the SRS requires.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "core"
