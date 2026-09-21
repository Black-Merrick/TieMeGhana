import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "../api/client.js";

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiRequest", () => {
  it("parses a JSON body from a successful response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await expect(apiRequest("/health/")).resolves.toEqual({ ok: true });
  });

  it("resolves to null for a 204 No Content, rather than trying to parse an empty body", async () => {
    // A real 204 carries no body at all, not even "null". Calling .json()
    // on it throws despite response.ok being true, which every caller here
    // trusts as "the request worked". Confirmed against a real Django
    // response, Content-Length: 0, while wiring up the pairing endpoints.
    const json = vi.fn(() => {
      throw new Error("body is empty, .json() should never be called");
    });
    fetchMock.mockResolvedValue({ ok: true, status: 204, json });

    await expect(apiRequest("/pairing/ABC123/")).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it("throws on a non 2xx response without touching the body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not found" }),
    });

    await expect(apiRequest("/pairing/GONE/offer/")).rejects.toThrow("404");
  });
});
