from django.db import DatabaseError, connection
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response


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

    return Response({"status": "ok", "database": "ok"})
