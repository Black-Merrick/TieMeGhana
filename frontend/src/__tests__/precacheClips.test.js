import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEDIA_CACHE, precacheClips } from "../signs/precacheClips.js";

vi.mock("../api/clips.js", () => ({ fetchResolvableClips: vi.fn() }));

const { fetchResolvableClips } = await import("../api/clips.js");

const CLIP = (gloss, url, kind = "word") => ({ id: gloss, gloss, kind, video_url: url });

/** A cache double that records what was put in it. */
function fakeCache(existing = []) {
  const stored = new Map();
  return {
    stored,
    match: vi.fn(async (url) => (existing.includes(url) ? {} : undefined)),
    put: vi.fn(async (url, response) => stored.set(url, response)),
  };
}

function installCaches(cache) {
  globalThis.caches = { open: vi.fn(async () => cache) };
  return cache;
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete globalThis.caches;
  delete globalThis.navigator.storage;
  fetchResolvableClips.mockReset();
});

describe("the media cache name", () => {
  it("matches the service worker rule that reads it", () => {
    // The warmer fills a cache by name and the service worker serves from it
    // by name. If they drift, every clip is warmed into a cache nothing reads
    // and then fetched from the network anyway, with nothing failing. This
    // project has already had one media rule stop matching in silence.
    // Read from the vitest root, which is the frontend directory. A file URL
    // relative to this module is not usable under jsdom.
    const config = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");

    expect(config).toContain(`cacheName: "${MEDIA_CACHE}"`);
  });
});

