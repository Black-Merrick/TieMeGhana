/**
 * The record in both languages, and emergency speech without a live call.
 *
 * Two features with one idea behind them: both renderings of a line already
 * exist at the moment it is created, so keep them rather than asking for them
 * again later. Asking again would mean sending a consultation to a third
 * party, which this app promises never to do, and in an emergency it would
 * mean a five second wait and unreviewed clinical Twi.
 */

import { describe, expect, it } from "vitest";

import {
  NO_PHRASES,
  anyFallsBackToEnglish,
  indexPhrases,
  phraseToSpeak,
} from "../emergency/spokenPhrases.js";
import {
  renderEntry,
  someEntriesUntranslated,
} from "../transcript/rendering.js";

const reviewed = (key, en, tw) => ({ key, en, tw, tw_reviewed: true });
const unreviewed = (key, en, tw) => ({ key, en, tw, tw_reviewed: false });

describe("showing a recorded line in a chosen language", () => {
  it("shows the original when it is already in that language", () => {
    const entry = { text: "Where does it hurt", language: "en" };

    expect(renderEntry(entry, "en")).toMatchObject({
      text: "Where does it hurt",
      available: true,
    });
  });

  it("shows the saved translation when there is one", () => {
    // Kept when the line was written, because the service had just produced it
    // to caption or speak it. Nothing is sent to switch between them.
    const entry = {
      text: "Where does it hurt",
      language: "en",
      translation: "Ɛhe na ɛyɛ wo ya",
      translationLanguage: "tw",
    };

    expect(renderEntry(entry, "tw")).toMatchObject({
      text: "Ɛhe na ɛyɛ wo ya",
      available: true,
    });
  });

  it("falls back to the original, marked, when no translation was saved", () => {
    // A record missing half its lines would be worse than one that is honest
    // about which are untranslated.
    const entry = { text: "Cannot breathe", language: "en" };

    expect(renderEntry(entry, "tw")).toMatchObject({
      text: "Cannot breathe",
      available: false,
      shownIn: "en",
    });
  });

  it("shows a line recorded before this existed as it is", () => {
    // No language on the entry means it predates the change. Guessing which
    // language it was in would be inventing something.
    const entry = { text: "appear" };

    expect(renderEntry(entry, "tw")).toMatchObject({
      text: "appear",
      available: true,
    });
  });

  it("reports when some lines cannot be shown in the chosen language", () => {
    const entries = [
      { text: "one", language: "en", translation: "baako", translationLanguage: "tw" },
      { text: "Cannot breathe", language: "en" },
    ];

    expect(someEntriesUntranslated(entries, "tw")).toBe(true);
    expect(someEntriesUntranslated(entries, "en")).toBe(false);
  });

  it("survives an empty record", () => {
    expect(someEntriesUntranslated([], "tw")).toBe(false);
    expect(someEntriesUntranslated(undefined, "tw")).toBe(false);
  });
});

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

describe("telling the responder why they are hearing English", () => {
  it("says so when Twi was asked for and something falls back", () => {
    const phrases = indexPhrases({ phrases: [], pending_review: ["NOSE"] });

    expect(anyFallsBackToEnglish(phrases, "tw")).toBe(true);
  });

  it("stays quiet when English was asked for", () => {
    const phrases = indexPhrases({ phrases: [], pending_review: ["NOSE"] });

    expect(anyFallsBackToEnglish(phrases, "en")).toBe(false);
  });

  it("stays quiet when nothing is pending", () => {
    const phrases = indexPhrases({ phrases: [], pending_review: [] });

    expect(anyFallsBackToEnglish(phrases, "tw")).toBe(false);
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
