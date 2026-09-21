import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeviceMode,
  clearDeviceMode,
  loadDeviceMode,
  saveDeviceMode,
} from "../pairing/deviceMode.js";
import { VISIT_MAX_AGE_MS } from "../visit/visit.js";

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the device choice", () => {
  it("is nothing until somebody has been asked", () => {
    expect(loadDeviceMode()).toBeNull();
  });

  it("remembers a shared device", () => {
    saveDeviceMode(DeviceMode.SHARED);

    expect(loadDeviceMode()).toBe("shared");
  });

  it("remembers a paired one", () => {
    saveDeviceMode(DeviceMode.PAIRED);

    expect(loadDeviceMode()).toBe("paired");
  });

  it("returns what it saved, so a caller can put it straight into state", () => {
    expect(saveDeviceMode(DeviceMode.PAIRED)).toBe("paired");
  });

  it("refuses a mode it does not know", () => {
    expect(() => saveDeviceMode("telepathy")).toThrow(/unknown device mode/i);
    expect(loadDeviceMode()).toBeNull();
  });

  it("is cleared when the next patient starts", () => {
    saveDeviceMode(DeviceMode.PAIRED);

    clearDeviceMode();

    expect(loadDeviceMode()).toBeNull();
  });
});

describe("a choice that outlived its visit", () => {
  it("expires on the same clock a visit does", () => {
    saveDeviceMode(DeviceMode.PAIRED, 1_000);

    expect(loadDeviceMode(1_000 + VISIT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("clears itself when it expires, rather than being found again", () => {
    saveDeviceMode(DeviceMode.PAIRED, 1_000);
    loadDeviceMode(1_000 + VISIT_MAX_AGE_MS + 1);

    expect(localStorage.getItem("tiemeghana.device")).toBeNull();
  });

  it("still holds just inside the window", () => {
    saveDeviceMode(DeviceMode.PAIRED, 1_000);

    expect(loadDeviceMode(1_000 + VISIT_MAX_AGE_MS - 1)).toBe("paired");
  });
});

describe("storage that cannot be trusted", () => {
  it("treats corrupt data as no answer", () => {
    localStorage.setItem("tiemeghana.device", "{not json");

    expect(loadDeviceMode()).toBeNull();
  });

  it("treats an unrecognised mode as no answer", () => {
    localStorage.setItem(
      "tiemeghana.device",
      JSON.stringify({ mode: "nope", startedAt: Date.now() }),
    );

    expect(loadDeviceMode()).toBeNull();
  });

  it("treats a missing timestamp as no answer", () => {
    localStorage.setItem("tiemeghana.device", JSON.stringify({ mode: "paired" }));

    expect(loadDeviceMode()).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(loadDeviceMode()).toBeNull();
    expect(() => saveDeviceMode(DeviceMode.SHARED)).not.toThrow();
  });
});
