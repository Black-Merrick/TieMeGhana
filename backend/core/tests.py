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
    assert response.json() == {"status": "ok", "database": "ok"}


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
