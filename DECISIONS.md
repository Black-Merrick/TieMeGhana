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

---

## ADR 016, Record in whatever format the browser supports, and say which

**Context.** FR 1.2 needs the doctor's speech captured in the browser.
Browsers do not agree on a recording format: Chrome and Firefox produce WebM
with Opus, Safari on iOS produces MP4 and cannot produce WebM at all. NFR 6
lists Chrome, Safari, and Firefox on both Android and iOS.

**Decision.** Ask the browser which of a preference ordered list of formats it
supports and record the first one, falling back to letting it choose. The
chosen format travels to the backend as the upload's content type, and the
backend forwards it to Khaya rather than asserting a single format.

**Why.** Hardcoding WebM would make the microphone silently unusable on every
iPhone, which is half the target platforms. And transcription accuracy, or
whether it works at all, can depend on the provider knowing what container it
received, so throwing that information away costs nothing to keep.

**Consequence.** Whether Khaya's ASR accepts WebM with Opus, or MP4, is **not
yet verified.** Confirming it needs one real transcription call with real
recorded speech, which spends metered credit, so it is deliberately deferred to
the same session that tests the filmed clips. The format is a constant in one
place, so if Khaya turns out to want WAV, transcoding is confined to the
provider.

---

## ADR 017, The microphone needs a secure context, and the app says so plainly

**Context.** `getUserMedia` is only available in a secure context. `localhost`
counts as one, so the microphone works during development. A phone opening the
app over plain http on a hospital network does not, and the browser simply
does not offer the microphone, with no error anywhere.

ADR 007 deliberately leaves HTTPS redirection off so a demo cannot make itself
unreachable. That means a hospital demo served over http on a local network
lands in exactly this case.

**Decision.** Detect `window.isSecureContext` separately from feature
detection and report three states: `ok`, `insecure`, `unsupported`. On
`insecure` the app says the microphone needs a secure connection and that
typing still works.

**Why.** "This browser cannot record audio" would be false, and would send
someone debugging a browser problem that does not exist while the real cause
is the URL. The two failures have different fixes and only one of them is ours.

**Consequence.** Any demo where the doctor's device is not the machine running
the server needs https, or the microphone will not appear. Recorded here
because it is a deployment fact that no amount of frontend code can work
around, and it is the kind of thing discovered at the worst moment. Typing
remains a fully supported path precisely so this degrades rather than blocks.

---

## ADR 018, Recordings are converted to 16 kHz mono WAV before upload

**Context.** The first real recording through the microphone failed. Khaya's
ASR endpoint returned an error, the caption endpoint turned that into a 503,
and the doctor saw "could not reach the language service".

The cause is a format mismatch. `MediaRecorder` cannot produce WAV or MP3 in
any browser: Chrome and Firefox record WebM with Opus, Safari records MP4 with
AAC. Khaya's developer portal renders client side so its documentation is not
readable programmatically, but the community Dart client that GhanaNLP's own
site links to transcribes from a plain `.mp3` file and uses language code
`tw`. That strongly suggests Khaya expects an ordinary audio file rather than
a WebM container.

**Decision.** Convert the recording in the browser to 16 kHz mono 16 bit PCM
WAV before uploading. Decoding uses the browser's own audio stack via
`decodeAudioData`, and resampling and downmixing use `OfflineAudioContext`.

**Why.**

16 kHz mono is the standard input rate for speech recognition, so it is what
the model expects rather than something it has to resample itself. It is also
about a tenth the size of 48 kHz stereo, which matters on the connections
NFR 5 describes.

Converting in the browser rather than the server keeps ffmpeg out of the
runtime image, so ADR 008 still holds. Each browser can decode the format it
just recorded, so the same code path works on Chrome and on Safari, which also
removes the WebM versus MP4 split that ADR 016 had to work around.

WAV is uncompressed, which is the real cost. At 16 kHz mono a five second
utterance is roughly 160 KB, which is acceptable for a single consultation
turn and is the trade we would make anyway to get transcription working at all.

Resampling is handed to `OfflineAudioContext` rather than written by hand
because a naive resampler aliases, and aliasing makes speech harder to
transcribe rather than easier.

**Consequence.** Conversion can fail, in principle only if the browser cannot
decode its own recording. That is surfaced as a failure rather than uploading
bytes the service cannot read, because uploading them would spend metered
credit to get an error back. The upload's filename extension is derived from
the blob's type rather than hardcoded, since a stale `.webm` name would
misdescribe WAV bytes to anything that trusts the filename.

**Verified 2026-09-12.** Khaya accepts the 16 kHz mono WAV and transcribes
it. The whole speech to sign pipeline now runs end to end on real services:
speech, to transcript, to Twi caption, to GhSL clip lookup. The conversion was
the fix, not a workaround.

---

## ADR 019, Git flow with one long lived feature branch

**Context.** Work had accumulated on a single branch with nothing pushed, so
CI had never run and there was no reviewable boundary between the stable
baseline and work in progress.

**Decision.** Three branches on `origin`:

| Branch | Holds |
| --- | --- |
| `main` | The stable baseline. Currently the Sprint 0 foundation |
| `develop` | Integration branch. Features merge here first |
| `feature/p0-core-consultation` | All ongoing work. This is where we commit and push |

`develop` was created from `main`, so the feature branch merges cleanly into
it. Day to day, everything is committed and pushed to the feature branch, and
`git push` with no arguments goes there because upstream tracking is set.

**Why.** It keeps `main` and `develop` reviewable rather than accumulating
half finished work, and it gives CI a real pull request to validate before
anything reaches an integration branch. For a hackathon submission, being able
to point at a clean `main` and a reviewed merge history is worth the small
overhead.

