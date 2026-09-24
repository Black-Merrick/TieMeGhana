/**
 * The demo day deck: 15 slides for the 25 minute slot.
 *
 * Built to the hackathon's own instructions rather than to our architecture.
 * Instruction 3 is the one the deck is shaped around — "clearly distinguishing
 * working features from planned features" — so every feature on every slide
 * carries a status pill, and two facing slides state the split outright rather
 * than leaving a judge to infer it.
 *
 * Slides 8 to 13 map one to one onto the seven assessment criteria. They are
 * not meant to be read aloud in the ten minute demo; they are there so a
 * question in the fifteen minute Q and A can be answered by turning to a slide.
 *
 * Speaker notes are written into each slide's notes pane, so the .pptx carries
 * its own script and the separate notes PDF stays the long form version.
 *
 *   NODE_PATH=<where pptxgenjs is> node docs/talk/build-demo-deck.mjs
 *
 * pptxgenjs is deliberately not a dependency of this project: it builds a
 * document, not the product, and the repository should not grow a package for
 * something only run by hand.
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "tie-me-ghana-demo-day.pptx");

/* The app's own palette, so the deck and the thing on screen are one product. */
const DEEP = "0B3D2E";
const GREEN = "0A4A3A";
const MINT = "7FD8B8";
const WASH = "F4F8F6";
const LINE = "D8E2DE";
const INK = "0F1F1A";
const MUTED = "5D6F68";
const AMBER = "B26A00";
const AMBER_WASH = "FDF6E7";
const RED = "A4301C";
const WHITE = "FFFFFF";

const HEAD = "Cambria";
const BODY = "Calibri";

const W = 13.333;
const H = 7.5;
const M = 0.62;

const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE";
pres.author = "Tie Me Ghana";
pres.title = "Tie Me Ghana — Demo Day";

let pageNo = 0;

/** A content slide with its title block and the page furniture. */
function slide({ eyebrow, title, dark = false, sub = null }) {
  const s = pres.addSlide();
  pageNo += 1;
  s.background = { color: dark ? DEEP : WHITE };

  if (eyebrow) {
    s.addText(eyebrow.toUpperCase(), {
      x: M, y: 0.42, w: W - M * 2, h: 0.26,
      fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2,
      color: dark ? MINT : GREEN, isTextBox: true, margin: 0,
    });
  }
  if (title) {
    s.addText(title, {
      x: M, y: 0.70, w: W - M * 2, h: 0.72,
      fontFace: HEAD, fontSize: 34, bold: true,
      color: dark ? WHITE : INK, isTextBox: true, margin: 0,
    });
  }
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.46, w: W - M * 2 - 1.2, h: 0.42,
      fontFace: BODY, fontSize: 14,
      color: dark ? MINT : MUTED, isTextBox: true, margin: 0,
    });
  }

  s.addText(`Tie Me Ghana`, {
    x: M, y: H - 0.52, w: 4, h: 0.26,
    fontFace: BODY, fontSize: 9.5, color: dark ? "7F9B91" : MUTED,
    isTextBox: true, margin: 0,
  });
  s.addText(String(pageNo), {
    x: W - M - 1, y: H - 0.52, w: 1, h: 0.26, align: "right",
    fontFace: BODY, fontSize: 9.5, color: dark ? "7F9B91" : MUTED,
    isTextBox: true, margin: 0,
  });
  return s;
}

/** The motif: a status pill. Every feature in the deck wears one. */
function pill(s, { x, y, text, tone }) {
  const on = tone === "working";
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w: on ? 1.42 : 1.28, h: 0.28,
    fill: { color: on ? DEEP : AMBER },
    line: { type: "none" },
    rectRadius: 0.14,
  });
  s.addText(text, {
    x, y, w: on ? 1.42 : 1.28, h: 0.28, align: "center", valign: "middle",
    fontFace: BODY, fontSize: 9, bold: true, charSpacing: 1,
    color: WHITE, isTextBox: true, margin: 0,
  });
}

/** A soft card. No edge stripes anywhere in this deck. */
function card(s, { x, y, w, h, tone = "plain" }) {
  const fill =
    tone === "planned" ? AMBER_WASH : tone === "stop" ? "FDF2F0" : WASH;
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: tone === "planned" ? "EBD9B4" : LINE, width: 1 },
    rectRadius: 0.08,
  });
}

