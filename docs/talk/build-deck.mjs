/**
 * Print the architecture talk to a PDF.
 *
 * The same approach as tools/build-manual.mjs: the Chrome already on the
 * machine, driven over the DevTools Protocol with Node's own fetch and
 * WebSocket. No PDF library is added to a project that does not otherwise need
 * one, and the slides stay editable as HTML rather than as a binary nobody can
 * diff.
 *
 *   node docs/talk/build-deck.mjs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK = resolve(HERE, "deck.html");
const OUT = resolve(HERE, "tie-me-ghana-architecture.pdf");
const PORT = 9345;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function chromeEndpoint(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const { webSocketDebuggerUrl } = await response.json();
      if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error("Chrome did not start a debugging port");
}

/** The smallest DevTools client that can open a page and print it. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;

  const ready = new Promise((done) => {
    socket.onopen = done;
  });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  };

  return {
    ready,
    send(method, params = {}, sessionId) {
      const next = (id += 1);
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
      return new Promise((resolve_, reject) =>
        pending.set(next, { resolve: resolve_, reject }),
      );
    },
    close: () => socket.close(),
  };
}

async function main() {
  const profile = await mkdtemp(join(tmpdir(), "tmg-deck-"));
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-sandbox",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const browser = connect(await chromeEndpoint(PORT));
    await browser.ready;

    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });

    await browser.send("Page.enable", {}, sessionId);
    await browser.send(
      "Page.navigate",
      { url: pathToFileURL(DECK).href },
      sessionId,
    );
    // Fonts and the stylesheet have to be in before the page is measured, or
    // the first slide prints with fallback metrics and the text reflows.
    await sleep(1800);

    const { data } = await browser.send(
      "Page.printToPDF",
      { printBackground: true, preferCSSPageSize: true },
      sessionId,
    );

    await writeFile(OUT, Buffer.from(data, "base64"));
    browser.close();
    console.log(`wrote ${OUT}`);
  } finally {
    // Waited for, not just signalled: Chrome is still writing its profile as it
    // goes, and removing the directory under it fails with ENOTEMPTY.
    const exited = once(chrome, "exit");
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
