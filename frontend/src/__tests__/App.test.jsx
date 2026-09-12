import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { fetchBodyLocations } from "../api/clips.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn(),
    fetchBodyLocations: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.clear();
  fetchClipByGloss.mockResolvedValue({
    gloss: "CAN_YOU_READ_AND_WRITE",
    kind: "prompt",
    video_url: "/media/clips/prompt.webm",
    duration_ms: 3000,
  });
  fetchBodyLocations.mockResolvedValue([]);
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