describe("warming the clip cache", () => {
  it("downloads every resolvable clip into the cache", async () => {
    const cache = installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("ASK", "https://cdn.example/clips/ask.mp4"),
      CLIP("ABOUT", "https://cdn.example/clips/about.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    const summary = await precacheClips();

    expect(summary).toMatchObject({ warmed: 2, failed: 0, supported: true });
    expect([...cache.stored.keys()]).toEqual(
      expect.arrayContaining([
        "https://cdn.example/clips/ask.mp4",
        "https://cdn.example/clips/about.mp4",
      ]),
    );
  });

  it("does not refetch a clip that is already cached", async () => {
    const cached = "https://cdn.example/clips/ask.mp4";
    installCaches(fakeCache([cached]));
    fetchResolvableClips.mockResolvedValue([CLIP("ASK", cached)]);
    globalThis.fetch = vi.fn();

    const summary = await precacheClips();

    expect(summary).toMatchObject({ alreadyCached: 1, warmed: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetches the same url only once when two glosses share a clip", async () => {
    // Several glosses currently point at one placeholder file. Warming it once
    // per gloss would download the same bytes repeatedly on the connection
    // this is supposed to spare.
    const shared = "https://cdn.example/clips/placeholder.mp4";
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("ABOUT", shared),
      CLIP("FEELING", shared),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    const summary = await precacheClips();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(summary.warmed).toBe(1);
  });

  it("falls back to an opaque fetch when the bucket sends no CORS headers", async () => {
    const url = "https://cdn.example/clips/ask.mp4";
    const cache = installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([CLIP("ASK", url)]);
    globalThis.fetch = vi.fn(async (_url, options) => {
      if (options?.mode !== "no-cors") throw new TypeError("Failed to fetch");
      return { ok: false, status: 0, type: "opaque" };
    });

    const summary = await precacheClips();

    // Counted apart from a clean warm up, because an opaque response hides its
    // status: a 404 and a video look identical from here.
    expect(summary).toMatchObject({ unverified: 1, warmed: 0, failed: 0 });
    expect(cache.stored.has(url)).toBe(true);
  });

  it("does not cache a clip the server reports as missing", async () => {
    const cache = installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("ASK", "https://cdn.example/clips/gone.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const summary = await precacheClips();

    expect(summary).toMatchObject({ failed: 1, warmed: 0 });
    expect(cache.stored.size).toBe(0);
  });

  it("stops when the storage quota is nearly full", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("ASK", "https://cdn.example/clips/ask.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    globalThis.navigator.storage = {
      estimate: async () => ({ usage: 95, quota: 100 }),
    };

    const summary = await precacheClips();

    expect(summary.warmed).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("survives being offline at startup", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockRejectedValue(new Error("offline"));

    await expect(precacheClips()).resolves.toMatchObject({ warmed: 0 });
  });

  it("survives the clip list arriving as something other than a list", async () => {
    // The failure that once blanked the triage screen: a catch handles the
    // server failing, not the server answering with the wrong shape.
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue({ detail: "Not found" });

    await expect(precacheClips()).resolves.toMatchObject({ warmed: 0 });
  });

  it("reports itself unsupported where there is no cache storage", async () => {
    fetchResolvableClips.mockResolvedValue([]);

    await expect(precacheClips()).resolves.toMatchObject({ supported: false });
  });
});

describe("warming the highest value clips first", () => {
  // Not a filter, an order. Everything still gets warmed; a patient who taps
  // something in the first few seconds should find the most likely clip
  // already there. See KIND_PRIORITY's own reasoning for why these four
  // kinds go first.
  it("fetches a system prompt before an ordinary word sign", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("HEAD", "https://cdn.example/clips/head.mp4", "word"),
      CLIP("LITERACY_CHECK", "https://cdn.example/clips/literacy.mp4", "prompt"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await precacheClips();

    const order = globalThis.fetch.mock.calls.map(([url]) => url);
    expect(order.indexOf("https://cdn.example/clips/literacy.mp4")).toBeLessThan(
      order.indexOf("https://cdn.example/clips/head.mp4"),
    );
  });

  it("fetches an emergency alert before an ordinary word sign", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("HEAD", "https://cdn.example/clips/head.mp4", "word"),
      CLIP("CANNOT_BREATHE", "https://cdn.example/clips/breathe.mp4", "alert"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await precacheClips();

    const order = globalThis.fetch.mock.calls.map(([url]) => url);
    expect(order.indexOf("https://cdn.example/clips/breathe.mp4")).toBeLessThan(
      order.indexOf("https://cdn.example/clips/head.mp4"),
    );
  });

  it("fetches the fingerspelling alphabet before an ordinary word sign", async () => {
    // FR 1.6, reused across almost every free text message, so the letters
    // are worth having on the device before any specific word is.
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("HEAD", "https://cdn.example/clips/head.mp4", "word"),
      CLIP("A", "https://cdn.example/clips/a.mp4", "letter"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await precacheClips();

    const order = globalThis.fetch.mock.calls.map(([url]) => url);
    expect(order.indexOf("https://cdn.example/clips/a.mp4")).toBeLessThan(
      order.indexOf("https://cdn.example/clips/head.mp4"),
    );
  });

  it("does not let an unrecognised kind jump the queue", async () => {
    // A clip kind added later degrades to "warmed in API order" rather than
    // silently winning every race by defaulting to the front.
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("MYSTERY", "https://cdn.example/clips/mystery.mp4", "not-a-real-kind"),
      CLIP("HELLO", "https://cdn.example/clips/hello.mp4", "prompt"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await precacheClips();

    const order = globalThis.fetch.mock.calls.map(([url]) => url);
    expect(order.indexOf("https://cdn.example/clips/hello.mp4")).toBeLessThan(
      order.indexOf("https://cdn.example/clips/mystery.mp4"),
    );
  });
});

describe("reporting progress to the interface", () => {
  it("reports a total that is the real amount of work", async () => {
    // Counted before any downloading starts. A total that keeps being revised
    // downwards as cached entries turn up would show a bar going backwards.
    const cached = "https://cdn.example/clips/have.mp4";
    installCaches(fakeCache([cached]));
    fetchResolvableClips.mockResolvedValue([
      CLIP("HAVE", cached),
      CLIP("NEED", "https://cdn.example/clips/need.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    const seen = [];
    await precacheClips({ onProgress: (update) => seen.push(update) });

    expect(seen[0]).toEqual({ total: 1, completed: 0, done: false });
    expect(seen.at(-1)).toEqual({ total: 1, completed: 1, done: true });
  });

  it("counts up as each clip lands", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("A", "https://cdn.example/clips/a.mp4"),
      CLIP("B", "https://cdn.example/clips/b.mp4"),
      CLIP("C", "https://cdn.example/clips/c.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    const seen = [];
    await precacheClips({ onProgress: (update) => seen.push(update) });

    const counts = seen.map((update) => update.completed);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(seen.at(-1)).toMatchObject({ total: 3, completed: 3, done: true });
  });

  it("reports nothing to do when every clip is already cached", async () => {
    // What every visit after the first looks like. The indicator reads this
    // and renders nothing, rather than announcing "ready" on every open.
    const urls = [
      "https://cdn.example/clips/a.mp4",
      "https://cdn.example/clips/b.mp4",
    ];
    installCaches(fakeCache(urls));
    fetchResolvableClips.mockResolvedValue([CLIP("A", urls[0]), CLIP("B", urls[1])]);
    globalThis.fetch = vi.fn();

    const seen = [];
    const summary = await precacheClips({ onProgress: (update) => seen.push(update) });

    expect(seen).toEqual([{ total: 0, completed: 0, done: true }]);
    expect(summary.alreadyCached).toBe(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still finishes the report when a clip fails", async () => {
    // A stalled bar with no end is worse feedback than none: it says the app
    // is stuck when it has in fact finished and moved on.
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("GONE", "https://cdn.example/clips/gone.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const seen = [];
    await precacheClips({ onProgress: (update) => seen.push(update) });

    expect(seen.at(-1)).toMatchObject({ done: true, completed: 1, total: 1 });
  });

  it("works with no progress callback at all", async () => {
    installCaches(fakeCache());
    fetchResolvableClips.mockResolvedValue([
      CLIP("A", "https://cdn.example/clips/a.mp4"),
    ]);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));

    await expect(precacheClips()).resolves.toMatchObject({ warmed: 1 });
  });
});
