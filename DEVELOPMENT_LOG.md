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

---

## FR 1.2 verified end to end, 2026-09-12

Khaya accepts the 16 kHz mono WAV and transcribes it. The format conversion in
ADR 018 was the fix, not a workaround.

**P0.1 is now complete and verified on real services**, not just under the
stub: speech, to transcript, to Twi caption, to GhSL clip lookup, with the
clip library correctly reporting coverage gaps while footage is still missing.

Remaining for NFR 6 is a Safari and iOS device pass, which is a manual check
rather than an engineering task. The WAV conversion makes it much more likely
to work, since it removes the WebM versus MP4 difference that would otherwise
have made iOS a separate code path.

---

## Sprint 3, Interaction foundations and the literacy check

**Goal.** Build the cross cutting pieces SRS section 4.4 requires to be single
sourced, then FR 2.1 to 2.3: the literacy check that routes a patient to the
right interaction path.

### What was built

| Piece | Purpose |
| --- | --- |
| `feedback/vibration.js` | The five patterns from SRS section 6, defined once. NFR 3 degradation built in |
| `visit/visit.js` | The literacy answer, scoped to a visit and expiring. ADR 020 |
| `YesNoChoice` | The app's single Yes and No control, section 4.4, no visible text per FR 2.1 |
| `signs/sequence.js` | Wraps one named clip as a sequence so it plays through the shared player |
| `LiteracyCheck` | FR 2.1 to 2.3, the question in sign video with icon answers |
| `ClipKind.PROMPT` | A clip the app asks in its own voice, kept out of caption tokenizing |
| `GET /api/clips/by-gloss/<gloss>/` | Fetch a named clip without the frontend knowing database ids |
| App routing | Literacy check first, then the path FR 2.2 selected, with the path always visible |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 84 passed |
| Frontend suite | 116 passed, 11 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Production build | PWA builds, service worker generated |

### The risk this sprint was really about

FR 2.2 says the literacy answer lasts "for the visit". That scope is load
bearing, because the app runs on a device handed from patient to patient. An
answer that outlived its visit would route the next patient down the previous
patient's path, and showing captions to a patient who cannot read print is
exactly the failure the literacy check exists to prevent.

So the answer persists across a reload, an always visible "New patient" control
clears it, and a visit older than four hours is treated as finished even if
nobody pressed the button. Every ambiguous case fails closed and re asks: a
corrupt record, a missing timestamp, an unrecognized path, or storage being
unavailable. See ADR 020.

### Problems hit, and the fixes

**The staleness guard rejected a timestamp of zero.** It tested
`!visit.startedAt`, and `!0` is true, so a visit that legitimately started at
epoch zero was discarded as invalid. Found by the test asserting a visit inside
the window survives. A falsy check on a numeric field is the kind of fault that
hides until a clock or a fixture produces that one value, so it now checks the
type with `Number.isFinite` and there is a regression test for the zero case.

**The stored path was trusted without validation.** An unrecognized value would
have fallen through to whichever branch the UI defaults to, which for this
screen means routing a patient by accident. It now fails closed and re asks.

### Known limitations, deliberate

**The literacy prompt clip is not filmed**, so the app cannot yet ask the
question in GhSL. Rather than route the patient anyway, the screen says the
video is missing and asks staff to put the question in person, while still
recording the answer. Blocking entirely would make the whole app unusable
before filming is done; routing silently would defeat the check. The gloss
`CAN_YOU_READ_AND_WRITE` is seeded and waiting for footage.

**Guided Interrogation Mode is not built**, so a patient routed there sees a
staff facing notice. It deliberately tells the doctor not to fall back to typed
captions for that patient, because doing so is the specific harm FR 2.4 exists
to avoid. Sprint 4 builds it.

---

## Sprint 4, Guided Interrogation Mode

**Goal.** FR 2.4 to 2.7. The path for a patient fluent in GhSL who does not
read print: the doctor picks from a fixed clinical bank, the app asks the
question in sign video, and the patient answers by tapping or by nodding.

### A design change part way through

The first implementation gave every question its own filmed prompt clip. That
made each new question cost a recording and a consultant review before it could
be asked at all.

Reworked so a question is **stitched from the word clips already in the
library**, exactly as a caption is. Adding a question is now a row in the bank
rather than a filming session, coverage improves automatically as the library
grows, and a question can be reworded without reshooting anything. The
`prompt_clip` field was removed. See ADR 021.

