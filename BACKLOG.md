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
| 6 | Session transcript, on device | Completes P0.4. **P0 complete, system is demonstrable end to end** |
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
| 1.6 | Unmatched words trigger fingerspelling fallback, letter clips in sequence | 1 | `done` |
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
| 2.1 | First use prompt, sign video only, two large icon options, no text | 3 | `done`, needs the prompt clip filmed |
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
| 4.1 | Every exchange logged with direction, text, and timestamp | 6 | `todo` |
| 4.2 | Full transcript stored only on the patient's own device, not uploaded | 6 | `todo` |
| 4.3 | Patient can view, scroll, and delete their own transcript | 6 | `todo` |

Architecture decision: the transcript is canonical in IndexedDB on the
patient's device. The backend holds only the live exchange needed to keep the
doctor and patient screens in sync during an active consultation, and discards
it at session end. Privacy is a property of what the server stores, not a
setting that could be misconfigured.

## P1.1, Emergency Visual Triage Mode, sprint 7

| FR | Requirement | Status |
| --- | --- | --- |
| 5.1 | One tap pain scale icons | `todo` |
| 5.2 | Tappable body map for pain location | `todo` |
| 5.3 | Pre recorded GhSL videos for critical alerts, Asthma, Pregnancy, Cannot Breathe | `todo` |
| 5.4 | No typing required anywhere in this mode | `todo` |
| 5.5 | Every selection spoken aloud in Twi or English, consistent with FR 3.4 | `todo` |

## P1.2, GhSL Prescription Playback, sprint 8

| FR | Requirement | Status |
| --- | --- | --- |
| 6.1 | Final instructions saved as an ordered playlist of GhSL clips and Twi captions | `todo` |
| 6.2 | Playlist cached on the patient's phone for offline replay | `todo` |
| 6.3 | QR code links to the playlist through a de identified reference, medicine name, dosage, and clip sequence only | `todo` |
| 6.4 | The private transcript is never in the playlist and is not resolvable from the QR code | `todo` |

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
| 1 | Speech to sign video within 5 seconds for an average sentence | Timed instrumentation on the pipeline, measured under throttled network | `todo` |
| 2 | Every interactive element satisfies Feedback and Affordance at minimum | Per screen checklist against SRS §4 before a screen is called finished | `todo` |
| 3 | Vibration degrades gracefully where unsupported, never fails silently | Unit test with the Vibration API absent | `todo` |
| 4 | Transcript never transmitted without explicit patient action | Satisfied by architecture, asserted by a test that no transcript endpoint exists | `todo` |
| 5 | Usable under intermittent connectivity, core vocabulary cached | Service worker cache verified with the network offline in devtools | `todo` |
| 6 | Works on current Chrome, Safari, Firefox, on Android and iOS | Manual device pass before submission | `todo` |

---

## P2, documented direction, not built

Listed so the architecture is judged on whether it extends cleanly, not on
whether these exist.

| Item | Why the architecture already accommodates it |
| --- | --- |
| Visual or vibration based queue call alternative | Reuses the vibration vocabulary and the tap pattern already built |
| Expansion to Ga and Ewe | The language provider is an interface, and clip lookup is keyed on gloss, not on Twi |
| Extension to lecture halls, churches, public service counters | The captioning plus guided question and answer model is not hospital specific |

---

## Known dependencies outside the code

These are the things that block a sprint for reasons no amount of engineering
solves, so they are tracked explicitly.

| Dependency | Needed by | Status |
| --- | --- | --- |
| Khaya AI API key from GhanaNLP | ~~Sprint 2~~ | **resolved 2026-09-12.** All three endpoints verified live. Free tier is metered, so `LANGUAGE_PROVIDER=stub` in dev per ADR 015 |
| 30 to 50 filmed or sourced GhSL clips for a hospital intake scenario | **the critical path now.** 92 glosses are recorded and awaiting footage, 0 usable. Drop files in `backend/footage/` and run `import_clips`, see its README | open |
| GhSL fluent consultant review of the clinical question bank and emergency alerts | Before sprint 4 ships and before any public demo | open |
| Alphabet clips for fingerspelling, one per letter | FR 1.6 cannot fall back without a complete alphabet, so a partial one leaves words unavailable rather than spelled | open |
