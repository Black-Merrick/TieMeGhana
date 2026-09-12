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

---

## Sprint 2, Khaya language layer and doctor captioning

**Branch.** `sprint-1-ghsl-clip-library`, continued. Sprint 2 built on sprint
1 directly rather than branching again, since nothing had been pushed and the
two together are what completes P0.1.

**Goal.** Complete P0.1: FR 1.1 to FR 1.4 plus the player for FR 1.7, so the
headline demo runs end to end.

### What was built

| Piece | Purpose |
| --- | --- |
| `core/language/` | Provider interface for ASR, translation, and TTS, with Khaya and stub implementations |
| `LANGUAGE_PROVIDER` setting | `auto`, `stub`, or `khaya`. Protects metered free tier credit, ADR 015 |
| `POST /api/caption/` | FR 1.1 to 1.7 in one request, so NFR 1's budget is spent on work rather than round trips |
| `SignSequencePlayer` | Plays a resolved sequence back to back with the next clip preloaded, ADR 008 |
| `DoctorConsultation` | Language choice, message input, caption and sign video shown together, coverage notices |
| `manage.py import_clips` | Imports filmed footage from a folder named by gloss, without approving it |
| `backend/footage/` | Where recordings go, with a README covering naming, approval, and re-import |

### Reproducing it

```bash
cd backend && source .venv/bin/activate && pytest        # 71 tests
cd ../frontend && npm run lint && npm test && npm run build   # 20 tests
```

Exercising the caption pipeline, server on 8001, stub provider:

```bash
curl -X POST http://127.0.0.1:8001/api/caption/ \
  -H 'Content-Type: application/json' \
  -d '{"source_language":"en","text":"Where does it hurt?"}'
```

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 71 passed |
| Frontend suite | 20 passed, 3 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Production build | PWA builds, service worker generated |
| Live Khaya, one verification run | "Where does it hurt?" returned "Ɛhe na ɛyɛ yaw?" |

### Live verification of Khaya, done once, deliberately

Run on 2026-09-12 with a real key, then the provider was switched back to the
stub because the free tier is metered.

| Endpoint | Result |
| --- | --- |
| `POST /v2/translate` | 200, correct Twi, no deprecation headers |
| `POST /tts/v1/tts` | 200, 51 KB genuine WAV, `RIFF....WAVE` header |
| `POST /asr/v1/transcribe` | 400 on deliberately invalid audio, confirming route and credential |

**The v1 translate endpoint is past its sunset date.** It answered correctly,
but with `deprecation: true` and `sunset: 2026-09-06`, which had already
passed, plus a `link` header naming `/v2/translate` as successor. We switched
to v2 and a test now guards against reverting. See ADR 013.

This was only visible because the verification read response headers rather
than just the status code. The call succeeded, so nothing else would have
surfaced it.

### The significant bug this sprint found

**Sign lookup was resolving clips from the Twi caption instead of the English
text.** Every test passed. Against real Khaya it failed completely:
"Where does it hurt?" translates to "Ɛhe na ɛyɛ yaw?", which tokenizes to
`ɛhe`, `na`, `ɛyɛ`, `yaw`, and the clip library is keyed on English glosses
like `WHERE` and `HURT`. Not one token could ever match.

The stub hid it perfectly. Its translation returns the input unchanged, so the
English caption and the English lookup text were the same string, and the two
code paths were indistinguishable. The bug was invisible under the stub and
total under the real provider.

Fixed per ADR 014: one utterance now produces a Twi caption for the patient to
read and a separate English lookup text for the clip library, still one
translation call either way. A `directional_provider` test fixture translates
with a visible direction tag, so a test can now prove which of the two the
lookup used. Three tests cover it, including a regression guard asserting the
Twi caption is never used as the lookup key.

Worth carrying forward as a habit: where a stub's simplification could hide a
direction or a mapping, the test needs a provider that transforms visibly, not
one that passes input through.

### Problems hit, and the fixes

**A real API key was placed in `backend/.env.example`, which is committed.**
Caught before any commit, so the key never entered git history, verified with
`git log --all -S`. Moved to `backend/.env`, which is gitignored, and the
template restored to a blank value. Worth knowing that the `detect-private-key`
pre commit hook would not have caught this: it detects SSH and PEM keys, not
API tokens.