function heading(s, { x, y, w, text, color = DEEP, size = 15 }) {
  s.addText(text, {
    x, y, w, h: 0.3,
    fontFace: HEAD, fontSize: size, bold: true, color,
    isTextBox: true, margin: 0,
  });
}

function body(s, { x, y, w, h, text, size = 12.5, color = INK }) {
  s.addText(text, {
    x, y, w, h,
    fontFace: BODY, fontSize: size, color, lineSpacing: size * 1.32,
    isTextBox: true, margin: 0, valign: "top",
  });
}

function bullets(s, { x, y, w, h, items, size = 12.5, color = INK }) {
  s.addText(
    items.map((t, i) => ({
      text: t,
      options: { bullet: true, breakLine: i !== items.length - 1 },
    })),
    {
      x, y, w, h,
      fontFace: BODY, fontSize: size, color,
      paraSpaceAfter: 6, isTextBox: true, margin: 0, valign: "top",
    },
  );
}

/** A numbered disc, used for the demo running order. */
function disc(s, { x, y, n, d = 0.42 }) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: d, h: d, fill: { color: DEEP }, line: { type: "none" },
  });
  s.addText(String(n), {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: BODY, fontSize: 12, bold: true, color: WHITE,
    isTextBox: true, margin: 0,
  });
}

/* ------------------------------------------------------------------ 1 */
{
  const s = pres.addSlide();
  pageNo += 1;
  s.background = { color: DEEP };
  s.addText("MTN GHANA TEKYEREMA PA HACKATHON 2026", {
    x: M, y: 2.35, w: 11, h: 0.3,
    fontFace: BODY, fontSize: 12, bold: true, charSpacing: 2.4,
    color: MINT, isTextBox: true, margin: 0,
  });
  s.addText("Tie Me Ghana", {
    x: M, y: 2.72, w: 11, h: 1.15,
    fontFace: HEAD, fontSize: 54, bold: true, color: WHITE,
    isTextBox: true, margin: 0,
  });
  s.addText(
    "A deaf patient and a doctor, talking to each other.\nToday, on the phones they already carry.",
    {
      x: M, y: 3.95, w: 9.4, h: 0.95,
      fontFace: BODY, fontSize: 17, color: "CFE4DC",
      lineSpacing: 25, isTextBox: true, margin: 0,
    },
  );
  s.addText("Team [your team name]", {
    x: M, y: 5.30, w: 6, h: 0.3,
    fontFace: BODY, fontSize: 13, bold: true, color: WHITE,
    isTextBox: true, margin: 0,
  });
  s.addText("Pilot. Not yet approved for clinical use.", {
    x: M, y: H - 0.72, w: 8, h: 0.3,
    fontFace: BODY, fontSize: 10.5, color: "7F9B91",
    isTextBox: true, margin: 0,
  });
  s.addNotes(
    "Stand still. Do not touch the laptop yet.\n\n" +
      "Good morning. We are team [name]. Our project is called Tie Me Ghana.\n\n" +
      "Think of a deaf patient who walks into a hospital in Ghana today. The doctor speaks. " +
      "She cannot hear him. So he writes it down. But many deaf people in Ghana did not finish " +
      "school, so she cannot read it either.\n\n" +
      "Then the hospital looks for a sign language helper. There are very few. Most days there is none.\n\n" +
      "Tie Me Ghana lets those two people talk. Today. With the phone already in their hand.\n\n" +
      "Then say: Let me take you through one visit, from the door to the pharmacy.",
  );
}

/* ------------------------------------------------------------------ 2 */
{
  const s = slide({ eyebrow: "The problem", title: "Three doors, all closed" });
  const items = [
    ["She cannot hear him", "Speech is the hospital's default, and it carries nothing to a Deaf patient."],
    ["She cannot read it", "Writing is the fallback everywhere. Many Deaf Ghanaians did not finish school, so the note is no better than the speech."],
    ["There is no interpreter", "GhSL interpreters are few. A ward cannot staff one, and at night there is nobody at all."],
  ];
  items.forEach(([h, t], i) => {
    const x = M + i * 4.12;
    card(s, { x, y: 2.15, w: 3.86, h: 3.05 });
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.28, y: 2.44, w: 0.56, h: 0.56,
      fill: { color: DEEP }, line: { type: "none" },
    });
    s.addText(String(i + 1), {
      x: x + 0.28, y: 2.44, w: 0.56, h: 0.56, align: "center", valign: "middle",
      fontFace: BODY, fontSize: 14, bold: true, color: WHITE, isTextBox: true, margin: 0,
    });
    heading(s, { x: x + 0.28, y: 3.22, w: 3.3, text: h });
    body(s, { x: x + 0.28, y: 3.62, w: 3.3, h: 1.45, text: t, size: 12, color: MUTED });
  });
  body(s, {
    x: M, y: 5.65, w: W - M * 2, h: 1.2,
    text:
      "So the visit runs on hand waving and guessing. The patient cannot say where the pain is. " +
      "The doctor cannot be sure she understood the medicine. Both of them leave hoping.",
    size: 14,
  });
  s.addNotes(
    "Three doors, and all of them are shut.\n\n" +
      "Point at each one as you say it. Do not rush — this is the slide that makes the judges care.\n\n" +
      "Finish on the last line: both of them leave hoping. Then pause, and go to the demo.",
  );
}

