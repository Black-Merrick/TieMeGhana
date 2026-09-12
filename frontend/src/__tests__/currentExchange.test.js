import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCurrentExchange,
  loadCurrentExchange,
  saveCurrentExchange,
} from "../consultation/currentExchange.js";

/**
 * ADR 032. A reload is not an unusual event on a hospital device, and losing
 * the question at that moment means asking the patient to sit through it again.
 */

const caption = {
  transcript: "Did you vomit?",
  caption: "Wo foee?",
  sequence: {
    segments: [],
    fingerspelled_tokens: [],
    unavailable_tokens: [],
    total_duration_ms: 0,
  },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("keeping the exchange across a reload", () => {
  it("reports nothing before a question has been asked", () => {
    expect(loadCurrentExchange()).toBeNull();
  });

  it("returns the question that was on screen", () => {
    saveCurrentExchange({ caption });

    expect(loadCurrentExchange().caption.transcript).toBe("Did you vomit?");
  });

  it("keeps whether a body location was expected", () => {
    // Otherwise a reload part way through "where does it hurt" drops the
    // patient back to a yes or no they were never asked.
    saveCurrentExchange({ caption, awaitingLocation: true });

    expect(loadCurrentExchange().awaitingLocation).toBe(true);
  });

  it("merges rather than replacing what is already stored", () => {
    // The caption and the location flag are set by different parts of the
    // screen, so one must not wipe the other.
    saveCurrentExchange({ caption });

    saveCurrentExchange({ awaitingLocation: true });

    const stored = loadCurrentExchange();
    expect(stored.caption.transcript).toBe("Did you vomit?");
    expect(stored.awaitingLocation).toBe(true);
  });

  it("treats a record with no question as nothing to restore", () => {
    // There is nothing to put back on screen without a caption, so a record
    // holding only flags is not an exchange.
    saveCurrentExchange({ awaitingLocation: true });

    expect(loadCurrentExchange()).toBeNull();
  });
});

describe("clearing the exchange", () => {
  it("leaves nothing behind", () => {
    saveCurrentExchange({ caption });

    clearCurrentExchange();

    expect(loadCurrentExchange()).toBeNull();
  });

  it("is safe to call when there is nothing stored", () => {
    expect(() => clearCurrentExchange()).not.toThrow();
  });
});

describe("failing safely", () => {
  it("restores nothing when storage is unavailable", () => {
    // A private window. An exception here would take down the consultation
    // screen on load, which is strictly worse than losing the question.
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

    expect(loadCurrentExchange()).toBeNull();
    expect(() => saveCurrentExchange({ caption })).not.toThrow();
  });

  it("restores nothing rather than guessing at a corrupt record", () => {
    localStorage.setItem("tiemeghana.exchange", "not json");

    expect(loadCurrentExchange()).toBeNull();
  });

  it("refuses a caption with no resolved sequence", () => {
    // Written by an older version, or a partial write. The player and the
    // coverage notice both read the sequence, so restoring one without it
    // crashes the consultation screen on load, which is worse than losing the
    // question.
    localStorage.setItem(
      "tiemeghana.exchange",
      JSON.stringify({ caption: { transcript: "Fever?", caption: "Fever?" } }),
    );

    expect(loadCurrentExchange()).toBeNull();
  });

  it("refuses a sequence missing its coverage lists", () => {
    localStorage.setItem(
      "tiemeghana.exchange",
      JSON.stringify({
        caption: { caption: "Fever?", sequence: { segments: [] } },
      }),
    );

    expect(loadCurrentExchange()).toBeNull();
  });
});