FR 2.6's instruction to nod or shake is one clip, `NOD_OR_SHAKE`, appended to
every yes or no question rather than filmed into each one.

### What was built

| Piece | Purpose |
| --- | --- |
| `questions` app | The fixed, pre reviewed bank, SRS section 4.3 |
| `resolve_sign_sequences()` | Batched resolution, so the whole bank shares one clip lookup |
| `resolve_question_sequences()` | Stitches each question, appending the nod instruction to yes or no ones |
| `GET /api/questions/` | The bank, with options nested and each question's video resolved |
| `GuidedInterrogation` | The doctor's bank, the question player, and the answer flow |
| `AnswerOptionGrid` | FR 2.5, sign video options the patient taps |
| `seed_questions` | Nine intake, symptom, and history questions |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 113 passed |
| Frontend suite | 136 passed, 12 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Production build | PWA builds |
| Seeded bank | 9 questions, 0 signable yet, which is correct with no footage |

### Properties the SRS and standards asked for by name

**Deleting a question deletes its answer options.** Named in
`ENGINEERING_STANDARDS.md` section 4, because an orphaned option would offer an
answer belonging to no question. Tested, along with the case where deleting one
question must leave another's options alone.

**`/api/questions/` returns options nested inside each question.** Also named
in section 4 as a contract the frontend assumes, so it is asserted directly
rather than inferred from the serializer.

**No camera based gesture detection.** FR 2.6 is explicit, and there is a test
asserting it, because adding gesture detection later would be a change to a
stated design decision rather than an improvement.

**What gets recorded for a yes or no question is the doctor's confirmation**,
per FR 2.7, not a reading of the patient's head movement. The record carries
who answered, so a transcript can never imply the patient tapped something they
never touched.

### Problems hit, and the fixes

**The answer option fixture collided with its own uniqueness constraint.**
Grid positions are unique per question, and the fixture defaulted every option
to position zero, so a test about cascade deletion failed on layout. The
fixture now assigns positions itself.

**The bank was fetched and resolved twice per request.** Overriding
`get_serializer_context` to supply resolved sequences re evaluated the queryset,
so `list()` and the context each resolved the whole bank. Caught by the query
count test: 9 queries where 6 were expected. Questions are now fetched once and
resolved once.

**`askable()` was written with leftover scaffolding in it**, a dead
`if False else` expression left from working out how to reference the review
status. Replaced with a plain reference to `ReviewStatus.APPROVED`, then removed
entirely when the prompt clip went away.

### Known limitations, deliberate

**No footage, so no question can be signed yet.** All nine are seeded and the
bank reports zero signable, which is correct rather than broken. Coverage
appears automatically as word clips are filmed.

**Recorded answers are held in memory.** The durable transcript on the
patient's own device is FR 4.1 to 4.3, next sprint. The shape already matches
what that will persist, and the screen says plainly that nothing is saved yet.

---

## Sprint 4 follow up, the bank returned a 500 in the browser

**Symptom.** The app showed "Could not load the question bank" while every
test passed and the health check was green.

**Cause.** `SignClipSerializer.get_video_url` returned `clip.video.url`, and
Django's `FileField.url` **raises** when the field is empty. It had only ever
been used on `resolvable()` clips, which always have footage. Nesting clips
inside answer options exposed it to unfilmed ones, which is the state the
seeded bank is in.

Every test passed because the `make_option` fixture always created a filmed
clip. The narrow lesson is the fix. The broader one is that a fixture whose
defaults are the healthy case will not exercise the state the system actually
spends its early life in, which here is "nothing is filmed yet".

**The more important thing this surfaced.** Once unfilmed options render
correctly, a selection question would show a partial grid. That is worse than
showing nothing: a patient offered three body parts when their pain is in a
fourth taps the nearest available one, the doctor receives a plausible wrong
answer, and nothing about it looks wrong. Misdiagnosis risk from constrained
answers is one of the problems this project exists to reduce.

So a selection question is now only offered when every one of its options is
filmed and approved, and an incomplete grid is withheld with an instruction to
ask in person. Yes or no questions are unaffected, because a nod needs no
footage, and that is the only usable path today. See ADR 022.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 119 passed |
| Frontend suite | 140 passed |
| Live `/api/questions/` | 200, nine questions, all correctly reported as not yet playable |