/* ------------------------------------------------------------------ 3 */
{
  const s = slide({
    eyebrow: "What it is",
    title: "One web page, two ways to use it",
    sub: "No app store, no download, no new hardware on the ward.",
  });
  const rows = [
    ["Two devices", "The patient holds her own phone. A six character code pairs them, and from then on the two devices talk straight to each other."],
    ["Or one device", "No smart phone? The same visit runs on one screen, split down the middle, turned between the two people."],
  ];
  rows.forEach(([h, t], i) => {
    const y = 2.25 + i * 1.86;
    card(s, { x: M, y, w: 7.55, h: 1.62 });
    heading(s, { x: M + 0.3, y: y + 0.26, w: 4.4, text: h });
    body(s, { x: M + 0.3, y: y + 0.66, w: 6.95, h: 0.86, text: t, size: 12, color: MUTED });
    pill(s, { x: M + 6.0, y: y + 0.24, text: "WORKING NOW", tone: "working" });
  });
  const stats = [
    ["108", "reviewed GhSL clips"],
    ["13.2 MB", "whole library, on the phone"],
    ["0", "consultation data on our server"],
  ];
  stats.forEach(([n, l], i) => {
    const y = 2.30 + i * 1.30;
    s.addText(n, {
      x: 8.55, y, w: 4.2, h: 0.52,
      fontFace: HEAD, fontSize: 30, bold: true, color: DEEP, isTextBox: true, margin: 0,
    });
    s.addText(l, {
      x: 8.55, y: y + 0.52, w: 4.2, h: 0.3,
      fontFace: BODY, fontSize: 11, color: MUTED, isTextBox: true, margin: 0,
    });
  });
  body(s, {
    x: M, y: 6.08, w: W - M * 2, h: 0.7,
    text:
      "It opens in any browser, on any phone, on whatever laptop the ward already owns. " +
      "Add it to the home screen and it behaves like an app, with the sign videos stored on the device.",
    size: 12.5, color: MUTED,
  });
  s.addNotes(
    "Say the two modes plainly. The point to land: we did not make the poorer patient use a worse app.\n\n" +
      "The three numbers on the right are the ones to quote if asked. 108 clips, 13.2 MB for the whole " +
      "library so a phone can hold it, and nothing about the consultation stored on our server.",
  );
}

/* ------------------------------------------------------------------ 4 */
{
  const s = slide({
    eyebrow: "Instruction 3 · what is real",
    title: "Working today",
    sub: "Every item below runs in the build you are about to see. Nothing here is a mock-up.",
  });
  const left = [
    "Doctor speaks or types. The sentence is captioned in Twi and played as GhSL sign video.",
    "The literacy question is asked in sign, on the patient's own phone, before anything else.",
    "Guided Interrogation: the doctor taps a question, the patient answers Yes or No in sign.",
    "The patient types a reply and the doctor's device speaks it out loud.",
  ];
  const right = [
    "Emergency triage: four critical alerts, a body drawing and a pain scale, mirrored to her phone.",
    "Prescription as sign video plus a QR code, saved to the patient's phone and played offline.",
    "The safety gate refuses any sentence it cannot sign correctly, and names the missing word.",
    "Session transcript kept on each device. Pairing survives a reload of either phone.",
  ];
  card(s, { x: M, y: 2.15, w: 5.92, h: 4.08 });
  card(s, { x: M + 6.18, y: 2.15, w: 5.92, h: 4.08 });
  pill(s, { x: M + 0.28, y: 2.40, text: "WORKING NOW", tone: "working" });
  pill(s, { x: M + 6.46, y: 2.40, text: "WORKING NOW", tone: "working" });
  bullets(s, { x: M + 0.28, y: 2.92, w: 5.36, h: 3.18, items: left, size: 13 });
  bullets(s, { x: M + 6.46, y: 2.92, w: 5.36, h: 3.18, items: right, size: 13 });
  body(s, {
    x: M, y: 6.42, w: W - M * 2, h: 0.6,
    text:
      "1,933 automated tests. 61 written architecture decisions, including the mistakes. " +
      "Deployed and reachable right now, not running on this laptop.",
    size: 12.5, color: MUTED,
  });
  s.addNotes(
    "This is the slide the instructions ask for. Say it in one line:\n\n" +
      "Everything on this slide works in the build we are about to show you. The next slide is what does not.\n\n" +
      "Do not read all eight. Read three, then move on. The list is here so a judge can see it.",
  );
}

/* ------------------------------------------------------------------ 5 */
{
  const s = slide({
    eyebrow: "Instruction 3 · what is not",
    title: "Planned, and honestly not built",
    sub: "We would rather list these than have you find them.",
  });
  const items = [
    ["Fingerspelling", "9 of 26 letters filmed. Spelling a word needs every one of its letters, so the fallback stays off and a word with no sign stops the sentence instead."],
    ["Body-part grid in Guided mode", "0 of 16 filmed. The app hides the grid rather than offer three body parts when the pain is in a fourth — a wrong answer there looks exactly like a right one."],
    ["Clinical sign-off", "The sign library and the word-safety lists need a GhSL consultant and a clinician. Until then it is a pilot, and every screen says so."],
    ["Direct connection on closed networks", "No TURN server, so some hospital networks will refuse to pair two devices. The app says so and offers the one-screen mode instead of failing quietly."],
    ["Ga and Ewe", "The language layer is an interface and clip lookup is keyed on gloss, not on Twi, so it extends — but it is not built."],
    ["Visual queue call", "Designed against the vibration vocabulary already in the app. Not built."],
  ];
  items.forEach(([h, t], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 6.18;
    const y = 2.18 + row * 1.46;
    card(s, { x, y, w: 5.92, h: 1.30, tone: "planned" });
    heading(s, { x: x + 0.26, y: y + 0.16, w: 4.1, text: h, color: AMBER, size: 13 });
    body(s, { x: x + 0.26, y: y + 0.52, w: 5.4, h: 0.72, text: t, size: 10.5, color: MUTED });
    pill(s, { x: x + 4.42, y: y + 0.15, text: "PLANNED", tone: "planned" });
  });
  s.addNotes(
    "Do not apologise for this slide. Deliver it as a strength.\n\n" +
      "Say: we were asked to separate what works from what is planned, so here it is in full.\n\n" +
      "If you only say one thing, say the body-part grid: we hide it on purpose, because a patient " +
      "offered three body parts when the pain is in a fourth will tap the nearest one, and that wrong " +
      "answer looks exactly like a right one. That single decision tells them how we think about safety.",
  );
}

/* ------------------------------------------------------------------ 6 */
{
  const s = slide({
    eyebrow: "The demo",
    title: "Ten minutes, in this order",
    sub: "Screens 1 to 9. Times are budgets, not targets.",
  });
  const steps = [
    ["Does she have a phone?", "40s"],
    ["Pair with a six letter code", "50s"],
    ["Can she read? Asked in sign", "50s"],
    ["Guided questions, answered in sign", "2m"],
    ["Free typing, and a voice for the doctor", "70s"],
    ["The app refuses a sentence", "60s"],
    ["Emergency, mirrored to her phone", "60s"],
    ["The medicine, saved on her phone", "2m"],
    ["One shared screen, and no app store", "80s"],
  ];
  steps.forEach(([t, time], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = M + col * 4.12;
    const y = 2.25 + row * 1.42;
    card(s, { x, y, w: 3.86, h: 1.26 });
    disc(s, { x: x + 0.24, y: y + 0.40, n: i + 1 });
    s.addText(t, {
      x: x + 0.82, y: y + 0.24, w: 2.3, h: 0.78,
      fontFace: BODY, fontSize: 11.5, bold: true, color: INK,
      isTextBox: true, margin: 0, valign: "middle",
    });
    s.addText(time, {
      x: x + 3.16, y: y + 0.46, w: 0.5, h: 0.3, align: "right",
      fontFace: BODY, fontSize: 10, bold: true, color: MUTED,
      isTextBox: true, margin: 0,
    });
  });
  body(s, {
    x: M, y: 6.52, w: W - M * 2, h: 0.5,
    text: "Running late? Cut 5 and 9. Never cut 6 or 8 — the refusal and the medicine are the two that win marks.",
    size: 12, color: MUTED,
  });
  s.addNotes(
    "This slide is for you, not for them. Leave it up for five seconds while you move to the laptop.\n\n" +
      "Type the filmed questions word for word: 'Do you have fever?' plays one clip, " +
      "'Do you have a fever?' refuses. For the refusal screen use 'Your pain is not serious.'",
  );
}

