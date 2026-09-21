import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAVE_TIMEOUT_MS, saveFile } from "../prescription/saveFile.js";

let clicked;
beforeEach(() => {
  clicked = [];
  vi.useFakeTimers();
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => "blob:video"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saving a video to the device", () => {
  it("fetches it and saves it from this origin, under the name given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["mp4"]) }),
    );

    const saved = await saveFile("https://bucket.example/clips/a.mp4", "paracetamol.mp4");

    expect(saved).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://bucket.example/clips/a.mp4",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(clicked).toEqual([{ href: "blob:video", download: "paracetamol.mp4" }]);
  });

  it("lets go of the blob afterwards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["mp4"]) }),
    );

    await saveFile("/media/a.mp4", "a.mp4");
    await vi.advanceTimersByTimeAsync(61000);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  it("says so when the file could not be fetched, saving nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    expect(await saveFile("/media/gone.mp4", "a.mp4")).toBe(false);
    expect(clicked).toEqual([]);
  });

  it("says so when the network or the bucket's CORS refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await saveFile("https://bucket.example/a.mp4", "a.mp4")).toBe(false);
    expect(clicked).toEqual([]);
  });

  it("gives up on a connection that stalls, rather than saying it is saving for ever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );

    const saving = saveFile("https://bucket.example/a.mp4", "a.mp4");
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS + 100);

    expect(await saving).toBe(false);
    expect(clicked).toEqual([]);
  });
});
