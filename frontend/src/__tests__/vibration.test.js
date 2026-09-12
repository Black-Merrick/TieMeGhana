import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VibrationPattern,
  isVibrationSupported,
  vibrate,
} from "../feedback/vibration.js";

let vibrateSpy;

beforeEach(() => {
  vibrateSpy = vi.fn().mockReturnValue(true);
  vi.stubGlobal("navigator", { ...globalThis.navigator, vibrate: vibrateSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the vibration vocabulary", () => {
  it("defines exactly the five patterns the SRS lists", () => {
    // SRS section 6 is the source of truth and names five events. A sixth
    // pattern appearing here means a feature invented one instead of reusing
    // the vocabulary, which section 4.4 forbids.
    expect(Object.keys(VibrationPattern)).toEqual([
      "TAP_SELECTION",
      "AUDIO_STARTED",
      "AUDIO_FINISHED",
      "EMERGENCY_ALERT",
      "TRANSCRIPT_SAVED",
    ]);
  });

  it("never reuses one pattern for two meanings", () => {
    // The whole point of a fixed vocabulary is that a patient learns what each
    // pulse means. Two events sharing a pattern would teach them something
    // false, so this is a correctness property, not a style preference.
    const patterns = Object.values(VibrationPattern).map((p) => p.join(","));

    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("makes the emergency alert the most insistent pattern", () => {
    // It confirms the highest stakes action in the app, so it should not be
    // possible to mistake it for an ordinary tap.
    const pulses = (pattern) => Math.ceil(pattern.length / 2);

    expect(pulses(VibrationPattern.EMERGENCY_ALERT)).toBe(3);
    expect(pulses(VibrationPattern.TAP_SELECTION)).toBe(1);
  });

  it("keeps the transcript pulse softer than a tap", () => {
    // SRS section 6 calls it "soft, brief". It is a background confirmation,
    // not something demanding attention mid consultation.
    expect(VibrationPattern.TRANSCRIPT_SAVED[0]).toBeLessThan(
      VibrationPattern.TAP_SELECTION[0],
    );
  });
});

describe("vibrate", () => {
  it("passes the pattern to the device", () => {
    vibrate(VibrationPattern.TAP_SELECTION);

    expect(vibrateSpy).toHaveBeenCalledWith(VibrationPattern.TAP_SELECTION);
  });

  it("reports success when the device vibrated", () => {
    expect(vibrate(VibrationPattern.TAP_SELECTION)).toBe(true);
  });

  it("reports failure without throwing where vibration is unsupported", () => {
    // NFR 3. A throw inside a tap handler would break the interaction itself,
    // which is far worse than no haptic feedback, so the caller gets a false
    // and can fall back to visual confirmation alone.
    vi.stubGlobal("navigator", { ...globalThis.navigator, vibrate: undefined });

    expect(isVibrationSupported()).toBe(false);
    expect(() => vibrate(VibrationPattern.TAP_SELECTION)).not.toThrow();
    expect(vibrate(VibrationPattern.TAP_SELECTION)).toBe(false);
  });

  it("reports failure when the browser refuses", () => {
    // Chrome returns false rather than throwing, for example before the page
    // has had any user gesture.
    vibrateSpy.mockReturnValue(false);

    expect(vibrate(VibrationPattern.TAP_SELECTION)).toBe(false);
  });

  it("survives a browser that throws instead of refusing", () => {
    vibrateSpy.mockImplementation(() => {
      throw new Error("not allowed");
    });

    expect(vibrate(VibrationPattern.TAP_SELECTION)).toBe(false);
  });
});
