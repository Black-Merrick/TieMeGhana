# Product Backlog and Sprint Plan

Every requirement in `Tie_Me_Ghana_SRS_v2.pdf` traced to the sprint that
delivers it. Priority order is the SRS's own: P0 is the hackathon build
target, P1 follows once P0 is stable, P2 is documented direction only and is
not built.

Update the status column as each item lands. This file is the answer to "is
that feature actually finished, or just demoed once."

Status key: `todo`, `wip`, `done`

---

## Sprint order and rationale

| Sprint | Delivers | Why here |
| --- | --- | --- |
| 0 | Foundation, tooling, CI, walking skeleton | A green baseline before any feature code, so a later failure is never ambiguous |
| 1 | GhSL clip library, gloss resolution, fingerspelling fallback | The retrieval layer everything visual depends on. Pure backend, fully testable without the Khaya API |
| 2 | Khaya language layer, doctor to patient captioning and sign playback | Completes P0.1, the headline demo: speech to Twi caption to GhSL video |
| 3 ✅ | Interaction foundations, literacy check | Vibration vocabulary, sign video player, and Yes/No icons built once before the first patient facing screen needs them |
| 4 | Guided Interrogation Mode | Completes P0.2, the differentiating feature. Depends on sprint 3's shared components |
| 5 ✅ | Patient to doctor spoken output | Completes P0.3. Depends on sprint 2's TTS provider |
| 6 ✅ | Session transcript, on device | **P0 complete. The system is demonstrable end to end** |
| 7 | Emergency Visual Triage Mode | P1.1. Reuses sprint 5's TTS and sprint 3's tap pattern, no new technology |
| 8 | GhSL Prescription Playback with QR | P1.2. Reuses the clip library and the PWA cache already in place |

Sprint 6 is the point at which the project is safe to present. Sprints 7 and 8
are strong additions, not prerequisites, which is deliberate.

---

## Sprint 0, Foundation, `done`

Not a feature, the baseline that makes every later sprint verifiable.

| Item | Status |
| --- | --- |
| Django and DRF backend, environment driven settings, SQLite fallback for zero setup onboarding | `done` |
| React and Vite PWA frontend, service worker and clip caching configured from the first commit | `done` |
| Health endpoint that actually touches the database, with tests for both the healthy and degraded paths | `done` |
| pytest, Black, isort, Ruff configured. Ruff `T20` fails the build on a leftover `print` | `done` |
| ESLint configured. `no-console` fails the build on a leftover `console.log` | `done` |
| pre commit hooks, so formatting is enforced by a tool and not by willpower | `done` |
| GitHub Actions CI, both halves, running against PostgreSQL and checking for missing migrations | `done` |
| `docker-compose.yml` for daily dev, `docker-compose.full.yml` for the full stack | `done` |
| README, setup guide, this backlog | `done` |

---

## P0.1, Doctor to Patient Communication, sprints 1 and 2

| FR | Requirement | Sprint | Status |
| --- | --- | --- | --- |
| 1.1 | Doctor selects spoken input language, English or Twi, before speaking | 2 | `done` |
| 1.2 | Speech transcribed via ASR | 2 | `done`, verified end to end against live Khaya |
| 1.3 | English text translated to Twi if needed | 2 | `done`, verified against live Khaya |
| 1.4 | Twi caption displayed on screen | 2 | `done` |
| 1.5 | Caption tokenized and matched to GhSL clips by English gloss | 1 | `done` |
| 1.6 | Unmatched words trigger fingerspelling fallback, letter clips in sequence | 1 | `done`, except blocking words, which refuse the sentence instead, ADR 033 |
| 1.7 | Matched clips stitched into one sign video, played alongside the caption | 1, 2 | `done`, playlist player per ADR 008 |

Design constraint carried into the code: clips cannot be created through the
API. The library is admin managed only, because an unreviewed medical sign has
real clinical consequences. A test locks this in.

Delivered in sprint 1, backend only: the `clips` app, `SignClip` model with a
`resolvable()` rule requiring both consultant approval and footage,
`resolve_sign_sequence()` for FR 1.5 to 1.7, `GET /api/clips/`,
`POST /api/sign-sequence/`, the admin review workflow, and
`manage.py seed_clips`. 29 tests. See ADR 008, 009, and 010 for the decisions
this produced, and the sprint 1 entry in `DEVELOPMENT_LOG.md`.

