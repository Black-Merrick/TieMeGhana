import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_HOLD_MS,
  MIN_OVERLAY_MS,
  estimatedSpeechMs,
  remainingHoldMs,
} from "../feedback/speechHold.js";
import useSpeechFeedback from "../hooks/useSpeechFeedback.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import { speakResponse } from "../api/speech.js";

vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});

/**
 * The talking face stays for as long as the sentence takes to say. The patient
 * cannot hear it, so the face is their only evidence that it is being said,
 * and it was going as soon as the audio stopped, which with the development
 * service is a fraction of a second.
 */

describe("how long a sentence takes to say", () => {
  it("is never shorter than the shortest the face is shown", () => {
    expect(estimatedSpeechMs("Yes")).toBe(MIN_OVERLAY_MS);
    expect(estimatedSpeechMs("")).toBe(MIN_OVERLAY_MS);
    expect(estimatedSpeechMs(undefined)).toBe(MIN_OVERLAY_MS);
  });

  it("grows with the number of words", () => {
    expect(estimatedSpeechMs("I have taken the medicine")).toBeGreaterThan(
      estimatedSpeechMs("I cannot breathe"),
    );
    expect(estimatedSpeechMs("one two three four five six seven eight")).toBeGreaterThan(3000);
  });

  it("is capped, so a very long sentence does not hold the screen for ever", () => {
    expect(estimatedSpeechMs("word ".repeat(500))).toBe(MAX_HOLD_MS);
  });

  it("counts words in any language, and not the spaces between them", () => {
    expect(estimatedSpeechMs("  a   b  c  ")).toBe(estimatedSpeechMs("a b c"));
  });
});

describe("how much longer after the sound has ended", () => {
  const sentence = "I have taken the medicine but the pain is still severe";

  it("is what is left of the sentence's time", () => {
    const whole = estimatedSpeechMs(sentence);

    expect(remainingHoldMs(sentence, 500)).toBe(whole - 500);
  });

  it("is nothing once the audio has run as long as the sentence would", () => {
    expect(remainingHoldMs(sentence, estimatedSpeechMs(sentence) + 1)).toBe(0);
  });

  it("is nothing when it is not known when the sound began", () => {
    // The report of it may have been collapsed into the one after, and the
    // sound may have run its whole length already.
    expect(remainingHoldMs(sentence, null)).toBe(0);
  });
});

describe("the doctor's own device", () => {
  class FakeAudio {
    static last = null;
    constructor() {
      FakeAudio.last = this;
    }
    play() {
      this.onplay?.();
      return Promise.resolve();
    }
    pause() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.last = null;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { ...globalThis.URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
    speakResponse.mockResolvedValue({
      spoken_text: "I have taken the medicine but the pain is still severe",
      audio_base64: btoa("RIFFWAVE"),
      audio_media_type: "audio/wav",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function saySomething() {
    const hook = renderHook(() => useSpokenResponse());
    await act(async () => {
      hook.result.current.speak({ text: "long one", sourceLanguage: "en", outputLanguage: "en" });
      await vi.advanceTimersByTimeAsync(0);
    });
    return hook;
  }

  it("shows the face while it is being prepared and said", async () => {
    const { result } = await saySomething();

    expect(result.current.status).toBe("playing");
    expect(result.current.showing).toBe(true);
  });

  it("keeps it up after a short sound, for as long as the sentence takes", async () => {
    const { result } = await saySomething();

    // The audio ends almost at once, as the development service's does.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      FakeAudio.last.onended();
    });
    expect(result.current.status).toBe("spoken");
    expect(result.current.showing).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(estimatedSpeechMs("I have taken the medicine but the pain is still severe") - 200);
    });
    expect(result.current.showing).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.showing).toBe(false);
  });

  it("does not hold it longer than the sound when the sound was longer", async () => {
    const { result } = await saySomething();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
      FakeAudio.last.onended();
    });

    expect(result.current.status).toBe("spoken");
    expect(result.current.showing).toBe(false);
  });

  it("takes it away at once when it is stopped", async () => {
    const { result } = await saySomething();
    await act(async () => {
      FakeAudio.last.onended();
    });
    expect(result.current.showing).toBe(true);

    act(() => result.current.stop());

    expect(result.current.showing).toBe(false);
  });

  it("takes it away at once when the sound fails", async () => {
    const { result } = await saySomething();

    await act(async () => {
      FakeAudio.last.onerror();
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.showing).toBe(false);
  });
});

describe("the patient's phone", () => {
  const TEXT = "I have taken the medicine but the pain is still severe";
  let channel;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
    channel = { send: vi.fn(), lastMessage: null };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function hear(hook, rerender, status) {
    channel = { ...channel, lastMessage: { type: "speaking", status } };
    rerender();
  }

  async function answered() {
    const hook = renderHook(() => useSpeechFeedback(channel));
    act(() => hook.result.current.begin(TEXT));
    return hook;
  }

  it("keeps the face up until the sentence would be finished, not until the report of it", async () => {
    const hook = await answered();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      hear(hook, hook.rerender, "playing");
    });

    // The doctor's device says it is spoken a moment later, as a short sound would.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      hear(hook, hook.rerender, "spoken");
    });
    expect(hook.result.current.status).toBe("spoken");
    expect(hook.result.current.busy).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(estimatedSpeechMs(TEXT) - 500);
    });
    expect(hook.result.current.busy).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it("is up for the shortest time at least, when it never saw the sound start", async () => {
    const hook = await answered();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      hear(hook, hook.rerender, "spoken");
    });
    expect(hook.result.current.busy).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_OVERLAY_MS);
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it("takes it away at once for a failure", async () => {
    const hook = await answered();

    await act(async () => {
      hear(hook, hook.rerender, "failed");
    });

    expect(hook.result.current.busy).toBe(false);
  });

  it("holds an answer said again for the sentence as well", async () => {
    const hook = await answered();
    await act(async () => {
      hear(hook, hook.rerender, "spoken");
      await vi.advanceTimersByTimeAsync(MIN_OVERLAY_MS + 100);
    });
    expect(hook.result.current.busy).toBe(false);

    act(() => hook.result.current.replay());
    expect(hook.result.current.busy).toBe(true);
  });
});
