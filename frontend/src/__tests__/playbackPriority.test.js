import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CLAIM_MS,
  claimPlayback,
  isWatching,
  resetPlaybackPriority,
  whenNobodyIsWatching,
} from "../signs/playbackPriority.js";

/**
 * The warm up stands aside for the clip somebody is watching for.
 *
 * Measured against the real bucket: it serves about 150 KB a second however
 * many files are asked for at once, so three warm up downloads take the whole
 * connection. A clip already stored played in 11 ms; the same clip fetched
 * while the warm up ran did not arrive within twenty seconds.
 */

beforeEach(() => resetPlaybackPriority());
afterEach(() => {
  resetPlaybackPriority();
  vi.useRealTimers();
});

describe("claiming the connection", () => {
  it("is free when nobody is watching", async () => {
    expect(isWatching()).toBe(false);
    await expect(whenNobodyIsWatching()).resolves.toBeUndefined();
  });

  it("is spoken for while a clip is loading", () => {
    claimPlayback();

    expect(isWatching()).toBe(true);
  });

  it("makes the warm up wait, and lets it go once the clip is ready", async () => {
    const release = claimPlayback();
    let resumed = false;
    whenNobodyIsWatching().then(() => (resumed = true));

    await Promise.resolve();
    expect(resumed).toBe(false);

    release();
    await Promise.resolve();
    expect(resumed).toBe(true);
  });

  it("waits for the last of several clips, not the first", async () => {
    const first = claimPlayback();
    const second = claimPlayback();
    let resumed = false;
    whenNobodyIsWatching().then(() => (resumed = true));

    first();
    await Promise.resolve();
    expect(resumed).toBe(false);

    second();
    await Promise.resolve();
    expect(resumed).toBe(true);
  });

  it("counts one release once, however many times it is called", async () => {
    // A player releases on both "ready" and unmount. Counting that twice would
    // leave the warm up paused for the rest of the session.
    const release = claimPlayback();
    const other = claimPlayback();

    release();
    release();
    release();

    expect(isWatching()).toBe(true);
    other();
    expect(isWatching()).toBe(false);
  });

  it("gives the connection back by itself when a clip never resolves", async () => {
    // A stalled connection produces a video element that reports neither
    // success nor failure. The warm up must not be held off for ever by it.
    vi.useFakeTimers();
    claimPlayback();
    expect(isWatching()).toBe(true);

    await vi.advanceTimersByTimeAsync(MAX_CLAIM_MS + 10);

    expect(isWatching()).toBe(false);
  });

  it("lets a waiting warm up through when the claim expires", async () => {
    vi.useFakeTimers();
    claimPlayback();
    let resumed = false;
    whenNobodyIsWatching().then(() => (resumed = true));

    await vi.advanceTimersByTimeAsync(MAX_CLAIM_MS + 10);

    expect(resumed).toBe(true);
  });
});

describe("the readiness hook claims while a clip is loading", () => {
  it("holds the connection until the video can play, then gives it back", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { default: useVideoReadiness } = await import(
      "../hooks/useVideoReadiness.js"
    );

    const { result } = renderHook(() => useVideoReadiness({ source: "/clips/a.mp4" }));
    expect(isWatching()).toBe(true);

    act(() => result.current.handlers.onCanPlay());

    expect(isWatching()).toBe(false);
  });

  it("gives it back when the video fails, since nothing is coming", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { default: useVideoReadiness } = await import(
      "../hooks/useVideoReadiness.js"
    );

    const { result } = renderHook(() => useVideoReadiness({ source: "/clips/a.mp4" }));

    act(() => result.current.handlers.onError());

    expect(isWatching()).toBe(false);
  });

  it("gives it back when the screen goes", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { default: useVideoReadiness } = await import(
      "../hooks/useVideoReadiness.js"
    );

    const { unmount } = renderHook(() => useVideoReadiness({ source: "/clips/a.mp4" }));
    expect(isWatching()).toBe(true);

    unmount();

    expect(isWatching()).toBe(false);
  });

  it("claims again for the next clip in a sentence", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { default: useVideoReadiness } = await import(
      "../hooks/useVideoReadiness.js"
    );

    const { result, rerender } = renderHook(
      ({ source }) => useVideoReadiness({ source }),
      { initialProps: { source: "/clips/a.mp4" } },
    );
    act(() => result.current.handlers.onCanPlay());
    expect(isWatching()).toBe(false);

    rerender({ source: "/clips/b.mp4" });

    expect(isWatching()).toBe(true);
  });

  it("claims nothing when there is no clip to wait for", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { default: useVideoReadiness } = await import(
      "../hooks/useVideoReadiness.js"
    );

    renderHook(() => useVideoReadiness({ source: undefined }));

    expect(isWatching()).toBe(false);
  });
});
