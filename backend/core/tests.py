import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_reports_ok_when_database_is_reachable(api_client):
    """
    The health endpoint is what tells us during a demo whether a failure is in
    the API layer or the database, so it has to actually touch the database
    rather than returning a hardcoded 200.
    """
    response = api_client.get(reverse("health"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


@pytest.mark.django_db
def test_health_reports_degraded_when_database_is_unreachable(api_client, monkeypatch):
    """A green health check with a dead database would be worse than no check."""
    from django.db import DatabaseError, connection

    def fail(*args, **kwargs):
        raise DatabaseError("simulated outage")

    monkeypatch.setattr(connection, "ensure_connection", fail)

    response = api_client.get(reverse("health"))

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


@pytest.mark.django_db
class TestHealthReportsPendingMigrations:
    """
    A migration written but not applied is the failure this catches.

    It has cost the same lost hour three times: the endpoint that touches the
    new column returns a 500 about a column nobody has heard of, `runserver`
    printed its warning before the migration existed and does not repeat it on
    reload, and the test suite stays green throughout because pytest builds its
    database from scratch every run.
    """

    def test_a_migrated_database_reports_ok(self, api_client):
        # pytest applies every migration when it builds the test database, so
        # this is the state the suite always runs in.
        assert api_client.get(reverse("health")).json()["migrations"] == "ok"

    def test_an_unapplied_migration_is_reported(self, api_client, monkeypatch):
        from core import views

        monkeypatch.setattr(
            views, "_pending_migrations", lambda: ["prescriptions.0002_something"]
        )

        body = api_client.get(reverse("health")).json()

        assert body["migrations"] == "pending"
        assert body["pending_migrations"] == ["prescriptions.0002_something"]

    def test_a_stale_schema_is_not_reported_as_being_offline(
        self, api_client, monkeypatch
    ):
        # Deliberately still 200. The API and the database are both up, and a
        # 503 would make the interface tell the patient it is offline, sending
        # whoever is debugging to look at the network instead of the schema.
        from core import views

        monkeypatch.setattr(views, "_pending_migrations", lambda: ["clips.0007"])

        response = api_client.get(reverse("health"))

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_an_unreadable_migration_table_is_not_reported_as_ok(
        self, api_client, monkeypatch
    ):
        # Saying "ok" here would be a guess, and the whole value of this
        # endpoint is that it does not guess.
        from django.db import DatabaseError

        from core import views

        def fail():
            raise DatabaseError("cannot read django_migrations")

        monkeypatch.setattr(views, "_pending_migrations", fail)

        assert api_client.get(reverse("health")).json()["migrations"] == "unknown"


class TestProxiedAdminOrigins:
    """
    The dev server proxies /admin, so the browser's Origin is the Vite port
    while Django sees its own host. Django treats that mismatch as a cross site
    request and rejects the POST, which surfaced as a 403 when approving a clip
    with a CSRF message that says nothing about proxying.
    """

    def test_the_dev_origins_may_post_a_form(self, settings):
        for origin in settings.CORS_ALLOWED_ORIGINS:
            assert origin in settings.CSRF_TRUSTED_ORIGINS, origin

    def test_vites_fallback_port_is_included(self, settings):
        # Vite moves to the next free port when 5173 is taken, which happens
        # routinely on a machine running more than one project, and the admin
        # then breaks for a reason nobody would connect to the port number.
        assert any("5174" in origin for origin in settings.CSRF_TRUSTED_ORIGINS)

    def test_origins_are_full_urls_with_a_scheme(self, settings):
        # Django requires the scheme here. A bare host is silently ignored,
        # so the setting would look configured and do nothing.
        for origin in settings.CSRF_TRUSTED_ORIGINS:
            assert origin.startswith(("http://", "https://")), origin


@pytest.mark.django_db
class TestApiIsStateless:
    """
    The API must not care whether a browser is also logged into the admin.

    A doctor approving clips in the admin leaves a session cookie in the same
    browser. With session authentication enabled, DRF then treats every API
    call as an authenticated request and enforces CSRF on it, so the
    consultation screen starts failing with 403 and the message on screen says
    the language service is unreachable, which is not what happened.

    Reproduced with `enforce_csrf_checks`, because the default test client
    skips the check and the failure only appears in a real browser.
    """

    def test_a_post_works_while_logged_into_the_admin(self, django_user_model):
        from rest_framework.test import APIClient

        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client = APIClient(enforce_csrf_checks=True)
        client.login(username="reviewer", password="pw")

        response = client.post(
            reverse("caption"),
            {"source_language": "en", "text": "appear"},
            format="json",
        )

        assert response.status_code == 200

    def test_a_post_works_for_a_browser_with_no_session(self):
        from rest_framework.test import APIClient

        client = APIClient(enforce_csrf_checks=True)

        response = client.post(
            reverse("caption"),
            {"source_language": "en", "text": "appear"},
            format="json",
        )

        assert response.status_code == 200

    def test_the_api_does_not_authenticate_by_session(self, settings):
        # The patient facing API has no user accounts and reads nothing from
        # request.user, so session authentication buys nothing and costs the
        # failure above. The Django admin is unaffected: it is not DRF, and its
        # own forms are still CSRF protected.
        assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == []
