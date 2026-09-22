import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSentPrescription,
  loadSentPrescription,
  saveSentPrescription,
} from "../pairing/sentPrescription.js";
import { VISIT_MAX_AGE_MS } from "../visit/visit.js";

const REFERENCE = "abc123XYZ_-def456ghi";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the prescription issued to the patient's phone", () => {
  it("is remembered, so a phone that comes back is given it again", () => {
    saveSentPrescription(REFERENCE);

    expect(loadSentPrescription()).toBe(REFERENCE);
  });

  it("is nothing until one is issued", () => {
    expect(loadSentPrescription()).toBeNull();
  });

  it("is forgotten when the next patient starts", () => {
    saveSentPrescription(REFERENCE);

    clearSentPrescription();

    expect(loadSentPrescription()).toBeNull();
  });

  it("expires with the visit", () => {
    saveSentPrescription(REFERENCE, 1000);

    expect(loadSentPrescription(1000 + VISIT_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem("tiemeghana.sent-prescription")).toBeNull();
  });

  it("refuses anything that is not a reference", () => {
    saveSentPrescription("../../etc/passwd");
    saveSentPrescription(undefined);

    expect(loadSentPrescription()).toBeNull();
  });

  it("does not trust what is in storage either", () => {
    localStorage.setItem(
      "tiemeghana.sent-prescription",
      JSON.stringify({ reference: "<script>", savedAt: Date.now() }),
    );

    expect(loadSentPrescription()).toBeNull();
  });

  it("copes with storage that is not JSON", () => {
    localStorage.setItem("tiemeghana.sent-prescription", "{nope");

    expect(loadSentPrescription()).toBeNull();
  });
});
