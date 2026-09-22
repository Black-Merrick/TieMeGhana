import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadWithRetry } from "../lazyScreen.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("loading a screen that is fetched when it is first opened", () => {
  it("loads it in one go when nothing is wrong", async () => {
    const load = vi.fn().mockResolvedValue({ default: "screen" });

    await expect(loadWithRetry(load)).resolves.toEqual({ default: "screen" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failure that passes", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: "screen" });

    const loaded = loadWithRetry(load);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(loaded).resolves.toEqual({ default: "screen" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last try, and says why", async () => {
    const load = vi.fn().mockRejectedValue(new Error("still down"));

    const loaded = loadWithRetry(load, { tries: 3 });
    const assertion = expect(loaded).rejects.toThrow("still down");
    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
    expect(load).toHaveBeenCalledTimes(3);
  });
});