/* ------------------------------------------------------------------ 7 */
{
  const s = slide({
    eyebrow: "Why it is safe",
    title: "It would rather show nothing than half a sentence",
    dark: true,
  });
  s.addText(
    "“Your pain is not serious.”",
    {
      x: M, y: 2.10, w: 7.4, h: 0.6,
      fontFace: HEAD, fontSize: 25, bold: true, color: WHITE, isTextBox: true, margin: 0,
    },
  );
  card(s, { x: M, y: 2.90, w: 7.4, h: 1.05, tone: "stop" });
  s.addText(
    "Refused. The word “not” has no reviewed sign, so the sentence does not play.",
    {
      x: M + 0.28, y: 3.10, w: 6.9, h: 0.68,
      fontFace: BODY, fontSize: 13, bold: true, color: RED, isTextBox: true, margin: 0,
    },
  );
  s.addText(
    "A normal app drops the word it does not know and plays the rest. The patient would have read " +
      "“your pain is serious” — the opposite of what the doctor said.\n\n" +
      "In a hospital that is how somebody takes the wrong dose. So every word is classified before " +
      "anything plays: droppable, or safe to spell, or blocking. One blocking word stops the whole " +
      "sentence and the doctor is told which word it was.",
    {
      x: M, y: 4.28, w: 7.4, h: 2.2,
      fontFace: BODY, fontSize: 13, color: "CFE4DC", lineSpacing: 19,
      isTextBox: true, margin: 0,
    },
  );
  card(s, { x: 8.55, y: 2.10, w: 4.16, h: 4.15 });
  heading(s, { x: 8.81, y: 2.34, w: 3.6, text: "How a word is treated" });
  bullets(s, {
    x: 8.81, y: 2.84, w: 3.64, h: 3.2, size: 12.5, color: INK,
    items: [
      "Has a reviewed sign → play it",
      "An article or copula → drop it, GhSL does not use them",
      "Blocking, like “not” → stop the sentence",
      "Otherwise → spell it, once the alphabet exists",
    ],
  });
  s.addNotes(
    "Slow right down here. This is the slide that separates a health tool from a demo.\n\n" +
      "Say: this is the part we are most proud of, and it is the part that does nothing.\n\n" +
      "Then the line that lands: we would rather show nothing than show half of a sentence. Pause after it.",
  );
}

/* ------------------------------------------------------------------ 8 */
{
  const s = slide({
    eyebrow: "Assessment · 20 points",
    title: "Communication support and two-way interaction",
    sub: "Both directions, and neither of them needs an interpreter.",
  });
  const cols = [
    ["Doctor → patient", [
      "Speech or typing, in English or Twi",
      "Caption shown in Twi, and played as GhSL sign video",
      "14 whole questions filmed as single clips, so a common question is one smooth video",
      "Anything else is built sign by sign from the library",
    ]],
    ["Patient → doctor", [
      "Yes or No, answered by tapping a signed button",
      "Typed replies, spoken aloud on the doctor's device so his eyes stay on her",
      "Emergency alerts, a body drawing and a pain scale, all without words",
      "Every exchange recorded in a transcript on each device",
    ]],
  ];
  cols.forEach(([h, items], i) => {
    const x = M + i * 6.18;
    card(s, { x, y: 2.15, w: 5.92, h: 4.08 });
    heading(s, { x: x + 0.28, y: 2.42, w: 4.0, text: h, size: 16 });
    pill(s, { x: x + 4.22, y: 2.38, text: "WORKING NOW", tone: "working" });
    bullets(s, { x: x + 0.28, y: 2.96, w: 5.36, h: 3.14, items, size: 13 });
  });
  body(s, {
    x: M, y: 6.42, w: W - M * 2, h: 0.5,
    text: "The two devices exchange this directly. None of it passes through our server.",
    size: 12.5, color: MUTED,
  });
  s.addNotes(
    "Q and A slide. Turn to it if a judge asks how the patient answers back.\n\n" +
      "The strongest single fact: the doctor's device speaks her typed reply out loud, so he can keep " +
      "looking at his patient instead of at a screen.",
  );
}

