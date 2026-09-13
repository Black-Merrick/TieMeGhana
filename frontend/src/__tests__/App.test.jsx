import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { fetchBodyLocations, fetchCriticalAlerts } from "../api/clips.js";
import { fetchPlaylist } from "../api/prescriptions.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn(),
    fetchBodyLocations: vi.fn(),
    fetchCriticalAlerts: vi.fn(),
  };
});

vi.mock("../api/prescriptions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchPlaylist: vi.fn() };
});

beforeEach(() => {
  localStorage.clear();
  // Every test starts on the app's own route. A leaked prescription path would
  // replace the whole consultation screen and fail in a way that looks
  // unrelated to whichever test left it behind.
  window.history.pushState({}, "", "/");
  fetchPlaylist.mockResolvedValue({
    reference: "ref",
    items: [],
    is_fully_signable: true,
    unsignable_positions: [],
  });
  fetchClipByGloss.mockResolvedValue({
    gloss: "CAN_YOU_READ_AND_WRITE",
    kind: "prompt",
    video_url: "/media/clips/prompt.webm",
    duration_ms: 3000,
  });
  fetchBodyLocations.mockResolvedValue([]);
  fetchCriticalAlerts.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", database: "ok" }),
    }),
  );
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("connection status", () => {
  it("reports a connected system when the health check succeeds", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveTextContent(
        "Connected to the hospital system",
      );
    });
  });

  it("falls back to an offline message when the API is unreachable", async () => {
    // NFR 5, the app must stay usable under intermittent connectivity, so a
    // failed health check has to degrade visibly rather than hang on checking.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveTextContent(
        "Offline, cached content only",
      );
    });
  });
});

describe("routing by literacy path", () => {
  it("asks the literacy question before anything else", async () => {
    // FR 2.1. Nothing about the consultation may start until the patient has
    // been routed, because assuming either path breaks the app for the people
    // it exists to serve.
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("literacy-check")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/message for the patient/i)).not.toBeInTheDocument();
  });

  it("shows the captioning flow to a patient who reads", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send to patient/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ask-where-it-hurts")).not.toBeInTheDocument();
  });

  it("never shows typed captions to a patient who does not read", async () => {
    // The single most important routing rule in the app. Falling through to
    // captions here would silently break accessibility for exactly the
    // patients the literacy check exists to protect.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("ask-where-it-hurts")).toBeInTheDocument();
    });
    // The doctor asks in their own words on both paths, so the distinguishing
    // thing is the patient's side: Guided Interrogation offers them yes or no
    // and never a caption to read back or a field to type into.
    expect(
      screen.getByRole("button", { name: /ask the patient/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send to patient/i }),
    ).not.toBeInTheDocument();
  });

  it("routes straight after the patient answers, without a reload", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send to patient/i }),
      ).toBeInTheDocument();
    });
  });
});

describe("the visit bar", () => {
  it("keeps the patient's path visible rather than in a settings menu", async () => {
    // Section 4.1, Visibility.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("literacy-path")).toHaveTextContent(
        "Guided Interrogation",
      );
    });
  });

  it("shows no path indicator before the patient has answered", async () => {
    render(<App />);

    await waitFor(() => screen.getByTestId("literacy-check"));
    expect(screen.queryByTestId("literacy-path")).not.toBeInTheDocument();
  });

  it("asks the next patient fresh when the visit is ended", async () => {
    // The control that stops one patient's literacy answer being applied to
    // the next person handed the same device.
    saveLiteracyPath(LiteracyPath.LITERATE);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    await waitFor(() => {
      expect(screen.getByTestId("literacy-check")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /send to patient/i }),
    ).not.toBeInTheDocument();
  });
});


describe("the spoken output language", () => {
  it("keeps the listener's language on screen, not in a settings menu", async () => {
    // Section 4.1 names this specifically as something that must always be
    // visible, because it decides whether the doctor understands anything.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("output-language")).toBeInTheDocument();
    });
  });

  it("defaults to English", async () => {
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => screen.getByTestId("output-language"));
    const group = within(screen.getByTestId("output-language"));
    expect(group.getByRole("radio", { name: /english/i })).toBeChecked();
  });

  it("keeps the choice for the rest of the visit", async () => {
    // FR 3.4 sets it once per session, so it has to survive a reload rather
    // than being asked again for every answer.
    saveLiteracyPath(LiteracyPath.GUIDED);
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await waitFor(() => screen.getByTestId("output-language"));
    await user.click(
      within(screen.getByTestId("output-language")).getByRole("radio", {
        name: /twi/i,
      }),
    );
    unmount();

    render(<App />);
    await waitFor(() => screen.getByTestId("output-language"));
    expect(
      within(screen.getByTestId("output-language")).getByRole("radio", {
        name: /twi/i,
      }),
    ).toBeChecked();
  });

  it("shows no language toggle before a patient has been routed", async () => {
    render(<App />);

    await waitFor(() => screen.getByTestId("literacy-check"));
    expect(screen.queryByTestId("output-language")).not.toBeInTheDocument();
  });
});


