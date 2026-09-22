import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EmergencyTriageGuest from "../components/EmergencyTriageGuest.jsx";
import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import { readTranscript } from "../transcript/transcript.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCriticalAlerts: vi.fn(), fetchEmergencySpeech: vi.fn() };
});

/**
 * Emergency triage on the patient's own phone. The doctor's device speaks the
 * taps; this screen sends them and shows, and lets the patient feel, how each
 * one is going.
 */

const ALERTS = [
  { id: "CANNOT_BREATHE", english_text: "Cannot breathe", icon: "breathing", is_playable: false, clip: null },
];
const PHRASES = {
  phrases: [
    { key: "CANNOT_BREATHE", en: "I cannot breathe", tw: "x", tw_reviewed: false },
    { key: "HEAD", en: "I have a headache", tw: "y", tw_reviewed: false },
  ],
  pending_review: [],
};

let lastMessage;
const send = vi.fn();
const channel = () => ({ send, lastMessage, state: "connected" });

function mount(props = {}) {
  const view = render(<EmergencyTriageGuest channel={channel()} {...props} />);
  return {
    ...view,
    hear(message) {
      lastMessage = message;
      view.rerender(<EmergencyTriageGuest channel={channel()} {...props} />);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  lastMessage = null;
  fetchCriticalAlerts.mockResolvedValue(ALERTS);
  fetchEmergencySpeech.mockResolvedValue(PHRASES);
  vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what the patient is offered", () => {
  it("is the doctor's emergency screen: alerts, pain scale and body", async () => {
    mount();

    expect(await screen.findByTestId("alert-CANNOT_BREATHE")).toBeInTheDocument();
    expect(screen.getByTestId("pain-scale")).toBeInTheDocument();
    expect(screen.getByTestId("body-part-HEAD")).toBeInTheDocument();
  });

  it("has nowhere to type, per FR 5.4", async () => {
    const { container } = mount();
    await screen.findByTestId("alert-CANNOT_BREATHE");

    expect(container.querySelector("input, textarea")).toBeNull();
  });

  it("has no voice choice and no way out: those are the doctor's", async () => {
    mount();
    await screen.findByTestId("alert-CANNOT_BREATHE");

    expect(screen.queryByTestId("triage-voice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("leave-emergency")).not.toBeInTheDocument();
  });

  it("still offers the pain scale and body when the alerts cannot load", async () => {
    fetchCriticalAlerts.mockRejectedValue(new Error("offline"));
    mount();

    expect(await screen.findByTestId("alerts-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("pain-level-3")).toBeInTheDocument();
    expect(screen.getByTestId("body-part-HEAD")).toBeInTheDocument();
  });
});

describe("a tap", () => {
  it("is sent to the doctor's device as which button it was", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("alert-CANNOT_BREATHE"));

    expect(send).toHaveBeenCalledWith({ type: "triage", kind: "alert", id: "CANNOT_BREATHE" });
  });

  it("sends a pain level and a body part the same way", async () => {
    mount();
    await screen.findByTestId("alert-CANNOT_BREATHE");

    await userEvent.click(screen.getByTestId("pain-level-4"));
    expect(send).toHaveBeenLastCalledWith({ type: "triage", kind: "pain", id: 4 });
  });

  it("is shown back at once as being sent, in the patient's own words", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("alert-CANNOT_BREATHE"));

    expect(screen.getByTestId("sent-reply-working")).toBeInTheDocument();
    expect(screen.getAllByText(/I cannot breathe/).length).toBeGreaterThan(0);
  });

  it("is kept in this phone's own record as the sentence it means", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("alert-CANNOT_BREATHE"));

    expect(readTranscript()).toEqual([
      expect.objectContaining({
        direction: "to_doctor",
        text: "I cannot breathe",
        answeredBy: "patient",
      }),
    ]);
  });

  it("is kept as the button's own words when the vocabulary did not load", async () => {
    fetchEmergencySpeech.mockRejectedValue(new Error("offline"));
    mount();
    await userEvent.click(await screen.findByTestId("pain-level-4"));

    expect(readTranscript()[0].text).toBe("Severe pain");
  });

  it("marks what was chosen", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("alert-CANNOT_BREATHE"));

    expect(screen.getByTestId("alert-CANNOT_BREATHE")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("following the doctor's device speaking it", () => {
  async function tapped() {
    const view = mount();
    await userEvent.click(await screen.findByTestId("alert-CANNOT_BREATHE"));
    return view;
  }

  it("covers the screen with the talking face while it is spoken, so a second tap cannot land", async () => {
    const view = await tapped();
    act(() => view.hear({ type: "speaking", status: "playing" }));

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("sent-reply-playing")).toBeInTheDocument();
  });

  it("vibrates when speech starts and when it ends", async () => {
    const view = await tapped();
    act(() => view.hear({ type: "speaking", status: "playing" }));
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 70, 40]);

    act(() => view.hear({ type: "speaking", status: "spoken" }));
    expect(navigator.vibrate).toHaveBeenCalledWith([220]);
  });

  it("says it was spoken, and offers it again", async () => {
    const view = await tapped();
    act(() => view.hear({ type: "speaking", status: "spoken" }));

    expect(screen.getByTestId("sent-reply-spoken")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("replay-answer"));
    expect(send).toHaveBeenLastCalledWith({ type: "replay" });
  });

  it("says so at once when it could not be spoken", async () => {
    const view = await tapped();
    act(() => view.hear({ type: "speaking", status: "failed" }));

    expect(screen.getByTestId("sent-reply-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
  });

  it("lets the patient stop it, which the doctor's device is told", async () => {
    const view = await tapped();
    act(() => view.hear({ type: "speaking", status: "playing" }));

    await userEvent.click(screen.getByTestId("stop-speaking"));

    expect(send).toHaveBeenLastCalledWith({ type: "stop" });
  });

  it("believes nothing about speech it did not ask for", async () => {
    const view = mount();
    await screen.findByTestId("alert-CANNOT_BREATHE");

    act(() => view.hear({ type: "speaking", status: "playing" }));

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-ready")).toBeInTheDocument();
  });
});

describe("while the doctor's device is being found again", () => {
  it("is shown, but cannot be tapped", async () => {
    mount({ offline: true });
    await screen.findByTestId("alert-CANNOT_BREATHE");

    expect(screen.getByTestId("alert-CANNOT_BREATHE")).toBeDisabled();
    expect(within(screen.getByTestId("pain-scale")).getByTestId("pain-level-1")).toBeDisabled();
    await waitFor(() => expect(send).not.toHaveBeenCalled());
  });
});