Delivered in sprint 2: the language provider layer with Khaya and stub
implementations, `POST /api/caption/`, the `SignSequencePlayer` that plays a
resolved sequence back seamlessly with the next clip preloaded, and the
doctor's captioning screen. Verified against live Khaya on 2026-09-12:
"Where does it hurt?" returned "Ɛhe na ɛyɛ yaw?". See ADR 011 and 013 to 015.

**FR 1.2 microphone capture** is built: the doctor can speak in English or
Twi, the same language choice applies to speaking and typing, and the recording
is captioned through the identical pipeline. The format is chosen from what the
browser supports, because Safari on iOS records MP4 and cannot record WebM, and
the chosen format is forwarded to Khaya rather than assumed. See ADR 016
and 017.

Two things about it are **not** verified, and both need the same real device
session that tests the filmed clips:

- ~~Whether Khaya's ASR accepts our WAV.~~ **Verified working 2026-09-12.**
  The 16 kHz mono WAV conversion was the fix, see ADR 018. Speech to
  transcript to Twi caption to clip lookup now runs on real services.
- ~~That audio actually records on a real device.~~ **Verified working
  2026-09-12**, on Chrome. Safari and iOS remain part of the NFR 6 device pass.

And one deployment fact worth knowing before demo day: **the microphone needs
https** on any device that is not the machine running the server, because
`getUserMedia` requires a secure context. The app detects this and says so
rather than claiming the browser cannot record. Typing works either way.

## P0.2, Literacy Check and Guided Interrogation, sprints 3 and 4

| FR | Requirement | Sprint | Status |
| --- | --- | --- | --- |
| 2.1 | First use prompt, sign video only, two large icon options, no text | 3 | `done, deviated`, needs the prompt clip filmed |

The question is printed in English and Twi beside the sign video, and the two
options carry labels, both at the team's direction. Recorded as ADR 047, which
also sets out what keeps it safe: the sign video is still the question, the
icon still comes first inside each option, and the routing depends on nothing
being read.

| 2.2 | Answer saved, determines the interaction path for the visit | 3 | `done`, visit scoped per ADR 020 |
| 2.3 | Literate patients proceed to free captioning and typed responses | 3 | `done` |
| 2.4 | Non literate patients use Guided Interrogation, question played as sign video | 4 | `done`, **diverges from the SRS**: the doctor asks freely rather than from a bank, ADR 023 |
| 2.5 | A grid of sign video answer options, for body location | 4 | `done`, withheld until every location is filmed, ADR 022 |
| 2.6 | Patient nods or shakes, observed in person. No camera gesture detection | 4 | `done`, no camera used, asserted by test |
| 2.7 | Doctor taps to confirm the observed answer, and that confirmation is what gets logged | 4 | `done`, doctor's confirmation is what is recorded |

This is the single most important behavioural distinction in the app. A
regression here silently breaks accessibility for exactly the users the
project exists to serve, so the branching logic gets direct test coverage.

## P0.3, Patient to Doctor Communication, sprint 5

| FR | Requirement | Sprint | Status |
| --- | --- | --- | --- |
| 3.1 | Literate patients type a response in English or Twi | 5 | `done` |
| 3.2 | Typed text translated if needed, then converted to speech | 5 | `done` |
| 3.3 | Non literate patients respond only through Guided Interrogation | 5 | `done`, the reply field is never rendered on that path |
| 3.4 | Every response spoken aloud in Twi or English, set once per session | 5 | `done`, on the visit per ADR 025 |
| 3.5 | Spoken output fires for tap selected answers too, audible without the doctor looking at the screen | 5 | `done` |

## P0.4, Session Transcript, sprint 6

| FR | Requirement | Sprint | Status |
| --- | --- | --- | --- |
| 4.1 | Every exchange logged with direction, text, and timestamp | 6 | `done`, both directions |
| 4.2 | Full transcript stored only on the patient's own device, not uploaded | 6 | `done`, no endpoint exists to send one, asserted by test |
| 4.3 | Patient can view, scroll, and delete their own transcript | 6 | `done`, plus save a named copy per ADR 026 and 028 |

Architecture decision: the transcript is canonical in IndexedDB on the
patient's device. The backend holds only the live exchange needed to keep the
doctor and patient screens in sync during an active consultation, and discards
it at session end. Privacy is a property of what the server stores, not a
setting that could be misconfigured.

## P1.1, Emergency Visual Triage Mode, sprint 7, `done`

| FR | Requirement | Status |
| --- | --- | --- |
| 5.1 | One tap pain scale icons | `done` |
| 5.2 | Tappable body map for pain location | `done` |
| 5.3 | Pre recorded GhSL videos for critical alerts, Asthma, Pregnancy, Cannot Breathe | `done, reduced` |

