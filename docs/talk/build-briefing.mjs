/**
 * Build the demo day briefing as a Word document.
 *
 *   NODE_PATH=/path/to/where/docx/is npm_config_yes=1 node docs/talk/build-briefing.mjs
 *
 * For the team, not for the judges: the run of show, what each minute is worth
 * against the published rubric, and the answers to the questions that decide
 * the Q&A half of the session.
 *
 * `docx` is not a dependency of this project and must not become one: it builds
 * a document for a meeting, and nothing a hospital downloads should carry it.
 * Install it anywhere outside the repository and point NODE_PATH at that
 * node_modules, or run this file from there.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "tie-me-ghana-demo-briefing.docx");

const GREEN = "0A4A3A";
const INK = "10221C";
const MUTED = "5D6F68";
const WASH = "F1F6F4";
const AMBER = "FEF6E7";

/** Content width for A4 with the margins set below, in DXA. */
const W = 9746;

const text = (value, options = {}) => new TextRun({ text: value, ...options });

const para = (value, options = {}) =>
  new Paragraph({ children: [text(value)], spacing: { after: 120 }, ...options });

const rich = (children, options = {}) =>
  new Paragraph({ children, spacing: { after: 120 }, ...options });

const h1 = (value) =>
  new Paragraph({
    text: value,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
  });

const h2 = (value) =>
  new Paragraph({
    text: value,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  });

const bullet = (value, level = 0) =>
  new Paragraph({
    children: Array.isArray(value) ? value : [text(value)],
    numbering: { reference: "dots", level },
    spacing: { after: 80 },
  });

/** A shaded box for something that must not be skimmed past. */
const callout = (title, body, fill = AMBER) =>
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "D8E2DE" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8E2DE" },
      left: { style: BorderStyle.SINGLE, size: 18, color: GREEN },
      right: { style: BorderStyle.SINGLE, size: 2, color: "D8E2DE" },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: [
              rich([text(title, { bold: true, color: GREEN })], { spacing: { after: 80 } }),
              ...(Array.isArray(body) ? body : [para(body, { spacing: { after: 0 } })]),
            ],
          }),
        ],
      }),
    ],
  });

/** A table with a heading row. `widths` must sum to W. */
const table = (headers, rows, widths) =>
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "D8E2DE" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8E2DE" },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E6EBEF" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map(
          (heading, index) =>
            new TableCell({
              width: { size: widths[index], type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: WASH },
              margins: { top: 90, bottom: 90, left: 140, right: 140 },
              children: [
                rich([text(heading, { bold: true, color: GREEN, size: 19 })], {
                  spacing: { after: 0 },
                }),
              ],
            }),
        ),
      }),
      ...rows.map(
        (cells) =>
          new TableRow({
            children: cells.map(
              (cell, index) =>
                new TableCell({
                  width: { size: widths[index], type: WidthType.DXA },
                  margins: { top: 90, bottom: 90, left: 140, right: 140 },
                  children: (Array.isArray(cell) ? cell : [cell]).map((line) =>
                    typeof line === "string"
                      ? para(line, { spacing: { after: 0 } })
                      : line,
                  ),
                }),
            ),
          }),
      ),
    ],
  });

/** One question and its answer, the shape the whole Q&A section repeats. */
const qa = (question, answer, extra = []) => [
  rich([text("Q. ", { bold: true, color: GREEN }), text(question, { bold: true })], {
    spacing: { before: 200, after: 60 },
  }),
  ...(Array.isArray(answer) ? answer : [para(answer, { spacing: { after: 60 } })]),
  ...extra,
];