/* ------------------------------------------------------------------ 9 */
{
  const s = slide({
    eyebrow: "Assessment · 20 points",
    title: "Accessibility and inclusion",
    sub: "Designed for a patient who may read nothing at all.",
  });
  const items = [
    ["Nothing depends on reading", "Questions are signed, answers are tapped. Even the Yes and No buttons carry their own sign clips."],
    ["The literacy question is asked, not assumed", "It is shown in sign on the patient's own phone, so she answers it herself instead of a nurse guessing for her."],
    ["Nothing depends on colour alone", "Each half of a shared screen carries a heading, a hint and a differently shaped mark, for bright sunlight and for colour blind staff."],
    ["Nothing depends on hearing", "Vibration and visible state replace every sound cue. The app never relies on a chime."],
    ["The poorer patient is not downgraded", "One phone or two, it is the same app and the same questions. The no-phone path is not a cut-down version."],
    ["Emergency is reachable first", "The triage screen opens before any question is asked. You should not fill in a form to say you cannot breathe."],
  ];
  items.forEach(([h, t], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 6.18;
    const y = 2.18 + row * 1.46;
    card(s, { x, y, w: 5.92, h: 1.30 });
    heading(s, { x: x + 0.26, y: y + 0.16, w: 4.2, text: h, size: 13 });
    body(s, { x: x + 0.26, y: y + 0.52, w: 5.4, h: 0.72, text: t, size: 10.5, color: MUTED });
    pill(s, { x: x + 4.50, y: y + 0.15, text: "WORKING NOW", tone: "working" });
  });
  s.addNotes(
    "Q and A slide, and the one to turn to if asked whether Deaf people were involved.\n\n" +
      "Answer: the clips are signed by Deaf signers and a reviewer approves every clip before it can " +
      "reach a patient. The app will not play a clip nobody approved.",
  );
}

/* ------------------------------------------------------------------ 10 */
{
  const s = slide({
    eyebrow: "Assessment · 20 points",
    title: "Technical fit and implementation",
    sub: "Built to survive a hospital network, not a conference Wi-Fi.",
  });
  const left = [
    ["Peer to peer, by design", "Once paired, the devices exchange the consultation directly. The server introduces them and then has nothing to do with it."],
    ["Offline after first use", "The service worker keeps the clips on the device, so a sign plays in milliseconds with no network."],
    ["Honest failure", "No TURN server, so some networks will not pair. The app says so and offers one shared screen rather than routing a consultation somewhere else."],
  ];
  left.forEach(([h, t], i) => {
    const y = 2.18 + i * 1.42;
    card(s, { x: M, y, w: 7.55, h: 1.26 });
    heading(s, { x: M + 0.28, y: y + 0.17, w: 5.4, text: h, size: 13 });
    body(s, { x: M + 0.28, y: y + 0.53, w: 7.0, h: 0.68, text: t, size: 10.5, color: MUTED });
  });
  card(s, { x: 8.55, y: 2.18, w: 4.16, h: 3.92 });
  heading(s, { x: 8.81, y: 2.44, w: 3.6, text: "Evidence" });
  const stats = [
    ["1,933", "automated tests, both halves"],
    ["61", "written architecture decisions"],
    ["108", "reviewed clips, 13.2 MB served"],
  ];
  stats.forEach(([n, l], i) => {
    const y = 3.00 + i * 1.02;
    s.addText(n, {
      x: 8.81, y, w: 3.6, h: 0.42,
      fontFace: HEAD, fontSize: 22, bold: true, color: DEEP, isTextBox: true, margin: 0,
    });
    s.addText(l, {
      x: 8.81, y: y + 0.40, w: 3.6, h: 0.28,
      fontFace: BODY, fontSize: 10, color: MUTED, isTextBox: true, margin: 0,
    });
  });
  body(s, {
    x: M, y: 6.42, w: W - M * 2, h: 0.5,
    text: "Django and DRF on Render, React and Vite on Netlify, Postgres on Neon, clips on Cloudflare R2. One repository, two deployments.",
    size: 12, color: MUTED,
  });
  s.addNotes(
    "If asked whether this is a real deployment: it is. The site is hosted, the database is hosted, " +
      "the clips come from cloud storage. What you are watching is not running on this laptop.\n\n" +
      "If asked what is weakest technically: say TURN, before they say it. Some hospital networks will " +
      "not allow two devices to connect directly, and the honest answer is that we fall back to one screen.",
  );
}