FR 5.3 names three alerts. Asthma was removed at the team's direction, leaving
cannot breathe and pregnant. Recorded as ADR 041 and flagged here rather than
quietly dropped, because the SRS still names it: a later reader reconciling the
code against the spec would otherwise read the gap as a bug and add it back.
A test asserts its absence for the same reason.

| 5.4 | No typing required anywhere in this mode | `done` |
| 5.5 | Every selection spoken aloud in Twi or English, consistent with FR 3.4 | `done` |

## P1.2, GhSL Prescription Playback, sprint 8, `done`

| FR | Requirement | Status |
| --- | --- | --- |
| 6.1 | Final instructions saved as an ordered playlist of GhSL clips and Twi captions | `done` |
| 6.2 | Playlist cached on the patient's phone for offline replay | `done` |

Satisfied three ways, weakest to strongest, per ADR 046: the service worker
caches the clips and the playlist, the patient can save one mp4 of the whole
prescription to the phone's gallery, and the doctor can print a slip carrying
the QR code and the medicines as words.

| 6.3 | QR code links to the playlist through a de identified reference, medicine name, dosage, and clip sequence only | `done` |
| 6.4 | The private transcript is never in the playlist and is not resolvable from the QR code | `done` |

FR 6.4 is enforced by what the reference contains, not by a permission check.
The QR payload has no field that could carry transcript data and no endpoint
that would resolve one, so there is no path to expose it even if a permission
were misconfigured. A test asserts the payload shape.

---

## Cross cutting, built once, sprint 3

The SRS is explicit that these are single sourced rather than reimplemented
per feature. Section 4.4, Consistency, and section 6.

| Item | Requirement source | Status |
| --- | --- | --- |
| Vibration vocabulary module, the five patterns in SRS section 6, defined once and imported everywhere | §6, §4.2 | `done` |
| Graceful degradation to visual only feedback where the Vibration API is absent | NFR 3 | `done` |
| One shared sign video player, identical appearance and controls for every clip in the app | §4.4 | `done` |
| One Yes and No icon set, used in Guided Interrogation, Triage, and any future confirmation | §4.4 | `done` |
| Literacy path indicator always visible, never in a settings menu | §4.1 | `done` |
| Output language toggle, always visible | §4.1 | `done` |

### Vibration vocabulary, the single source of truth

| Event | Pattern |
| --- | --- |
| Tap selection registered, standard | One short pulse |
| Audio playback to hearing listener begins | Two short pulses |
| Audio playback to hearing listener ends | One long pulse |
| Emergency Triage critical alert selected | Three short, sharp pulses |
| Session transcript saved | One soft, brief pulse |

A new feature reuses one of these. It does not invent a sixth.

---

## Non functional requirements, verified in a hardening pass after sprint 6

| NFR | Requirement | How we verify it | Status |
| --- | --- | --- | --- |
| 1 | Speech to sign video within 5 seconds for an average sentence | Timed instrumentation on the pipeline, measured under throttled network | `wip` |
| 2 | Every interactive element satisfies Feedback and Affordance at minimum | Per screen checklist against SRS §4 before a screen is called finished | `todo` |
| 3 | Vibration degrades gracefully where unsupported, never fails silently | Unit test with the Vibration API absent | `done` |
| 4 | Transcript never transmitted without explicit patient action | Satisfied by architecture, asserted by a test that walks every route and fails if one could carry a transcript | `done` |
| 5 | Usable under intermittent connectivity, core vocabulary cached | Service worker cache verified with the network offline in devtools | `done` |
| 6 | Works on current Chrome, Safari, Firefox, on Android and iOS | Manual device pass before submission | `todo` |

NFR 3, done 2026-09-18: `frontend/src/__tests__/vibration.test.js` covers the
module with the Vibration API absent, refusing, and throwing. Extended with
one component level case in `EmergencyTriage.test.jsx`, "still speaks a
critical alert when the device cannot vibrate": the highest stakes pattern in
the vocabulary, EMERGENCY_ALERT, previously had no test proving the alert
itself survives losing vibration, only that the vibration call happens.
`YesNoChoice.test.jsx` already covered the same shape for TAP_SELECTION.

