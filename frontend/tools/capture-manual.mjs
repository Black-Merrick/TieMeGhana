/**
 * Capture the screenshots and callout positions the user manual is built from.
 *
 * Drives a real Chrome over the DevTools Protocol, using the browser already
 * installed on the machine and Node's own fetch and WebSocket. No dependency is
 * added for this: a manual is documentation, and documentation tooling has no
 * business appearing in the bundle a hospital downloads.
 *
 * The important part is not the screenshots. It is that the numbered callouts
 * are positioned from the live page rather than measured by hand. Each one
 * names a CSS selector, and this asks the running app where that element
 * actually is. A hand placed arrow is correct on the day it is drawn and
 * quietly wrong after the next layout change, which is how manuals come to
 * point at the wrong button. These are regenerated with one command.
 *
 * Usage, with the dev server already running:
 *
 *   node tools/capture-manual.mjs --base http://localhost:5183
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "..", "docs", "manual", "shots");

const args = process.argv.slice(2);
const BASE = (valueOf("--base") ?? "http://localhost:5183").replace(/\/+$/, "");
const CHROME = valueOf("--chrome") ?? "google-chrome";
const PORT = Number(valueOf("--port") ?? 9333);

/**
 * The window the manual is shot in. A laptop, which is what a clinic has.
 *
 * 1.5 rather than 2. A figure prints about 155mm wide, so 1.5 puts roughly 310
 * dots to the inch on the page, which is as much as print resolves. Capturing
 * at 2 was 419, invisible on paper and a third of the PDF that every device
 * downloads.
 */
const VIEWPORT = { width: 1280, height: 860, scale: 1.5 };

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * The visit record the app keeps on the device, seeded to reach a screen.
 *
 * Written straight into localStorage rather than clicked through, so a shot of
 * the consultation does not depend on the literacy screen behaving first. The
 * shape is visit/visit.js.
 */
const visit = (literacyPath, outputLanguage = "en") =>
  JSON.stringify({ literacyPath, outputLanguage, startedAt: Date.now() });

/**
 * Every screen the manual documents.
 *
 * `callouts` are [selector, note] pairs. The note is what the manual prints
 * beside that number. Order is the order a reader meets them, not the order
 * they appear in the DOM.
 */
const SCREENS = [
  {
    id: "opening",
    title: "The opening screen",
    path: "/",
    storage: {},
    callouts: [
      ['[data-testid="enter-emergency"]', "Emergency"],
      ['[data-testid="install-app"]', "Install app"],
      ['[data-testid="connection-status"]', "Connection"],
      ['[data-testid="choice-yes"]', "Yes"],
      ['[data-testid="choice-no"]', "No"],
      ['[data-testid="open-privacy"]', "Privacy and terms"],
    ],
  },
  {
    id: "consultation",
    title: "Talking to a patient who reads",
    path: "/",
    storage: { "tiemeghana.visit": visit("literate") },
    callouts: [
      ['[data-testid="doctor-language"]', "I speak"],
      ['[data-testid="output-language"]', "Speak in"],
      ["#doctor-message", "The message box"],
      [".consultation__send", "Send to patient"],
      ['[data-testid="microphone-button"]', "Speak to patient"],
      ['[data-testid="new-patient"]', "New patient"],
    ],
  },
  {
    id: "guided",
    title: "Talking to a patient who does not read",
    path: "/",
    storage: { "tiemeghana.visit": visit("guided") },
    callouts: [
      ["#doctor-message", "The question"],
      [".consultation__send", "Send to patient"],
      ['[data-testid="ask-where-it-hurts"]', "Ask where it hurts"],
    ],
  },
  {
    id: "emergency",
    title: "Emergency mode",
    path: "/",
    storage: {},
    click: '[data-testid="enter-emergency"]',
    callouts: [
      ['[data-testid="triage-voice"]', "Read answers in"],
      ['.alerts', "Cannot breathe, Pregnant"],
      ['[data-testid="pain-scale"]', "How much pain"],
      ['[data-testid="body-map"]', "Point to where it hurts"],
      ['[data-testid="leave-emergency"]', "Leave emergency mode"],
    ],
  },
  {
    id: "prescription",
    title: "Writing a prescription",
    path: "/",
    storage: { "tiemeghana.visit": visit("literate") },
    click: '[data-testid="enter-prescription"]',
    callouts: [
      ['.photo__pick', "Photograph of the medicine"],
      ['[data-testid="amount-0"]', "How much"],
      ['.dose__times', "When"],
      ['[data-testid="issue-prescription"]', "Issue the prescription"],
    ],
  },
];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=/tmp/tmg-manual-chrome-${process.pid}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const target = await waitForChrome(PORT);
    const captured = [];

    for (const screen of SCREENS) {
      process.stdout.write(`  ${screen.id} ... `);
      const shot = await capture(target, screen);
      captured.push(shot);
      console.log(`${shot.callouts.length} callouts`);
    }

    await writeFile(
      resolve(OUT, "..", "screens.json"),
      `${JSON.stringify({ viewport: VIEWPORT, screens: captured }, null, 2)}\n`,
      "utf8",
    );
    console.log(`\n  wrote ${captured.length} screenshots to docs/manual/shots`);
  } finally {
    chrome.kill();
  }
}