The feature branch is long lived and named after the SRS priority group rather
than a single sprint, because P0 is one coherent deliverable across several
sprints. Per feature branches off `develop` are the more conventional shape and
remain available for anything genuinely separable, such as the P1 additions.

**Consequence.** Nothing is pushed to `main` or `develop` without being asked.
Merging the feature branch into `develop` is a pull request and a deliberate
decision, not an automatic step on finishing a sprint.

---

## ADR 020, The literacy answer is scoped to a visit and expires

**Context.** FR 2.2 says the patient's literacy answer "determines their
interaction path for the visit". The obvious implementation is to persist it on
the device so a mid consultation page reload does not ask the same patient
twice.

But this app runs on a device hospital staff hand from one patient to the
next. A persisted answer with no expiry would route the next patient down the
previous patient's path, and the wrong direction here is not a cosmetic
mismatch: it shows captions to a patient who cannot read print, which is
precisely the failure the literacy check exists to prevent.

**Decision.** Three mechanisms together.

The answer persists on the device, so a reload does not re ask. An always
visible "New patient" control ends the visit and clears it, which is the
primary mechanism. And a visit older than four hours is treated as finished
even if nobody pressed the button.

Four hours is longer than any consultation and shorter than a shift, so in
practice the window cannot span two patients.

**Why.** Staff under time pressure will forget to press a button. A safety net
that fails closed costs the patient a few seconds of being asked again. Failing
open costs them the consultation. Every ambiguous case therefore re asks: a
corrupt record, a missing timestamp, an unrecognized path, or storage being
unavailable all produce "no visit" rather than a guess.

**Consequence.** The answer lives in `localStorage` on the device only, never
sent to a server, consistent with ADR 002. Tests cover each failing closed
path individually, because they are the ones that matter and none of them is
exercised by ordinary use.

One bug found writing this is worth recording: the staleness guard originally
tested `!visit.startedAt`, which rejects a legitimate timestamp of `0`. A
falsy check on a numeric field is the kind of fault that hides until a clock or
a fixture happens to produce that one value.

---

## ADR 021, A clinical question is stitched from word clips, not filmed as one

**Context.** Guided Interrogation asks the patient a question in GhSL. The
first implementation gave each question its own filmed prompt clip, which meant
every question added to the bank needed a new recording, a new consultant
review, and could not be asked until both were done.

**Decision.** A question carries no clip of its own. Its English text is
resolved through the existing clip library exactly as a caption is, and the
matched word clips are played as one stitched sequence. Adding a question is
then a row in the bank, not a filming session.

FR 2.6's instruction to nod or shake is one reviewed clip, `NOD_OR_SHAKE`,
appended to every yes or no question rather than filmed into each one.

**Why.** Filming is the project's real bottleneck, not code. Reusing the word
clips already being recorded means the bank's coverage improves automatically
as the library grows, and a question can be reworded without reshooting
anything. It also means the same reviewed sign for "pain" is used in a caption
and in a question, which is the consistency section 4.4 asks for and which a
separately filmed question could quietly break.

The cost is that a question is only as good as its wording. Words the library
does not have will fingerspell, so the bank is written using words the library
already contains, and `is_playable` plus the unavailable word list tell the
doctor when a question would not actually reach the patient.

**Consequence.** Resolving the bank happens in one batched lookup rather than
per question, because the doctor opens the whole bank at once and per question
resolution would be two queries each. `prompt_clip` was removed from the model.
A question with no coverage is marked in the bank rather than hidden, so the
gap is visible instead of looking like a small bank.

---

## ADR 022, A partial answer grid is withheld, not shown

**Context.** A selection question offers the patient a grid of sign video
answers, for example eight body locations for "where does it hurt". Those
clips are filmed over time, so for a while only some of them exist.

The obvious behaviour is to show whichever options are filmed and add the rest
later.

**Decision.** A selection question is only offered when **every** one of its
answer options is filmed and approved. A partial grid is withheld entirely and
the doctor is told to ask the question in person.

**Why.** A patient shown three body parts when their pain is in a fourth will
tap the nearest available one. They have answered honestly from what they were
offered, the doctor receives "chest" when the truth is "stomach", and nothing
about the answer looks wrong. Misdiagnosis risk from exactly this kind of
constrained answer is one of the problems the project exists to reduce, so
producing it ourselves would be worse than asking the question some other way.

The same reasoning does not apply to a yes or no question. A nod needs no
footage, so that path stays usable while the clip library is still being
filmed, and it is the only usable path today.

**Consequence.** `is_playable` on a question accounts for its options, not just
its own wording, and each option reports its own playability so the admin can
see which ones are outstanding. Questions with an incomplete grid stay visible
in the bank, marked, so the gap is something the team can see and close rather
than something invisible.

This was found by the bank returning a 500 in the browser while every test
passed, because the test fixture always created filmed option clips. The real
lesson is narrower than the fix: a fixture whose defaults are the *healthy*
case will not exercise the state the system actually spends its early life in.

---

## ADR 023, The doctor asks freely in Guided Interrogation, there is no question bank

**Context.** FR 2.4 describes the doctor selecting a question from a preset
clinical bank. That was built: nine questions, categorised, each stitched from
the clip library.

In use it was the wrong shape. A consultation is a conversation, and a fixed
list cannot follow one. The doctor could not ask "how many days?" after a yes,
or "is it worse when you eat?", or anything the bank did not anticipate.
Meanwhile the literate path already lets them type or speak whatever they
need.

**Decision.** Guided Interrogation uses the same doctor input as the literate
path: type or speak, in English or Twi. The question is captioned and stitched
into GhSL exactly as before. The difference is entirely on the patient's side,
which is where it belongs: they answer **yes or no**, by tapping the shared
icons or by nodding for the doctor to confirm.

