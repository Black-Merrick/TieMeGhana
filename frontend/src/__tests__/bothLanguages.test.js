/**
 * The saved record in both languages, and emergency speech without a live call.
 *
 * One idea behind both: both renderings of a line already exist at the moment
 * it is created, so keep them rather than asking for them again later. Asking
 * again would mean sending a consultation to a third party, which this app
 * promises never to do, and in an emergency it would mean a five second wait
 * and unreviewed clinical Twi.
 *
 * The on screen toggle that chose between them was removed. The saved copy
 * still carries both, which is where it matters: that is the file a patient
 * hands to another clinician who may not share the language the consultation
 * happened in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NO_PHRASES,
  indexPhrases,
  phraseToSpeak,
} from "../emergency/spokenPhrases.js";

const reviewed = (key, en, tw) => ({ key, en, tw, tw_reviewed: true });
const unreviewed = (key, en, tw) => ({ key, en, tw, tw_reviewed: false });

describe("choosing what an emergency tap says", () => {
  const phrases = indexPhrases({
    phrases: [
      reviewed("HEAD", "Head", "Ti"),
      unreviewed("NOSE", "Nose", "Nose"),
    ],
    pending_review: ["NOSE"],
  });

  it("speaks the prepared Twi when it has been reviewed", () => {
    // The saving that matters: the text is already Twi, so the server has
    // nothing to translate and goes straight to speech. One call, not two.
    expect(phraseToSpeak(phrases, "HEAD", "tw", "Head")).toEqual({
      text: "Ti",
      language: "tw",
    });
  });

  it("speaks English when Twi has not been reviewed", () => {
    // The gate. Asked for "Nose" the translator returned "Nose", and asked for
    // "Waist" it returned "Waist a ɔyɛ ɔkwasea". Reading either to a clinician
    // during triage is worse than reading English.
    expect(phraseToSpeak(phrases, "NOSE", "tw", "Nose")).toMatchObject({
      text: "Nose",
      language: "en",
      fellBackToEnglish: true,
    });
  });

  it("reports the language it actually chose, not the one asked for", () => {
    // The caller passes this back as the source language, which is what stops
    // the server translating text that is already in the right language.
    expect(phraseToSpeak(phrases, "NOSE", "tw", "Nose").language).toBe("en");
    expect(phraseToSpeak(phrases, "HEAD", "tw", "Head").language).toBe("tw");
  });

  it("speaks English without consulting the vocabulary at all", () => {
    expect(phraseToSpeak(phrases, "HEAD", "en", "Head")).toEqual({
      text: "Head",
      language: "en",
    });
  });

  it("falls back to the label for a phrase the server does not know", () => {
    // A new body location before the vocabulary catches up. Speaking the
    // English label beats speaking nothing.
    expect(phraseToSpeak(phrases, "ELBOW", "tw", "Elbow")).toMatchObject({
      text: "Elbow",
      language: "en",
    });
  });

  it("works when the vocabulary never loaded", () => {
    // Offline, or the request failed. Every tap is spoken in English, which is
    // how emergency mode behaved before this existed.
    expect(phraseToSpeak(NO_PHRASES, "HEAD", "tw", "Head")).toMatchObject({
      text: "Head",
      language: "en",
    });
  });
});

describe("reading a malformed vocabulary", () => {
  it("survives a payload that is not what was expected", () => {
    // The failure that once blanked the triage screen: a catch handles the
    // server failing, not the server answering with something else.
    expect(indexPhrases(null)).toEqual(NO_PHRASES);
    expect(indexPhrases({})).toEqual(NO_PHRASES);
    expect(indexPhrases({ phrases: "nope" })).toEqual(NO_PHRASES);
  });

  it("ignores entries with no key rather than indexing undefined", () => {
    const phrases = indexPhrases({ phrases: [{ en: "Head" }, reviewed("HEAD", "Head", "Ti")] });

    expect(Object.keys(phrases.byKey)).toEqual(["HEAD"]);
  });
});

describe("the saved copy carries both languages", () => {
  /**
   * The file a patient shows to another clinician, who may not share the
   * language the consultation happened in. A record that has to be read in a
   * particular language is one that fails the person carrying it.
   */

  it("writes the translation under the line it belongs to", async () => {
    const { transcriptAsText, Direction } = await import(
      "../transcript/transcript.js"
    );

    const text = transcriptAsText(
      [
        {
          id: "1",
          at: "2026-09-16T09:00:00.000Z",
          direction: Direction.TO_PATIENT,
          text: "Take one tablet after food",
          language: "en",
          translation: "abopon baako a wɔde di aduane akyi",
          translationLanguage: "tw",
        },
      ],
      { patientName: "", savedAt: new Date("2026-09-16T09:05:00.000Z") },
    );

    expect(text).toContain("Take one tablet after food");
    expect(text).toContain("abopon baako a wɔde di aduane akyi");
    expect(text).toContain("Twi:");
  });

  it("writes one line where there is no translation", async () => {
    const { transcriptAsText, Direction } = await import(
      "../transcript/transcript.js"
    );

    const text = transcriptAsText(
      [
        {
          id: "1",
          at: "2026-09-16T09:00:00.000Z",
          direction: Direction.TO_DOCTOR,
          text: "Cannot breathe",
          language: "en",
        },
      ],
      { savedAt: new Date("2026-09-16T09:05:00.000Z") },
    );

    expect(text).toContain("Cannot breathe");
    expect(text).not.toContain("Twi:");
  });

  it("does not repeat a line whose translation is the same text", async () => {
    // Mixed input is passed through untranslated, so both renderings are
    // identical. Printing it twice would look like a bug in the record.
    const { transcriptAsText, Direction } = await import(
      "../transcript/transcript.js"
    );

    const text = transcriptAsText(
      [
        {
          id: "1",
          at: "2026-09-16T09:00:00.000Z",
          direction: Direction.TO_PATIENT,
          text: "Fa paracetamol",
          language: "mixed",
          translation: "Fa paracetamol",
          translationLanguage: "mixed",
        },
      ],
      { savedAt: new Date("2026-09-16T09:05:00.000Z") },
    );

    expect(text.match(/Fa paracetamol/g)).toHaveLength(1);
  });
});

