import { describe, expect, it } from "vitest";

import { announcedPath, announcedPrescription } from "../pairing/announcedScreen.js";

const REFERENCE = "abc123XYZ_-def456ghi";

describe("the prescription a message says was issued", () => {
  it.each(["path", "question", "emergency", "resume"])("is read from a %s message", (type) => {
    expect(announcedPrescription({ type, prescription: REFERENCE })).toBe(REFERENCE);
  });

  it("is unknown when a message does not say", () => {
    expect(announcedPrescription({ type: "path", path: "guided" })).toBeUndefined();
    expect(announcedPrescription(null)).toBeUndefined();
  });

  it("is not believed unless it is shaped like a reference", () => {
    expect(announcedPrescription({ type: "path", prescription: "../x" })).toBeUndefined();
    expect(announcedPrescription({ type: "path", prescription: 42 })).toBeUndefined();
    expect(
      announcedPrescription({ type: "path", prescription: "<img onerror=x>" }),
    ).toBeUndefined();
  });

  it("is not read from a message that does not carry the screen", () => {
    expect(announcedPrescription({ type: "speaking", prescription: REFERENCE })).toBeUndefined();
  });

  it("is never taken away by a message that says nothing", () => {
    // A phone keeps what it was given: it is the patient's to keep.
    expect(announcedPrescription({ type: "question" })).toBeUndefined();
  });
});

describe("the path a message announces", () => {
  it.each(["path", "question", "emergency"])("is read from a %s message", (type) => {
    expect(announcedPath({ type, path: "guided" })).toBe("guided");
  });

  it("is not read from anything else", () => {
    expect(announcedPath({ type: "speaking", path: "guided" })).toBeUndefined();
    expect(announcedPath(null)).toBeUndefined();
  });
});