---

## Sprint 4 redesign, Guided Interrogation without a question bank

**Why it changed.** The bank was built as FR 2.4 describes it, nine
categorised questions. Seeing it in the browser made the problem obvious: a
consultation is a conversation, and a fixed list cannot follow one. The doctor
could not ask "how many days?" after a yes, or anything nobody thought of in
advance, while the literate path already let them type or speak freely.

**What it is now.** Guided Interrogation uses the same doctor input as the
literate path. The difference sits entirely on the patient's side, which is
where it belongs: they answer yes or no, by tapping or by nodding for the
doctor to confirm. "Where does it hurt" keeps a dedicated action, because a
place cannot be answered yes or no, and the body locations appear for the
patient to point to. See ADR 023.

### What was removed and what replaced it

| Removed | Replaced by |
| --- | --- |
| `questions` app: models, serializers, views, admin, seed, 29 tests | Nothing. The doctor types or speaks |
| `ClinicalQuestion`, `AnswerOption` | `clips/body_locations.py`, a named clip set with no model |
| `GET /api/questions/` | `GET /api/clips/body-locations/`, one query |

Shared rather than duplicated, since both paths now do the same thing on the
doctor's side:

| New shared piece | Used by |
| --- | --- |
| `useCaption` | Both paths: one request, status, and failure path |
| `DoctorUtteranceForm` | Both paths: language, typing, microphone, all its notices |
| `CaptionResult` | Both paths: caption, player, coverage, provider warning |

`DoctorConsultation` is now 35 lines. It was 200.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 90 passed, 29 fewer with the bank gone |
| Frontend suite | 138 passed |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Live `/api/clips/body-locations/` | 200, 16 locations head downwards, none filmed yet |
| Live `/api/questions/` | 404, correctly gone |

### The trade this makes, recorded rather than glossed over

SRS section 4.3 justified the fixed bank as preventing an unreviewed sign video
being generated on the fly. Free input reintroduces that risk: a doctor can
type a word the library has no sign for.

What makes it acceptable is that the gap was already visible. Every caption
reports which words were spelled out and which could not be signed, on screen,
before the doctor relies on it. An unreviewed sign is still never invented,
because resolution only returns consultant approved clips. Coverage is now
reported rather than guaranteed in advance: a weaker promise, but an honest one.

### Note on the development database

Removing the app leaves its two tables behind in any existing `db.sqlite3`,
since there is no migration to drop them once the app is gone. Harmless, and
they disappear on a fresh database. Nothing references them.

---

## Sprint 5, Patient responses spoken aloud

**Goal.** FR 3.1 to 3.5. Every patient response reaches the hearing clinician
as speech, whether the patient typed it or tapped it.

### What was built

| Piece | Purpose |
| --- | --- |
| `POST /api/speak/` | Translates if needed, then synthesises, returning audio inline with the text that was spoken |
| `speak_response()` | FR 3.2, one translation call only when the two languages differ |
| `useSpokenResponse` | Playback plus the section 6 vibration vocabulary around it |
| `SpokenResponse` | Section 4.2, waveform while speaking, completed state when finished |
| `PatientReply` | FR 3.1, the literate patient types in English or Twi |
| Output language on the visit | FR 3.4, set once, always visible per section 4.1 |
| Silent WAV from the stub | So the whole feedback loop works with no Khaya key |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 102 passed |
| Frontend suite | 177 passed, 15 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Production build | PWA builds |
| Live `POST /api/speak/` | 200, 12.8 KB valid WAV, translation applied, provider reported |

### The feedback is the feature

FR 3.4's value is not the audio, it is knowing the audio happened. A Deaf
patient cannot hear whether their answer reached the doctor, so section 4.2
asks for a waveform that resolves into a completed state, and section 6 fixes
the vibration: two short pulses when speech starts, one long pulse when it
ends. Both patterns were already defined in sprint 3 and are used here for the
first time, which is what a single sourced vocabulary is for.

All of that hangs off real playback events, so the stub now returns a valid
silent WAV rather than the placeholder bytes it used to. See ADR 024. That
makes the flow demonstrable and testable without spending metered credit.

