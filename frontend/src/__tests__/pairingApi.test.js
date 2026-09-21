import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPairing,
  endPairing,
  fetchAnswer,
  fetchOffer,
  isJoinPath,
  postAnswer,
  postOffer,
} from "../api/pairing.js";

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function requestedUrl() {
  return fetchMock.mock.calls[0][0];
}

describe("createPairing", () => {
  it("posts to the pairing endpoint with no body", async () => {
    await createPairing();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pairing/");
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
  });
});

describe("the offer and answer slots", () => {
  it("posts an offer's sdp as json", async () => {
    await postOffer("ABC123", "v=0 offer-body");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pairing/ABC123/offer/");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ sdp: "v=0 offer-body" });
  });

  it("fetches the offer with a plain GET", async () => {
    await fetchOffer("ABC123");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pairing/ABC123/offer/");
    expect(options.method).toBeUndefined();
  });

  it("posts an answer's sdp as json", async () => {
    await postAnswer("ABC123", "v=0 answer-body");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pairing/ABC123/answer/");
    expect(JSON.parse(options.body)).toEqual({ sdp: "v=0 answer-body" });
  });

  it("fetches the answer with a plain GET", async () => {
    await fetchAnswer("ABC123");

    expect(requestedUrl()).toBe("/api/pairing/ABC123/answer/");
  });

  it("encodes a code that needs it, rather than building an unsafe url", () => {
    fetchOffer("has a space");

    expect(requestedUrl()).toBe("/api/pairing/has%20a%20space/offer/");
  });
});

describe("endPairing", () => {
  it("deletes the pairing by code", async () => {
    await endPairing("ABC123");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/pairing/ABC123/");
    expect(options.method).toBe("DELETE");
  });
});

describe("isJoinPath", () => {
  it("recognises the patient's own entry point", () => {
    expect(isJoinPath("/join")).toBe(true);
    expect(isJoinPath("/join/")).toBe(true);
  });

  it("rejects every other route", () => {
    expect(isJoinPath("/")).toBe(false);
    expect(isJoinPath("/joining")).toBe(false);
    expect(isJoinPath("/p/abc123")).toBe(false);
    expect(isJoinPath("/join/extra")).toBe(false);
  });
});