NFR 1, wip 2026-09-18. The instrumentation itself is done:
`consultations/services.py`'s `build_caption` now times itself with
`perf_counter`, logs the duration on every request including a failed one,
and returns it as `pipeline_ms` on the response, proven to be a real reading
rather than a placeholder by a test that makes the provider sleep 200ms and
checks the number moved. Also verified for real under a throttled network:
headless Chrome against the real dev server, `Network.emulateNetworkConditions`
set to Chrome's own "Slow 3G" preset (400ms latency, 400 Kbps), a reasonable
stand-in for a Ghanaian hospital connection. A full caption round trip,
client to server and back, landed at 465ms, of which the server's own
pipeline was 8 to 50ms; the rest is the throttle. That leaves roughly 90% of
the five second budget unspent by anything this app's own code controls.

What is still open, and by choice rather than oversight: that number is
against `LANGUAGE_PROVIDER=stub`, which does no real translation or ASR.
Getting the genuine end to end figure means at least one live Khaya call,
and Khaya's free tier is metered, so that has been left for a deliberate,
minimal, explicitly requested check rather than spent without asking, per
standing project practice.

NFR 5, done 2026-09-18, verified for real rather than assumed from
`vite.config.js`: `npm run build`, then `vite preview`, then a headless
Chrome session driven over the DevTools protocol, the same technique used for
the mobile layout pass. First load online, confirmed
`navigator.serviceWorker.controller` is set and `caches.open(...)` holds all
12 precached entries. Then `Network.emulateNetworkConditions({offline:
true})`, the same switch DevTools' own offline checkbox flips, and reloaded:
`/` still rendered the full literacy check screen, and a prescription deep
link the phone had never cached (`/p/abc123...`) rendered the app shell and a
plain "no connection" message rather than a blank page or the browser's own
offline error page. `serviceWorkerRouting.test.js` already covers the
routing rules that make this possible as a permanent regression test; this
was the one part of NFR 5 that only a real service worker in a real browser
can prove, which is why it stayed a manual verification rather than growing a
vitest test of its own.

---

## P2, documented direction, not built

Listed so the architecture is judged on whether it extends cleanly, not on
whether these exist.

| Item | Why the architecture already accommodates it |
| --- | --- |
| Visual or vibration based queue call alternative | Reuses the vibration vocabulary and the tap pattern already built |
| Expansion to Ga and Ewe | The language provider is an interface, and clip lookup is keyed on gloss, not on Twi |
| Patient's own phone, two device visits | Built, `wip` until tried on real devices. Peer to peer WebRTC, six character code, asked before the literacy check, both paths. A reload of either device is rejoined by itself and each stays on its page. Emergency mode opened by the doctor is mirrored onto the phone, whose taps are spoken on the doctor's device. The prescription the doctor issues is given to the phone, with its videos to play and save. ADR 053 has the known limits: no TURN so some networks will not connect, the pairing cache is per process |
| Extension to lecture halls, churches, public service counters | The captioning plus guided question and answer model is not hospital specific |

---

## Known dependencies outside the code

These are the things that block a sprint for reasons no amount of engineering
solves, so they are tracked explicitly.

| Dependency | Needed by | Status |
| --- | --- | --- |
| Khaya AI API key from GhanaNLP | ~~Sprint 2~~ | **resolved 2026-09-12.** All three endpoints verified live. Free tier is metered, so `LANGUAGE_PROVIDER=stub` in dev per ADR 015 |
| **GhSL footage, about 45 clips.** The list, and the reasoning behind it, are in "The filming list" below | **the critical path.** Everything else in P0 and P1 is built and tested. Drop files in `backend/footage/` and run `import_clips`, see its README | open |
| GhSL fluent consultant review of the emergency alerts | Before any public demo. Covers both the three signs themselves and ADR 040, the judgment that an unfilmed alert is still worth offering | open |
| Two GhSL clips for the critical alerts, `cannot_breathe` and `pregnancy` | Emergency Triage works without them, per ADR 040, on the drawn icons alone. Once filmed, each clip becomes the card itself, which is what FR 5.3 asks for | open |
| **Review of the safety word lists** in `clips/safety.py` | ADR 033 classifies words by what their absence does. The lists are seeded with the obvious cases and are a clinical judgment, not an engineering one. Needs the team's Deaf member and a GhSL consultant. **One specific question found while building ADR 049:** `morning` and `night` are blocking, `afternoon` and `evening` are not, and nothing about the four differs clinically. Should they be classified alike, and if so, blocking? | open |
| **Reviewed aliases** for common phrasings, per ADR 034 | Lets "how are you doing" reach the FEELING sign. Each entry needs a named consultant | open |
| A Cloudflare R2 bucket, for any deployment | Free below 10 GB and free of egress charges. Media on a container filesystem is lost on every restart, so this is required rather than preferred. Wired up in ADR 050; the four values and where to click for them are in `SETUP_GUIDE.md` | open |
| Rate limiting on prescription issuing | ADR 044's known limitation, mitigated 2026-09-18: `PrescriptionIssueThrottle` caps issuing at 60/hour per IP, so a runaway script can no longer create rows without bound. Not a disclosure either way, since each row is readable only by its own unguessable reference | **resolved 2026-09-18** |
| Authentication for the doctor facing API | Deliberately not added alongside the rate limit above: ADR 036 and ADR 044 both reject an account for this half of the app, since none of these endpoints read `request.user` and an account would defeat FR 6.2, a patient replaying their own prescription without one. Real accounts, if ever wanted, are a deployment decision with its own design, not a gap the current architecture is missing | open, by design |