/* ------------------------------------------------------------------ 11 */
{
  const s = slide({
    eyebrow: "Assessment · 10 + 10 points",
    title: "Ghanaian language, and local fit",
  });
  card(s, { x: M, y: 2.08, w: 5.92, h: 4.18 });
  heading(s, { x: M + 0.28, y: 2.30, w: 4.2, text: "Ghanaian-language support" });
  pill(s, { x: M + 4.22, y: 2.28, text: "WORKING NOW", tone: "working" });
  bullets(s, {
    x: M + 0.28, y: 2.88, w: 5.36, h: 3.24, size: 12.5,
    items: [
      "English or Twi spoken in, Twi caption out, via the Khaya API",
      "Ghanaian Sign Language, filmed here with Deaf signers — not American Sign Language",
      "GhSL is one language nationwide, so the signs do not change from region to region",
      "Plural forms match their singular sign, because GhSL does not mark plurals",
      "Ga and Ewe extend through the same interface, but are not built",
    ],
  });
  card(s, { x: M + 6.18, y: 2.08, w: 5.92, h: 4.18 });
  heading(s, { x: M + 6.46, y: 2.30, w: 4.2, text: "UX, usability and local fit" });
  pill(s, { x: M + 10.40, y: 2.28, text: "WORKING NOW", tone: "working" });
  bullets(s, {
    x: M + 6.46, y: 2.88, w: 5.36, h: 3.24, size: 12.5,
    items: [
      "Runs on the phone a ward already owns — no app store, no download, no new hardware",
      "13.2 MB holds the whole library, so a weak network is a first-visit cost only",
      "A reload does not lose the visit; a refreshed device rejoins by itself",
      "Big targets, high contrast, and state that is always visible rather than inferred",
      "One screen or two, chosen by a nurse in one tap at the start of the visit",
    ],
  });
  s.addNotes(
    "Two criteria on one slide, ten points each.\n\n" +
      "The line that lands for local fit: a hospital does not need new machines for this. It needs the link.",
  );
}

/* ------------------------------------------------------------------ 12 */
{
  const s = slide({
    eyebrow: "Assessment · 10 points",
    title: "Adoption and continued use",
    sub: "The cheapest thing about it is the tenth hospital.",
  });
  const items = [
    ["Nothing to install", "A link, not a deployment. A ward starts using it in the time it takes to type an address."],
    ["Adding a sign is filming, not coding", "A new sign is recorded, reviewed and imported. We added 44 this week without touching the app."],
    ["The library is shared", "Every hospital draws on the same reviewed clips, so the second hospital costs almost nothing to serve."],
    ["It degrades honestly", "Where it cannot help, it says so. Staff learn quickly what it is for, which is how a tool survives past week one."],
  ];
  items.forEach(([h, t], i) => {
    const y = 2.20 + i * 1.04;
    card(s, { x: M, y, w: 7.9, h: 0.92 });
    heading(s, { x: M + 0.26, y: y + 0.14, w: 4.6, text: h, size: 12.5 });
    body(s, { x: M + 4.95, y: y + 0.12, w: 2.85, h: 0.70, text: t, size: 10, color: MUTED });
  });
  card(s, { x: 8.90, y: 2.20, w: 3.81, h: 3.96, tone: "planned" });
  heading(s, { x: 9.16, y: 2.45, w: 3.3, text: "Before a real ward", color: AMBER });
  bullets(s, {
    x: 9.16, y: 2.92, w: 3.3, h: 2.6, size: 11.5, color: MUTED,
    items: [
      "Clinical sign-off on the library",
      "The rest of the alphabet filmed",
      "The 16 body-part signs filmed",
      "A TURN server for closed networks",
    ],
  });
  pill(s, { x: 9.16, y: 5.70, text: "PLANNED", tone: "planned" });
  s.addNotes(
    "If asked about money: a hospital pays far more for one interpreter than for this. A small yearly " +
      "fee per hospital, with the clip library shared across all of them.\n\n" +
      "The amber box on the right is deliberate. Saying what has to happen before a real ward uses it " +
      "is what makes the rest of the slide believable.",
  );
}

