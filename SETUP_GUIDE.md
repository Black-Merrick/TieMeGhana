# Setup Guide

Everything needed to get Tie Me Ghana running locally. Should take under ten
minutes on a machine that already has Python, Node, and Docker.

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Python | 3.13 | 3.12 also fine |
| Node | 22 or newer | |
| Docker | any recent | Only needed for PostgreSQL, or for the full stack |
| ffmpeg | any recent | Stitches a sentence into one video. Without it clips play in sequence instead |

## 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
```

Confirm the baseline before writing anything new:

```bash
pytest
```

This runs against SQLite by default, so PostgreSQL is not required just to run
the suite. Leave `DATABASE_URL` unset in `.env` for that fallback.

Run the dev server:

```bash
python manage.py migrate
python manage.py runserver
```

The API is then at `http://localhost:8000/api/`. Check it:

```bash
curl http://localhost:8000/api/health/
# {"status":"ok","database":"ok"}
```

If you already have another Django project holding port 8000, run this one
elsewhere and tell the frontend proxy where to find it:

```bash
python manage.py runserver 8001
```

Then set `VITE_API_PROXY_TARGET=http://localhost:8001` in
`frontend/.env.local`.

### Using PostgreSQL locally

Day to day development only needs the database in Docker. Django and the
frontend stay native for fast reloads.

```bash
docker compose up -d db
```

Then set this in `backend/.env`:

```
DATABASE_URL=postgres://tiemeghana:tiemeghana@localhost:5432/tiemeghana
```

Run `python manage.py migrate` again after switching.

## 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The app is then at `http://localhost:5173`, or the next free port if 5173 is
taken. It shows "Connected to the hospital system" once it can reach the
backend health endpoint, which is the fastest way to confirm both halves are
talking to each other.

The dev server proxies `/api` and `/media` to Django, which is exactly what
nginx does in the containerized stack. That means the frontend only ever calls
the relative path `/api`, so a CORS or absolute URL mistake cannot show up in
deployment after working locally.

```bash
npm test        # unit tests
npm run lint    # ESLint, must pass with zero warnings
npm run build   # production PWA build
```

## 3. Enforce the standards automatically

From the project root, once:

```bash
pip install pre-commit
pre-commit install
```

Every `git commit` now runs Black, isort, and Ruff on Python files and ESLint
on JS and JSX files before the commit is allowed through. See
[ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md) section 2.

## 4. Optional, the full containerized stack

Use this to confirm the app behaves the way it will in a real deployment, not
for daily development.

```bash
docker compose -f docker-compose.full.yml up --build
```

The app is then at `http://localhost:8080`, with nginx proxying `/api` to
Django. Rebuilding on every code change is much slower than native hot
reload, which is why this is not the default workflow.

## Khaya AI credentials

Twi speech recognition, translation, and text to speech run through GhanaNLP's
Khaya AI. Put the key in `backend/.env`, **never in `.env.example`**, which is
committed:

```
KHAYA_API_KEY=your-key-here
LANGUAGE_PROVIDER=stub
```

### We are on the free tier, so keep `LANGUAGE_PROVIDER=stub`

Every translation, transcription, and speech call spends metered credit.
`LANGUAGE_PROVIDER=stub` means the key can stay configured without being used,
so ordinary development cannot exhaust the quota you need for judging.

Switch it deliberately when you actually want to test against real Twi, then
switch it straight back:

```
LANGUAGE_PROVIDER=khaya
```

The whole test suite forces the stub regardless of your `.env`, so running
`pytest` never costs credit.

With the stub, translation returns the text **unchanged** rather than inventing
Twi. That is deliberate, fabricated clinical Twi would look right in a demo and
be wrong in front of a Twi speaking judge. The app shows a visible notice
whenever a caption came from the stub, so it can never be mistaken for real
translation.

## ffmpeg, so a sentence plays as one video

A signed sentence is several clips. ffmpeg concatenates them into a single
video file so the patient sees one continuous utterance with one timeline,
rather than several clips each restarting the timer.

```bash
sudo apt install ffmpeg      # Debian, Ubuntu, Kali
brew install ffmpeg          # macOS
```

Without ffmpeg the app still works: the clips play back to back through two
buffers, which looks continuous but shows each clip's own length in the control
bar. The backend logs that it is falling back, and no request fails. See
ADR 030 and ADR 031.

Each stitched sentence is encoded once and cached in
`backend/media/stitched/`, keyed by the exact ordered clips it contains, so a
repeated sentence is served from disk.

## Speaking instead of typing

The doctor can speak in English or Twi as well as type. The microphone button
sits beside Send, and the language choice applies to both.

**The microphone only appears on a secure connection.** `getUserMedia`
requires a secure context, which `localhost` and `127.0.0.1` satisfy, so it
works during development on the machine running the server. Opening the app
from a phone over plain http does not, and the browser offers no microphone and
no error at all. The app detects this and says the connection needs https.

So for any demo where the doctor's device is **not** the machine running the
server, serve the app over https or the microphone will not be there. Typing
works either way, which is why it stays a first class path rather than a
fallback. See ADR 017.

## Adding filmed GhSL clips

The clip library starts with 92 glosses recorded and **zero** usable clips,
because no footage has been filmed yet. Until footage exists, captions
correctly report every word as unavailable.

```bash
cd backend
python manage.py seed_clips --report   # what the library still needs
```

Drop recordings into `backend/footage/`, named after their English gloss
(`head.webm`, `hurt.mp4`, `a.webm`), then:

```bash
python manage.py import_clips footage/
```

Imported footage is filmed but **not approved**, so it still cannot reach a
patient. See [backend/footage/README.md](backend/footage/README.md) for the
naming rules, the approval step, and why re-importing resets approval.