"Where does it hurt" is the one question that cannot be answered yes or no, so
it keeps a dedicated action. After its video plays, the body locations appear
for the patient to point to, and that answer tells the doctor where to focus
for the rest of the consultation.

The `questions` app, its models, admin, and seed command were removed.

**Why.** The bank solved a problem the app did not have while creating a real
one: it constrained the doctor to questions someone thought of in advance. The
patient's side is what needed constraining, not the doctor's, and yes or no
plus a body location covers it. Two paths now share one input, so a fix to
speech or translation reaches both rather than one drifting behind.

**The cost, stated plainly.** SRS section 4.3 justified the fixed bank as
"preventing an unreviewed or inaccurate sign video from ever being generated on
the fly". Free input reintroduces that: a doctor can type a word the library
has no sign for, and it will fingerspell.

What makes that acceptable is that the gap is already visible rather than
hidden. Every caption reports which words were spelled out and which could not
be signed at all, on screen, to the doctor, before they rely on it. An
unreviewed sign is still never invented, because resolution only ever returns
consultant approved clips. What changes is that coverage is now reported rather
than guaranteed in advance, which is a weaker promise but an honest one.

**Consequence.** A deliberate divergence from FR 2.4, recorded here rather
than left to look like drift. Worth saying out loud in the pitch: the literacy
branch is the differentiator, and it survives this change untouched. What went
away is a constraint on the doctor, not the accessibility guarantee for the
patient.

---

## ADR 024, The stub speaks real silence, not a placeholder byte string

**Context.** With no Khaya key, the stub provider's `synthesize` returned the
bytes `b"stub-audio"`. Enough to prove the call happened, and unplayable.

FR 3.4's value is not the audio itself, it is the feedback around it. A Deaf
patient cannot hear whether their answer reached the doctor, so section 4.2
requires a visible waveform resolving into a completed state, and section 6
fixes the vibration: two short pulses when speech starts, one long pulse when
it ends. All of that hangs off real playback events.

**Decision.** The stub returns a valid, silent WAV file, built by hand from a
44 byte header and zeroed samples. The browser plays it, the events fire, and
the whole feedback loop works without a key.

**Why.** Unplayable bytes would make the feedback impossible to see or test
without spending metered credit, which is the situation ADR 015 exists to
avoid. Silence is also the honest representation of what the stub is: it made
no speech, and nobody heard anything.

**Consequence.** Silence is convincing in the wrong way, because the flow looks
complete. So the interface says, in the strongest wording of any of the stub
notices, that the audio was **silence, not speech, and nobody heard the
answer**. This is the ADR 011 problem at its worst: everyone in the room would
otherwise assume the doctor heard, and the patient would believe they had been
understood.

---

## ADR 025, The spoken language belongs to the listener and is set once

**Context.** FR 3.4 says the patient's responses are spoken "in either Twi or
English depending on which the doctor or nurse understands", set once at the
start of the session.

There are now three language settings on screen: the doctor's input language
(FR 1.1), the patient's writing language (FR 3.1), and this one. They are
genuinely three different things, and it would be easy to collapse them into
one and be wrong.

**Decision.** The spoken output language lives on the visit, not on the
utterance. It is set once, persists across a reload, is cleared with the
visit, and sits permanently in the visit bar per section 4.1.

It is the **listener's** language, deliberately, not the patient's. A patient
writing Twi to a doctor who only speaks English must still be understood, so
the translation direction is driven by who is listening.

English is the default, because it is what clinical staff in Ghanaian
hospitals most reliably share. The toggle is on screen, so a Twi speaking nurse
changes it in one tap rather than the consultation being blocked on a question
nobody thought to ask.

**Consequence.** A stored visit from before this field existed falls back to
the default rather than leaving it undefined, because an undefined language
would be sent to the server, rejected, and turn an old visit into a broken
consultation. `saveOutputLanguage` returns null when there is no visit, so a
language cannot be set against a visit that already ended and inherited by the
next patient.

---

## ADR 026, The transcript is deleted when the visit ends

**Context.** FR 4.3 gives the patient a record they can view and delete. The
abstract goes further: it promises a Deaf patient "documented proof of what the
doctor actually communicated", which reads like something they keep.

But this app runs on a device hospital staff hand from one patient to the next.
A transcript that outlived its visit would show the next patient the previous
patient's consultation. Those consultations are about pregnancy, sexually
transmitted infections, and HIV status. Exposing one to a stranger is the
precise harm the project exists to prevent, and it would be our doing rather
than the hospital's.

**Decision.** The transcript lives on the device for the duration of the visit
and is deleted when the visit ends, by the same "New patient" control that
clears the literacy answer. The patient can also delete it themselves at any
time, per FR 4.3, behind a confirmation.

Because it is deleted, the patient can take a copy: one tap produces a plain
text file of the consultation. That is an explicit patient action, which is the
exact wording NFR 4 uses for the only circumstance in which the transcript may
leave the device.

**Why.** The abstract's promise and the shared device are both real, and only
one of them can be satisfied by persistence. Deleting and offering a copy
satisfies both: the patient leaves with proof if they want it, and the next
patient finds nothing.

Keeping it would also make the privacy claim false in the most damaging way
possible. Telling a Deaf patient their consultation is private, and then
leaving it on a screen for the next person, is worse than never promising it.

**Consequence.** Ending a visit destroys a record that cannot be recovered, so
the "save a copy" button sits next to the transcript rather than behind
anything. Two tests assert the deletion directly, including one that puts "I am
HIV positive" in a transcript and checks the next patient cannot see it, because
that is the case that actually matters.

---

## ADR 027, The transcript is stored in localStorage, not IndexedDB