/* ------------------------------------------------------------------ 13 */
{
  const s = slide({
    eyebrow: "Assessment · 10 points",
    title: "Where you can use it, right now",
    sub: "Open it on your own phone while we are still standing here.",
  });
  const rows = [
    ["Doctor or nurse", "tiemeghana.netlify.app"],
    ["Patient", "tiemeghana.netlify.app/join"],
  ];
  rows.forEach(([who, url], i) => {
    const y = 2.30 + i * 1.34;
    card(s, { x: M, y, w: 8.4, h: 1.14 });
    s.addText(who, {
      x: M + 0.3, y: y + 0.36, w: 2.2, h: 0.42,
      fontFace: BODY, fontSize: 13, bold: true, color: MUTED, isTextBox: true, margin: 0,
    });
    s.addText(url, {
      x: M + 2.5, y: y + 0.32, w: 5.7, h: 0.50,
      fontFace: BODY, fontSize: 18, bold: true, color: DEEP, isTextBox: true, margin: 0,
    });
  });
  card(s, { x: 9.35, y: 2.30, w: 3.36, h: 2.48 });
  heading(s, { x: 9.61, y: 2.56, w: 2.9, text: "No second phone?" });
  body(s, {
    x: 9.61, y: 2.96, w: 2.84, h: 1.6,
    text: "Open the first link and choose “No, share this device”. The whole visit runs on one screen.",
    size: 11, color: MUTED,
  });
  body(s, {
    x: M, y: 5.20, w: 8.4, h: 1.4,
    text:
      "It is a web site, so it opens in Chrome, in Safari, in any browser, on a phone, a tablet or a laptop. " +
      "Nothing to download and no app store. Open it once and tap “Add to Home Screen” and it behaves " +
      "like an installed app, with the sign videos kept on the device.",
    size: 12.5,
  });
  s.addNotes(
    "Say the address out loud, letter by letter if you must, and leave this slide up while they type it.\n\n" +
      "If asked whether the code is available: yes, and we are happy to add the judges. Ask which email. " +
      "Do not promise a public link if the repository is private.\n\n" +
      "Agree before you go on stage who the one named contact is, and give one address.",
  );
}

/* ------------------------------------------------------------------ 14 */
{
  const s = slide({ eyebrow: "In one sentence", title: "", dark: true });
  s.addText(
    "The server never learns what was said.",
    {
      x: M, y: 2.30, w: 11.6, h: 1.4,
      fontFace: HEAD, fontSize: 42, bold: true, color: WHITE,
      isTextBox: true, margin: 0, lineSpacing: 48,
    },
  );
  s.addText(
    "A deaf patient can say where the pain is. A doctor can be sure she understood the medicine. " +
      "And nobody had to find an interpreter.\n\n" +
      "It runs today, on the phones people already carry, in Ghanaian Sign Language filmed here. " +
      "It is a pilot, it is not approved for clinical use yet, and we say so on every screen until it is.",
    {
      x: M, y: 3.95, w: 10.4, h: 1.9,
      fontFace: BODY, fontSize: 16, color: "CFE4DC", lineSpacing: 24,
      isTextBox: true, margin: 0,
    },
  );
  s.addText("Thank you. Questions?", {
    x: M, y: H - 1.28, w: 8, h: 0.44,
    fontFace: HEAD, fontSize: 19, bold: true, color: MINT,
    isTextBox: true, margin: 0,
  });
  s.addNotes(
    "The closing. Then stop talking. Do not add anything — let the silence sit until the first question.\n\n" +
      "Closing lines, word for word:\n" +
      "So that is Tie Me Ghana. A deaf patient can say where the pain is. A doctor can be sure she " +
      "understood the medicine. And nobody had to find a sign language helper.\n" +
      "It runs today, on the phones people already carry, in Ghanaian Sign Language we filmed here.\n" +
      "It is a pilot. It is not approved for clinical use yet, and we will say so on every screen until it is.\n" +
      "Thank you. We are happy to take your questions.",
  );
}

await pres.writeFile({ fileName: OUT });
console.log(`wrote ${OUT}`);
