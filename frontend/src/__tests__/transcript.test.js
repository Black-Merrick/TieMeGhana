import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Direction,
  appendEntry,
  clearTranscript,
  readTranscript,
  transcriptAsText,
} from "../transcript/transcript.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

vi.mock("../feedback/vibration.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, vibrate: vi.fn() };
});

/**
 * FR 4.1 to 4.3. The transcript is the most sensitive thing the app holds:
 * consultations about pregnancy, sexually transmitted infections, and HIV
 * status. Most of these tests are about it not leaking.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Unstubbed before clearing, since a stubbed localStorage has no clear().
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("recording exchanges", () => {
  it("starts empty", () => {
    expect(readTranscript()).toEqual([]);
  });

  it("records direction, text, and a timestamp for every exchange", () => {
    // FR 4.1 names all three. A transcript missing the direction cannot show
    // who said what, which is the whole point of having one.
    appendEntry({
      direction: Direction.TO_PATIENT,
      text: "Where does it hurt?",
      at: "2026-09-12T10:00:00.000Z",
    });

    const [entry] = readTranscript();
    expect(entry.direction).toBe(Direction.TO_PATIENT);
    expect(entry.text).toBe("Where does it hurt?");
    expect(entry.at).toBe("2026-09-12T10:00:00.000Z");
  });

  it("records both directions", () => {
    appendEntry({ direction: Direction.TO_PATIENT, text: "Fever?" });
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    expect(readTranscript().map((e) => e.direction)).toEqual([
      Direction.TO_PATIENT,
      Direction.TO_DOCTOR,
    ]);
  });

  it("keeps exchanges in the order they happened", () => {
    // A consultation read out of order could reverse which answer belonged to
    // which question, which is worse than having no record.
    appendEntry({ direction: Direction.TO_PATIENT, text: "first" });
    appendEntry({ direction: Direction.TO_DOCTOR, text: "second" });
    appendEntry({ direction: Direction.TO_PATIENT, text: "third" });

    expect(readTranscript().map((e) => e.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps any extra detail an exchange carries", () => {
    // Such as who confirmed a nod, per FR 2.7, so the record cannot later
    // imply the patient tapped something they never touched.
    appendEntry({
      direction: Direction.TO_DOCTOR,
      text: "Yes",
      answeredBy: "doctor",
    });

    expect(readTranscript()[0].answeredBy).toBe("doctor");
  });

  it("refuses an unrecognized direction", () => {
    // An entry with no usable direction would be unreadable as a record.
    expect(() => appendEntry({ direction: "sideways", text: "x" })).toThrow();
  });

  it("vibrates one soft pulse when an exchange is saved", () => {
    // SRS section 6. The only cue the patient gets that their record was kept.
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    expect(vibrate).toHaveBeenCalledWith(VibrationPattern.TRANSCRIPT_SAVED);
  });

  it("survives across a reload within the visit", () => {
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    // A fresh read is what a reload does.
    expect(readTranscript()).toHaveLength(1);
  });
});

describe("deleting the transcript", () => {
  it("leaves nothing behind", () => {
    // FR 4.3. The patient can delete their own record.
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    clearTranscript();

    expect(readTranscript()).toEqual([]);
  });

  it("is safe to call when there is nothing recorded", () => {
    expect(() => clearTranscript()).not.toThrow();
  });

  it("removes the stored record rather than only emptying the list", () => {
    // Leaving an empty array behind would be harmless, but leaving the key
    // with stale content would not, so the key itself goes.
    appendEntry({ direction: Direction.TO_DOCTOR, text: "I am HIV positive" });

    clearTranscript();

    expect(localStorage.getItem("tiemeghana.transcript")).toBeNull();
  });
});

describe("failing safely", () => {
  it("reads as empty when storage is unavailable", () => {
    // A private window, or site data blocked. An exception here would take
    // down the consultation screen.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
      clear: () => {},
    });

    expect(readTranscript()).toEqual([]);
  });

  it("keeps the consultation going when a write fails", () => {
    // The exchange still happened, and the caller still gets it, it simply
    // will not survive a reload.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
      clear: () => {},
    });

    const entries = appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    expect(entries).toHaveLength(1);
  });

  it("reads as empty rather than guessing at a corrupt record", () => {
    localStorage.setItem("tiemeghana.transcript", "not json");

    expect(readTranscript()).toEqual([]);
  });

  it("reads as empty when the stored value is not a list", () => {
    localStorage.setItem("tiemeghana.transcript", JSON.stringify({ text: "x" }));

    expect(readTranscript()).toEqual([]);
  });
});

describe("taking a copy", () => {
  it("renders the consultation as readable text", () => {
    // The abstract promises documented proof of what the doctor communicated.
    // Since the record is deleted with the visit, taking a copy must be
    // possible, and it is an explicit patient action per NFR 4.
    appendEntry({
      direction: Direction.TO_PATIENT,
      text: "Do you have fever?",
      at: "2026-09-12T10:00:00.000Z",
    });
    appendEntry({
      direction: Direction.TO_DOCTOR,
      text: "Yes",
      at: "2026-09-12T10:00:05.000Z",
    });

    const text = transcriptAsText();

    expect(text).toContain("Doctor: Do you have fever?");
    expect(text).toContain("Patient: Yes");
  });

  it("names who said each line rather than using the internal direction", () => {
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    expect(transcriptAsText()).not.toContain("to_doctor");
  });
});
