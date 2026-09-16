/**
 * Build the user manual, as a web page and as a PDF.
 *
 * Reads docs/manual/screens.json, which capture-manual.mjs produced by asking
 * the running app where each control actually is. The callouts here are placed
 * from those measurements rather than positioned by eye, so an arrow cannot
 * end up pointing at empty space after a layout change. Rerun both tools and
 * the manual is correct again.
 *
 * The PDF is printed by the same Chrome that took the screenshots, through the
 * DevTools Protocol, so no PDF library is added to a project that does not
 * otherwise need one.
 *
 *   node tools/build-manual.mjs
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, "..", "..", "docs", "manual");
const PDF_OUT = resolve(HERE, "..", "public", "tie-me-ghana-manual.pdf");

const CHROME = "google-chrome";
const PORT = 9334;

/**
 * The viewport the screenshots were taken at.
 *
 * Both dimensions matter. A CSS percentage for `left` resolves against the
 * container's width and one for `top` against its height, so using the width
 * for both put every badge at the wrong vertical position, further out the
 * further down the page it belonged.
 */
let SHOT = { width: 1280, height: 860 };

const RELEASE = "Pilot release, September 2026";

/**
 * What each numbered callout means, per screen.
 *
 * Keyed by the selector the capture used, so the prose and the measurement
 * cannot drift apart: a selector renamed in one place and not the other leaves
 * a callout with no explanation, which the build reports.
 */
const EXPLANATIONS = {
  opening: {
    '[data-testid="enter-emergency"]': [
      "Emergency",
      "Opens Emergency mode straight away, without asking anything first. Use it for a patient who arrives after an accident or who cannot breathe. It works before you have asked whether they read.",
    ],
    '[data-testid="install-app"]': [
      "Install app",
      "Adds Tie Me Ghana to the device like any other app, with its own icon. Worth doing once on every device that will be used in the clinic: an installed copy opens faster and keeps its saved sign videos.",
    ],
    '[data-testid="connection-status"]': [
      "Connection",
      "Green means the hospital system is reachable. If it turns grey the app keeps working with the sign videos already on the device, but new prescriptions cannot be issued until it returns.",
    ],
    '[data-testid="choice-yes"]': [
      "Yes",
      "The patient reads written language. Tapping this opens the full consultation screen, where you type freely and they can type back.",
    ],
    '[data-testid="choice-no"]': [
      "No",
      "The patient does not read print. Tapping this opens Guided Interrogation, where every question is asked in sign video and answered yes or no.",
    ],
    '[data-testid="open-privacy"]': [
      "Privacy and Terms",
      "The full privacy policy and terms of use. Worth reading once before the app is used with real patients, and the page to send a hospital that asks what the app stores.",
    ],
  },
  consultation: {
    '[data-testid="doctor-language"]': [
      "I speak",
      "The language you are about to use. Choose Both when your sentence mixes English and Twi, which is normal for medicine names that have no Twi word. Speaking aloud needs one language chosen, because speech recognition handles one at a time.",
    ],
    '[data-testid="output-language"]': [
      "Speak in",
      "The language the patient's answers are read aloud to you in. Set it once at the start of the visit to whichever language you understand.",
    ],
    "#doctor-message": [
      "The message box",
      "Type what you want to say. Keep it to one clear instruction or question at a time. The app will show you the sign video before the patient sees it.",
    ],
    ".consultation__send": [
      "Send to patient",
      "Renders your message as Ghanaian Sign Language and shows it to the patient. If a word has no approved sign, the app tells you instead of guessing.",
    ],
    '[data-testid="microphone-button"]': [
      "Speak to patient",
      "Dictate instead of typing. Tap once to start, tap again to stop and send. Typing always works and needs no permission, so use it whenever the room is noisy.",
    ],
    '[data-testid="new-patient"]': [
      "New patient",
      "Ends this visit and erases the record of it from the device. Tap it before handing the device to the next patient. This is the control that stops one patient seeing another patient's consultation.",
    ],
  },
  guided: {
    "#doctor-message": [
      "The question",
      "Ask one thing at a time. Guided Interrogation is for a patient who does not read, so every question becomes a sign video and is answered yes or no.",
    ],
    ".consultation__send": [
      "Send to patient",
      "Shows the question as sign video. When the video ends, the Yes and No answers appear in the same place, so the patient does not have to look elsewhere.",
    ],
    '[data-testid="ask-where-it-hurts"]': [
      "Ask where it hurts",
      "Asks the question and then offers the patient a set of body locations to choose from, instead of a yes or no answer.",
    ],
  },
  emergency: {
    '[data-testid="triage-voice"]': [
      "Read answers in",
      "The language every tap is read aloud in. Set it first, in the few seconds before you start, so what the patient says reaches you in a language you understand.",
    ],
    ".alerts": [
      "Critical alerts",
      "One tap says the most urgent things a patient may need to tell you. Each is spoken aloud immediately. Where the sign video has not been filmed yet, the icon and the label are still shown and still work.",
    ],
    '[data-testid="pain-scale"]': [
      "How much pain",
      "Five faces, from comfortable to severe. The patient taps one and it is spoken aloud. This needs no sign video and no reading at all.",
    ],
    '[data-testid="body-map"]': [
      "Point to where it hurts",
      "The patient taps a part of the head or body and it is spoken aloud. Only the part they touched is highlighted, so there is no doubt about what they meant.",
    ],
    '[data-testid="leave-emergency"]': [
      "Leave emergency mode",
      "Returns to the normal consultation. Emergency mode sits outside the visit, so leaving it does not lose anything you had already asked.",
    ],
  },
  prescription: {
    ".photo__pick": [
      "Photograph of the medicine",
      "Take a picture of the packet. The patient recognises the box far more reliably than the name, and it means you do not have to type a drug name at all. Photograph the medicine, never the patient and never a label carrying a name.",
    ],
    '[data-testid="amount-0"]': [
      "How much",
      "Half, one, two, and so on, with the unit beside it. These are chosen rather than typed so that every prescription the app can produce is one it can also sign.",
    ],
    ".dose__times": [
      "When",
      "Morning, afternoon, evening, night, and whether it is taken before, with or after food. Choosing specific times is clearer for the patient than a count such as twice a day.",
    ],
    '[data-testid="issue-prescription"]': [
      "Issue the prescription",
      "Produces the QR code the patient takes home. Scanning it replays the whole list in sign language, on their own phone, with no account and no app to install.",
    ],
  },
};