**Context.** ADR 002 said the transcript would be canonical in IndexedDB.

**Decision.** `localStorage` instead.

**Why.** A consultation's transcript is a few kilobytes of text. localStorage
holds several megabytes, is synchronous, and works in the test environment
without a polyfill, so the failure paths that matter, storage blocked in a
private window, storage full, a corrupt record, are all directly testable.
IndexedDB would buy capacity and asynchrony that text does not need, at the
cost of a wrapper and a polyfill.

**Consequence.** If the transcript ever holds audio or video, this decision is
wrong and IndexedDB is the answer. Every read is wrapped, so an unavailable
store reads as an empty transcript rather than taking down the consultation
screen, and a write failure still returns the exchange to the caller so the
consultation continues without it being saved.

This supersedes the storage mechanism named in ADR 002. The substance of
ADR 002, that the transcript is canonical on the device and never on a server,
is unchanged and is what the absence tests in
`core/test_no_transcript_endpoint.py` defend.

---

## ADR 028, The patient's name is asked for at save time and never stored

**Context.** The saved consultation record needs the patient's name on it,
otherwise a downloaded file is not recognisably theirs.

The obvious implementation is to ask for the name at the start of the visit and
keep it with the visit, alongside the literacy answer and the output language.

**Decision.** The name is asked for at the moment the patient saves a copy,
used in that file, and then discarded. It is never written to storage and never
sent anywhere.

**Why.** ADR 026 already accepts that a transcript can be left behind on a
shared device if the visit is not ended properly, and mitigates it with
deletion and a staleness window. A name stored beside that transcript would
make the residual risk far worse: a stray record would go from being an
anonymous fragment to identifying exactly whose consultation about HIV status
or pregnancy a stranger had just read.

Asking at save time costs the patient a few seconds, once, at the only moment
the name is actually needed. That is a good trade for removing the identifying
half of the worst case entirely.

**Consequence.** Saving twice means typing the name twice, which is a deliberate
inconvenience rather than an oversight. The interface tells the patient the name
is not stored, because a privacy property nobody can see is worth little. Saving
is refused with a visible reason when the name is blank, since an unnamed file
defeats the point of asking.

---

## ADR 029, Empty input is refused visibly, never silently

**Context.** Both message forms ignored an empty submission and returned. The
tap did nothing and said nothing.

**Decision.** An empty send shows a message next to the field, marks the field
invalid for assistive technology, and clears as soon as the person starts
typing.

**Why.** A silent no op is the worst available behaviour here, and worse on each
side for a different reason.

The doctor would reasonably assume the message reached the patient and wait for
an answer that is never coming, in a consultation where the whole difficulty is
already that neither party can confirm the other understood.

For the patient it is worse still. A Deaf patient cannot hear whether anything
was spoken aloud, so a button that appears to do nothing is indistinguishable
from one that worked silently. They would believe they had answered the doctor.

**Consequence.** The doctor's warning mentions the microphone only when the
browser supports it, since offering an option that is not there would be its own
small lie. The warning clears on the first keystroke rather than on the next
submit, so it never lingers to contradict what is on screen.

---

## ADR 030, Clips are played through two buffers, so the joins are invisible

**Context.** ADR 008 chose an ordered playlist over a server stitched video
file, which put the burden of making it look like one video on the player. The
first implementation held one `<video>` element and changed its `src` when each
clip ended, with a second hidden element preloading the next clip's data.

That is not seamless. Changing `src` makes the browser tear down the current
video, load the new one, and decode its first frame, and it shows as a flash of
black between every word. Preloading into a *different* element does not help,
because the element that has to display it still has to load and decode it
itself.

**Decision.** Two video elements stacked in the same space. While one plays,
the other already holds the next clip with `preload="auto"`, fully fetched and
decoding. When the playing clip ends, the two swap roles: the standby element
becomes visible and plays, and the element just vacated loads the clip after
that.

The newly visible element keeps the `src` it already had, so nothing reloads
and playback continues on the following frame.

**Why.** It produces the outcome, a sentence that reads as one continuous
signed utterance, without the costs server side concatenation carries: no
ffmpeg in the runtime image, no per sentence encoding inside NFR 1's five
second budget, and clips stay individually cacheable, which is what makes
FR 6.2's offline replay possible.

The standby element is hidden with `opacity: 0` rather than `display: none` or
`visibility: hidden`. A `display: none` video is not required to keep decoding,
which would defeat the entire purpose of holding it ready.

**Consequence.** Two videos are on screen at once, so the standby one is
`aria-hidden` and carries no controls: only one of them is the utterance. The
handover is asserted by element identity in a test, that the standby element
becomes the playing one rather than the playing one being given a new source,
because that identity is the whole mechanism and a refactor that reintroduced a
`src` swap would look correct while restoring the flash.

**If a visible join remains** on real footage, the next step is server side
concatenation with ffmpeg, cached per resolved sentence so the cost is paid
once. That is a larger change and it gives up per clip caching, so it is worth
doing only if this proves insufficient with clips that are actually filmed.
Recorded here so the option is not forgotten.

---

## ADR 031, A sentence is concatenated into one video file

**Context.** ADR 008 chose a clip playlist, and ADR 030 made the picture
continuous with two buffers. That removed the flash of black, but the result is
still several videos, and it shows: the native control bar reports each clip's
own length, the timeline restarts at every word, and a two word sentence reads
"0:01 / 0:01" twice rather than one duration.

FR 1.7 says matched clips are "stitched into a single sign video". The playlist
was a reasonable reading of that. Watching it is not: a patient sees a sequence
of short videos, not a sentence.

**Decision.** The backend concatenates the resolved clips into one real MP4 with
ffmpeg and returns its URL alongside the sequence. The player uses that file
when it exists: one video, one timeline, one duration.