**The player crashed when given a shorter sequence.** Resetting the clip index
in a `useEffect` runs after the render that needed the new value, so the render
that first saw the shorter sequence still read the old out of range index. The
fix adjusts state during render, React's documented pattern for a prop change,
plus a clamp, because a render-phase state update re-renders but does not abort
the pass that triggered it. The test written for this caught it immediately.

**The ESLint pre commit hook failed on every file.** pre-commit reports paths
relative to the repository root, but ESLint must run from `frontend/` to pick
up its flat config. The hook now runs `npm run lint` without passing filenames.

**Two dev servers were started against a stale URLconf.** `runserver
--noreload` does not pick up new apps, so `/api/caption/` returned 404 twice
before the server was restarted. Not a code problem, but it wasted time twice
and is worth remembering.

**The test suite could reach a metered service.** Provider selection read only
"is a key present", so a developer with a key in `.env` would spend credit on
every test run. An autouse fixture now forces the stub and clears the key for
the whole suite, and `pytest` can no longer cost money.

### Known limitations, deliberate

**Microphone capture is not built.** The endpoint transcribes uploaded audio
and the ASR route is verified reachable, but nothing in the browser records it
yet, so a doctor types. `MediaRecorder` cannot be meaningfully tested in jsdom,
so this is scheduled with a real device pass rather than marked done.

**No footage exists, so nothing resolves.** 92 glosses recorded, 0 usable.
Captions correctly report every word as unavailable. This is the critical path
now, and it is not an engineering task. Drop recordings in `backend/footage/`
and run `import_clips`.

**Clip duration is entered by hand**, unchanged from sprint 1.

### Note on the development machine

Placeholder footage was briefly attached to `WHERE` and `HURT` in the local
SQLite database to demonstrate resolution, then removed, because fake footage
marked as consultant approved contradicts the safety property the library
exists to enforce. The library is back to 92 awaiting footage, 0 resolvable.

---

## Sprint 2b, Microphone capture for FR 1.2

**Goal.** Let the doctor speak rather than type, in either English or Twi,
closing the one part of P0.1 that was left open.

### What was built

| Piece | Purpose |
| --- | --- |
| `useAudioRecorder` | Wraps MediaRecorder so no component touches browser media APIs, keeping permission and cleanup rules in one place |
| `pickMimeType()` | Chooses the best format this browser can record, rather than assuming WebM |
| `recordingSupport()` | Tells `insecure` apart from `unsupported`, because the two have different fixes |
| Microphone button | Sits beside Send rather than replacing it, since typing stays a first class path |
| Recording indicator | SRS 4.2. Nothing else would tell the doctor the microphone is live |
| Content type plumbing | The recorded format travels to Khaya instead of being flattened to raw bytes |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 74 passed |
| Frontend suite | 48 passed, 5 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Production build | PWA builds, service worker generated |

### Two things worth knowing, found while building this

**Safari on iOS cannot record WebM.** It records `audio/mp4` only. NFR 6 lists
iOS Safari as a target, so a hardcoded WebM would have made the microphone
silently unusable on every iPhone, discovered whenever someone first tried it
on a phone. The format list is now preference ordered and feature detected.

**The microphone needs a secure context, and a hospital demo probably will not
have one.** `getUserMedia` is unavailable outside a secure context. `localhost`
counts, so it works all through development. A phone opening the app over plain
http on a hospital network does not, and the browser offers no microphone and
no error. ADR 007 deliberately leaves HTTPS redirection off so a demo cannot
make itself unreachable, which puts a LAN demo squarely in this case.

The app now detects it and says the connection needs https, rather than
claiming the browser cannot record, which would be false and would send someone
debugging the wrong thing. See ADR 017. **Any demo where the doctor's device is
not the server machine needs https for the microphone to appear.**

### Microphone release, treated as a correctness problem

Three separate paths release the media stream: a normal stop, a recorder that
throws after permission was already granted, and the component unmounting mid
recording. Each has its own test.

