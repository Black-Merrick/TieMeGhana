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

---

## Sprint 1, GhSL clip library and text to sign resolution

**Branch.** `sprint-1-ghsl-clip-library`

**Goal.** FR 1.5, FR 1.6, and FR 1.7 on the backend: the retrieval layer that
everything visual in the app depends on. Chosen first because it needs neither
the Khaya API key nor real footage, so nothing external could block it.

**Worked test first**, per `ENGINEERING_STANDARDS.md` section 3. The tests were
written and run before any implementation existed, failing with
`ModuleNotFoundError: No module named 'clips.models'`, then the implementation
was written to satisfy them.

### What was built

| Piece | Purpose |
| --- | --- |
| `SignClip` model | One reviewed GhSL clip, keyed on its English gloss, normalized uppercase on save |
| `resolvable()` queryset | The single rule for "may a patient see this": approved by a consultant **and** filmed |
| `awaiting_footage()`, `awaiting_review()` | Turn the library into the team's own footage and review tracker |
| `tokenize()` | Splits captions into word tokens, keeping Twi characters, discarding punctuation |
| `resolve_sign_sequence()` | FR 1.5 to 1.7, gloss match then fingerspelling fallback then honest unavailable |
| `GET /api/clips/` | Read only list of clips that are reviewed and filmed |
| `POST /api/sign-sequence/` | Resolves caption text to an ordered clip sequence for the player |
| Admin review workflow | Approve and return for rework actions, with filmed and review columns |
| `manage.py seed_clips` | Seeds 92 glosses with no footage, so the library records what still needs recording |

### Reproducing it

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py seed_clips           # seeds vocabulary, films nothing
python manage.py seed_clips --report  # what the library still needs
pytest
```

Exercising the API directly, with the server on 8001:

```bash
curl -X POST http://127.0.0.1:8001/api/sign-sequence/ \
  -H 'Content-Type: application/json' -d '{"text":"head hurts"}'

curl http://127.0.0.1:8001/api/clips/

# Must be 405, clips are admin managed only
curl -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8001/api/clips/ \
  -H 'Content-Type: application/json' -d '{"gloss":"FAKE"}'
```

### Verification

| Check | Result |
| --- | --- |
| Test suite | 31 passed, 29 of them new in this sprint |
| Formatting, import order, lint | black, isort, ruff all clean |
| Migration drift | none |
| Seed command | 92 glosses created, 0 ready for clinical use, which is the correct honest state |
| Live API | sign sequence resolves and reports coverage, clip write returns 405 |

### Tests worth knowing about

These are the ones that encode something the project would be worse without.

- **An unreviewed clip is never used even when the gloss matches.** The
  resolver falls back to fingerspelling instead. This is the clinical safety
  property of the whole module.
- **Resolution cost does not grow with sentence length.** Asserted with
  `django_assert_num_queries(2)`. A per token query would have quietly blown
  NFR 1's five second budget on a long sentence.
- **Clips cannot be created or deleted through the API.** Locks in the stated
  design that the library is admin managed and consultant reviewed.
- **A partially spellable word is reported unavailable, not played with gaps.**
  A gap would be read by the patient as part of the word.
- **The tokenizer keeps ɛ and ɔ.** Twi captions are the normal case here, and a
  tokenizer that stripped them would mangle most real input.
- **Seeding never produces a resolvable clip.** Seeding records what is needed,
  it does not fabricate reviewed footage.

### Problems hit, and the fixes

**`ClipKind` was imported inside the `make_clip` fixture, so the `alphabet`
fixture could not see it.** The import has to be function local because
`conftest.py` is imported before Django's app registry is ready, so the fix was
a second local import rather than moving it to module level.

**`bulk_create` bypasses `save()`, so gloss normalization did not run** in the
seed command. Harmless with the current all uppercase lists, but it would
silently store a lowercase gloss the resolver could never match. The command
now normalizes explicitly.

**`MEDIA_URL` was `"media/"` with no leading slash.** Clip URLs are built from
it, so a relative value would resolve against whatever path the app happened to
be on. Now `"/media/"`. `STATIC_URL` had the same problem and was fixed with
it.

**Ruff flagged `typing.Iterable` as deprecated** in favour of
`collections.abc.Iterable`, and fixed it automatically. Noted because it is the
lint rules doing their job rather than a mistake needing a decision.

### Known limitations, deliberate

**No footage exists yet, so the library resolves nothing.** Every caption
currently reports `unavailable`, because the alphabet has no footage either and
so even fingerspelling cannot complete. This is correct behaviour, not a bug,
and it is visible rather than hidden. The moment real clips are uploaded and
approved, resolution starts working with no code change.

**Multi word signs are not matched.** See ADR 010. They fingerspell instead,
which is worse for the patient. Phrase level matching is a later sprint.

**Clip duration is entered by hand.** Nothing reads it from the video file,
because that needs ffmpeg, which is deliberately not a runtime dependency per
ADR 008. `total_duration_ms` is therefore an estimate based on what a reviewer
typed in.

### Carried forward

Unchanged from sprint 0, and none of it blocked this sprint: the Khaya API key,
filmed GhSL footage, alphabet footage for FR 1.6, and consultant review of the
question bank. Sprint 1 made the first three visible as data rather than as a
note in a file, which is the point of ADR 009.