Silence is convincing in the wrong way, because the flow looks complete. So
the stub notice here is the bluntest in the app: the audio was **silence, not
speech, and nobody heard the answer**. This is the ADR 011 problem at its
worst, since everyone in the room would otherwise assume the doctor heard.

### Problems hit, and the fixes

**Three language selectors now share one screen.** The doctor's input
language, the patient's writing language, and the spoken output language are
three different settings per FR 1.1, FR 3.1 and FR 3.4, and every one of them
offers English and Twi. Tests began failing with "found multiple elements with
the role radio". Each group now carries an identity and the tests query within
the group they mean, which is also the accessible structure: a screen reader
announces the legend with the option.

**A `loadVisit` edit silently did not apply.** A scripted string replacement
did not match the file, so the output language fallback was never added, and a
stored visit from before the field existed returned `undefined`. Caught by the
test written for exactly that case. An undefined language would have been sent
to the server, rejected, and turned an old visit into a broken consultation.

**Blob URLs leak unless revoked.** Each spoken answer creates one, so a long
consultation would accumulate them. Released when playback ends and when a new
answer replaces the previous one, with tests for both.

### Known limitations, deliberate

**Audio is base64 inside the JSON** rather than a separate binary response.
That costs about a third in size, and buys the spoken text and the provider
name arriving with the audio, which the interface needs in order to say the
audio was stub silence. A bare audio body could not carry that.

**Nothing is saved yet.** The consultation log is still in memory. FR 4.1 to
4.3 make it a durable transcript on the patient's own device, which is the next
sprint and completes P0.

---

## Sprint 6, The session transcript. P0 complete

**Goal.** FR 4.1 to 4.3, the patient's own record of the consultation, and with
it the last of P0.

### What was built

| Piece | Purpose |
| --- | --- |
| `transcript/transcript.js` | The record, on the device, with every read and write guarded |
| `useTranscript` | Reads what is already stored on mount, so a reload loses nothing |
| `TranscriptView` | FR 4.3, view, scroll, delete behind a confirmation, and save a copy |
| Both paths recording | FR 4.1, both directions, on the literate and guided paths alike |
| `core/test_no_transcript_endpoint.py` | NFR 4, asserted against the API surface itself |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 104 passed |
| Frontend suite | 208 passed, 17 files |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Migration drift | none |
| Production build | PWA builds |

### The privacy property, and how it is defended

FR 4.2 says the transcript is stored only on the patient's device. That is kept
by there being nowhere to send one. Two tests walk the entire URL configuration
and fail if any route's path or name suggests it could carry a consultation
record, and a second pins the named API surface so adding an endpoint is a
deliberate act rather than something that happens quietly.

Tests about absence are easy to forget to write, and this is the one property
the project's privacy claim rests on.

The harder half is the shared device. A transcript that outlived its visit would
show the next patient the previous patient's consultation, and these
consultations are about pregnancy, sexually transmitted infections, and HIV
status. So the transcript is deleted when the visit ends, by the same control
that clears the literacy answer, and the patient can take a plain text copy
first. One test puts "I am HIV positive" into a transcript, ends the visit, and
checks the next patient sees nothing, because that is the case that actually
matters. See ADR 026.

### A decision revised

ADR 002 said IndexedDB. The transcript is a few kilobytes of text, so
localStorage is enough, synchronous, and testable without a polyfill, which
means the failure paths that matter are directly covered: storage blocked,
storage full, a corrupt record. Recorded as ADR 027, which supersedes only the
storage mechanism in ADR 002, not its substance.

### Problems hit, and the fixes

**The stubbed localStorage had no `clear()`,** which the test hooks call, so
four tests failed on teardown rather than on their subject. Stubs gained the
method and the teardown now unstubs before clearing.

**FR 2.7's attribution was stored but not shown.** The transcript kept whether
an answer was the patient's tap or the doctor's confirmation, and then rendered
neither. Two tests caught it. A patient reading their record later has to be
able to tell which answers were their own, so it is displayed.

**The route pinning test broke itself.** Normalizing regex anchors with
`replace("^", "")` also gutted the character class in `[^/.]`, turning it into
`[/.]`. Rewritten to compare route names, which are readable and stable, rather
than patterns.

### Where the project stands

P0 is complete. The remaining work is not code:

