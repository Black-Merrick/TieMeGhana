import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PatientDevice from "../components/PatientDevice.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { forgetYesNoSigns } from "../hooks/useYesNoSigns.js";
import { loadVisit } from "../visit/visit.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn(),
    fetchBodyLocations: vi.fn().mockResolvedValue([]),
    fetchCriticalAlerts: vi.fn().mockResolvedValue([]),
    fetchEmergencySpeech: vi.fn().mockResolvedValue({ phrases: [], pending_review: [] }),
  };
});

/**
 * The literacy question on the patient's own phone, FR 2.1.
 *
 * It is a question for the patient: whether they read. Asking it only on the
 * doctor's screen, across the room, is asking a Deaf patient to answer a
 * question they may not have been able to see. So the phone shows the same
 * question, and either device may answer it.
 */

const clip = (gloss) => ({
  gloss,
  video_url: `/media/clips/${gloss.toLowerCase()}.mp4`,
  duration_ms: 3242,
});

const send = vi.fn();
const channel = (lastMessage = null) => ({ send, lastMessage, state: "connected" });

function mount(first = null, props = {}) {
  const view = render(<PatientDevice channel={channel(first)} {...props} />);
  return {
    ...view,
    hear(message) {
      view.rerender(<PatientDevice channel={channel(message)} {...props} />);
    },
  };
}

const ASKED = { type: "literacy", resume: "k3Jx9_-Qm2LpV8wZr5TnYA" };

beforeEach(() => {
  localStorage.clear();
  forgetYesNoSigns();
  fetchClipByGloss.mockImplementation(async (gloss) => clip(gloss));
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("being asked on the phone", () => {
  it("shows the question instead of waiting for the doctor to begin", async () => {
    const view = mount();
    await screen.findByTestId("patient-waiting");

    view.hear(ASKED);

    expect(await screen.findByTestId("literacy-check")).toBeInTheDocument();
    expect(screen.queryByTestId("patient-waiting")).not.toBeInTheDocument();
  });

  it("shows the question as sign video", async () => {
    mount(ASKED);

    expect(await screen.findByTestId("literacy-prompt")).toBeInTheDocument();
  });

  it("offers Yes and No with their own signs", async () => {
    mount(ASKED);

    expect(await screen.findByTestId("choice-yes-sign")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no-sign")).toBeInTheDocument();
  });

  it("does not show the doctor's notice about unfilmed footage", async () => {
    // That notice is an instruction to staff, to ask in person. On the
    // patient's own phone it is words about them, to them, for no purpose.
    fetchClipByGloss.mockRejectedValue(new Error("404"));
    mount(ASKED);

    await waitFor(() => expect(screen.getByTestId("choice-yes")).toBeInTheDocument());
    expect(screen.queryByTestId("literacy-unavailable")).not.toBeInTheDocument();
  });
});

describe("answering on the phone", () => {
  it("sends the answer to the doctor's device", async () => {
    mount(ASKED);
    await screen.findByTestId("choice-yes");

    await userEvent.click(screen.getByTestId("choice-yes"));

    expect(send).toHaveBeenCalledWith({ type: "literacy-answer", value: true });
  });

  it("sends No the same way", async () => {
    mount(ASKED);
    await screen.findByTestId("choice-no");

    await userEvent.click(screen.getByTestId("choice-no"));

    expect(send).toHaveBeenCalledWith({ type: "literacy-answer", value: false });
  });

  it("writes no visit of its own, since the doctor's device owns it", async () => {
    // Two windows of one browser share storage while this is tested on a
    // laptop, and a visit written here would be the doctor's next patient.
    mount(ASKED);
    await screen.findByTestId("choice-yes");

    await userEvent.click(screen.getByTestId("choice-yes"));

    expect(loadVisit()).toBeNull();
  });

  it("says the answer is on its way, rather than sitting on the question", async () => {
    mount(ASKED);
    await screen.findByTestId("choice-yes");

    await userEvent.click(screen.getByTestId("choice-yes"));

    expect(await screen.findByTestId("literacy-answered")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("moves to the consultation when the doctor's device says which it is", async () => {
    const view = mount(ASKED);
    await screen.findByTestId("choice-yes");
    await userEvent.click(screen.getByTestId("choice-yes"));

    view.hear({ type: "path", path: "literate" });

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
  });
});

describe("when the doctor answers first", () => {
  it("takes the question off the phone", async () => {
    const view = mount(ASKED);
    await screen.findByTestId("literacy-check");

    view.hear({ type: "path", path: "guided" });

    await waitFor(() =>
      expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId("stage-idle")).toBeInTheDocument();
  });
});

describe("what it does not interrupt", () => {
  it("gives way to emergency mode", async () => {
    const view = mount(ASKED);
    await screen.findByTestId("literacy-check");

    view.hear({ type: "emergency", emergency: true });

    expect(await screen.findByTestId("emergency-triage-guest")).toBeInTheDocument();
  });

  it("is not shown once the consultation has ended", async () => {
    const view = mount(ASKED);
    await screen.findByTestId("literacy-check");

    view.hear({ type: "ended" });

    expect(await screen.findByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("is not shown before the doctor has asked", async () => {
    mount();

    expect(await screen.findByTestId("patient-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("is not shown to a phone already in a consultation", async () => {
    // A reconnecting phone is sent its path, not the question again.
    mount({ type: "path", path: "literate" });

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });
});