/** How each screen is introduced, and what to do on it. */
const SECTIONS = {
  opening: {
    number: "1",
    lead: "This is what the app opens into, and what the next patient should always be handed. One question decides how the whole visit will work.",
    steps: [
      "Ask the patient, in person, whether they can read and write. The printed question on screen is not a substitute: a patient who does not read has not been asked.",
      "Tap Yes or No on their behalf, or let them tap it.",
      "The app opens the matching screen and stays there for the rest of the visit.",
    ],
  },
  consultation: {
    number: "2",
    lead: "For a patient who reads. You type, they see both the words and the sign video, and they can type back.",
    steps: [
      "Set I speak and Speak in once, at the start of the visit.",
      "Type one clear instruction or question.",
      "Tap Send to patient, then turn the device towards them.",
      "Read their reply, or listen to it read aloud.",
    ],
  },
  guided: {
    number: "3",
    lead: "For a patient who does not read print. Every question is asked in sign video and answered with a tap, so nothing depends on written language.",
    steps: [
      "Type a question that can be answered yes or no.",
      "Tap Send to patient. The question plays as sign video.",
      "When the video ends, Yes and No appear where the video was. The patient taps one.",
      "Use Ask where it hurts when you need a body location instead of yes or no.",
    ],
  },
  emergency: {
    number: "4",
    lead: "For an accident, a collapse, or any moment where there is no time to set anything up. Nothing here needs typing, reading, or a sign video that has been filmed.",
    steps: [
      "Tap Emergency from any screen. It works before the literacy question has been asked.",
      "Set Read answers in to the language you understand.",
      "Hand the device to the patient. Every tap is spoken aloud to you immediately.",
      "Tap Leave emergency mode when the immediate danger has passed.",
    ],
  },
  prescription: {
    number: "5",
    lead: "The instructions the patient takes home, as a QR code they can replay in sign language on their own phone for as long as the course lasts.",
    steps: [
      "Photograph each medicine, so the patient recognises the packet rather than a name.",
      "Choose how much, and when.",
      "Tap Issue the prescription.",
      "Show the patient the QR code so they can scan it, and print it if they want a paper copy.",
    ],
  },
};