/**
 * Reduce a screenshot's palette, which roughly halves the file.
 *
 * A screen of flat interface colours needs nowhere near sixteen million of
 * them, and the difference is invisible: compared side by side at full size,
 * the antialiasing on body text is indistinguishable. The saving is real,
 * because these end up embedded in a PDF that the app ships to every device.
 *
 * Skipped with a note where ImageMagick is absent. A manual that builds a
 * little larger is better than a build that refuses on a machine missing a
 * tool it only needs for documentation.
 */
async function shrink(file) {
  if (shrink.unavailable) return;

  try {
    await new Promise((done, fail) => {
      execFile(
        "convert",
        [file, "-colors", "200", "-strip", "-define", "png:compression-level=9", file],
        (error) => (error ? fail(error) : done()),
      );
    });
  } catch {
    shrink.unavailable = true;
    console.warn(
      "\n    ImageMagick not found, so screenshots are left unoptimised.",
    );
  }
}

/** Chrome takes a moment to open its debugging port. */
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

async function capture(browserSocketUrl, screen) {
  const browser = await connect(browserSocketUrl);

  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = browser.session(sessionId);

  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.scale,
      mobile: false,
    });

    // Seeded on the origin before the app loads, so the first render is
    // already the screen being documented rather than a flash of the literacy
    // question.
    await goto(page, `${BASE}/`);
    await page.send("Runtime.evaluate", {
      expression: `
        localStorage.clear();
        ${Object.entries(screen.storage)
          .map(
            ([key, value]) =>
              `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
          )
          .join("\n")}
      `,
      awaitPromise: true,
    });

    await goto(page, `${BASE}${screen.path}`);
    await settle(page);
    await waitForSetupToFinish(page);

    if (screen.click) {
      await page.send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(screen.click)})?.click()`,
      });
      await settle(page, 1200);
    }

    // Asked of the live page, so a callout cannot drift away from the control
    // it names.
    const boxes = await measure(page, screen.callouts);

    const { data } = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const file = resolve(OUT, `${screen.id}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    await shrink(file);

    const missing = screen.callouts
      .filter(([selector]) => !boxes.some((box) => box.selector === selector))
      .map(([selector]) => selector);

    if (missing.length) {
      // Reported rather than skipped. A manual quietly missing the callout for
      // the button it is explaining is worse than a build that stops.
      console.warn(`\n    not found on ${screen.id}: ${missing.join(", ")}`);
    }

    return {
      id: screen.id,
      title: screen.title,
      image: `shots/${screen.id}.png`,
      callouts: boxes,
    };
  } finally {
    await browser.send("Target.closeTarget", { targetId });
    browser.close();
  }
}

async function measure(page, callouts) {
  const expression = `
    (${JSON.stringify(callouts)}).map(([selector, note]) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { selector, note, x: r.x, y: r.y, width: r.width, height: r.height };
    }).filter(Boolean)
  `;

  const { result } = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });

  return result.value ?? [];
}

async function goto(page, url) {
  await page.send("Page.navigate", { url });
  await page.until("Page.loadEventFired");
}

/**
 * Wait until the first run indicator has finished and taken itself away.
 *
 * Otherwise it appears in the corner of every figure. It is a real part of the
 * app and is documented in its own right, but repeated across five screenshots
 * it is clutter that has nothing to do with the control being explained.
 *
 * The clips are cached in the browser profile, which these captures share, so
 * only the first screen actually waits. The rest find everything present and
 * show nothing.
 */
async function waitForSetupToFinish(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { result } = await page.send("Runtime.evaluate", {
      expression: `!document.querySelector('[data-testid="setup-progress"]')`,
      returnByValue: true,
    });
    if (result.value) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  console.warn("\n    the setup indicator never cleared; it will be in shot");
}

/** Let the app finish fetching, rendering and animating in. */
async function settle(page, extra = 900) {
  await new Promise((done) => setTimeout(done, extra));
}

/** The smallest CDP client that does this job. */
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