---

## The filming list

Measured rather than estimated. The resolver was run against one real
prescription, "Paracetamol, one tablet, twice a day", under four footage
scenarios, and what it returned decided this list:

| Filmed | Result |
| --- | --- |
| Nothing | refused: `one` and `twice` blocking, `paracetamol` `tablet` `day` unavailable |
| The dose and frequency words | refused: `paracetamol` unavailable |
| **Plus the 26 letter alphabet** | **shown**, with `paracetamol` fingerspelled P-A-R-A-C-E-T-A-M-O-L |
| Plus a `PARACETAMOL` sign of its own | shown, as one sign rather than eleven letters |

### 1. The alphabet, 26 clips, `A` to `Z`

The highest value footage in the project, and it was previously listed as a
fallback for FR 1.6 rather than as the thing FR 6 turns on.

A medicine name is a **content** word, so it does not need a clip of its own.
With the alphabet filmed it is fingerspelled, which is what an interpreter does
with a drug name anyway. Twenty six clips therefore cover **every medicine that
will ever be prescribed**, where a clip per drug would be an endless list that
is always missing the one in front of you.

### 2. The prescription vocabulary, exactly 39 clips

Since ADR 049 a dose is chosen from fixed lists rather than typed, so this is
not an estimate. It is the complete set of words a prescription can contain,
generated by `filming_vocabulary()` in `backend/prescriptions/dosing.py` and
checked by a test that walks every sentence the app can build:

```
after, afternoon, before, capsule, capsules, day, days, drop
drops, eight, evening, five, food, for, four, half
injection, injections, millilitre, millilitres, morning, night, nine, once
one, sachet, sachets, seven, six, spoon, spoons, tablet
tablets, ten, three, times, twice, two, with
```

**Once these exist, every prescription the app can produce is signable.** That
is the whole point of the change: before it, whether a prescription could be
shown depended on what the doctor happened to type.

Numbers and frequencies among them are **blocking** words per ADR 033, so they
cannot be covered by the alphabet. Dropping them changes the dose, and spelling
them would be wrong rather than clumsy: sign languages have their own number
signs, so T-W-O is not what a signer reads for 2.

The plurals are listed because the resolver matches words, and "tablets" is a
different word from "tablet". A consultant may decide one clip serves both, in
which case a reviewed alias under ADR 034 is the way to record that rather than
filming twice.

### 4. The two critical alerts

`cannot_breathe` and `pregnancy`, per FR 5.3 and ADR 040. Emergency Triage
already works without them, on the drawn icons, so these improve a working
screen rather than unblocking a broken one.

### What is deliberately not on this list

A clip per medicine name. Two reasons, and the second now matters more than the
first. Fingerspelling covers the whole class, so a per drug library would need
extending every time a formulary changes, with the failure mode landing on
whichever patient is holding the device. And since ADR 048 the medicine is
identified by a photograph the doctor takes, so its name is not signed at all:
the picture says which box and the signs say what to do with it.

That also lowers what the alphabet is needed for. It is still the fallback for
any content word with no sign, which is FR 1.6 and applies across the whole
app, but a prescription no longer depends on it.

### A note on entering a dose

Digits work: `2` tokenizes and classifies as blocking correctly, so it resolves
once the number clips exist. But a dosage typed as `2` with a frequency of `1`
signs as a bare number with no unit, and the patient's caption reads "para, 2,
1". `one tablet` and `twice a day` resolve to signs a patient can act on. Worth
saying in whatever guidance the doctors get, because the app cannot tell the
difference between a terse entry and a wrong one.