async function main() {
  const data = JSON.parse(await readFile(resolve(DOCS, "screens.json"), "utf8"));

  // Trailing whitespace stripped before writing, because template literals
  // indent their blank lines and the repository's own hook would otherwise
  // rewrite this file every single time it is generated.
  const html = renderManual(data)
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
  await mkdir(DOCS, { recursive: true });
  await writeFile(resolve(DOCS, "manual.html"), html, "utf8");
  console.log("  wrote docs/manual/manual.html");

  await printToPdf(resolve(DOCS, "manual.html"), PDF_OUT);
  console.log("  wrote frontend/public/tie-me-ghana-manual.pdf");
}

function renderManual({ viewport, screens }) {
  if (viewport?.width && viewport?.height) SHOT = viewport;

  const missing = [];

  const sections = screens
    .map((screen) => {
      const notes = EXPLANATIONS[screen.id] ?? {};
      const section = SECTIONS[screen.id];

      const numbered = screen.callouts.map((callout, index) => {
        const explanation = notes[callout.selector];
        if (!explanation) missing.push(`${screen.id}: ${callout.selector}`);
        return { ...callout, index: index + 1, explanation };
      });

      return renderScreen(screen, section, numbered);
    })
    .join("\n");

  if (missing.length) {
    // A callout drawn on the picture with nothing explaining it is a number
    // pointing at a button and saying nothing about it.
    console.warn(`\n  callouts with no explanation:\n    ${missing.join("\n    ")}`);
  }

  return page(sections);
}

function renderScreen(screen, section, callouts) {
  const markers = callouts
    .map((callout) => {
      // Percentages of the figure, so it can be printed at any width and the
      // ring stays on its control. Each axis against its own dimension.
      const left = (callout.x / SHOT.width) * 100;
      const right = ((callout.x + callout.width) / SHOT.width) * 100;
      const top = (callout.y / SHOT.height) * 100;
      const middle = ((callout.y + callout.height / 2) / SHOT.height) * 100;
      const width = (callout.width / SHOT.width) * 100;
      const height = (callout.height / SHOT.height) * 100;

      // The badge goes on whichever side has room for it, so it never hangs
      // off the figure and the arrow always points inwards at the control.
      const outside = left < 12 || right > 88 ? "inside" : left > 55 ? "left" : "right";

      const badgeStyle =
        outside === "left"
          ? `left:${left}%; top:${middle}%;`
          : outside === "right"
            ? `left:${right}%; top:${middle}%;`
            : `left:${right}%; top:${top}%;`;

      // Both boxed and numbered, and positioned against the figure itself
      // rather than nested inside the badge: a percentage inside a zero sized
      // element resolves to zero, which is why the rings were invisible.
      return `
        <span class="ring" style="left:${left}%; top:${top}%; width:${width}%; height:${height}%;"></span>
        <span class="badge badge--${outside}" style="${badgeStyle}">${callout.index}</span>`;
    })
    .join("");

  const rows = callouts
    .filter((callout) => callout.explanation)
    .map(
      (callout) => `
      <tr>
        <td class="key__n"><span class="key__badge">${callout.index}</span></td>
        <td class="key__what"><strong>${escape(callout.explanation[0])}</strong></td>
        <td class="key__does">${escape(callout.explanation[1])}</td>
      </tr>`,
    )
    .join("");

  return `
  <section class="screen">
    <header class="screen__head">
      <p class="screen__number">Section ${section.number}</p>
      <h2 class="screen__title">${escape(screen.title)}</h2>
      <p class="screen__lead">${escape(section.lead)}</p>
    </header>

    <figure class="shot">
      <div class="shot__frame">
        <img src="${screen.image}" alt="${escape(screen.title)}" />
        ${markers}
      </div>
    </figure>

    <h3 class="screen__sub">What each control does</h3>
    <table class="key">
      <tbody>${rows}</tbody>
    </table>

    <h3 class="screen__sub">How to use it</h3>
    <ol class="steps">
      ${section.steps.map((step) => `<li>${escape(step)}</li>`).join("")}
    </ol>
  </section>`;
}

