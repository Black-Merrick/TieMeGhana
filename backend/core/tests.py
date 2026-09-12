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