Stopping the recorder does not stop the underlying stream, so without this the
browser keeps showing the microphone as live. In an app whose privacy claim is
the reason a Deaf patient would use it instead of bringing a relative to
interpret, a recording indicator that stays on after the doctor stopped
speaking is a real problem rather than a cosmetic one.

### Known limitations, deliberate

**Whether Khaya's ASR accepts WebM or MP4 is unverified.** The route and
credential are confirmed, the audio format is not. It needs one real
transcription call with real recorded speech, which spends metered credit, so
it is deferred to the same session that tests the filmed clips. If Khaya turns
out to want WAV, transcoding is confined to the provider.

**No real device pass yet.** jsdom has no microphone, so the tests stand one
in. They prove the state machine, the format choice, and the cleanup. They do
not prove sound reaches the server.

**An empty recording is discarded client side**, so tapping stop immediately
does not spend a transcription call to get nothing back.

---

## Sprint 2c, Making the microphone actually transcribe

**Trigger.** The first real recording through the browser failed with "could
not reach the language service".

### What the failure actually was

Two separate problems, one masking the other.

**The running dev server was stale.** It had been started with `--noreload`
before `LANGUAGE_PROVIDER` existed, so it was on `auto`, saw the key in
`.env`, and called real Khaya. Typed messages worked, because translation
works. Audio failed. The server is now run with the reloader on, since a stale
server had caused a misleading failure three times by this point.

**Khaya's ASR rejected the upload.** `MediaRecorder` cannot produce WAV or MP3
in any browser: Chrome and Firefox give WebM with Opus, Safari gives MP4 with
AAC. Khaya's developer portal renders client side, so its docs cannot be read
programmatically, but the community Dart client GhanaNLP's own site links to
transcribes from a plain `.mp3` and uses language code `tw`. The strong
implication is that Khaya wants an ordinary audio file.

Recordings are now converted in the browser to 16 kHz mono WAV, the standard
speech recognition input, using the browser's own decoder and
`OfflineAudioContext`. This keeps ffmpeg out of the runtime per ADR 008 and
removes the Chrome versus Safari format split entirely. See ADR 018.

### The gap that made this expensive

**The provider's error message was being thrown away.** `LanguageError`
carried Khaya's actual response text, the view discarded it and returned a
generic 503, and Django's default logging does not configure our app loggers,
so nothing was written anywhere. Diagnosing the failure meant reproducing it,
and reproducing it costs metered credit.

Now logged server side, with the provider, the source language, and whether
the input was audio or text. Deliberately **not** returned to the client: a
provider message can quote the utterance back, and the utterance is clinical
content. Two tests cover it, one that the message is logged and one that it
never reaches the response.

### A disclosure problem found on the way

With the stub provider, a recording "works" but the transcript is **invented**.
The stub returns a fixed sentence regardless of what was said. The existing
provider warning only mentioned translation, so a spoken demo would have shown
words the doctor never said as though they had been heard, which is a worse
version of exactly the failure ADR 011 exists to prevent.

The response now reports `transcript_source`, and a stubbed recording says the
speech was not transcribed and the text is placeholder content.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 78 passed |
| Frontend suite | 65 passed, 7 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Production build | PWA builds, service worker generated |
| Audio path, stub provider | 200, transcript and caption returned through the dev proxy |

### Problems hit, and the fixes

**jsdom's `Blob` has no `arrayBuffer()`,** so the WAV header could not be read
back in a test. Split the encoder into `encodeWavBuffer`, returning raw bytes,
and `encodeWav`, wrapping it in a Blob. Better design regardless: the pure
function is the part worth testing, and the header is now asserted field by
field.

**`propagate: False` on our loggers meant nothing could observe them.**
Records reached our console handler but not the root logger, so the test
asserting the provider error is logged failed. The test caught a real config
mistake, not a test problem: any log aggregator would have been just as blind.
Root has no handler of its own, so propagating logs nothing twice.

**The upload was still named `utterance.webm`** after conversion to WAV. The
extension is now derived from the blob's own type, because a filename that
misdescribes the bytes is exactly the kind of thing a media service trusts.

### Still unverified

**Whether Khaya accepts this WAV.** It needs one real transcription call, which
costs credit. If it still fails, the log now says why rather than requiring
another round of guessing.