function page(sections) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tie Me Ghana User Manual</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }

  :root {
    --ink: #10221c;
    --primary: #0a4a3a;
    --deep: #00352b;
    --muted: #5d6f68;
    --line: #e6ebef;
    --mint: #e8f5ef;
    --mint-pale: #f4fbf8;
    --accent: #c2410c;
    --danger: #b93829;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ---- cover ---- */
  .cover { height: 247mm; display: flex; flex-direction: column; page-break-after: always; }
  .cover__top { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
  .cover__eyebrow {
    font-size: 8.5pt; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--primary); margin: 0 0 10mm;
  }
  .cover__title { font-size: 34pt; line-height: 1.05; margin: 0 0 5mm; letter-spacing: -0.02em; color: var(--deep); }
  .cover__sub { font-size: 13pt; color: var(--muted); margin: 0 0 14mm; max-width: 120mm; line-height: 1.4; }
  .cover__rule { height: 3px; width: 34mm; background: var(--primary); margin-bottom: 10mm; }
  .cover__meta { font-size: 9.5pt; color: var(--muted); margin: 0; }
  .cover__notice {
    border: 1px solid #f1c7bf; background: #fdeeec; border-radius: 3mm;
    padding: 6mm 7mm; margin-top: auto;
  }
  .cover__notice h2 { margin: 0 0 2mm; font-size: 11pt; color: var(--danger); }
  .cover__notice p { margin: 0 0 2mm; font-size: 9.5pt; }
  .cover__notice p:last-child { margin-bottom: 0; }

  /* ---- generic ---- */
  h2 { font-size: 16pt; color: var(--deep); margin: 0 0 3mm; letter-spacing: -0.01em; }
  h3 {
    font-size: 11pt; color: var(--deep); margin: 5mm 0 2mm;
    /* A heading alone at the foot of a page, with its content overleaf, is the
       single thing that makes a generated document look generated. */
    break-after: avoid; page-break-after: avoid;
  }
  p { margin: 0 0 3mm; }

  .lead-section { page-break-after: always; }

  .contents ol { margin: 0; padding-left: 5mm; }
  .contents li { margin-bottom: 2mm; }

  .callout-box {
    border-left: 3px solid var(--primary); background: var(--mint-pale);
    padding: 4mm 5mm; margin: 4mm 0; border-radius: 0 2mm 2mm 0;
  }
  .callout-box p:last-child { margin-bottom: 0; }

  .warn { border-left-color: var(--danger); background: #fdeeec; }

  /* ---- a documented screen ---- */
  .screen { page-break-before: always; }
  .screen__number {
    font-size: 8pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--primary); margin: 0 0 1.5mm;
  }
  .screen__title { font-size: 16pt; margin: 0 0 1.5mm; }
  .screen__lead { color: var(--muted); margin: 0 0 4mm; max-width: 155mm; }
  .screen__sub { font-size: 10.5pt; }

  /* Narrower than the text column on purpose. At full width a figure and its
     key table no longer fit one page together, and the section broke across
     two with the second mostly empty. */
  .shot { margin: 0 auto 3mm; width: 134mm; }
  .shot__frame {
    position: relative; border: 1px solid var(--line); border-radius: 2mm;
    overflow: hidden; line-height: 0;
  }
  .shot__frame img { width: 100%; display: block; }

  /* A ring around the control and a numbered badge beside it, both placed
     from the measurement the capture took off the live page. */
  .ring {
    position: absolute;
    border: 2px solid var(--accent);
    border-radius: 1.6mm;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
  }

  .badge {
    position: absolute;
    display: flex; align-items: center; justify-content: center;
    width: 5.6mm; height: 5.6mm; border-radius: 50%;
    background: var(--accent); color: #fff;
    font-size: 8pt; font-weight: 700; line-height: 1;
    box-shadow: 0 0 0 1.8px #fff;
  }

  /* The arrow is part of the badge and always points back at the ring, so the
     eye is led from the number to the control rather than having to hunt. */
  .badge::after {
    content: ""; position: absolute;
    border-top: 1.4mm solid transparent;
    border-bottom: 1.4mm solid transparent;
  }

  .badge--left { transform: translate(-100%, -50%); margin-left: -2.6mm; }
  .badge--left::after {
    left: 100%; top: 50%; margin-top: -1.4mm;
    border-left: 2.2mm solid var(--accent);
  }

  .badge--right { transform: translateY(-50%); margin-left: 2.6mm; }
  .badge--right::after {
    right: 100%; top: 50%; margin-top: -1.4mm;
    border-right: 2.2mm solid var(--accent);
  }

  /* Hard against an edge of the figure, where there is no room beside the
     control. Sat on its corner instead, with no arrow to draw. */
  .badge--inside { transform: translate(-50%, -50%); }
  .badge--inside::after { display: none; }

  .key { width: 100%; border-collapse: collapse; font-size: 9pt; line-height: 1.45; }
  .key tr { page-break-inside: avoid; }
  .key td { border-top: 1px solid var(--line); padding: 1.9mm 2mm; vertical-align: top; }
  .key__n { width: 8mm; }
  .key__badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 5mm; height: 5mm; border-radius: 50%;
    background: var(--accent); color: #fff; font-size: 7.5pt; font-weight: 700;
  }
  .key__what { width: 38mm; }
  .key__does { color: #33413c; }

  .steps { margin: 0; padding-left: 5mm; font-size: 9.5pt; }
  .steps li { margin-bottom: 1.5mm; page-break-inside: avoid; }

  table.plain { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 3mm 0; }
  table.plain th {
    text-align: left; font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); border-bottom: 1px solid var(--line); padding: 2mm;
  }
  table.plain td { border-bottom: 1px solid var(--line); padding: 2.5mm 2mm; vertical-align: top; }
  table.plain tr { page-break-inside: avoid; }

  ul.tight { margin: 0 0 3mm; padding-left: 5mm; }
  ul.tight li { margin-bottom: 1.5mm; }