- **Filmed GhSL footage.** 95 glosses, zero usable clips. Captions and
  questions correctly report they cannot be signed yet, and coverage appears
  with no code change once footage is imported.
- **Consultant review** of the question wording and emergency alerts.
- **The NFR pass**: the five second budget under a throttled network, and a
  Safari and iOS device check.

P1, Emergency Visual Triage and Prescription Playback, is genuinely optional
and was always scoped that way.

---

## Sprint 6 follow up, naming the saved record and refusing empty input

Two gaps found by using the app rather than reading it.

### The saved record had no name on it

A downloaded file with no name is not recognisably the patient's, which is the
point of a record they take away.

The name is asked for at the moment of saving, used in that file, and
discarded. Deliberately not stored with the visit alongside the literacy answer
and the output language, because ADR 026 already accepts that a transcript can
be left behind if a visit is not ended properly. A name stored beside it would
turn a stray record from an anonymous fragment into one identifying exactly
whose consultation about HIV status or pregnancy a stranger had read. See
ADR 028.

The interface says the name is not stored, because a privacy property nobody
can see is worth little. The saved file now also carries the time each exchange
happened and who confirmed each answer, so FR 2.7's distinction survives into
the patient's own copy.

### An empty send did nothing and said nothing

Both message forms ignored an empty submission and returned. A silent no op is
the worst available behaviour, and worse on each side for a different reason.

The doctor would assume the message reached the patient and wait for an answer
that is never coming, in a consultation where the difficulty is already that
neither party can confirm the other understood.

For the patient it is worse. A Deaf patient cannot hear whether anything was
spoken aloud, so a button that appears to do nothing is indistinguishable from
one that worked silently. They would believe they had answered the doctor.

Now both forms show a message beside the field, mark the field invalid for
assistive technology, and clear on the first keystroke rather than on the next
submit. The doctor's wording mentions the microphone only where the browser
supports it. See ADR 029.

### Verification

| Check | Result |
| --- | --- |
| Frontend suite | 226 passed, 17 files |
| Lint | eslint clean at zero warnings |
| Production build | PWA builds |

---

## Making the stitched video actually continuous

**The problem.** Playback advanced by changing the `src` of a single video
element. That makes the browser tear down the current video, load the next, and
decode its first frame, which shows as a flash of black between every word. The
hidden preload element helped the network but not the display, because the
element that has to show the clip still had to load and decode it itself.

So the sentence played as a series of clips with visible joins, not as one
video, which is what FR 1.7 asks for.

**The fix.** Two video elements stacked in the same space. While one plays, the
other already holds the next clip fully fetched and decoding. When the playing
clip ends they swap roles, and the newly visible element keeps the `src` it
already had, so nothing reloads and playback continues on the following frame.
See ADR 030.

The standby element is hidden with `opacity: 0`, not `display: none`. A
`display: none` video is not required to keep decoding, which would have
defeated the whole point.

### Verification

| Check | Result |
| --- | --- |
| Frontend suite | 230 passed, 17 files |
| Lint | eslint clean at zero warnings |
| Production build | PWA builds |

The handover is asserted by element identity: the standby element must *become*
the playing one, rather than the playing one being given a new source. That
identity is the mechanism, and a refactor that reintroduced a `src` swap would
look correct while quietly restoring the flash.

### Problems hit, and the fixes

**Two existing tests held a stale element.** They captured the video once and
fired `ended` on it repeatedly. With two buffers the playing element alternates,
so the second event landed on the standby element, which has no `ended`
handler. That is correct behaviour, not a bug: in a real browser only the
playing element fires the event. The tests now re-query before each event, which
is also a more accurate description of what happens.

### Still open, deliberately

If a visible join remains once real footage is in, the next step is server side
concatenation with ffmpeg, cached per resolved sentence. That gives up per clip
caching and adds a runtime dependency, so it is worth doing only if this proves
insufficient with clips that are actually filmed. Noted in ADR 030 so the
option is not lost.

---

## Really stitching the sentence into one video

**The complaint, which was right.** Two buffers made the picture continuous,
but the control bar still showed each clip's own length and the timeline
restarted at every word. A two word sentence read "0:01 / 0:01" twice. The
patient sees a sequence of short videos, not a sentence, however smooth the
transition is.