Each stitched file is cached under a key derived from the exact ordered clips it
contains, so a sentence is encoded once and every later request for it is served
from disk. Order is part of the key, because "head hurts" and "hurts head" use
the same clips and are different sentences.

**Why this is worth reversing ADR 008's reasoning.** Two of the three
objections in ADR 008 were about cost rather than correctness, and caching
answers both. The first encode of a novel sentence costs a second or two; every
repeat costs nothing, and a consultation repeats its phrases constantly. The
third objection, that a stitched file cannot be cached per clip, still stands,
which is why the clips themselves are still served and cached individually for
FR 6.2's offline replay. The stitched file is an addition, not a replacement.

The remaining cost is ffmpeg in the runtime image, which is one apt package.

**Why re-encode rather than stream copy.** Clips are filmed on whatever phone
is to hand, so they differ in resolution, aspect ratio, frame rate and codec.
Concatenation without normalizing either refuses outright or produces a
stretched result. Each input is scaled and **padded** to a common frame, never
cropped, because cropping could cut a signer's hands out of shot and a sign
without its hands is a different sign or none at all.

Audio is dropped entirely. Sign clips carry no meaningful sound, and mismatched
audio streams are the commonest reason concatenation fails.

**Consequence.** ffmpeg is a soft dependency, not a hard one. If it is absent,
the encode fails, or it times out, the endpoint returns no stitched URL and the
player falls back to ADR 030's two buffer playlist. The patient still sees every
sign. That fallback is tested, because a missing tool must never break a
consultation.

The encode writes to a temporary file and moves it into place only on success,
since a truncated file under a trusted cache key would be served forever.
Source paths are resolved strictly under `MEDIA_ROOT`, so a clip URL pointing
anywhere else is refused rather than read off disk.

---

## ADR 032, The exchange on screen survives a page reload

**Context.** The transcript already persisted, so a reload kept the written
record of what had been said. It did not keep the live part of the
consultation: the question the patient was looking at, the stitched sign video
they may not have finished watching, and whether they were part way through
pointing at a body location.

A reload is not an unusual event on a hospital device. A patient taps the wrong
thing, the service worker updates, or the screen is handed over mid question.

**Decision.** The exchange currently on screen is stored on the device and
restored on load, with the same lifetime as the visit. It is cleared when the
question is answered, and when the visit ends.

**Why.** Losing the question at that moment means asking the patient to sit
through it again, and if they had already worked out their answer, it means
asking them something they thought they had settled. Both are small in isolation
and corrosive in a consultation that is already slow and effortful for both
people.

Restoring whether a body location was expected matters more than it sounds: a
reload otherwise drops the patient back to a yes or no they were never asked,
against a question that wanted a place.

**Consequence.** Since the question now survives a reload, it must also be
destroyed when the visit ends, or the next patient would find the previous
patient's question waiting for them to answer. That is asserted by a test, for
the same reason as ADR 026's transcript test.

A restored record is validated by shape rather than by presence. A caption
written by an older version, or a partial write, can lack the resolved sequence
that the player and the coverage notice both read, and restoring one of those
crashes the consultation screen on load. That is strictly worse than losing the
question, so anything not matching fails closed and the screen starts clean.
That case was found by a test which stored a deliberately incomplete caption.

---

## ADR 033, A sentence that would change meaning is refused, not shown

**Context.** A word with no sign was simply absent from playback. That is not a
degraded rendering, it is a different sentence.

`"do you have no pain"` played as `PAIN`. `"take two tablets"` played as
`TABLETS`, with no dose. `"stop the medicine"` played as `MEDICINE`, the
opposite instruction. Verified live: `"ask about"` and `"ask no about"`
produced byte-identical video.

Neither person in the room can catch this. The doctor does not read GhSL, so
they cannot see what the patient was shown. The patient never saw the typed
words, so they cannot know they were asked something else. The patient answers
honestly, the doctor records the answer, and nothing looks wrong.

This is the failure mode the project exists to reduce, and we were generating
it ourselves.

**Decision.** Words are classified by what their absence does, and the sentence
is handled accordingly.

| Class | Examples | If it cannot be signed |
| --- | --- | --- |
| Droppable | `the a is are do does of and` | Left out. GhSL does not use them |
| Blocking | negation, dose, frequency, timing, severity, any number | **The sentence is not shown at all** |
| Content | `pain head fever medicine` | Fingerspelled; if unspellable, refused |

On top of that, a confirmation gate. When the rendering differs from what was
typed, the doctor reads back **the glosses the patient will actually see** and
confirms before the patient sees anything. When every word is a reviewed sign
and nothing was dropped, it goes straight through.

**Why dropping function words is safe rather than a compromise.** GhSL, like
every sign language, has no articles and no copula. "Do you have pain" is
signed roughly `PAIN YOU`. Omitting `do`, `the`, `is` produces more natural
GhSL, not broken GhSL. Spelling them letter by letter would be actively worse,
spending a patient's attention on words that carry nothing.

**Why blocking words are never fingerspelled.** Spelling `no` to a patient who
may not be print literate is not a rendering of "no", and assuming they
followed it is the same risk wearing a different shape. The sentence stops.

**Why confirmation is conditional.** Confirming a sentence with nothing wrong
with it would teach the doctor to tap through without reading, which makes the
gate worthless. Friction lands exactly where the risk is.

**Consequence.** With a small clip library many sentences are refused. That is
the correct behaviour and it is temporary: coverage improves as footage is
filmed. A refused sentence is never recorded in the transcript as asked, and
never offered an answer control, because the patient did not see it.