const children = [
  // ---------------------------------------------------------------- cover
  new Paragraph({
    children: [text("Tie Me Ghana", { bold: true, size: 56, color: GREEN })],
    spacing: { after: 60 },
  }),
  new Paragraph({
    children: [
      text("Demo day briefing — Thursday, 25 minutes", { size: 26, color: INK }),
    ],
    spacing: { after: 40 },
  }),
  new Paragraph({
    children: [
      text(
        "10 minutes to demonstrate, 15 minutes of questions. 100 points. 25 teams of 50 go through.",
        { size: 20, color: MUTED, italics: true },
      ),
    ],
    spacing: { after: 240 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 8 },
    },
  }),

  callout("Read this first", [
    para(
      "The brief says: demonstrate core functionality, clearly distinguishing working features from planned features. That sentence is worth points twice over — under Prototype Functionality, and under Presentation Clarity. We have a lot that genuinely works. Say plainly what does not, before anyone asks.",
      { spacing: { after: 80 } },
    ),
    para(
      "Nothing in this document claims a feature we have not built. If a judge asks about something not listed here, the honest answer is \"not yet, and here is why it is next\".",
      { spacing: { after: 0 } },
    ),
  ]),

  // ---------------------------------------------------------------- story
  h1("1. The story, in thirty seconds"),
  para(
    "Open with this. Do not open with the technology.",
  ),
  callout(
    "Say roughly this",
    [
      para(
        "\"A Deaf patient in a Ghanaian hospital cannot hear their name called. They cannot explain what happened after an accident. And an interpreter is not available for a walk-in visit.",
        { spacing: { after: 80 } },
      ),
      para(
        "The obvious answer is pen and paper. It does not work: fluency in Ghanaian Sign Language does not imply fluency in written English. We call that the literacy trap. A Deaf member of our own team told us about it from his own experience.",
        { spacing: { after: 80 } },
      ),
      para(
        "So Tie Me Ghana never asks a patient to read. The doctor types or speaks, and the patient sees Ghanaian Sign Language. The patient taps or types, and the doctor hears it spoken in Twi or English. Let me show you.\"",
        { spacing: { after: 0 } },
      ),
    ],
    WASH,
  ),

  // ---------------------------------------------------------------- rubric
  h1("2. Where the 100 points are"),
  para(
    "Every criterion below has a moment in the demo that earns it. If you are cut short, protect the twenty-pointers.",
  ),
  table(
    ["Criterion", "Pts", "What earns it, and when"],
    [
      [
        "Communication Support & Two-Way Interaction",
        "20",
        "Demo beats 2 and 4. Show both directions in one continuous exchange: doctor to patient as sign video, patient to doctor as speech the room can hear.",
      ],
      [
        "Accessibility & Inclusion",
        "20",
        "Demo beats 1, 3 and 5. The literacy branch, the sign-video Yes/No, the vibration and visual feedback, Emergency Triage with no reading at all.",
      ],
      [
        "Technical Fit, Prototype Functionality",
        "20",
        "Demo beat 6 (the refusal) plus the numbers in section 6. It works offline, on two devices, with 1,932 automated tests behind it.",
      ],
      [
        "Ghanaian-Language Support",
        "10",
        "Twi captions and Twi speech throughout, Ghanaian Sign Language as the visual channel, Twi on every control (Aane / Daabi). Ghana NLP's Khaya for translation and speech.",
      ],
      [
        "UX/UI, Usability & Local Fit",
        "10",
        "The shared-device divider, one-tap emergency, and the fact it is built for a hospital connection we measured at about 150 KB a second.",
      ],
      [
        "Adoption & Continued Use",
        "10",
        "Section 5 answers. No app store, no login, runs on the phone they already have, and the clip library grows without a developer.",
      ],
      [
        "Presentation Clarity & Answers",
        "10",
        "Keep to time. Distinguish working from planned. Answer the question actually asked.",
      ],
    ],
    [3300, 700, 5746],
  ),

  // ---------------------------------------------------------------- demo
  h1("3. The ten-minute demo"),
  para(
    "Two devices, both already open, both already warmed up. Rehearse it twice with a timer. The times are cumulative.",
  ),
  table(
    ["Time", "Beat", "What you do and say"],
    [
      [
        "0:00",
        "1 · The problem",
        "The thirty-second story from section 1. Do not open the app yet.",
      ],
      [
        "0:30",
        "2 · A consultation on one device",
        "Shared device. Point at the divider: doctor's half, patient's half. Type \"where is your pain\" and send. The sign video plays. Turn the screen. Patient taps an answer; it is spoken aloud in Twi. Say: \"the doctor never looks away from the patient to read an answer.\"",
      ],
      [
        "2:30",
        "3 · Never asked to read",
        "Press New patient. The first question is a sign video, with Yes and No as signs, not words. Say: \"this is the literacy check. A patient who cannot read is not asked in writing whether they can read.\" Answer No and land in Guided Interrogation.",
      ],
      [
        "4:00",
        "4 · The patient's own phone",
        "The strongest beat. Pair the second device with the code. Show the question arriving on the phone, the patient answering there, and the answer being spoken on the doctor's device. Say: \"the two devices talk directly. The consultation does not go through our server.\"",
      ],
      [
        "6:00",
        "5 · Emergency",
        "Press Emergency on the doctor's device; the patient's phone follows instantly. Tap a body part on the phone; it speaks on the doctor's device. Say: \"no literacy answer, no typing, and it works before anyone has set anything up.\"",
      ],
      [
        "7:15",
        "6 · It refuses to guess",
        "The beat that wins Technical Fit. Type \"take two tablets\" and send. It refuses, and says why. Say: \"we have no sign for 'two'. Showing the sentence without it would turn a dose into a guess, so the app will not show it. Silence is safer than a wrong instruction.\"",
      ],
      [
        "8:15",
        "7 · Take it home",
        "Issue a prescription. The QR code appears, and the medicines land on the patient's phone with the sign video. Tap Save. Say: \"that file plays months later with no network at all.\"",
      ],
      [
        "9:15",
        "8 · Working vs planned",
        "Section 4, out loud, in under forty-five seconds. Then stop talking.",
      ],
    ],
    [800, 2200, 6746],
  ),

  callout(
    "Do this before you join the call",
    [
      bullet([
        text("Switch the language provider to Khaya.", { bold: true }),
        text(
          " On the development setting the captions carry a warning that they were not translated, and the spoken audio is silence. That would cost points under two criteria at once. Test one full sentence end to end after switching.",
        ),
      ]),
      bullet(
        "Open both devices, let the clip library finish downloading, and check the toast says the videos are saved. A cold device fetches 13.2 MB before anything plays smoothly.",
      ),
      bullet(
        "Pair the two devices once and leave them paired. The code lasts ten minutes; if it lapses, re-pair before you are admitted, not on camera.",
      ),
      bullet(
        "Set the display name to the team name, as instructed, or you will not be admitted from the waiting room.",
      ),
      bullet(
        "Use only sentences from the safe list in section 6. Anything else may legitimately refuse, which is correct behaviour but not what you want in beat 2.",
      ),
      bullet(
        "Have a second person ready to drive the patient's phone so the demo never waits on one pair of hands.",
      ),
    ],
    AMBER,
  ),

  // ---------------------------------------------------------------- honesty
  h1("4. Working today vs planned"),
  para(
    "Say this in the demo, before the questions. It is a scored instruction, and it disarms every \"but does it really…\" question that would otherwise come at you in the Q&A.",
  ),
  table(
    ["Working today", "Planned, and honest about it"],
    [
      [
        [
          para("Doctor to patient as Ghanaian Sign Language, from typed or spoken input", { spacing: { after: 40 } }),
          para("Patient to doctor as speech, in Twi or English", { spacing: { after: 40 } }),
          para("The literacy check, asked as sign video on both devices", { spacing: { after: 40 } }),
          para("Guided Interrogation for a patient who does not read", { spacing: { after: 40 } }),
          para("Two devices paired directly, reconnecting by themselves in about 1.6 seconds", { spacing: { after: 40 } }),
          para("Emergency Visual Triage, mirrored to the patient's phone", { spacing: { after: 40 } }),
          para("Prescriptions with QR, saved to the phone, playable offline", { spacing: { after: 40 } }),
          para("107 reviewed GhSL clips; refusal when a sentence cannot be signed safely", { spacing: { after: 0 } }),
        ],
        [
          para("The fingerspelling alphabet is still unusable — 9 letters of 26 are filmed (Q and S to Z; R is missing), plus 7 digits. Spelling a word needs every one of its letters, so until the rest exist a word with no sign stops the sentence instead of being spelled out.", { spacing: { after: 60 } }),
          para("The body-location grid needs all 16 signs before it will show. We withhold it deliberately rather than offer three body parts when the pain is in a fourth.", { spacing: { after: 60 } }),
          para("Clinical sign-off on the sign library and on the word-safety lists is pending a GhSL consultant.", { spacing: { after: 60 } }),
          para("Some hospital networks will not allow two devices to connect directly. The app says so and offers to share one device rather than route the consultation elsewhere.", { spacing: { after: 0 } }),
        ],
      ],
    ],
    [4873, 4873],
  ),
  callout(
    "How to say the gaps without losing the room",
    [
      para(
        "\"The alphabet is our next 36 clips, and it is the highest-value footage in the project: twenty-six letters cover every medicine name that will ever be prescribed. The reason it is not done is that filming needs a GhSL signer and a consultant to approve each take, and we would rather ship nothing than ship a sign nobody has checked.\"",
        { spacing: { after: 0 } },
      ),
    ],
    WASH,
  ),

  // ---------------------------------------------------------------- Q&A
  new Paragraph({ children: [text("")], pageBreakBefore: true }),
  h1("5. The fifteen minutes of questions"),
  para(
    "This is the larger half of the session and it carries its own ten points. Decide now who answers what.",
  ),
  table(
    ["Topic", "Who answers"],
    [
      ["Clinical need, the literacy trap, Deaf users", "The team member who lives it. Nobody else should take these."],
      ["Architecture, offline, privacy, the direct connection", "The engineer."],
      ["Language, Twi, Khaya, other Ghanaian languages", "Whoever owns the language pipeline."],
      ["Adoption, cost, rollout, hospitals", "One person, and the same person each time."],
    ],
    [4873, 4873],
  ),

  h2("Technique"),
  bullet("Answer in two sentences, then stop. Judges have a list and a clock."),
  bullet([
    text("If you do not know, say so: ", {}),
    text("\"We haven't measured that. What we do know is…\"", { italics: true }),
    text(" Never invent a number."),
  ]),
  bullet("If a question assumes something we did not build, correct the premise gently before answering."),
  bullet("One voice per question. Do not let two people answer the same question."),
  bullet("Bring every answer back to a patient in a room, not to a framework."),

  h2("Communication and two-way interaction"),
  ...qa(
    "How is this different from Google Translate, or just typing on a phone?",
    "Typing assumes the patient reads written English, and the whole point is that many Deaf Ghanaians do not. We go to Ghanaian Sign Language, which is their language, and we come back as speech the clinician hears without looking away from the patient. Neither direction asks anyone to read.",
  ),
  ...qa(
    "Is the sign language generated by AI?",
    "No. Every sign is filmed footage of a real signer, approved by a person before it can be shown. We resolve a sentence to clips and play them in order. We deliberately do not synthesise signing, because a generated sign nobody has checked could say something clinically wrong.",
  ),
  ...qa(
    "Do you use a camera to read the patient's signing?",
    "No, and that is a design decision rather than a gap. Camera gesture recognition is not reliable enough to put between a patient and a doctor, and a wrong reading of a symptom is worse than no reading. The patient answers by tapping, or nods and the doctor records what they personally observed.",
  ),

  h2("Accessibility and inclusion"),
  ...qa(
    "How do you know this is what Deaf people actually need?",
    "The problem was identified by a Deaf member of our own team, from his own experience in a Ghanaian hospital. The published research corroborates it; it did not originate it. Every screen is built so that nothing essential depends on reading.",
  ),
  ...qa(
    "What about a patient who is Deaf and cannot read and does not know sign language?",
    "Emergency Visual Triage is for exactly that: a pain scale of faces, a body map they point at, and one-tap alerts. No text, no literacy answer, no setup. It is reachable before any other question is asked.",
  ),
  ...qa(
    "What about blind or low-vision users, or a clinician with colour blindness?",
    "Every state marked by colour is also marked by shape or text — the Yes and No marks, the pain faces, the divider on the shared screen. Status changes are announced to screen readers for the clinician's side. A Deaf-blind patient is beyond what this build serves, and we would not claim otherwise.",
  ),

  h2("Language"),
  ...qa(
    "How good is the Twi translation?",
    "Translation and speech come from Ghana NLP's Khaya, built for Ghanaian languages rather than adapted to them. Where a phrase has not been checked by a person, we show it in English and say so rather than read out unreviewed Twi to a clinician — in emergency mode that rule is absolute.",
  ),
  ...qa(
    "Will it work for Ga, Ewe, or Dagbani?",
    "The language service is behind an interface, and the sign clips are keyed on meaning rather than on any spoken language, so adding another is configuration and footage, not a rewrite. We have not done it, so we are not claiming it works today.",
  ),
  ...qa(
    "Is Ghanaian Sign Language the same as American Sign Language?",
    "No. GhSL has its own grammar and its own signs. That is precisely why the library is filmed here with local signers rather than taken from an international dataset, and why a consultant has to approve each clip.",
  ),

  h2("Technical"),
  ...qa(
    "Does it need the internet?",
    "It needs a connection to start a consultation and to translate. After that the sign videos are stored on the device, so they play instantly and keep playing with no network. A prescription can be saved as a video file that works months later offline, which is the part that matters most to a patient going home.",
  ),
  ...qa(
    "Where is the patient's data stored?",
    "Nowhere on our server. The transcript of a consultation lives on the devices, and each device keeps its own copy that its owner can delete. Our API holds the sign library, issues prescriptions, and introduces two devices to each other. There is no endpoint that could accept a transcript, and we have a test that asserts it.",
  ),
  ...qa(
    "How do the two devices communicate?",
    "The doctor's device asks our server for a six-character code, the patient types it in, and the two exchange just enough to reach each other. After that they talk directly, device to device. Our server sees the code and the connection details, never anything that was said.",
  ),
  ...qa(
    "Why not route it through your server? It would be simpler.",
    "It would, and then the consultation would pass through a third party. We would rather refuse to connect on a network that blocks a direct link, and tell the user honestly, than quietly send a medical conversation somewhere it does not belong.",
  ),
  ...qa(
    "What happens if a word is not in your library?",
    "It depends on the word. A word that carries no meaning in GhSL is dropped, and the doctor is told. A word that changes the meaning — a number, a negation, a frequency — stops the sentence entirely. We would rather show nothing than show \"take tablets\" when the doctor typed \"take two tablets\".",
  ),
  ...qa(
    "How do you know the sign shown is the right one?",
    "Nothing reaches a patient until a GhSL-fluent consultant has approved that specific recording. Replacing the footage resets the approval, because the approval was for the recording and not for the word. And before sending, the doctor sees exactly which signs will play.",
  ),
  ...qa(
    "How much of this is actually built?",
    "All of what we just showed you. It is about 1,932 automated tests across the two halves, and the two-device features are verified in real browsers over a real connection rather than only in unit tests. Section 4 lists what is not done.",
  ),

  h2("Adoption and continued use"),
  ...qa(
    "How would a hospital actually roll this out?",
    "It installs from the browser onto a tablet the ward already has — no app store, no procurement, no login to administer. A patient can use their own phone by typing a code. The realistic first step is one clinic, a few devices, and the sign library extended with the vocabulary that clinic actually uses.",
  ),
  ...qa(
    "What does it cost to run?",
    "Very little. The pieces we use are on free tiers today, and the video storage was chosen specifically because it does not charge for downloads. The real cost is not servers, it is filming and reviewing sign footage, which is a people cost and the honest bottleneck.",
  ),
  ...qa(
    "Who adds new signs? Do you need a developer?",
    "No. A clip is uploaded through an admin page, marked with its meaning, and approved by a consultant. It becomes usable immediately. The library is also the record of what still needs filming, so the gap is visible rather than hidden.",
  ),
  ...qa(
    "What is the biggest risk to this project?",
    "Clinical validation, and we would say so before you asked. The sign library and the rules about which words are safe to drop are engineering's best guess until a GhSL consultant and a clinician sign them off. That is why the app refuses rather than guesses, and it is the first thing we would fund.",
  ),

  h2("If it goes wrong on the day"),
  bullet(
    "A clip does not play: say \"that one is fetching — the library is 13.2 MB and this device is cold\" and carry on with the next beat. Do not wait in silence.",
  ),
  bullet(
    "The two devices will not pair: say \"this network is blocking the direct connection, which is the honest failure we designed for\", switch to the shared-device demo, and keep moving.",
  ),
  bullet(
    "A sentence refuses unexpectedly: that is the safety gate. Use it — \"that is the refusal I was going to show you\" — and explain why.",
  ),
  bullet("Never apologise twice for the same thing. Name it once, then move."),

  // ---------------------------------------------------------------- numbers
  h1("6. Numbers and phrases to have ready"),
  h2("Numbers you can quote"),
  table(
    ["Figure", "What it is"],
    [
      ["107", "Reviewed GhSL clips live: 72 words, 17 phrases, 16 letters and digits, 2 emergency alerts"],
      ["160 MB to 13.2 MB", "The whole library, compressed on upload, so a device can hold it"],
      ["1,932", "Automated tests: 654 on the backend, 1,278 on the frontend"],
      ["61", "Written architecture decisions, including the mistakes"],
      ["1.6 seconds", "For a refreshed device to rejoin a consultation by itself"],
      ["11 ms", "To play a sign already stored on the device"],
      ["~150 KB/s", "The connection speed we measured and designed for"],
      ["4 hours", "How long a paired visit can be rejoined; then it is gone"],
      ["Zero", "Consultation content stored on our server"],
    ],
    [2400, 7346],
  ),

  h2("Sentences that are safe to demonstrate"),
  para(
    "These resolve against the 107 clips we have. Anything outside this vocabulary may correctly refuse.",
  ),
  bullet("\"where is your pain\" — plays as one filmed phrase"),
  bullet("\"where does it hurt\" — one filmed phrase"),
  bullet("\"do you have fever\" — one filmed phrase"),
  bullet("\"are you vomiting\" — one filmed phrase"),
  bullet("\"do you feel dizzy\" — one filmed phrase"),
  bullet("\"do you have allergies\" — one filmed phrase"),
  bullet("\"where exactly is the pain\" — one filmed phrase"),
  bullet("\"when did the pain start\" — one filmed phrase"),
  bullet("\"is the pain severe\" — one filmed phrase"),
  bullet("\"have you taken any medicine\" — one filmed phrase"),
  bullet("\"have you had this problem before\" — one filmed phrase"),
  bullet("\"can you breathe normally\" — one filmed phrase"),
  bullet("\"headache\", \"stomachache\", \"rashes\", \"itchy\", \"tired\" — single word signs"),
  bullet("\"do you have a similar problem before\" — one filmed phrase"),
  bullet("\"my pain is after morning\" — word by word"),
  bullet("\"no pain\" — shows that a negation is signable, not dropped"),
  bullet("\"where is your pains\" — shows plural matching, since GhSL does not mark plural"),
  bullet("\"I am pregnant\" and \"I cannot breathe\" — the two emergency alerts"),
  rich(
    [
      text("To demonstrate the refusal, use ", {}),
      text("\"take two tablets\"", { bold: true }),
      text(
        ". We have no sign for \"two\", and a dose without its number is the exact harm the gate exists to prevent.",
      ),
    ],
    { spacing: { before: 120 } },
  ),

  h2("Words currently in the library"),
  para(
    "after, afternoon, am, an, and, are, at, because, before, below, but, can, could, did, do, evening, for, from, had, has, have, her, his, how, hurt, if, in, is, morning, my, night, no, of, off, on, or, over, pain, should, since, that, the, they, this, to, under, was, what, when, where, who, why, will, with, without, would, yes, your",
    { spacing: { after: 160 } },
  ),

  callout(
    "The last thing to say, if you get the chance",
    [
      para(
        "\"Everything we built comes down to one rule: the app never pretends. If it cannot say something safely, it says so. That is what makes it usable in a hospital rather than impressive in a demo.\"",
        { spacing: { after: 0 } },
      ),
    ],
    WASH,
  ),
];

const doc = new Document({
  creator: "Tie Me Ghana",
  title: "Tie Me Ghana — demo day briefing",
  description: "Run of show and Q&A playbook for the hackathon demo.",
  numbering: {
    config: [
      {
        reference: "dots",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 220 } } },
          },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21, color: INK } },
      heading1: {
        run: { font: "Calibri", size: 30, bold: true, color: GREEN },
      },
      heading2: {
        run: { font: "Calibri", size: 24, bold: true, color: INK },
      },
    },
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } },
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(OUT, buffer);
console.log(`wrote ${OUT}`);
