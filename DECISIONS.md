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

---

## ADR 008, A sign sequence is an ordered playlist, not a stitched video file

**Context.** FR 1.7 says matched clips are "stitched into a single sign video".
That can be read as server side video concatenation, producing one file per
sentence, or as an ordered list that one player plays back seamlessly.

**Decision.** The API returns an ordered sequence of clip references. A single
player component plays them back to back so the patient sees one continuous
signed sentence.

**Why.** Three reasons, in order of weight.

Server side concatenation costs seconds of encoding per sentence. NFR 1 allows
five seconds for the entire pipeline including speech recognition and
translation, so spending most of that budget re encoding video we already have
would break the requirement outright.

A stitched file is unique to its sentence, so it can never be cached. Clip
references are cached per clip, which is what makes FR 6.2's offline
prescription replay possible at all, and what makes the second sentence in a
consultation faster than the first.

It also needs no ffmpeg in the runtime image, so the backend container stays
small and the dev setup has one less system dependency.

**Consequence.** Seamless playback is now the player's responsibility, and a
visible stutter between clips would be a real defect rather than a cosmetic
one. The player must preload the next clip while the current one plays. That
is a frontend concern for the sprint that builds it.

---

## ADR 009, A clip row may exist before its footage does

**Context.** The project needs 30 to 50 reviewed GhSL clips, which have to be
filmed and then checked by a GhSL fluent consultant. Neither had happened when
the library was built, and the team needs to know what is still outstanding.

**Decision.** `SignClip.video` may be empty. A row with no footage records a
gloss the project needs. A clip is only resolvable when it is both approved
and filmed, which is one queryset method, `resolvable()`, used everywhere.

**Why.** The alternative is tracking outstanding footage in a spreadsheet
beside the code, which goes stale immediately. Making the library itself the
record means `manage.py seed_clips --report` answers "what still needs
filming" from the same data the app serves, and the Django admin doubles as the
review queue.

**Consequence.** Every read path must go through `resolvable()`, never a bare
`SignClip.objects.all()`, or an unfilmed or unreviewed clip could reach a
patient. Tests assert this for both the resolver and the API.

---

## ADR 010, Word glosses are single words, phrase matching is deferred

**Context.** Some clinical concepts are one sign but several English words,
for example "how many" or "two times daily".

**Decision.** Glosses of kind `WORD` are single words only. Multi word signs
are not matched from captions in this sprint.

**Why.** The tokenizer splits on non word characters, so a gloss like
`HOW-MANY` could never be produced from a caption and would sit in the library
looking supported while never matching anything. Honest absence beats a
feature that appears to exist.

**Consequence.** Multi word concepts currently fingerspell, which is worse for
the patient. Phrase level matching, longest match first across a token window,
is the fix and belongs in a later sprint. Emergency alerts avoid the problem
entirely because the patient selects them directly rather than through
tokenized text, which is why `CANNOT_BREATHE` is kind `ALERT`.

---

## ADR 011, Every caption response names the provider that produced it

**Context.** With no Khaya key, the stub provider returns the input text
unchanged rather than translating it. The response therefore contains English
text in a field labelled as a Twi caption. In a demo that is indistinguishable
from working translation until a Twi speaker reads it.

**Decision.** The caption response carries a `language_provider` field, either
`"khaya"` or `"stub"`, and the interface shows a visible notice whenever it is
`"stub"`.

**Why.** The failure mode this prevents is the worst kind: silently
overclaiming. A judge who is a Twi speaker would immediately notice untranslated
output presented as a translation, and the project would look like it was
faking the feature rather than honestly running without a credential. Making
the provider visible turns a potential credibility problem into evidence of
deliberate engineering.

The alternative, having the stub invent Twi from a small hardcoded glossary,
is worse. Fabricated clinical Twi would be confidently wrong in exactly the
setting where being wrong matters most, and nobody on the team can verify it.

**Consequence.** The field is part of the API contract, and the frontend must
render the notice. A test asserts the field is present and correct, and another
asserts the stub leaves text unchanged so nobody later mistakes that for a bug
and "fixes" it by inventing translations.

---

## ADR 012, The live exchange app is `consultations`, not `sessions_log`

**Context.** `ENGINEERING_STANDARDS.md` anticipated a backend app called
`sessions_log`. ADR 002 then moved the transcript to the patient's own device.

