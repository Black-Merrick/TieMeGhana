# Production backend image. Daily development runs Django natively for fast
# reloads, see SETUP_GUIDE.md, this image is for the full stack and deployment.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ffmpeg concatenates a resolved sentence into one video file, per ADR 031.
# Without it the app still works, playing the clips in sequence instead, but
# the patient sees several videos rather than one continuous utterance.
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installed before the source is copied so a code change does not invalidate
# the dependency layer and force a full reinstall on every rebuild.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

# Documentation only: the actual port comes from $PORT at runtime, which is how
# every container host tells a process where to listen.
EXPOSE 8000

CMD ["./entrypoint.sh"]