**What it does now.** The backend concatenates the resolved clips into one real
MP4 with ffmpeg and returns its URL with the sequence. The player uses that
file when it exists: one video, one timeline, one duration, and no "Sign 2 of
2" caption contradicting what is on screen. See ADR 031.

Each stitched sentence is encoded once and cached under a key derived from the
exact ordered clips in it, so repeats are served from disk. A consultation
repeats its phrases constantly, which is what makes this affordable inside
NFR 1's budget.

### Why this reverses part of ADR 008

Two of ADR 008's three objections to stitching were about cost, and caching
answers both: the first encode of a novel sentence costs a second or two, every
repeat costs nothing. The third, that a stitched file cannot be cached per clip,
still stands, which is why individual clips are still served and cached for
FR 6.2's offline replay. The stitched file is an addition, not a replacement.

### Design details that matter

**Padded, never cropped.** Clips come off whatever phone was to hand, so they
differ in resolution and aspect ratio and have to be normalized before concat
will accept them. Cropping to fit could cut a signer's hands out of frame, and
a sign without its hands is a different sign or none at all.

**Audio dropped.** Sign clips carry no meaningful sound, and mismatched audio
streams are the commonest reason concatenation fails.

**Written aside, then moved.** A failed or timed out encode would otherwise
leave a truncated file under a cache key that is trusted forever.

**Paths anchored to MEDIA_ROOT.** A clip URL pointing anywhere else is refused
rather than read off disk.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 121 passed, 17 new for stitching |
| Frontend suite | 235 passed |
| Lint and formatting | black, isort, ruff, eslint all clean |

ffmpeg is not installed on this machine, and is not assumed by the tests. The
encode itself is never run in them. What is tested is everything around it: the
cache key, that a cached file is reused rather than re-encoded, that a missing
tool or a failed encode falls back to the playlist rather than breaking the
consultation, and that the command built is the one intended.

### Problems hit, and the fixes

**A null byte ended up in the source.** `" ".join(...)` was written with the
separator as a literal `\0`, and Python refused the whole module with
"source code string cannot contain null bytes", reported against a different
file than the one at fault. Found by scanning every Python file for null bytes.
The separator is now a newline, which cannot appear in a path and so is an
unambiguous delimiter for hashed material anyway.

### Still needed locally

ffmpeg is not installed here, so the fallback path is what runs until it is:

```bash
sudo apt install ffmpeg
```

It is already in the backend Dockerfile, so the containerized stack and any
deployment have it.

---

## Keeping the consultation across a page reload

**What was actually lost.** The transcript already survived a reload, so the
written record was safe. What went was the live part: the question on screen,
the stitched video the patient may not have finished watching, and whether they
were part way through pointing at a body location.

A reload is ordinary on a hospital device, and losing the question at that
moment means asking the patient to sit through it again. If they had already
worked out their answer, it means asking them something they thought they had
settled.

**What it does now.** The exchange on screen is stored on the device and
restored on load, cleared when the question is answered and when the visit
ends. See ADR 032.

Restoring whether a body location was expected matters more than it sounds: a
reload otherwise drops the patient back to a yes or no they were never asked,
against a question that wanted a place.

Because the question now survives a reload, it also has to be destroyed when
the visit ends, or the next patient would find the previous patient's question
waiting for them. Asserted by a test, for the same reason as ADR 026's
transcript test.

### Verification

| Check | Result |
| --- | --- |
| Frontend suite | 252 passed, 18 files |
| Lint | eslint clean at zero warnings |
| Production build | PWA builds |

### Problems hit, and the fixes

**A restored record could crash the screen on load.** The first version checked
only that a caption was present. A caption missing its resolved sequence, from
an older version or a partial write, made `CaptionResult` throw while
destructuring, taking down the consultation screen on load, which is strictly
worse than losing the question.

Found by a test that deliberately stored an incomplete caption. Records are now
validated by shape, and anything that does not match fails closed so the screen
starts clean.

---

## The safety gate: refusing sentences that would change meaning

**The bug, verified live before fixing anything.** A word with no sign was
absent from playback, and absence changes meaning.

```
doctor says : "ask about"      patient sees : [ASK, ABOUT]
doctor says : "ask no about"   patient sees : [ASK, ABOUT]
```

Byte-identical video for two different sentences. `"do you have no pain"`
played as `PAIN`. `"take two tablets"` played as `TABLETS`, no dose. `"stop
the medicine"` played as `MEDICINE`, the opposite instruction.

