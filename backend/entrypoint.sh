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

# The admin is how a consultant approves clips, and an unapproved clip never
# plays. `createsuperuser` wants a terminal, and Render's free tier has no
# shell, so the account is made from the environment instead. Does nothing
# when the variables are absent, which is the case locally and in CI.
python manage.py ensure_superuser

# The port is given by the host, not chosen by us. Render, Fly and Cloud Run
# all inject $PORT and route to it, and a server bound to a fixed 8000 is a
# server the platform cannot reach: the deploy succeeds, the health check times
# out, and the logs show a happy gunicorn talking to nobody.

# One process with several threads, not several processes. Pairing keeps its
# short lived handshake in the process cache, so a code minted by one worker
# does not exist for another, and with three workers roughly two in three
# pairing attempts would have failed with "not found", at random. Threads share
# that memory, and this app spends its time waiting on the network (Khaya, the
# database, the bucket), which threads handle well. To run more processes,
# WEB_CONCURRENCY has to be raised together with a shared cache: see ADR 053.
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-8}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
