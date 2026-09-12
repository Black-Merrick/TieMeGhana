import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiteracyPath,
  VISIT_MAX_AGE_MS,
  endVisit,
  loadVisit,
  saveLiteracyPath,
} from "../visit/visit.js";

/**
 * FR 2.2, the literacy answer and how long it lasts.
 *
 * The riskiest behaviour in this module is not saving, it is forgetting. This
 * app runs on a device passed between patients, so an answer that outlives its
 * visit routes the next patient down the wrong path.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("loadVisit", () => {
  it("reports no visit before anyone has answered", () => {
    expect(loadVisit()).toBeNull();
  });

  it("returns the answer within the same visit", () => {
    // A patient who reloads the page mid consultation must not be asked again.
    saveLiteracyPath(LiteracyPath.GUIDED, 1_000);

    expect(loadVisit(2_000).literacyPath).toBe(LiteracyPath.GUIDED);
  });

  it("forgets a visit that has gone stale", () => {
    // The safety property. A device handed to a new patient hours later must
    // never inherit the previous patient's literacy answer, because showing
    // captions to a patient who cannot read print is exactly the failure the
    // literacy check exists to prevent.
    saveLiteracyPath(LiteracyPath.LITERATE, 0);

    expect(loadVisit(VISIT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("clears the stale visit rather than leaving it to be read again", () => {
    saveLiteracyPath(LiteracyPath.LITERATE, 0);

    loadVisit(VISIT_MAX_AGE_MS + 1);

    // Even asked with a fresh clock, the record is gone.
    expect(loadVisit(VISIT_MAX_AGE_MS + 2)).toBeNull();
  });

  it("keeps a visit that is old but still within the window", () => {
    saveLiteracyPath(LiteracyPath.GUIDED, 0);

    expect(loadVisit(VISIT_MAX_AGE_MS - 1)).not.toBeNull();
  });

  it("re asks rather than guessing when the stored record is corrupt", () => {
    localStorage.setItem("tiemeghana.visit", "not json");

    expect(loadVisit()).toBeNull();
  });

  it("re asks when the stored record has no start time", () => {
    // Without a timestamp the staleness rule cannot be applied, so the record
    // cannot be trusted to belong to this patient.
    localStorage.setItem(
      "tiemeghana.visit",
      JSON.stringify({ literacyPath: LiteracyPath.LITERATE }),
    );

    expect(loadVisit()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    // A private window, or site data blocked. An exception here would take
    // down the first screen a patient ever sees.
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
    });

    expect(() => loadVisit()).not.toThrow();
    expect(loadVisit()).toBeNull();
  });
});

describe("saveLiteracyPath", () => {
  it("records the guided path for a patient who does not read print", () => {
    const visit = saveLiteracyPath(LiteracyPath.GUIDED, 500);

    expect(visit.literacyPath).toBe(LiteracyPath.GUIDED);
    expect(visit.startedAt).toBe(500);
  });

  it("refuses an unrecognized path", () => {
    // Silently storing a typo would route the patient by falling through to a
    // default, which is the one thing this module must never do.
    expect(() => saveLiteracyPath("maybe")).toThrow();
  });

  it("replaces the previous answer rather than merging with it", () => {
    saveLiteracyPath(LiteracyPath.LITERATE, 0);

    saveLiteracyPath(LiteracyPath.GUIDED, 10);

    expect(loadVisit(20).literacyPath).toBe(LiteracyPath.GUIDED);
  });

  it("still works when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    });

    expect(() => saveLiteracyPath(LiteracyPath.GUIDED)).not.toThrow();
  });
});

describe("endVisit", () => {
  it("clears the answer so the next patient is asked fresh", () => {
    saveLiteracyPath(LiteracyPath.LITERATE, 0);

    endVisit();

    expect(loadVisit(1)).toBeNull();
  });

  it("is safe to call when there is no visit", () => {
    expect(() => endVisit()).not.toThrow();
  });
});

describe("failing closed", () => {
  it("re asks when the stored path is not one we recognize", () => {
    // Falling through to whichever branch the UI defaults to would route a
    // patient by accident. Re asking costs seconds, misrouting costs the
    // consultation.
    localStorage.setItem(
      "tiemeghana.visit",
      JSON.stringify({ literacyPath: "unknown", startedAt: 1_000 }),
    );

    expect(loadVisit(1_001)).toBeNull();
  });

  it("accepts a visit that started at timestamp zero", () => {
    // Guarding with truthiness rather than type would reject this, and a bug
    // that only appears for one value of the clock is the worst kind to find.
    saveLiteracyPath(LiteracyPath.GUIDED, 0);

    expect(loadVisit(1).literacyPath).toBe(LiteracyPath.GUIDED);
  });
});

describe("the hearing listener's language", () => {
  it("defaults to English when a visit starts", async () => {
    // The language clinical staff most reliably share, and the toggle is on
    // screen so a Twi speaking nurse changes it in one tap.
    const { DEFAULT_OUTPUT_LANGUAGE } = await import("../visit/visit.js");
    saveLiteracyPath(LiteracyPath.GUIDED, 0);

    expect(loadVisit(1).outputLanguage).toBe(DEFAULT_OUTPUT_LANGUAGE);
  });

  it("keeps the chosen language for the rest of the visit", async () => {
    // FR 3.4 sets it once per session, so it must survive a reload.
    const { OutputLanguage, saveOutputLanguage } = await import(
      "../visit/visit.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED, 0);

    saveOutputLanguage(OutputLanguage.TWI, 1);

    expect(loadVisit(2).outputLanguage).toBe(OutputLanguage.TWI);
  });

  it("refuses an unrecognized language", async () => {
    const { saveOutputLanguage } = await import("../visit/visit.js");
    saveLiteracyPath(LiteracyPath.GUIDED, 0);

    expect(() => saveOutputLanguage("fr", 1)).toThrow();
  });

  it("will not set a language against a visit that has ended", async () => {
    // Otherwise the next patient would inherit it along with a half written
    // visit record.
    const { OutputLanguage, saveOutputLanguage } = await import(
      "../visit/visit.js"
    );

    expect(saveOutputLanguage(OutputLanguage.TWI)).toBeNull();
    expect(loadVisit()).toBeNull();
  });

  it("falls back rather than leaving the language undefined", async () => {
    // A record written before this field existed. Sending a request with no
    // output language would fail validation on the server.
    const { DEFAULT_OUTPUT_LANGUAGE } = await import("../visit/visit.js");
    localStorage.setItem(
      "tiemeghana.visit",
      JSON.stringify({ literacyPath: LiteracyPath.GUIDED, startedAt: 1_000 }),
    );

    expect(loadVisit(1_001).outputLanguage).toBe(DEFAULT_OUTPUT_LANGUAGE);
  });
});