**The word lists are clinical judgments, not engineering ones.** They are
seeded with the obvious negations, quantifiers, frequencies and severities, and
they should be reviewed and extended by the team's Deaf member and a GhSL
consultant. Adding a word to the blocking list is always safe. Adding one to
the droppable list is a claim that its absence cannot change what a patient
understands. Two currently-spelled words, "you" and "have", are arguable
candidates and are left for that review rather than decided here.

---

## ADR 034, Alternative words are a reviewed table, not a similarity guess

**Context.** A doctor writes "how are you doing" and the library has FEELING.
The system should be able to bridge that, and there are two ways: have somebody
record that the words are interchangeable, or have software judge that they are
similar.

**Decision.** A reviewed alias table. A GhSL fluent consultant records that
"doing" reaches the FEELING sign, and the resolver matches either. No
embeddings, no language model, nothing in the patient-facing path that
estimates meaning.

An alias carries its own reviewer rather than inheriting the clip's. Approving
footage says the sign is correct; it does not say which other English words
that sign may stand for. An alias with no reviewer is ignored entirely, and an
alias cannot reach a clip that is itself unreviewed or unfilmed, so it can
never route around the review gate.

**Why not embeddings or an LLM.** In a clinical setting the failure mode of a
confident wrong paraphrase is indistinguishable from success. "Do you have
pain" and "do you have severe pain" are close in any vector space and are
different clinical questions. Nobody present can detect the substitution, for
the same reason ADR 033 exists.

An alias table is deterministic, auditable, offline, free, and explainable: a
consultant approved every entry, and it can be shown to a reviewer as a list.

**Consequence.** Coverage grows by human effort rather than automatically,
which is slower and is the point. A term is unique across the library, because
one word cannot mean two signs without the same sentence signing differently on
two devices. An exact gloss always wins over an alias, so an alias is a
fallback and never a substitution for something that already matches.

If a suggestion layer is added later, it belongs **behind** the confirmation
gate in ADR 033: it may propose an alternative to the doctor, who approves it
in one tap. It may never substitute one silently.

---

## ADR 035, Importing footage is idempotent, and reachable without a terminal

**Context.** `footage/` is an inbox, not the store. Nothing watched it, so a
clip sat in a directory the app never looked at until somebody ran
`manage.py import_clips`. Two problems with that.

The obvious one: during a filming session you want a clip to appear when it
lands. The one that matters more: in a hospital, the person adding footage will
not have shell access, and "run this management command" is not a realistic
instruction for them.

**Decision.** Import stays an explicit act, but there are now three ways to
ask for it, all sharing one code path:

| | How | For |
| --- | --- | --- |
| `import_clips footage/` | Once | Normal use |
| `import_clips footage/ --watch` | Polls every 3s | Filming sessions |
| A button on the clip list in the admin | POST | A hospital, where nobody has a terminal |

**And the guard that makes repetition safe.** A clip records the checksum of
the file it was imported from, and a file whose contents already match is left
completely alone.

**Why the guard is not optional.** Re-importing resets approval to pending,
deliberately, because a consultant approved the recording that was there
before rather than the new one. Without the guard, anything that re-runs an
import would silently un-approve reviewed footage: the watcher polling, a file
sync touching timestamps, a second click of the button. The doctor would not
see an error. They would see sentences start being refused mid consultation,
with no way to connect that to a folder having been scanned again.

The comparison is by content hash, not modification time, because a timestamp
changes when nothing about the file does. A test sets the mtime to zero and
asserts the approval survives.

**Why not a filesystem watcher library.** Polling every three seconds needs no
dependency and behaves identically on every platform and over a network share,
which is what a mounted volume in a deployment will be. Three seconds is
imperceptible next to the time it takes to film a clip.

**Consequence.** The admin import is POST only. Importing replaces footage and
resets approvals, so it must not be reachable by anything that follows links,
such as a crawler or a browser prefetch. It also approves nothing: a button
cannot vouch for a medical sign any more than a script can, which is the same
rule as ADR 009.

Adding the checksum field means clips imported before it existed have no
recorded checksum, so the first import after this change counts them as
replaced and resets their approval once. Correct rather than convenient: we
cannot know whether the file on disk is the one that was reviewed.

---

## ADR 036, The patient facing API is stateless

**Context.** A doctor approved clips in the Django admin, and the consultation
screen then failed on every message with "Could not reach the language
service". The service was fine. The server was returning 403.

DRF's default authentication includes `SessionAuthentication`, which enforces
CSRF for any request carrying a session cookie. Logging into the admin left
such a cookie in the same browser, so every API call from the app was treated
as an authenticated request and CSRF checked, and the app does not send
`X-CSRFToken`.

The failure was doubly misleading. The frontend cannot tell a 403 from a
network failure, so it reported the wrong cause. And a `curl` check returned
200, because an anonymous request is never CSRF checked, so the endpoint looked
healthy from the terminal while the browser could not use it.

**Decision.** The API authenticates nobody. `DEFAULT_AUTHENTICATION_CLASSES` is
empty.

**Why this is not a security downgrade.** These endpoints were already
unauthenticated and already read nothing from `request.user`. CSRF protects
against a request that changes state *as the authenticated user*, and none of
them do: they resolve text to clips, translate, synthesise speech, and return
read only data. The protection was guarding nothing while breaking the app.

The Django admin is untouched, and that is where CSRF matters. Its forms do
change state as an authenticated user, including the footage import in
ADR 035, and they remain protected.

**Consequence.** If the API ever authenticates a user, session authentication
comes back and the frontend has to send `X-CSRFToken` with every write. A test
pins the setting so that cannot happen silently, and another reproduces the
original failure with `enforce_csrf_checks` and a logged in user.

