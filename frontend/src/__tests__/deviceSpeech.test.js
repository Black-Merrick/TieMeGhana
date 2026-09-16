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
  forgetVoices,
  isSupported,
  loadVoices,
  pickVoice,
  speakOnDevice,
} from "../audio/deviceSpeech.js";

/** The voice list as it is once the browser has finished loading it. */
const voicesFor = async () => await loadVoices({ timeoutMs: 20 });

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
  forgetVoices();
  withVoices([voice("en-GB"), voice("en-US"), voice("fr-FR")]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding a voice", () => {
  it("matches on the language, not the region", async () => {
    // A device has en-GB or en-US, never plain "en".
    expect(pickVoice(await voicesFor(), "en")).toMatchObject({ lang: "en-GB" });
  });

  it("returns nothing when the language is not installed", async () => {
    // espeak-ng, the usual Linux synthesiser, ships 945 English voices and no
    // Akan at all.
    expect(pickVoice(await voicesFor(), "tw")).toBeNull();
  });

  it("never falls back to whatever voice happens to be there", async () => {
    // The dangerous case. Reading Twi in a French voice would be confident
    // mispronunciation of clinical words, which is worse than silence.
    forgetVoices();
    withVoices([voice("fr-FR")]);

    expect(pickVoice(await voicesFor(), "tw")).toBeNull();
    expect(pickVoice(await voicesFor(), "en")).toBeNull();
  });
});

describe("waiting for the browser to load its voices", () => {
  /**
   * The bug this module shipped with. Chrome returns an empty array from
   * getVoices until it has finished asking the operating system, then fires
   * voiceschanged. Reading once and believing the answer meant that on a
   * device which does have voices, the first answer of every session was
   * refused as though it had none.
   */

  it("waits for voiceschanged rather than believing an empty first read", async () => {
    forgetVoices();
    let voices = [];
    const listeners = [];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: (_event, fn) => listeners.push(fn),
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});

    const pending = loadVoices({ timeoutMs: 500 });

    // The browser finishes a moment later, as it actually does.
    voices = [voice("en-GB")];
    listeners.forEach((fn) => fn());

    expect(await pending).toHaveLength(1);
  });

  it("gives up after a moment on a device that genuinely has none", async () => {
    // Some Linux desktops have speech-dispatcher with nothing behind it. An
    // empty list is a real answer, so this must not hang waiting for one.
    forgetVoices();
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [],
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: () => {},
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});

    expect(await loadVoices({ timeoutMs: 10 })).toEqual([]);
  });
});

describe("deciding whether the device can help", () => {
  it("speaks an English answer to an English listener", async () => {
    await expect(
      canSpeak({ text: "Yes", sourceLanguage: "en", outputLanguage: "en" }),
    ).resolves.toBe(true);
  });

  it("refuses when the answer would need translating first", async () => {
    // It is a voice, not a translator. Twi in, English out, needs the service.
    await expect(
      canSpeak({ text: "Aane", sourceLanguage: "tw", outputLanguage: "en" }),
    ).resolves.toBe(false);
  });

  it("refuses when there is no voice for the language", async () => {
    await expect(
      canSpeak({ text: "Aane", sourceLanguage: "tw", outputLanguage: "tw" }),
    ).resolves.toBe(false);
  });

  it("refuses an empty answer", async () => {
    await expect(
      canSpeak({ text: "   ", sourceLanguage: "en", outputLanguage: "en" }),
    ).resolves.toBe(false);
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
    forgetVoices();
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

    forgetVoices();
    expect(isSupported()).toBe(false);
    expect(await loadVoices()).toEqual([]);
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

describe("choosing the best of the voices that match", () => {
  /**
   * A device with nineteen English voices usually has a range, and picking
   * whichever came first is how a clinician ends up straining to understand a
   * sentence about their patient.
   */

  const named = (name, lang = "en-GB", extra = {}) => ({ name, lang, ...extra });

  it("prefers anything over espeak", () => {
    // espeak is a formant synthesiser. Intelligible, but robotic, and on a
    // clinical sentence that costs comprehension rather than only charm.
    const voices = [named("espeak-ng English"), named("Daniel")];

    expect(pickVoice(voices, "en")).toMatchObject({ name: "Daniel" });
  });

  it("still uses espeak when it is all there is", () => {
    // Better to be understood with effort than not heard at all. This is the
    // usual state of a Linux desktop.
    const voices = [named("espeak-ng English")];

    expect(pickVoice(voices, "en")).toMatchObject({ name: "espeak-ng English" });
  });

  it("skips the novelty variants espeak exposes", () => {
    // "English+Half-LifeAnnouncementSystem" is a real entry on a machine with
    // espeak-ng installed. None of them belong in a consultation.
    const voices = [
      named("English+Half-LifeAnnouncementSystem"),
      named("English+Alex"),
      named("English"),
    ];

    expect(pickVoice(voices, "en")).toMatchObject({ name: "English" });
  });

  it("prefers a local voice over one that needs the network", () => {
    // This is the fallback for the network service having already failed, so
    // a voice that also needs the network is a poor second choice.
    const voices = [
      named("Google UK English", "en-GB", { localService: false }),
      named("Daniel", "en-GB", { localService: true }),
    ];

    expect(pickVoice(voices, "en")).toMatchObject({ name: "Daniel" });
  });

  it("still refuses a language it has no voice for, however many it has", () => {
    // The safety property, unchanged by ranking. espeak ships 945 English
    // voices and no Akan, and reading Twi in an English voice is confident
    // mispronunciation of clinical words.
    const voices = [named("Daniel"), named("Fiona", "en-US")];

    expect(pickVoice(voices, "tw")).toBeNull();
  });
});

describe("how it is spoken", () => {
  it("slows a little, because a clinician hears this a handful of times", async () => {
    forgetVoices();
    withVoices([voice("en-GB")]);

    await speakOnDevice({ text: "The pain is severe", outputLanguage: "en" });

    const [utterance] = window.speechSynthesis.speak.mock.calls[0];
    expect(utterance.rate).toBeLessThan(1);
    // Not a drawl. The answer is being waited on in front of a patient.
    expect(utterance.rate).toBeGreaterThan(0.8);
  });
});
