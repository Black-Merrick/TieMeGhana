# Setup Guide

Everything needed to get Tie Me Ghana running locally. Should take under ten
minutes on a machine that already has Python, Node, and Docker.

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Python | 3.13 | 3.12 also fine |
| Node | 22 or newer | |
| Docker | any recent | Only needed for PostgreSQL, or for the full stack |

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
Khaya AI. Put the key in `backend/.env`:

```
KHAYA_API_KEY=your-key-here
```

Left blank, language operations fall back to a deterministic stub. That is
deliberate: the test suite and CI must never depend on a live third party
service, or a network problem during judging looks like a broken app.