That second test matters more than the fix. The default test client skips CSRF,
which is why the whole suite passed while a real browser could not send a
message. A test that only exercises the API the way `curl` does cannot see this
class of bug at all.

---

## ADR 037, Contractions are expanded before anything classifies a word

**Context.** The tokenizer split on non-word characters, so `"don't"` became
`don` and `t`. Neither is a negation, so `classify` saw no blocking word, and
the ADR 033 safety gate let the sentence through.

```
"do not take the medicine"  ->  blocking: [not]  ->  refused
"don't take the medicine"   ->  blocking: []     ->  allowed
```

The same instruction, written two ways, and only one of them was caught. With
`TAKE` and `MEDICINE` filmed, the second would have played as `TAKE MEDICINE`:
the opposite of what the doctor wrote, past a gate built specifically to stop
that.

It was masked only because those two clips are not filmed yet, so the sentence
was refused for a different reason. The hole would have opened the moment the
library grew.

**Decision.** Contractions are expanded during tokenizing, before any other
code sees a token. `don't` becomes `do not`, `can't` becomes `cannot`,
`what's` becomes `what is`. Curly apostrophes are normalized first, since
phone keyboards and word processors produce them and a doctor pasting from
either would otherwise bypass the check.

A possessive loses its affix rather than the word: `patient's` becomes
`patient`. GhSL does not mark possession with an affix, and leaving the `'s`
in place would make the token unmatchable and unspellable, since there is no
letter clip for an apostrophe, so the sentence would be refused over
punctuation.

**Why expand rather than split.** Splitting is what caused the bug. The
negation lives in the second half of the contraction, and any approach that
discards or mangles it hides a blocking word from the classifier.

**Consequence.** Two ways of writing the same sentence now produce identical
tokens, and a test asserts that directly rather than checking each form
separately. The contraction list is English and finite, so it is data rather
than logic, and adding to it is safe.

---

## ADR 038, A phrase clip is preferred over stitching its words

**Context.** With word clips for `WHAT`, `IS`, `YOUR`, `NAME`, the sentence
"what is your name" was rendered by stitching four clips. If a clip of the
whole phrase also existed, it was never used, because the tokenizer produces
single words and the lookup only ever matched single glosses.

**Decision.** Clips can cover a phrase, `WHAT_IS_YOUR_NAME`, and resolution
matches the longest phrase available at each position before falling back to
individual words.

**Why the phrase is better, not merely fewer clips.** Sign languages have
their own grammar. GhSL word order, and its use of space, expression and
timing, are not English. Word signs played in English order produce something
closer to Signed Exact English than to GhSL, and a Deaf patient may follow it
with effort or not at all.

A phrase filmed by a native signer carries what individual clips cannot:
correct word order for the language, the facial expression that marks a
question or a negation, and the rhythm that separates one clause from the next.
Facial expression in particular is grammatical in sign languages rather than
decorative, and it simply is not present in a sequence of isolated word clips.

It also removes every stitching artefact for that sentence, since there is
nothing to join.

**Consequence.** Longest match wins, so a filmed `WHAT_IS_YOUR_NAME` beats a
filmed `YOUR_NAME` inside it. Phrases mix with words around them, so `"tell
your name"` can play `TELL` followed by a `YOUR_NAME` phrase clip.

A phrase covering a negation is safe to show under ADR 033 without the negation
being separately filmed, because it is signed as part of the phrase. That is
the best way to sign a negation anyway, since a native signer marks it with
expression as well as with a sign.

Phrase glosses are written expanded rather than contracted,
`WHAT_IS_YOUR_NAME`, because ADR 037 expands a doctor's `"what's"` before
matching and the expanded form is what the lookup sees.

The guidance for filming changes as a result: **film whole phrases for
anything asked often**, and keep word clips for the combinations nobody
anticipated. The word library is the fallback, not the goal.

---

## ADR 039, A gloss has one canonical form, whatever separator was typed

**Context.** A phrase clip was created in the admin with the gloss
`HOW ARE YOU DOING`, filmed, and approved. It then never matched anything. The
resolver recovers the words a phrase covers by splitting its gloss on
underscores, so a space separated gloss produced a single unsplittable token
that no sentence could ever equal.

Nothing reported a problem. The row saved cleanly, the admin showed it as
approved and ready, and the doctor typing exactly that sentence was told the
words could be neither signed nor spelled.

That is a worse failure than rejecting the input would have been. A rejected
form tells you immediately; this looked finished and did nothing.

**Decision.** A gloss has one canonical form: uppercase, with single
underscores between words. Spaces, hyphens and repeated separators are
normalized to it on save, and stray separators at the edges are dropped.

The reverse direction is tolerant rather than strict: recovering the words from
a gloss splits on any separator, so a row written before this existed still
resolves.

**Why normalize rather than validate.** All three forms are things a person
will reasonably produce. A phrase typed in the admin gets spaces, a filename
off a phone or camera gets spaces, a filename typed by hand gets underscores or
hyphens. None is a mistake, and rejecting two thirds of them would make the
tool fight its users over punctuation. Filenames especially: a clip should not
depend on someone renaming what their camera produced.

**Consequence.** A data migration brings existing rows into the canonical form.
Where normalizing would collide with a gloss that already exists, the row is
left alone rather than merged or deleted, because which of two clips holds the
reviewed footage is not a decision a migration can make.

The wider lesson is the one worth keeping: a field that silently accepts a value
it can never use is worse than one that refuses it. Two earlier decisions have
the same shape, ADR 010 on multi word glosses never matching and ADR 037 on
contractions hiding a negation, and all three were invisible until someone used
the thing.


## ADR 040: A critical alert is offered even when its sign clip is unfilmed