Neither person could catch it. The doctor does not read GhSL, so cannot see
what was shown. The patient never saw the typed words, so cannot know they
were asked something else. This is the failure the project exists to reduce,
and we were producing it.

**Now:**

```
doctor says : "ask no about"   blocking : [no]   safe to show : False
doctor says : "ask about"      blocking : []     safe to show : True
```

### What was built

| Piece | Purpose |
| --- | --- |
| `clips/safety.py` | Classifies words by what their absence does: droppable, blocking, content |
| Blocking refusal | Negation, dose, frequency, timing, severity, any number. Missing means the sentence is not shown |
| Droppable omission | Articles and copulas left out rather than spelled. GhSL does not use them |
| Confirmation gate | The doctor reads back the glosses the patient will see, when they differ from what was typed |
| `ClipAlias` | Reviewed alternative words, ADR 034. No AI in the patient path |
| Shown-not-attempted recording | The transcript records what the patient saw, not what was tried |

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 155 passed, 33 new for safety and aliases |
| Frontend suite | 261 passed |
| Lint and formatting | black, isort, ruff, eslint all clean |
| Production build | PWA builds |
| Live | `"ask no about"` refused, `"ask about"` shown |

### Why the pieces are shaped this way

**Dropping articles is safe, not a compromise.** GhSL has no articles and no
copula: "do you have pain" is signed roughly `PAIN YOU`. Omitting them is more
natural GhSL. Spelling them letter by letter would be worse, spending a
patient's attention on words carrying nothing.

**Blocking words are never fingerspelled.** Spelling `no` to a patient who may
not be print literate is not a rendering of "no", and assuming they followed it
is the same risk in a different shape.

**Confirmation is conditional.** A sentence rendered entirely in reviewed signs
goes straight through. Confirming something with nothing wrong with it would
teach the doctor to tap through without reading, making the gate worthless.

**Aliases are reviewed, not inferred.** "Do you have pain" and "do you have
severe pain" are close in any vector space and are different clinical
questions, and nobody present could detect the substitution. So an alias is a
consultant's recorded judgment, with its own reviewer, and it cannot reach
unreviewed footage.

### Problems hit, and the fixes

**An infinite render loop.** `CaptionResult` reports upward when the patient
has seen an utterance. The callback's identity changes on every render of the
caller, so the effect fired, set state, re-rendered, and fired again. The test
run hung rather than failing. Guarded with a ref holding which utterance has
been reported, which also guarantees one transcript entry per utterance rather
than one per render.

**Droppable words were being fingerspelled.** The fingerspelling branch ran
before the droppable check, so "the" spelled as T-H-E. Reordered: risk is
classified before spelling is attempted.

**A test expectation was wrong, not the code.** I asserted that "you" and
"have" would be dropped. They are not on the conservative droppable list, so
they are spelled. Both are arguably safe to drop, but that is a clinical
judgment for the team, so the test now documents the current behaviour and
ADR 033 records the open question.

**The dev database was missing the alias table.** The migration was created but
never applied locally, so the live endpoint returned 500 while every test
passed, because pytest builds a fresh database from migrations each run.

### What this costs, stated plainly

With 95 glosses and two filmed, most sentences are now refused. That is correct
and temporary: coverage improves as footage is filmed, and a refusal is
visible, whereas the alternative was a silent wrong answer.

---

## Making footage import idempotent, watchable, and reachable from the admin

**The question that prompted it.** Why does dropping a clip in `footage/` not
show up in the app? Because nothing watched the folder: `footage/` is an inbox
and `media/clips/` is the store, and until an import ran the file sat in a
directory the app never looked at.

**What was added.** Three ways to ask for an import, sharing one code path in
`clips/importing.py` so the command and the button cannot drift:

- `import_clips footage/`, once
- `import_clips footage/ --watch`, polling every three seconds, for filming
- **Import footage folder** on the clip list in the Django admin

Polling rather than a watcher library: no dependency, identical on every
platform and over a network share, which is what a mounted volume in a
deployment will be.

### The guard that had to come with it

Re-importing resets approval to pending, deliberately, because a consultant
approved the recording that was there before. So anything that re-runs an
import would silently un-approve reviewed footage: the watcher polling, a file
sync touching timestamps, a second click of the button.

