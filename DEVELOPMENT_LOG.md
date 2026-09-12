# Development Log

A running record of what was built in each sprint, the exact commands that
verify it, and the problems hit along the way including the ones that were our
own fault. Anyone should be able to reproduce any sprint's result from this
file alone.

`DECISIONS.md` records *why* things are the way they are. This file records
*what happened*.

---

## Sprint 0, Foundation

**Goal.** A verifiable baseline before any feature code, so that a failure in
sprint 1 is unambiguously a sprint 1 bug and not a setup problem.

**Starting state.** The repository contained three documents and had zero
commits. `ENGINEERING_STANDARDS.md` described a `backend/` and `frontend/`
scaffold, but it was not present on disk, so section 7's instruction to run
`pytest` against an existing baseline could not be followed. Sprint 0 built
that baseline instead.

### What was built

| Area | Detail |
| --- | --- |
| Backend | Django 5.2.7, DRF 3.16.1, environment driven settings, `config/` project and `core/` app |
| Health endpoint | `GET /api/health/`, touches the database rather than returning a hardcoded 200 |
| Frontend | React 19, Vite 7, PWA with service worker and a clip caching rule configured from the first commit |
| Quality gates | pytest, Black, isort, Ruff with `T20`, ESLint with `no-console` |
| Automation | pre commit hooks, GitHub Actions CI running both halves |
| Containers | `docker-compose.yml` for daily dev, `docker-compose.full.yml` for the full stack |
| Docs | `README.md`, `SETUP_GUIDE.md`, `BACKLOG.md`, `DECISIONS.md`, this log |

Ruff's `T20` rule and ESLint's `no-console` rule are the mechanical
enforcement of `ENGINEERING_STANDARDS.md` section 1: a leftover `print` or
`console.log` fails the build rather than relying on someone noticing it in
review.

### Reproducing it

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
python manage.py migrate
pytest

# Frontend
cd ../frontend
npm install
cp .env.example .env.local
npm run lint
npm test
npm run build

# Quality gates, from the repository root
pip install pre-commit          # or use backend/.venv/bin/pre-commit
pre-commit install
pre-commit run --all-files
```

### Verification, all passing

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `pytest` | 2 passed |
| Formatting | `black --check .` | 12 files unchanged |
| Import order | `isort --check-only .` | clean |
| Python lint | `ruff check .` | all checks passed |
| Migration drift | `python manage.py makemigrations --check --dry-run` | no changes detected |
| Deployment config | `DJANGO_DEBUG=0 DJANGO_SECURE_SSL=1 python manage.py check --deploy` | no issues |
| Frontend lint | `npm run lint` | clean at zero warnings |
| Frontend tests | `npm test` | 2 passed |
| Production build | `npm run build` | `sw.js` and manifest generated, 7 precache entries |
| Pre commit | `pre-commit run --all-files` | 10 hooks passed |
| End to end | browser to Vite proxy to Django to database | `{"status":"ok","database":"ok"}` |

### Problems hit, and the fixes

**WhiteNoise's manifest storage was active in development.** It requires
`collectstatic` to have run, so a fresh clone would fail on a step nobody
should need before `runserver`. The manifest backend now applies only when
`DEBUG` is off.

**WhiteNoise middleware was in the development chain.** It warned about the
missing `collectstatic` output directory on every request. In development the
staticfiles app already serves static files, so the middleware is now added
only outside development.

**`check --deploy` reported five HTTPS gaps.** Closed, but gated behind
`DJANGO_SECURE_SSL` rather than on `DEBUG` alone. See ADR 007 for why that
distinction matters for a demo.

**Port 8000 and port 5173 were already in use on the development machine** by
an unrelated Django project. The symptom was misleading: `GET /api/health/`
returned a Django 404 page from a different project's URLconf, which looks
like a routing bug in our code rather than a port collision. Fixed by making
the backend port configurable and adding a dev proxy, see below.

**The Vite dev server had no proxy.** The frontend called `/api`, which hit
Vite itself. Added a proxy for `/api` and `/media` so development mirrors what
nginx does in the containerized stack, per ADR 006.

**The proxy target was read with `process.env`, which silently does not
work.** A Vite config runs before `.env` files are applied to the process, so
`.env.local` was ignored and the proxy would have pointed at the default port
with no error at all. Now read with Vite's `loadEnv`. This is the kind of
failure worth recording because nothing reports it, the proxy just quietly
targets the wrong place.

**The ESLint pre commit hook failed on every file.** pre-commit reports paths
relative to the repository root, but ESLint has to run from `frontend/` to
pick up its flat config, so every path was wrong. The hook now runs
`npm run lint` over the whole frontend without passing filenames. The frontend
is small enough that this costs nothing.

### Known warning, accepted

`pre-commit` warns that the isort hook uses deprecated stage names. It is a
warning from isort's own hook definition, not from our configuration, and it
does not affect the result. Revisit when isort's pre commit hook is updated.

### Outstanding, carried into later sprints

These are tracked in `BACKLOG.md` under known dependencies. None of them block
sprint 1.

- Khaya AI API key from GhanaNLP, needed for real ASR, translation, and TTS
- 30 to 50 filmed or sourced GhSL clips for a hospital intake scenario
- Alphabet clips, one per letter, needed for the FR 1.6 fingerspelling fallback
- GhSL fluent consultant review of the clinical question bank and emergency
  alerts, required before any public demo

### Note on the development machine

`pypdf` was installed into the machine's Anaconda environment to extract the
text of `Tie_Me_Ghana_SRS_v2.pdf` for reading. It is not a project dependency
and is not in any requirements file.

Port 8000 on this machine is held by an unrelated Django project, so Tie Me
Ghana's backend runs on 8001 here, set in `frontend/.env.local`, which is not
committed. Other machines can use the default 8000.
