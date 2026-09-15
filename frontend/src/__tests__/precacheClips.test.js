import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEDIA_CACHE, precacheClips } from "../signs/precacheClips.js";

vi.mock("../api/clips.js", () => ({ fetchResolvableClips: vi.fn() }));

const { fetchResolvableClips } = await import("../api/clips.js");

const CLIP = (gloss, url) => ({ id: gloss, gloss, video_url: url });

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