describe("the transcript and the shared device", () => {
  it("destroys the record when the visit ends", async () => {
    // The most important privacy property in the app. This device is handed
    // from one patient to the next, and these consultations are about
    // pregnancy, sexually transmitted infections, and HIV status. Leaving one
    // behind for a stranger to read is the precise harm the project exists to
    // prevent. ADR 026.
    const { appendEntry, Direction, readTranscript } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "I am HIV positive" });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    expect(readTranscript()).toEqual([]);
  });

  it("shows the next patient nothing from the previous consultation", async () => {
    const { appendEntry, Direction } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "I am HIV positive" });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    await waitFor(() => screen.getByTestId("literacy-check"));
    expect(screen.queryByText(/HIV positive/i)).not.toBeInTheDocument();
  });

  it("keeps the record across a reload within the same visit", async () => {
    // A patient who reloads mid consultation must not lose what has been said,
    // which is the other half of FR 4.2: stored on the device, and actually
    // stored rather than held in memory.
    const { appendEntry, Direction } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("transcript-list")).toHaveTextContent("Yes");
    });
  });
});


describe("the exchange and the shared device", () => {
  it("does not leave the previous patient's question waiting for the next", async () => {
    // ADR 032 keeps the question across a reload, which makes it all the more
    // important that ending the visit removes it.
    const { saveCurrentExchange, loadCurrentExchange } = await import(
      "../consultation/currentExchange.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    saveCurrentExchange({
      caption: {
        transcript: "Are you pregnant?",
        caption: "Wo yɛ nyinsɛn?",
        sequence: {
          segments: [],
          fingerspelled_tokens: [],
          unavailable_tokens: [],
          omitted_tokens: [],
          blocking_tokens: [],
          back_translation: [],
          is_safe_to_show: true,
          needs_confirmation: false,
          total_duration_ms: 0,
        },
      },
    });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    expect(loadCurrentExchange()).toBeNull();
  });
});

describe("emergency triage is reachable, FR 5", () => {
  it("can be entered before the literacy question has been answered", async () => {
    // The reason this sits outside the visit. FR 5 is for a patient who may
    // have arrived after an accident, and asking whether they read before
    // letting them say they cannot breathe would be the wrong order.
    // See ADR 040.
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    expect(screen.getByTestId("emergency-triage")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("can be entered in the middle of a consultation", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    expect(screen.getByTestId("emergency-triage")).toBeInTheDocument();
  });

  it("returns to where the patient was when emergency mode is left", async () => {
    // A patient who taps Emergency by mistake, or whose emergency is dealt
    // with, must not lose the consultation they were part way through.
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));
    await userEvent.click(screen.getByTestId("leave-emergency"));

    expect(screen.queryByTestId("emergency-triage")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/message for the patient/i)).toBeInTheDocument();
  });

  it("hides the entry button while already in emergency mode", async () => {
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
  });
});

describe("a scanned prescription link, FR 6.3 and FR 6.4", () => {
  it("opens the prescription and nothing else", async () => {
    // This is the patient's own phone at home, not a hospital device. It must
    // not be shown a consultation shell, a literacy question, or any route
    // back into a visit.
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-patient")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connection-status")).not.toBeInTheDocument();
  });

  it("opens the prescription even mid consultation on the same device", async () => {
    // The reference in the URL decides, not what happens to be in
    // localStorage. A patient scanning at home may be on a phone that once
    // ran a consultation.
    saveLiteracyPath(LiteracyPath.LITERATE);
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
  });

  it("does not check the hospital connection on the patient's phone", async () => {
    // FR 6.2 means this screen is expected to work offline. Telling the
    // patient the hospital system is unreachable would be alarming and
    // irrelevant.
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.anything(),
    );
  });
});

describe("the prescription builder, FR 6.1", () => {
  it("is offered once a visit is under way", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-prescription"));

    expect(screen.getByTestId("prescription-builder")).toBeInTheDocument();
  });

  it("is not offered before there is a patient", async () => {
    // Unlike emergency mode. A prescription is the last thing that happens in
    // a consultation, so there is always a visit by the time it is wanted, and
    // offering it first would put a doctor's form in front of a patient who
    // has not been asked anything yet.
    render(<App />);

    expect(screen.queryByTestId("enter-prescription")).not.toBeInTheDocument();
  });

  it("returns to the consultation when cancelled", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-prescription"));
    await userEvent.click(screen.getByTestId("leave-prescription"));

    expect(screen.queryByTestId("prescription-builder")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/message for the patient/i)).toBeInTheDocument();
  });
});
