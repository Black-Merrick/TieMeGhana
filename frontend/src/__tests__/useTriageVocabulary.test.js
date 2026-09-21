import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import useTriageVocabulary, { RETRY_DELAYS_MS } from "../hooks/useTriageVocabulary.js";

vi.mock("../api/clips.js", () => ({
  fetchCriticalAlerts: vi.fn(),
  fetchEmergencySpeech: vi.fn(),
}));

const ALERTS = [{ id: "CANNOT_BREATHE", english_text: "Cannot breathe" }];
const SPEECH = { phrases: [{ key: "HEAD", en: "I have a headache" }], pending_review: [] };

beforeEach(() => {
  vi.useFakeTimers();
  fetchEmergencySpeech.mockResolvedValue(SPEECH);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("what emergency triage can say", () => {
  it("is loaded once when it can be", async () => {
    fetchCriticalAlerts.mockResolvedValue(ALERTS);

    const { result } = renderHook(() => useTriageVocabulary());
    await flush();

    expect(result.current.alerts).toEqual(ALERTS);
    expect(result.current.phrases.byKey.HEAD.en).toBe("I have a headache");
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(fetchCriticalAlerts).toHaveBeenCalledTimes(1);
  });

  it("says the alerts are unavailable at once, and does not sit loading while it retries", async () => {
    fetchCriticalAlerts.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useTriageVocabulary());
    await flush();

    expect(result.current.alerts).toEqual([]);
  });

  it("asks again after a failure, and shows the alerts when they arrive", async () => {
    fetchCriticalAlerts.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(ALERTS);

    const { result } = renderHook(() => useTriageVocabulary());
    await flush();
    expect(result.current.alerts).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] + 10));

    expect(result.current.alerts).toEqual(ALERTS);
  });

  it("asks again for the phrases too, so a Twi speaking responder is not left on English", async () => {
    fetchCriticalAlerts.mockResolvedValue(ALERTS);
    fetchEmergencySpeech.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(SPEECH);

    const { result } = renderHook(() => useTriageVocabulary());
    await flush();
    expect(result.current.phrases.byKey).toEqual({});

    await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] + 10));

    expect(result.current.phrases.byKey.HEAD).toBeDefined();
  });

  it("gives up after a few tries, rather than hammering a server that is down", async () => {
    fetchCriticalAlerts.mockRejectedValue(new Error("down"));

    renderHook(() => useTriageVocabulary());
    await act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000));

    expect(fetchCriticalAlerts).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
  });

  it("stops asking once the screen is gone", async () => {
    fetchCriticalAlerts.mockRejectedValue(new Error("offline"));

    const { unmount } = renderHook(() => useTriageVocabulary());
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60000));

    expect(fetchCriticalAlerts).toHaveBeenCalledTimes(1);
  });

  it("does not treat a payload that is not a list as alerts", async () => {
    fetchCriticalAlerts.mockResolvedValue({ detail: "nope" });

    const { result } = renderHook(() => useTriageVocabulary());
    await flush();

    expect(result.current.alerts).toEqual([]);
  });
});