**Context.** Emergency Visual Triage, FR 5.1 to 5.5, is the mode for a patient
who arrives after an accident with no interpreter and no time. FR 5.3 names
three one tap alerts: cannot breathe, asthma, pregnant. ADR 022 already settled
the general rule for anything the patient chooses from, and it is strict: an
option whose GhSL clip is not both approved and filmed is withheld entirely,
because an option the patient cannot read is an option they might tap by
accident, and a wrong answer is worse than a missing one.

Applied literally to FR 5.3, that rule removes the cannot breathe button from a
hospital that has not finished filming.

**Decision.** Critical alerts are the exception. All three are always offered,
filmed or not. Each carries an inline drawn icon, and the GhSL clip appears
inside the card once it exists. Body locations and answer grids keep the ADR 022
rule unchanged.

**Why.** The reasoning behind ADR 022 is a comparison of harms, and in an
emergency the comparison inverts. Elsewhere, a mis tapped option produces a
wrong answer in a conversation that can be repaired by the next question. Here,
the alternative to a half recognised icon is no way at all to say "cannot
breathe", and there is no next question. The icons are also not arbitrary
pictures: a struck through lungs symbol is closer to universally read than any
other control in the app, and the clinician reads the English label beside it
regardless.

This is a clinical judgment about relative harm, not an engineering one, and it
belongs in front of the GhSL consultant along with the safety word lists in
`clips/safety.py`.

**Consequence.** The alerts endpoint returns every alert with an `is_playable`
flag rather than filtering, which is the opposite of `body_locations`. The two
endpoints returning deliberately different shapes is a thing a future reader
will trip over, so the difference is commented at both ends and tested from
both sides.

Two further consequences of the mode sitting outside the visit. Emergency mode
is reachable before the literacy check has been answered, because asking a
patient whether they read before letting them say they cannot breathe is the
wrong order; leaving it returns them to whatever they were part way through.
And the pain scale and body map are drawings, needing no footage and nothing
from the server, so an alerts outage degrades the mode instead of ending it.
That last point had a real hole: a response that was not a list threw inside
render and took the drawings down with the alerts. The payload shape is now
checked rather than trusted, on the principle that the parts which need nothing
from the server must survive anything the server does.


## ADR 041: The critical alert set is cannot breathe and pregnant, not asthma

**Context.** FR 5.3 names three one tap alerts for Emergency Visual Triage:
cannot breathe, asthma, pregnant. The team reviewed the built screen and
removed asthma.

**Decision.** The alert set is the two remaining. `CRITICAL_ALERTS` in
`clips/emergency.py` is the single place it is written down, so the endpoint,
the seed list and the frontend all follow from one edit.

**Why.** This is a product and clinical call rather than an engineering one, so
the reasoning belongs to the team. What engineering can say about it: of the
three, asthma is the only one that names a diagnosis rather than what the
patient is experiencing or what would change their treatment. Cannot breathe
already covers the presentation an asthmatic patient would be tapping for, and
in an emergency a shorter list is scanned faster. Fewer, larger, less similar
cards is the direction section 4.5 pushes anyway.

**Consequence.** The SRS still names asthma, so the code and the spec now
disagree on paper. That disagreement is recorded in three places rather than
left to be rediscovered: this record, the FR 5.3 row in `BACKLOG.md` marked
`done, reduced`, and a test asserting `ASTHMA` is not in the endpoint's output.
The test is the one that matters. Without it, a future reader reconciling code
against the spec reads the gap as an oversight and puts it back.

The seeded `ASTHMA` clip row is left in any existing database. It is unfilmed
and no longer reachable, and which rows hold reviewed footage is not something
a code change should decide.

## ADR 042: The body map is one contour with clipped regions

**Context.** The first body map was assembled from one rounded rectangle per
region: a circle for the head, a box for the chest, and so on. It was rejected
on sight, and correctly. Section 4.5 asks for "an actual outline of a human
body, so tapping the stomach or the head feels like pointing, not like
operating a menu", and a figure made of boxes reads as a toy. A patient in pain
should not have to work out that a rectangle means their chest.

The obvious fix, drawing nine anatomically shaped pieces that tile into a body,
trades one problem for a worse one: nine hand authored outlines that have to
agree along every shared edge, where a millimetre of disagreement is a visible
seam or a sliver of body that belongs to no region at all.

**Decision.** One continuous contour for the whole figure, plus a clip path.
Regions are then simple shapes, mostly horizontal bands, drawn clipped to that
contour. A band across the chest comes out chest shaped. The arms and hands,
which sit beside the trunk rather than above or below it, are drawn last with
their inner edges copied from the contour's own table, so a later shape wins
the overlap and the arm to ribs boundary is exactly the gap between them.

The contour is stored as a table of anatomical points for the right half only,
mirrored at module load. Two reasons: a shoulder can be moved by changing one
number instead of six bezier control points, and the figure cannot drift
lopsided through an edit.

**Why not an image.** A photograph or a traced PNG would look better and could
not be divided. Regions have to be geometry for the tap to land anywhere other
than a bounding box, and the contour has to be a path for the clip to work.

**Consequence.** Three things about this are not obvious to the next reader and
are therefore commented at the point of use. Region fills must be
`transparent` rather than `none`, because `none` leaves a region with no hit
area at all, which looks interactive and ignores every tap. The contour and the
interior marks are painted above the regions so a selection tints underneath
them, which means both must opt out of pointer events or they swallow taps.
And focus cannot be shown with an outline, because the regions are clipped and
an outline drawn outside the contour is cut away, so focus fills the region
instead.

The nine region ids are glosses the rest of the app resolves body location
clips by, so they are fixed. Renaming one to suit the drawing would stop a sign
resolving with no error anywhere, which is the shape of bug ADR 010, 037 and
039 all were.
