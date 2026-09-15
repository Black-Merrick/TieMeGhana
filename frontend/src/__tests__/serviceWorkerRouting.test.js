/**
 * Which addresses the service worker may answer with the app's own index.html.
 *
 * Workbox registers a navigation fallback so a deep link into the app works
 * offline and on a hard refresh. That fallback matches *every* navigation,
 * including addresses that were never app routes, and the failure is silent
 * and total: the address bar shows the file you asked for and the browser
 * renders the patient app instead.
 *
 * It is invisible from a terminal, because curl has no service worker, and
 * invisible in development, where these paths are proxied to Django before a
 * worker sees them. It reached production, where the user manual opened as a
 * blank screen on a phone, and the Django admin would have done the same.
 *
 * So the rules are asserted here as behaviour rather than as a string in a
 * config file: the patterns are read out of vite.config.js and run against the
 * addresses that matter.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** The denylist as the build actually compiles it. */
function denylist() {
  const config = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

  const start = config.indexOf("navigateFallbackDenylist: [");
  expect(start, "vite.config.js has no navigateFallbackDenylist").toBeGreaterThan(-1);

  const body = config.slice(
    config.indexOf("[", start) + 1,
    config.indexOf("],", start),
  );

  // Regex literals only. Anything else here would be a rule this test cannot
  // reason about, and silently ignoring it would defeat the point.
  const patterns = [...body.matchAll(/\/((?:[^/\\\n]|\\.)+)\/([a-z]*)/g)].map(
    ([, source, flags]) => new RegExp(source, flags),
  );

  expect(patterns.length).toBeGreaterThan(0);
  return patterns;
}

const isDenied = (patterns, path) => patterns.some((pattern) => pattern.test(path));

describe("addresses the app must never answer for", () => {
  const patterns = denylist();

  it("the user manual, which is a real file and not a route", () => {
    // The bug that reached a phone. The link opens in a new tab, which is a
    // navigation, which the fallback swallowed.
    expect(isDenied(patterns, "/tie-me-ghana-manual.pdf")).toBe(true);
  });

  it("the Django admin, where a consultant approves clips", () => {
    // The same fault, and worse: answering the admin with the patient screen
    // is the precise confusion the development proxy exists to prevent, and
    // the service worker reintroduced it in production only.
    expect(isDenied(patterns, "/admin/")).toBe(true);
    expect(isDenied(patterns, "/admin/clips/signclip/")).toBe(true);
  });

  it("the API", () => {
    expect(isDenied(patterns, "/api/health/")).toBe(true);
    expect(isDenied(patterns, "/api/clips/")).toBe(true);
  });

  it("the admin's own stylesheets, and media", () => {
    expect(isDenied(patterns, "/static/admin/css/base.css")).toBe(true);
    expect(isDenied(patterns, "/media/clips/ask.mp4")).toBe(true);
  });

  it("any other file the build publishes", () => {
    expect(isDenied(patterns, "/icon-192.png")).toBe(true);
    expect(isDenied(patterns, "/manifest.webmanifest")).toBe(true);
  });
});

describe("addresses the app must still answer for", () => {
  const patterns = denylist();

  /**
   * The other half, and the one a careless denylist breaks. Each of these has
   * to fall back to index.html, or reloading it offline shows nothing.
   */

  it("the app itself", () => {
    expect(isDenied(patterns, "/")).toBe(false);
  });

  it("a scanned prescription, FR 6.3", () => {
    // The patient's own phone, possibly with no connection, which is the whole
    // reason the fallback exists. References are url safe base64, so they
    // carry letters, digits, hyphens and underscores but never a dot.
    expect(isDenied(patterns, "/p/abc123XYZ_-def")).toBe(false);
    expect(isDenied(patterns, "/p/Zm9vYmFyYmF6cXV4")).toBe(false);
  });

  it("the privacy policy and the terms", () => {
    expect(isDenied(patterns, "/privacy")).toBe(false);
    expect(isDenied(patterns, "/terms")).toBe(false);
    expect(isDenied(patterns, "/privacy/")).toBe(false);
  });
});