**Decision.** The app is called `consultations` and owns the live doctor to
patient exchange, starting with the caption pipeline.

**Why.** There is no server side session log for an app to own. Keeping the
name `sessions_log` would advertise storage that ADR 002 deliberately does not
exist, and the first person to go looking for stored transcripts would waste
time before finding out why the directory is empty. The name should say which
of the two things this is.

**Consequence.** A deviation from the scaffold the engineering standards
describe, recorded here so it reads as a decision rather than drift.

---

## ADR 013, Khaya translation uses the v2 endpoint

**Context.** Verifying the Khaya integration against a live account on
2026-09-12, the v1 translate endpoint worked and returned correct Twi. It also
returned these response headers:

```
deprecation: true
sunset: 2026-09-06T23:59:59Z
link: </v2/translate>; rel="successor-version"
```

The sunset date had already passed.

**Decision.** Use `/v2/translate`. It was tested with an identical payload,
returned identical output, and carries no deprecation headers.

**Why.** An endpoint past its announced sunset can be withdrawn without
notice. Building the headline demo on it means the demo might fail on the day
of judging for reasons entirely outside our control, and with no warning.

**Consequence.** A test asserts the request URL ends in `/v2/translate` and
does not contain `/v1/translate`, so a future refactor cannot quietly revert
to the sunset endpoint. Endpoint paths are module level constants in the
provider, so a later version bump is a one line change.

Worth noting how this was found: reading response headers on a verification
call, not from documentation. The call succeeded, so nothing would have
surfaced this if we had only checked the status code.

---

## ADR 014, Sign lookup uses English text, never the Twi caption

**Context.** The first implementation of the caption pipeline translated the
doctor's English into Twi, then resolved GhSL clips from that Twi caption. All
tests passed. Against real Khaya translation, every lookup failed:
"Where does it hurt?" became "Ɛhe na ɛyɛ yaw?", which tokenizes to `ɛhe`,
`na`, `ɛyɛ`, `yaw`, and those are matched against a library keyed on English
glosses like `WHERE` and `HURT`. Nothing could ever match.

**Decision.** One utterance produces two renderings. The **caption** is Twi,
because that is what the patient reads. The **sign lookup text** is English,
because that is what the clip library is keyed on, per the SRS definition of
Gloss and FR 1.5. Clips resolve from the English, never from the caption.

For English input that is one translation call, for the caption. For Twi input
it is one call in the other direction, to get English for lookup. Either way
exactly one call, so no extra latency against NFR 1.

**Why.** FR 1.5 says the lookup key is the English gloss. Resolving from the
Twi caption contradicts that, and produces a system that reports every word as
unavailable while looking entirely correct in tests.

**Consequence.** The response carries `sign_lookup_text`, and the interface
shows it whenever a sign is missing, because with Twi input the text actually
searched is a translation rather than what the doctor typed. A test using a
provider with visibly directional translation asserts the caption is never used
as the lookup key.

The wider lesson is recorded deliberately: a stub that returns its input
unchanged is honest but it makes two different code paths look identical. This
bug was invisible under the stub and total under the real provider. Where a
stub's simplification could hide a direction or a mapping, the test needs a
provider that transforms visibly, which is why `directional_provider` exists
alongside the ordinary stub.

---

## ADR 015, The language provider is explicitly selectable, defaulting to stub in dev

**Context.** The project uses Khaya's free tier, where every translation,
transcription, and synthesis call spends metered credit. Selecting the provider
purely on "is a key present" meant that simply having the key configured made
all ordinary development spend that credit.

**Decision.** A `LANGUAGE_PROVIDER` setting takes `auto`, `stub`, or `khaya`.
Local development sets `stub`, so the key can stay configured without being
used. `khaya` is set deliberately, for a verification run, then unset. `auto`
keeps the original behaviour and remains the default for deployment.

`khaya` with no key raises rather than falling back to the stub, because a
verification run that silently used the stub would prove nothing while
appearing to pass.

**Why.** Credit exhausted during development is credit unavailable during
judging. The constraint is real, so it belongs in configuration rather than in
somebody remembering not to run the wrong thing.

**Consequence.** An autouse test fixture forces `stub` and clears the key for
the entire suite, so no test can reach a metered service even on a machine
where a key is configured. The three provider selection tests override it
explicitly, and are the only place that should.
