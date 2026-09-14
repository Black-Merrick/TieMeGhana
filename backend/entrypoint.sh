#!/bin/sh
# Start the backend: apply migrations, then serve.
#
# Migrations run here rather than being baked into the image, so the schema is
# applied exactly once per deployment against the real database. An image that
# migrated at build time would migrate against nothing, and one that never
# migrated would serve a schema behind its code, which is the failure ADR 045
# added a health check for after it had cost an hour three times.
set -e

python manage.py migrate --noinput

# The port is given by the host, not chosen by us. Render, Fly and Cloud Run
# all inject $PORT and route to it, and a server bound to a fixed 8000 is a
# server the platform cannot reach: the deploy succeeds, the health check times
# out, and the logs show a happy gunicorn talking to nobody.
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-3}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