That failure would be invisible. The doctor would see no error, just sentences
starting to be refused mid consultation, with nothing connecting that to a
folder having been scanned again.

A clip now records the checksum of the file it came from, and matching contents
are left completely alone. By content hash, not modification time, because a
timestamp changes when nothing about the file does. A test sets the mtime to
zero and asserts the approval survives.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 165 passed, 10 new |
| Lint and formatting | black, isort, ruff all clean |
| Live, first run | 1 new, 2 replaced, 1 non video ignored |
| Live, second run | `unchanged 3 clip(s), left alone` |

The admin import is POST only, since importing replaces footage and resets
approvals and must not be reachable by anything that follows links. It approves
nothing: a button cannot vouch for a medical sign any more than a script can.

### One time effect worth knowing

Clips imported before the checksum field existed have no recorded checksum, so
the first import after this change counted them as replaced and reset their
approval. Correct rather than convenient: we cannot know whether the file on
disk is the one that was reviewed.

### Also removed

A `video_files` helper left over from an earlier shape of the command, unused
by anything.

---

## Reaching the Django admin, and two bugs on the way

**The question.** How do you visit the admin page? It turned out there were
three obstacles, two of them mine.

**No account existed.** `createsuperuser` is interactive, so it has to be run
by a person. Now documented in `SETUP_GUIDE.md` alongside what the admin is
actually for.

**`localhost:5174/admin/` returned the React app with a 200.** The dev server
proxied only `/api` and `/media`, so `/admin` fell through to the SPA
fallback. Someone looking for the admin got the patient screen and no error to
explain it, which is the most confusing outcome available. `/admin` and
`/static` are now proxied in development, matching what nginx already did, for
the same reason as ADR 006: development should fail the way deployment does,
or not at all.

**Then CSRF rejected the login with a 403.** Caused by the fix above.
Proxying `/admin` means the browser's `Origin` is the Vite port while Django
sees its own host, and Django treats the mismatch as a cross site request. The
error message talks about cookies and template tags and says nothing about
proxying, so it is not a message that leads anywhere useful.

`CSRF_TRUSTED_ORIGINS` is now set, env overridable, defaulting to the dev
origins. It includes port **5174** as well as 5173, because Vite moves to the
next free port when 5173 is taken, which happens routinely on a machine
running more than one project. A test asserts 5174 is covered, since the admin
would otherwise break for a reason nobody would connect to a port number.

nginx also gained `/static`, without which the admin loads entirely unstyled
in the containerized stack, broken enough that someone would assume it was.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 168 passed, 3 new |
| `5174/admin/login/` | Django's login page, styled |
| CSRF through the proxy | POST accepted, credentials rejected on their merits |

---

## Logging into the admin broke the consultation screen

**Symptom.** Every message failed with "Could not reach the language service".
The service was fine.

**Cause.** Two things I had done collided. DRF's default authentication
includes `SessionAuthentication`, which enforces CSRF for any request carrying
a session cookie, and approving clips in the admin left one in the same
browser. Every API call from the app was then treated as authenticated and
CSRF checked, and the app does not send `X-CSRFToken`. The server returned 403.

**Two ways this hid itself.**

The message on screen was wrong. The frontend cannot tell a 403 from a network
failure, so it blamed the language service, which was reachable and working.

And my own `curl` check returned 200, because an anonymous request is never
CSRF checked. The endpoint looked healthy from the terminal while the browser
could not use it. Testing an API with curl does not reproduce a browser that
has cookies.

**Fix.** The API authenticates nobody. It has no user accounts and never reads
`request.user`, so session authentication bought nothing and cost this. CSRF
protects against a request that changes state as the authenticated user, and
none of these do. See ADR 036.

The Django admin is untouched, which is where CSRF actually matters: its forms
do change state as an authenticated user, including the footage import.

### Verification

| Check | Result |
| --- | --- |
| Backend suite | 171 passed, 3 new |
| Reproduced first | 403 in a test before any fix |
| Live, with a real session cookie | caption returns 200, `['APPEAR']`, safe to show |

The reproduction needed `enforce_csrf_checks=True` plus a logged in user. The
default test client skips the check, which is why 416 tests passed while a real
browser could not send a message. A suite that only exercises the API the way
curl does cannot see this class of bug.
