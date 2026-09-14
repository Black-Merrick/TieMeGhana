import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useSpokenResponse from "../hooks/useSpokenResponse.js";
import { speakResponse } from "../api/speech.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});
vi.mock("../feedback/vibration.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, vibrate: vi.fn() };
});

/**
 * FR 3.4, speaking a patient response, and the feedback around it.
 *
 * jsdom has no audio device, so a stand in records what was played and lets a
 * test fire the events a real element would. That is honest about what these
 * prove: the state machine and the vibration vocabulary, not that sound came
 * out of a speaker.
 */

class FakeAudio {
  static instances = [];

  constructor(src) {
    this.src = src;
    this.played = false;
    FakeAudio.instances.push(this);
  }

  play() {
    this.played = true;
    // A real element fires play asynchronously, after play() resolves.
    this.onplay?.();
    return Promise.resolve();
  }

  finish() {
    this.onended?.();
  }

  fail() {
    this.onerror?.();
  }
}

const spokenPayload = {
  source_language: "en",
  output_language: "en",
  spoken_text: "Yes",
  translation_applied: false,
  language_provider: "khaya",
  audio_base64: btoa("RIFFWAVEfake"),
  audio_media_type: "audio/wav",
};

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => "blob:spoken"),
    revokeObjectURL: vi.fn(),
  });
  speakResponse.mockResolvedValue(spokenPayload);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useSpokenResponse", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useSpokenResponse());

    expect(result.current.status).toBe("idle");
  });

  it("sends the patient's text and both languages", async () => {
    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      await result.current.speak({
        text: "wo tiri",
        sourceLanguage: "tw",
        outputLanguage: "en",
      });
    });

    expect(speakResponse).toHaveBeenCalledWith({
      text: "wo tiri",
      sourceLanguage: "tw",
      outputLanguage: "en",
    });
  });

  it("plays the audio it received", async () => {
    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].played).toBe(true);
  });

  it("vibrates two short pulses when speech begins", async () => {
    // SRS section 6. The patient's physical cue for an event they cannot hear,
    // which is the whole reason this feedback exists.
    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    expect(vibrate).toHaveBeenCalledWith(VibrationPattern.AUDIO_STARTED);
    expect(result.current.status).toBe("playing");
  });

  it("vibrates one long pulse when speech ends", async () => {
    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    await act(async () => {
      FakeAudio.instances[0].finish();
    });

    expect(vibrate).toHaveBeenCalledWith(VibrationPattern.AUDIO_FINISHED);
    expect(result.current.status).toBe("spoken");
  });

  it("uses a different pattern for starting and finishing", async () => {
    // Two events the patient must be able to tell apart by feel alone.
    expect(VibrationPattern.AUDIO_STARTED).not.toEqual(
      VibrationPattern.AUDIO_FINISHED,
    );
  });

  it("keeps the spoken text, so the doctor can read what was said", async () => {
    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    expect(result.current.result.spoken_text).toBe("Yes");
  });

  it("reports a failure when the language service is unreachable", async () => {
    speakResponse.mockRejectedValue(new Error("503"));
    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    expect(result.current.status).toBe("failed");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("reports a failure when the audio cannot be played", async () => {
    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    await act(async () => {
      FakeAudio.instances[0].fail();
    });

    expect(result.current.status).toBe("failed");
  });

  it("releases the audio url once playback finishes", async () => {
    // A blob url is held until revoked, so leaking one per answer would grow
    // memory across a long consultation.
    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    await act(async () => {
      FakeAudio.instances[0].finish();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:spoken");
  });

  it("releases the previous audio when a new answer is spoken", async () => {
    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" });
    });

    await act(async () => {
      await result.current.speak({ text: "No", sourceLanguage: "en", outputLanguage: "en" });
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:spoken");
    expect(FakeAudio.instances).toHaveLength(2);
  });
});