</style>
</head>
<body>

<section class="cover">
  <div class="cover__top">
    <p class="cover__eyebrow">User Manual</p>
    <h1 class="cover__title">Tie Me Ghana</h1>
    <p class="cover__sub">Hospital communication for Deaf and Hard of Hearing patients, in Ghanaian Sign Language.</p>
    <div class="cover__rule"></div>
    <p class="cover__meta">${RELEASE}<br />Built for the MTN Ghana Tekyerema Pa Hackathon 2026</p>
  </div>

  <div class="cover__notice">
    <h2>Read this first</h2>
    <p><strong>This app is not an interpreter and does not replace one.</strong> Where a qualified Ghanaian Sign Language interpreter is available and the conversation matters, use the interpreter.</p>
    <p><strong>This is a pilot.</strong> It has not been approved as a medical device and is not cleared for clinical use. Do not use it alone to take consent for a procedure, to deliver a serious diagnosis, or for any exchange where a misunderstanding carries real risk.</p>
  </div>
</section>

<section class="lead-section">
  <h2>What this app does</h2>
  <p>Tie Me Ghana helps a clinician and a Deaf or Hard of Hearing patient understand one another during a hospital visit, without an interpreter in the room.</p>
  <p>You type or speak. The patient sees your words as a video of a real person signing in Ghanaian Sign Language. They answer by tapping, typing or pointing, and their answer is read aloud to you so you can keep your hands and eyes on the patient.</p>

  <h3>How the signing works, and where it stops</h3>
  <p>Every sign is a recording of a real person, approved in advance by a fluent Ghanaian Sign Language consultant. The app never invents or animates a sign, so it can only show what has been filmed and approved.</p>
  <div class="callout-box">
    <p><strong>The app refuses rather than guesses.</strong> When a word has no approved sign, it tells you instead of showing a different one. A near miss in a clinical sentence is more dangerous than a gap, because it looks like an answer.</p>
  </div>
  <p>Some sentences will be refused outright and will not be shown to the patient. When that happens, rephrase the sentence or find another way to ask.</p>

  <h3>What is in this manual</h3>
  <div class="contents">
    <ol>
      <li>The opening screen, and starting a visit</li>
      <li>Talking to a patient who reads</li>
      <li>Talking to a patient who does not read</li>
      <li>Emergency mode</li>
      <li>Writing a prescription</li>
      <li>Working with a poor connection</li>
      <li>What the app stores</li>
      <li>If something goes wrong</li>
    </ol>
  </div>

  <h3>Before the first patient</h3>
  <ul class="tight">
    <li>Open the app once on a good connection and let it finish setting up. It saves the sign videos onto the device so they play instantly afterwards, and shows its progress while it does.</li>
    <li>Tap <strong>Install app</strong> so it has its own icon and opens without a browser.</li>
    <li>Read the privacy policy and terms, linked at the bottom of the opening screen.</li>
  </ul>
