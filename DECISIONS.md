# Architecture Decision Record

Every decision that would be expensive to reverse, with the reasoning that
produced it. The point is that a reviewer, a teammate, or the three of us in
two weeks can tell the difference between a deliberate choice and an accident.

Format: context, decision, consequence. Newest last.

---

## ADR 001, Retrieval based sign rendering, not generative synthesis

**Context.** Converting Twi text to Ghanaian Sign Language is the core
technical problem. The two available approaches are generating sign animation
from text, or matching text against a library of clips recorded in advance.

**Decision.** Retrieval. Tokenize the caption, match each token to a reviewed
GhSL clip by its English gloss, play the matched clips in sequence, and fall
back to fingerspelling for anything unmatched.

**Why.** Generative sign synthesis is an unsolved research problem for every
sign language globally, not just GhSL. Attempting it would produce a demo that
fails unpredictably on the exact clinical vocabulary that matters. The 2026
SignTalk Gh research validates retrieval specifically for healthcare domain
sign applications.

**Consequence.** Quality is bounded by the clip library, so the library is a
first class asset with its own review process, not an implementation detail.
Coverage gaps are visible and measurable rather than hidden behind plausible
looking but wrong output. Fingerspelling is mandatory, not optional, because
it is what makes an incomplete library still usable.

---

## ADR 002, The session transcript is canonical on the patient's device

**Context.** SRS FR 4.2 and NFR 4 require that the full transcript is stored
only on the patient's own device and never transmitted without explicit
patient action. `ENGINEERING_STANDARDS.md` separately describes a backend
`sessions_log` app, which implies server side storage. These conflict.

**Decision.** The SRS wins. The transcript is canonical in IndexedDB on the
patient's device. The backend holds only the live exchange needed to keep the
doctor's screen and the patient's screen in sync during an active
consultation, and discards it when the session ends.

**Why.** Privacy for Deaf patients is not a feature of this project, it is the
reason a patient would trust it instead of bringing a family member or pastor
to interpret. A promise that depends on a permission setting can be
misconfigured. A promise that depends on the server never having the data
cannot.

**Consequence.** There is no endpoint that returns a stored transcript,
because none exists to return. A test asserts this rather than trusting it.
Transcript export, if we ever add it, is an explicit patient initiated action
and a new decision record.

---

## ADR 003, GhanaNLP Khaya AI for Twi speech and translation

**Context.** The app needs Twi automatic speech recognition, English to Twi
translation, and Twi and English text to speech.

**Decision.** GhanaNLP's Khaya AI, behind a provider interface in our own
code.

**Why.** General purpose Western speech tools fail on Twi, and fail worse on
Ghanaian speech that mixes Twi and English inside one sentence, which is how
people actually talk in a Ghanaian hospital. Khaya is built for exactly this.

**Consequence.** We depend on a third party service, so every language
operation goes through an interface with a deterministic stub implementation.
The stub is what CI and the test suite run against. A network problem during
judging must never look like a broken app.

---

## ADR 004, Django and DRF backend, React and Vite PWA frontend

**Context.** Stack choice for a time boxed build with a small team.

**Decision.** Django with Django REST Framework on the backend, React built by
Vite and shipped as a Progressive Web App on the frontend.

**Why.** Django's admin gives us a clip library and clinical question bank
review interface for free, which matters because both are admin managed by
design. A PWA installs to any device hospital staff hand over, with no app
store, and its service worker is what makes offline clip replay possible under
the connectivity NFR 5 describes.

**Consequence.** Two toolchains to keep green, which is why CI runs both
halves independently.

---

## ADR 005, SQLite fallback for development, PostgreSQL in CI and deployment

**Context.** Requiring PostgreSQL before anyone can run the test suite adds a
setup step during onboarding.

**Decision.** `DATABASE_URL` unset falls back to SQLite. CI and every
deployment set it to PostgreSQL explicitly.

**Why.** A teammate should be able to clone the repo and get a green test run
in one command. But a query or migration that only works on SQLite would then
fail at deployment, so CI runs against the real database on every push.

**Consequence.** The two are never assumed equivalent. CI is the authority on
whether something works, not a local run.

---

## ADR 006, The dev server proxies /api, mirroring nginx

**Context.** In development the frontend and backend are separate origins. In
the containerized stack nginx serves both from one origin. Configuring the
frontend with an absolute backend URL makes those two cases behave
differently.

**Decision.** The Vite dev server proxies `/api` and `/media` to Django. The
frontend only ever calls the relative path `/api`.

**Why.** A CORS failure or a hardcoded host that works locally and breaks only
in deployment is a category of bug that surfaces at the worst possible time.
Making development match deployment removes the category rather than
remembering to test for it.

**Consequence.** The proxy target is configurable, because a developer may
already have another project holding port 8000. The config reads it with
Vite's `loadEnv`, not `process.env`, since a Vite config runs before `.env`
files reach the process and `process.env` would ignore `.env.local` silently.

---

## ADR 007, HTTPS hardening is gated on an explicit variable, not on DEBUG

**Context.** `manage.py check --deploy` requires secure cookies, HSTS, and an
SSL redirect once `DEBUG` is off.

**Decision.** Those settings switch on with `DJANGO_SECURE_SSL=1`, not
automatically whenever `DEBUG` is off.

**Why.** A hackathon demo may legitimately run with `DEBUG=0` over plain http
on a local network. An automatic HTTPS redirect there makes the app completely
unreachable, during the one demo that matters.

**Consequence.** Deployment must set the variable. It is documented in
`backend/.env.example` next to the setting it controls.
