import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crossOriginFor,
  forgetMediaCors,
  mediaCorsVersion,
  originOf,
  recordMediaCors,
  subscribeMediaCors,
} from "../signs/mediaCors.js";

const BUCKET = "https://cdn.example/clips/hurt.mp4";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => forgetMediaCors());
afterEach(() => {
  forgetMediaCors();
  vi.restoreAllMocks();
});

describe("asking for a clip with CORS", () => {
  it("is not done for a server nothing is known about, which plays as it always did", () => {
    expect(crossOriginFor(BUCKET)).toBeUndefined();
  });

  it("is done for a server the warm up found to allow it", () => {
    recordMediaCors(BUCKET, true);

    expect(crossOriginFor(BUCKET)).toBe("anonymous");
  });

  it("is not done for one it found not to, which would refuse the video outright", () => {
    recordMediaCors(BUCKET, false);

    expect(crossOriginFor(BUCKET)).toBeUndefined();
  });

  it("covers every clip on that server, not only the one that was fetched", () => {
    recordMediaCors(BUCKET, true);

    expect(crossOriginFor("https://cdn.example/stitched/abc.mp4")).toBe("anonymous");
  });

  it("does not spill onto another server", () => {
    recordMediaCors(BUCKET, true);

    expect(crossOriginFor("https://other.example/clips/hurt.mp4")).toBeUndefined();
  });

  it("is never needed for a clip on the app's own server", () => {
    recordMediaCors(`${window.location.origin}/media/clips/hurt.mp4`, true);

    expect(crossOriginFor("/media/clips/hurt.mp4")).toBeUndefined();
    expect(crossOriginFor(`${window.location.origin}/media/clips/hurt.mp4`)).toBeUndefined();
  });

  it("ignores a url it cannot read", () => {
    expect(() => recordMediaCors("http://", true)).not.toThrow();
    expect(crossOriginFor(null)).toBeUndefined();
    expect(crossOriginFor(undefined)).toBeUndefined();
  });
});

describe("what is known lapsing", () => {
  it("lets a yes last as long as the cache it goes with", () => {
    recordMediaCors(BUCKET, true, 1000);

    expect(crossOriginFor(BUCKET, 1000 + 29 * DAY)).toBe("anonymous");
    expect(crossOriginFor(BUCKET, 1000 + 31 * DAY)).toBeUndefined();
  });

  it("lets a no lapse quickly, so a server that turns CORS on is noticed", () => {
    recordMediaCors(BUCKET, false, 1000);
    expect(crossOriginFor(BUCKET, 1000 + 30 * 60 * 1000)).toBeUndefined();

    // A no is never acted on anyway; what matters is that a later yes wins.
    recordMediaCors(BUCKET, true, 1000 + 2 * HOUR);
    expect(crossOriginFor(BUCKET, 1000 + 2 * HOUR)).toBe("anonymous");
  });

  it("goes back to not asking when a server that allowed it stops, and says so at once", () => {
    recordMediaCors(BUCKET, true, 1000);

    recordMediaCors(BUCKET, false, 5000);

    expect(crossOriginFor(BUCKET, 6000)).toBeUndefined();
  });
});

describe("remembering between visits", () => {
  it("keeps it on the device", () => {
    recordMediaCors(BUCKET, true);

    expect(JSON.parse(localStorage.getItem("tiemeghana.media-cors"))["https://cdn.example"]).toMatchObject({
      allowed: true,
    });
  });

  it("carries on when storage is unavailable, for this visit", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => recordMediaCors(BUCKET, true)).not.toThrow();
    expect(crossOriginFor(BUCKET)).toBe("anonymous");
  });

  it("treats unreadable storage as knowing nothing", () => {
    localStorage.setItem("tiemeghana.media-cors", "{not json");
    forgetMediaCors();
    localStorage.setItem("tiemeghana.media-cors", "{not json");
    vi.resetModules();

    expect(crossOriginFor("https://never-seen.example/clips/a.mp4")).toBeUndefined();
  });
});

describe("telling the player", () => {
  it("notifies a subscriber when something is recorded, so it asks the right way", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMediaCors(listener);

    recordMediaCors(BUCKET, true);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("changes its version, for a store that compares", () => {
    const before = mediaCorsVersion();

    recordMediaCors(BUCKET, true);

    expect(mediaCorsVersion()).not.toBe(before);
  });

  it("does not make a fuss about being told the same thing again", () => {
    recordMediaCors(BUCKET, true, 1000);
    const listener = vi.fn();
    subscribeMediaCors(listener);

    recordMediaCors(BUCKET, true, 2000);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    subscribeMediaCors(listener)();

    recordMediaCors(BUCKET, true);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("originOf", () => {
  it("reads the origin of a full url", () => {
    expect(originOf(BUCKET)).toBe("https://cdn.example");
  });

  it("reads a path as the app's own origin", () => {
    expect(originOf("/media/clips/a.mp4")).toBe(window.location.origin);
  });

  it("gives up on nonsense", () => {
    expect(originOf("http://")).toBeNull();
  });
});