</section>

${sections}

<section class="screen">
  <header class="screen__head">
    <p class="screen__number">Section 6</p>
    <h2 class="screen__title">Working with a poor connection</h2>
    <p class="screen__lead">Hospital connections drop. The app is built for that, and most of it keeps working.</p>
  </header>

  <table class="plain">
    <thead><tr><th>What you are doing</th><th>With no connection</th></tr></thead>
    <tbody>
      <tr><td>Asking a question the device has already shown</td><td>Works. The sign video is saved on the device.</td></tr>
      <tr><td>Asking something new</td><td>Needs a connection to look up the signs.</td></tr>
      <tr><td>Emergency mode: pain scale and body map</td><td>Works. Both are drawings and need nothing from the server.</td></tr>
      <tr><td>Reading an answer aloud</td><td>Needs a connection.</td></tr>
      <tr><td>Issuing a prescription</td><td>Needs a connection.</td></tr>
      <tr><td>A patient replaying a prescription at home</td><td>Works once they have opened it once on a connection.</td></tr>
    </tbody>
  </table>

  <h3>The indicator in the top bar</h3>
  <p>Green means the hospital system is reachable. Grey means it is not. The app does not stop when it turns grey: it keeps using what is already on the device and tells you which actions are unavailable rather than failing silently.</p>

  <div class="callout-box">
    <p><strong>On the day of a demonstration or a clinic session,</strong> open the app a minute beforehand. The pilot runs on free hosting that puts the server to sleep after about fifteen minutes of no use, and waking it takes up to a minute.</p>
  </div>
</section>

<section class="screen">
  <header class="screen__head">
    <p class="screen__number">Section 7</p>
    <h2 class="screen__title">What the app stores</h2>
    <p class="screen__lead">The short version. The full privacy policy is linked at the bottom of the opening screen.</p>
  </header>

  <table class="plain">
    <thead><tr><th>Information</th><th>Where it goes</th></tr></thead>
    <tbody>
      <tr><td>The patient's name, age, number or diagnosis</td><td>Never collected. There is nowhere in the app to enter them.</td></tr>
      <tr><td>The record of the visit</td><td>The device only. It is never sent anywhere, and it is erased when you tap New patient.</td></tr>
      <tr><td>Prescriptions</td><td>Stored on the server as medicine names, photographs and dosages, with nothing saying whose they are.</td></tr>
      <tr><td>Photographs of medicines</td><td>Stored with the hidden camera information removed, including the location the photograph was taken.</td></tr>
    </tbody>
  </table>

  <div class="callout-box warn">
    <p><strong>Two habits that matter.</strong></p>
    <p>Tap <strong>New patient</strong> before handing the device on. That is what erases the previous consultation, and these consultations cover pregnancy, sexually transmitted infections and HIV status.</p>
    <p>Photograph the medicine, never the patient, and never a label carrying somebody's name.</p>
  </div>

  <h3>Translation leaves our servers</h3>
  <p>Sentences are sent to GhanaNLP's Khaya service to be turned into Twi and read aloud, and a dictated message is sent as audio to be turned into text. Nothing identifying goes with them, because the app holds nothing to send. The record of the visit is not among them: it is assembled on the device and stays there.</p>
  <p>It is worth telling a patient that a translation service is involved, in the same way you would mention an interpreter.</p>

  <h3>The prescription QR code</h3>
  <p>Anybody who scans the code or holds the link can see that list of medicines. It carries no name, so it says what somebody is taking without saying who, but treat a printed code the way you would treat any prescription slip.</p>
