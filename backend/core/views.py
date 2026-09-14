from django.db import DatabaseError, connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response


def _pending_migrations() -> list[str]:
    """
    Migrations that exist in the repository but not in this database.

    Django prints a warning about these when `runserver` starts, which is no
    help at all to a server that started before the migration was written: it
    reloads on the file change without printing the notice again. The failure
    that follows is a 500 from whichever endpoint touches the new column, with
    a message about a column nobody has heard of, and the tests stay green
    throughout because pytest builds its database from scratch every run.

    That has now caused the same lost hour three times, so the health endpoint
    answers the question directly rather than leaving it to be inferred.
    """
    executor = MigrationExecutor(connection)
    targets = executor.loader.graph.leaf_nodes()

    return [
        f"{migration.app_label}.{migration.name}"
        for migration, _ in executor.migration_plan(targets)
    ]


@api_view(["GET"])
def health(request):
    """
    Report whether the API process and its database are both reachable.

    Used by docker-compose healthchecks and by the frontend on startup, so a
    demo failure can be traced to a specific layer in seconds rather than
    guessed at in front of judges.
    """
    try:
        connection.ensure_connection()
    except DatabaseError:
        return Response(
            {"status": "degraded", "database": "unreachable"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        pending = _pending_migrations()
    except DatabaseError:
        # The connection answered a moment ago, so a failure here is about
        # reading the migration table rather than about reachability. Reported
        # as unknown rather than as "ok", which would be a guess.
        pending = None

    # Still HTTP 200. The API process and the database are both up, and
    # returning 503 would make the interface tell the patient it is offline,
    # which is not what happened and would send someone looking at the
    # network. The schema being stale is its own distinct fact.
    body = {
        "status": "ok",
        "database": "ok",
        "migrations": (
            "unknown" if pending is None else ("pending" if pending else "ok")
        ),
    }

    if pending:
        body["pending_migrations"] = pending

    return Response(body)
