/**
 * Speaking with the device's own voice when the service cannot.
 *
 * Khaya's free tier answered "Out of call volume quota" and every patient
 * answer stopped being spoken. Captions degraded, because signs need no
 * translation to resolve. Speech had nothing to degrade to, and FR 3.1 to 3.5
 * exist because an answer nobody hears is an answer nobody receives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canSpeak,
  isSupported,
  speakOnDevice,
  voiceFor,
} from "../audio/deviceSpeech.js";

const voice = (lang, name = lang) => ({ lang, name });

function withVoices(voices) {
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => voices,
    speak: vi.fn((utterance) => utterance.onend?.()),
    cancel: vi.fn(),
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(text) {
        this.text = text;
      }
    },
  );
}

beforeEach(() => {
  withVoices([voice("en-GB"), voice("en-US"), voice("fr-FR")]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding a voice", () => {
  it("matches on the language, not the region", () => {
    // A device has en-GB or en-US, never plain "en".
    expect(voiceFor("en")).toMatchObject({ lang: "en-GB" });
  });

  it("returns nothing when the language is not installed", () => {
    // Nearly every device has English. Almost none has Twi.
    expect(voiceFor("tw")).toBeNull();
  });

  it("never falls back to whatever voice happens to be there", () => {
    // The dangerous case. Reading Twi in a French voice would be confident
    // mispronunciation of clinical words, which is worse than silence.
    withVoices([voice("fr-FR")]);

    expect(voiceFor("tw")).toBeNull();
    expect(voiceFor("en")).toBeNull();
  });
});

describe("deciding whether the device can help", () => {
  it("speaks an English answer to an English listener", () => {
    expect(
      canSpeak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" }),
    ).toBe(true);
  });

  it("refuses when the answer would need translating first", () => {
    // It is a voice, not a translator. Twi in, English out, needs the service.
    expect(
      canSpeak({ text: "Aane", sourceLanguage: "tw", outputLanguage: "en" }),
    ).toBe(false);
  });

  it("refuses when there is no voice for the language", () => {
    expect(
      canSpeak({ text: "Aane", sourceLanguage: "tw", outputLanguage: "tw" }),
    ).toBe(false);
  });

  it("refuses an empty answer", () => {
    expect(
      canSpeak({ text: "   ", sourceLanguage: "en", outputLanguage: "en" }),
    ).toBe(false);
  });
});

describe("speaking", () => {
  it("resolves true once the voice has finished", async () => {
    await expect(
      speakOnDevice({ text: "The pain is severe", outputLanguage: "en" }),
    ).resolves.toBe(true);
  });

  it("uses the matching voice rather than the default", async () => {
    await speakOnDevice({ text: "Yes", outputLanguage: "en" });

    const [utterance] = window.speechSynthesis.speak.mock.calls[0];
    expect(utterance.voice).toMatchObject({ lang: "en-GB" });
    expect(utterance.text).toBe("Yes");
  });

  it("abandons anything already queued", async () => {
    // The clinician wants this answer, not a backlog of earlier ones read out
    // in order after it.
    await speakOnDevice({ text: "Yes", outputLanguage: "en" });

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("resolves false rather than throwing when there is no voice", async () => {
    // The caller is already in a failure path. A second exception there would
    // replace a useful message with a crash.
    await expect(
      speakOnDevice({ text: "Aane", outputLanguage: "tw" }),
    ).resolves.toBe(false);
  });

  it("resolves false when the synthesiser errors", async () => {
    withVoices([voice("en-GB")]);
    window.speechSynthesis.speak = vi.fn((utterance) => utterance.onerror?.());

    await expect(
      speakOnDevice({ text: "Yes", outputLanguage: "en" }),
    ).resolves.toBe(false);
  });
});

describe("a browser with no synthesiser at all", () => {
  it("reports itself unsupported rather than throwing", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("speechSynthesis", undefined);

    expect(isSupported()).toBe(false);
    expect(voiceFor("en")).toBeNull();
    await expect(
      speakOnDevice({ text: "Yes", outputLanguage: "en" }),
    ).resolves.toBe(false);
  });
});

describe("the hook reaching for it when the service fails", () => {
  /**
   * The behaviour the whole module exists for: a spent quota must not mean
   * silence when the device could have said it.
   */

  it("speaks on the device after the service refuses", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const speech = await import("../api/speech.js");
    const { default: useSpokenResponse } = await import(
      "../hooks/useSpokenResponse.js"
    );

    vi.spyOn(speech, "speakResponse").mockRejectedValue(new Error("503"));

    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({
        text: "The pain is severe",
        sourceLanguage: "en",
        outputLanguage: "en",
      });
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalled();
    expect(result.current.status).toBe("spoken");
  });

  it("reports failure when the device cannot help either", async () => {
    // Twi out with no Twi voice. Honest silence rather than a noise that
    // sounds like it worked.
    const { renderHook, act } = await import("@testing-library/react");
    const speech = await import("../api/speech.js");
    const { default: useSpokenResponse } = await import(
      "../hooks/useSpokenResponse.js"
    );

    vi.spyOn(speech, "speakResponse").mockRejectedValue(new Error("503"));

    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({
        text: "Aane",
        sourceLanguage: "tw",
        outputLanguage: "tw",
      });
    });

    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
  });

  it("does not reach for the device when the service worked", async () => {
    // Khaya's voice is the better one. This is a fallback, never the first
    // choice.
    const { renderHook, act } = await import("@testing-library/react");
    const speech = await import("../api/speech.js");
    const { default: useSpokenResponse } = await import(
      "../hooks/useSpokenResponse.js"
    );

    vi.spyOn(speech, "speakResponse").mockResolvedValue({
      spoken_text: "Yes",
      audio_base64: "UklGRgAAAABXQVZF",
      audio_media_type: "audio/wav",
    });
    vi.spyOn(speech, "audioUrlFrom").mockReturnValue("blob:fake");
    if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          this.onplay?.();
          this.onended?.();
          return Promise.resolve();
        }
      },
    );

    const { result } = renderHook(() => useSpokenResponse());
    await act(async () => {
      await result.current.speak({
        text: "Yes",
        sourceLanguage: "en",
        outputLanguage: "en",
      });
    });

    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });
});
