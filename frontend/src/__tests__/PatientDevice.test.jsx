import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PatientDevice, { STALLED_AFTER_MS } from "../components/PatientDevice.jsx";
import { fetchBodyLocations } from "../api/clips.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBodyLocations: vi.fn() };
});

/**
 * The patient's phone between connecting and knowing which screen it is for.
 * The literacy answer is given after the connection exists, so the phone
 * learns its path from the doctor's device rather than deciding it.
 */

function channel(overrides = {}) {
  return { send: vi.fn(), lastMessage: null, state: "connected", ...overrides };
}

function caption() {
  return {
    source_language: "en",
    transcript: "Where is the pain?",
    caption: "Ɛhe na ɛyɛ yaw?",
    caption_language: "tw",
    caption_problem: "",
    language_provider: "khaya",
    sequence: {
      source_text: "Where is the pain?",
      segments: [],
      total_duration_ms: 0,
      fingerspelled_tokens: [],
      unavailable_tokens: [],
      omitted_tokens: [],
      blocking_tokens: [],
      back_translation: [],
      is_safe_to_show: true,
      needs_confirmation: false,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchBodyLocations.mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("before the doctor has chosen a path", () => {
  it("says it is connected and waiting, rather than showing a blank screen", () => {
    render(<PatientDevice channel={channel()} />);

    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();
  });

  it("shows neither consultation screen yet", () => {
    render(<PatientDevice channel={channel()} />);

    expect(screen.queryByTestId("stage-idle")).not.toBeInTheDocument();
  });
});

describe("once the doctor has chosen", () => {
  it("shows the guided screen for a guided path", async () => {
    render(
      <PatientDevice
        channel={channel({ lastMessage: { type: "path", path: "guided" } })}
      />,
    );

    expect(await screen.findByTestId("stage-idle")).toHaveTextContent(
      /waiting for the doctor to ask a question/i,
    );
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

  it("shows the reply screen for a literate path", async () => {
    render(
      <PatientDevice
        channel={channel({ lastMessage: { type: "path", path: "literate" } })}
      />,
    );

    expect(await screen.findByTestId("stage-idle")).toHaveTextContent(
      /you can also write to them now/i,
    );
    expect(screen.getByTestId("speak-to-doctor")).toBeInTheDocument();
  });

  it("learns the path from a question too, in case the path message was lost", async () => {
    // The connection hands a component only its newest message, so a path
    // sent in the same instant as a question can be replaced by it.
    render(
      <PatientDevice
        channel={channel({
          lastMessage: { type: "question", result: caption(), path: "literate" },
        })}
      />,
    );

    expect(await screen.findByTestId("caption")).toHaveTextContent("Ɛhe na ɛyɛ yaw?");
  });

  it("switches screens when the path arrives after waiting", async () => {
    const { rerender } = render(<PatientDevice channel={channel()} />);
    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();

    rerender(
      <PatientDevice
        channel={channel({ lastMessage: { type: "path", path: "literate" } })}
      />,
    );

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
  });
});

describe("a path it does not recognise", () => {
  it("keeps waiting rather than guessing which half of a consultation to show", () => {
    render(
      <PatientDevice
        channel={channel({ lastMessage: { type: "path", path: "telepathy" } })}
      />,
    );

    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-idle")).not.toBeInTheDocument();
  });

  it("ignores a path smuggled in on some other kind of message", () => {
    render(
      <PatientDevice
        channel={channel({ lastMessage: { type: "speaking", path: "literate" } })}
      />,
    );

    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();
  });
});

describe("the consultation ending before it began", () => {
  it("says so when the doctor ends it", () => {
    render(<PatientDevice channel={channel({ lastMessage: { type: "ended" } })} />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
  });

  it("says so when the join screen says it is over", () => {
    render(<PatientDevice channel={channel()} ended />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
  });

  it("offers the way to the next consultation", async () => {
    const onLeave = vi.fn();
    render(<PatientDevice channel={channel()} ended onLeave={onLeave} />);

    await userEvent.click(screen.getByTestId("join-another"));

    expect(onLeave).toHaveBeenCalled();
  });

  it("does not take a closed connection for the end: that is the join screen's call", () => {
    render(<PatientDevice channel={channel({ state: "closed" })} />);

    expect(screen.queryByTestId("pairing-ended")).not.toBeInTheDocument();
  });
});

describe("coming back after a reload", () => {
  it("goes straight to the screen it was on, from the remembered path", async () => {
    render(<PatientDevice channel={channel({ state: "connecting" })} path="literate" offline />);

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
    expect(screen.queryByTestId("patient-waiting")).not.toBeInTheDocument();
  });

  it("says it is reconnecting, above the consultation that stays on screen", async () => {
    render(<PatientDevice channel={channel({ state: "connecting" })} path="literate" offline />);

    expect(screen.getByTestId("patient-reconnecting-banner")).toBeInTheDocument();
    expect(await screen.findByTestId("stage-idle")).toBeInTheDocument();
  });

  it("says nothing of reconnecting once it is back", async () => {
    render(<PatientDevice channel={channel()} path="literate" />);

    await screen.findByTestId("speak-to-doctor");
    expect(screen.queryByTestId("patient-reconnecting-banner")).not.toBeInTheDocument();
  });

  it("holds the controls still while it is away", async () => {
    render(<PatientDevice channel={channel({ state: "connecting" })} path="literate" offline />);

    await screen.findByTestId("speak-to-doctor");
    expect(document.querySelector(".offline-lock")).toHaveAttribute("inert");
  });

  it("with no path remembered yet, just says it is reconnecting", () => {
    render(<PatientDevice channel={channel({ state: "connecting" })} offline />);

    expect(screen.getByTestId("patient-reconnecting")).toBeInTheDocument();
  });

  it("lets the patient give up waiting", async () => {
    const onLeave = vi.fn();
    render(
      <PatientDevice
        channel={channel({ state: "connecting" })}
        path="literate"
        offline
        onLeave={onLeave}
      />,
    );

    await userEvent.click(screen.getByTestId("leave-consultation"));

    expect(onLeave).toHaveBeenCalled();
  });

  it("ignores a remembered path it does not recognise", () => {
    render(<PatientDevice channel={channel()} path="telepathy" />);

    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();
  });

  it("shows the ended screen with the record for a consultation that ended while away", async () => {
    render(<PatientDevice channel={channel()} path="guided" ended />);

    expect(await screen.findByTestId("pairing-ended")).toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });
});

describe("when reconnecting is not working", () => {
  afterEach(() => vi.useRealTimers());

  it("says it is routine at first", () => {
    render(<PatientDevice channel={channel({ state: "connecting" })} path="literate" offline />);

    expect(screen.getByTestId("patient-reconnecting-text")).toHaveTextContent(
      /reconnecting to your doctor/i,
    );
    expect(screen.getByTestId("patient-reconnecting-banner")).not.toHaveAttribute("data-stalled");
  });

  it("stops saying so after a while, and says what to do", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <PatientDevice
        channel={channel({ state: "connecting" })}
        path="literate"
        offline
        onLeave={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS + 500);
    });

    const text = screen.getByTestId("patient-reconnecting-text");
    expect(text).toHaveTextContent(/still cannot reach your doctor/i);
    expect(text).toHaveTextContent(/new code/i);
    expect(screen.getByTestId("leave-consultation")).toBeInTheDocument();
  });
});