</section>

<section class="screen">
  <header class="screen__head">
    <p class="screen__number">Section 8</p>
    <h2 class="screen__title">If something goes wrong</h2>
    <p class="screen__lead">The problems most likely to come up, and what to do about each.</p>
  </header>

  <table class="plain">
    <thead><tr><th>What you see</th><th>What it means, and what to do</th></tr></thead>
    <tbody>
      <tr>
        <td>The app says a word has no sign</td>
        <td>That sign has not been filmed and approved yet. Rephrase using simpler words, or write the word down if the patient reads.</td>
      </tr>
      <tr>
        <td>A question is refused and will not send</td>
        <td>The sentence contains something that cannot be signed safely. The app will not show a half correct clinical sentence. Rephrase it.</td>
      </tr>
      <tr>
        <td>The video area says it is getting ready</td>
        <td>The sign video is still downloading. It plays as soon as it arrives. If this happens often, open the app on a better connection once and let it finish setting up.</td>
      </tr>
      <tr>
        <td>The connection indicator is grey</td>
        <td>The hospital system is unreachable. Saved sign videos, the pain scale and the body map still work. New questions and prescriptions do not.</td>
      </tr>
      <tr>
        <td>The microphone will not start</td>
        <td>Either the browser refused permission, or Both is selected as your language. Speech recognition handles one language at a time, so choose English or Twi, or type the message.</td>
      </tr>
      <tr>
        <td>The first request after a quiet period is slow</td>
        <td>The pilot server sleeps when unused and takes up to a minute to wake. Open the app a minute before a clinic session.</td>
      </tr>
      <tr>
        <td>The Twi caption reads oddly</td>
        <td>Translation is done by machine, by GhanaNLP's Khaya service. It has no knowledge of the patient or of what was said a moment earlier, so a clinical sentence can come back subtly wrong. Read it before you send it if you read Twi, and rephrase in simpler words if it looks off.</td>
      </tr>
      <tr>
        <td>Nothing is captioned and answers are not read aloud</td>
        <td>The translation service is unreachable. The app says so and asks you to type instead. Sign videos already on the device still play.</td>
      </tr>
    </tbody>
  </table>

  <h3>Getting help</h3>
  <p>Write to bestdrtrick@gmail.com. Include what you were doing, what you expected, and what happened instead. If it concerns a prescription, include its reference, which is the code under the QR image.</p>
</section>

</body>
</html>
`;
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function printToPdf(htmlPath, pdfPath) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=/tmp/tmg-manual-pdf-${process.pid}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const socketUrl = await waitForChrome(PORT);
    const browser = await connect(socketUrl);
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = browser.session(sessionId);

    await page.send("Page.enable");
    await page.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await page.until("Page.loadEventFired");
    // The screenshots are large PNGs read off disk; give them a moment to
    // decode before the page is printed, or the figures come out blank.
    await new Promise((done) => setTimeout(done, 1500));

    const { data } = await page.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%; font-size:7pt; color:#5d6f68;
                    font-family:'Segoe UI',system-ui,sans-serif;
                    padding:0 14mm; display:flex; justify-content:space-between;">
          <span>Tie Me Ghana User Manual</span>
          <span class="pageNumber"></span>
        </div>`,
    });

    await mkdir(dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, Buffer.from(data, "base64"));
    browser.close();
  } finally {
    chrome.kill();
  }
}

async function waitForChrome(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const { webSocketDebuggerUrl } = await response.json();
      if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Chrome never opened its debugging port.");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const waiters = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: done, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else done(message.result);
      return;
    }
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].method === message.method) {
        waiters.splice(index, 1)[0].resolve(message.params);
      }
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((done, fail) => {
      const id = nextId++;
      pending.set(id, { resolve: done, reject: fail });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const until = (method) =>
    new Promise((done) => waiters.push({ method, resolve: done }));

  return {
    send,
    until,
    close: () => socket.close(),
    session: (sessionId) => ({
      send: (method, params) => send(method, params, sessionId),
      until,
    }),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