describe("not speaking the same answer twice", () => {
  // jsdom has no blob URL registry, so releasing one throws there. Stubbed
  // rather than guarded in the hook: revokeObjectURL exists in every browser,
  // and an unhandled rejection in the suite hides real ones.
  beforeEach(() => {
    if (typeof URL.revokeObjectURL !== "function") {
      URL.revokeObjectURL = () => {};
    }
  });

  /**
   * The buttons are disabled while an answer is being spoken, but `disabled`
   * only takes effect after React re-renders, and a second tap landing inside
   * that gap gets through. The result is the same answer spoken over itself,
   * which to a clinician sounds like the patient said it twice.
   */

  it("ignores a second request for the answer already being spoken", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const speech = await import("../api/speech.js");
    const { default: useSpokenResponse } = await import(
      "../hooks/useSpokenResponse.js"
    );

    const spoken = {
      spoken_text: "Aane",
      audio_base64: "UklGRgAAAABXQVZF",
      audio_media_type: "audio/wav",
    };
    const call = vi.spyOn(speech, "speakResponse").mockResolvedValue(spoken);
    vi.spyOn(speech, "audioUrlFrom").mockReturnValue("blob:fake");

    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      // Two taps, no await between them, which is what a double tap is.
      result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "tw" });
      result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "tw" });
    });

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("still accepts a different answer straight after", async () => {
    // A patient correcting themselves. Losing that would be worse than
    // overlapping audio, so the guard is keyed on the text rather than being a
    // plain busy flag.
    const { renderHook, act } = await import("@testing-library/react");
    const speech = await import("../api/speech.js");
    const { default: useSpokenResponse } = await import(
      "../hooks/useSpokenResponse.js"
    );

    const call = vi.spyOn(speech, "speakResponse").mockResolvedValue({
      spoken_text: "x",
      audio_base64: "UklGRgAAAABXQVZF",
      audio_media_type: "audio/wav",
    });
    vi.spyOn(speech, "audioUrlFrom").mockReturnValue("blob:fake");

    const { result } = renderHook(() => useSpokenResponse());

    await act(async () => {
      result.current.speak({ text: "Yes", sourceLanguage: "en", outputLanguage: "tw" });
      result.current.speak({ text: "No", sourceLanguage: "en", outputLanguage: "tw" });
    });

    expect(call).toHaveBeenCalledTimes(2);
  });
});
