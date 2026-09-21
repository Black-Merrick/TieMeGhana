import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBodyLocations, fetchCriticalAlerts } from "../api/clips.js";
import { closePairing, createPairing, endPairing, registerResume } from "../api/pairing.js";
import { fetchPlaylist } from "../api/prescriptions.js";
import { loadDeviceMode, saveDeviceMode } from "../pairing/deviceMode.js";
import { loadLastQuestion, saveLastQuestion } from "../pairing/lastQuestion.js";
import { loadHostResume, saveHostResume } from "../pairing/resume.js";
import { saveDoctorRole } from "../pairing/role.js";
import { loadScreen, saveScreen } from "../visit/screen.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";
import { PeerState } from "../webrtc/peerChannel.js";
import usePeerChannel from "../hooks/usePeerChannel.js";
import App from "../App.jsx";

vi.mock("../hooks/usePeerChannel.js", () => ({ default: vi.fn() }));
vi.mock("../api/pairing.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPairing: vi.fn(),
    endPairing: vi.fn(),
    registerResume: vi.fn(),
    closePairing: vi.fn(),
  };
});
vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn().mockResolvedValue(null),
    fetchBodyLocations: vi.fn(),
    fetchCriticalAlerts: vi.fn(),
  };
});
vi.mock("../api/prescriptions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchPlaylist: vi.fn() };
});

/**
 * Two device mode, seen from the doctor's app: the question that opens every
 * visit, and what having a patient's phone attached does to the rest of it.
 * The peer connection itself is faked here (its own tests cover it), so what
 * is pinned is App's wiring: when a code is asked for, what is shown at each
 * stage, and above all that the connection outlives every screen a doctor
 * can open and ends only with the visit.
 */

const send = vi.fn();
const close = vi.fn();
let connection;

beforeEach(() => {
  // Cleared here as well as after each test: the previous test's screen is
  // unmounted, and so sends "ended", after this file's own afterEach has run.
  send.mockClear();
  close.mockClear();
  localStorage.clear();
  saveDoctorRole();
  window.history.pushState({}, "", "/");
  connection = PeerState.CONNECTING;
  usePeerChannel.mockReset().mockImplementation(() => ({
    state: connection,
    send,
    close,
    lastMessage: null,
  }));
  createPairing.mockResolvedValue({ code: "K7Q2XM" });
  endPairing.mockResolvedValue(null);
  registerResume.mockResolvedValue(null);
  closePairing.mockResolvedValue(null);
  fetchBodyLocations.mockResolvedValue([]);
  fetchCriticalAlerts.mockResolvedValue([]);
  fetchPlaylist.mockResolvedValue({
    reference: "ref",
    items: [],
    is_fully_signable: true,
    unsignable_positions: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", database: "ok", migrations: "ok" }),
    }),
  );
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function answerPhoneQuestion(hasPhone, user = userEvent.setup()) {
  await waitFor(() => screen.getByTestId("device-choice"));
  await user.click(
    within(screen.getByTestId("device-choice")).getByTestId(
      hasPhone ? "choice-yes" : "choice-no",
    ),
  );
  return user;
}

describe("answering that the patient has their own phone", () => {
  it("shows a pairing code rather than the literacy check", async () => {
    render(<App />);
    await answerPhoneQuestion(true);

    expect(await screen.findByTestId("pairing-code")).toHaveTextContent("K7Q2XM");
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("remembers the answer, so a reload does not ask again", async () => {
    render(<App />);
    await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");

    expect(loadDeviceMode()).toBe("paired");
  });

  it("goes on to the literacy check once the phone has connected", async () => {
    const { rerender } = render(<App />);
    await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");

    connection = PeerState.CONNECTED;
    rerender(<App />);

    expect(await screen.findByTestId("literacy-check")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-host-waiting")).not.toBeInTheDocument();
  });

  it("puts the patient's half on their phone, for the literate path", async () => {
    const { rerender } = render(<App />);
    const user = await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");
    connection = PeerState.CONNECTED;
    rerender(<App />);
    await screen.findByTestId("literacy-check");

    await user.click(screen.getByTestId("choice-yes"));

    expect(await screen.findByTestId("replying-on-patient-phone")).toBeInTheDocument();
    expect(screen.queryByTestId("speak-to-doctor")).not.toBeInTheDocument();
  });

  it("puts the patient's half on their phone, for the guided path", async () => {
    const { rerender } = render(<App />);
    const user = await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");
    connection = PeerState.CONNECTED;
    rerender(<App />);
    await screen.findByTestId("literacy-check");

    await user.click(screen.getByTestId("choice-no"));

    expect(await screen.findByTestId("ask-where-it-hurts")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-yes")).not.toBeInTheDocument();
  });

  it("tells the phone which screen it is for once the path is chosen", async () => {
    const { rerender } = render(<App />);
    const user = await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");
    connection = PeerState.CONNECTED;
    rerender(<App />);
    await screen.findByTestId("literacy-check");
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "path" }));

    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "path", path: "literate" }),
      ),
    );
  });

  it("lets the doctor give up on pairing and use this device", async () => {
    render(<App />);
    const user = await answerPhoneQuestion(true);
    await screen.findByTestId("pairing-code");

    await user.click(screen.getByTestId("pairing-use-this-device"));

    expect(await screen.findByTestId("literacy-check")).toBeInTheDocument();
    expect(loadDeviceMode()).toBe("shared");
  });
});

describe("answering that the patient shares this device", () => {
  it("asks for no code and opens no connection", async () => {
    render(<App />);
    await answerPhoneQuestion(false);

    expect(await screen.findByTestId("literacy-check")).toBeInTheDocument();
    expect(createPairing).not.toHaveBeenCalled();
    expect(usePeerChannel).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: expect.any(String) }),
    );
  });
});

describe("a paired visit, once under way", () => {
  async function pairedVisit(path = LiteracyPath.GUIDED) {
    saveDeviceMode("paired");
    saveLiteracyPath(path);
    connection = PeerState.CONNECTED;
    render(<App />);
    await screen.findByTestId("literacy-path");
    await waitFor(() => expect(createPairing).toHaveBeenCalled());
  }

  it("is not disturbed by opening the prescription", async () => {
    // Prescription replaces the consultation on screen. If the connection
    // lived inside the consultation this would tell the patient's phone the
    // visit was over, when the doctor had only turned to another screen.
    await pairedVisit();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("enter-prescription"));
    await waitFor(() =>
      expect(screen.queryByTestId("ask-where-it-hurts")).not.toBeInTheDocument(),
    );

    expect(send).not.toHaveBeenCalledWith({ type: "ended" });
    expect(close).not.toHaveBeenCalled();
    expect(usePeerChannel).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "K7Q2XM" }),
    );
  });

  it("is not disturbed by opening emergency mode either", async () => {
    await pairedVisit();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("enter-emergency"));
    await waitFor(() =>
      expect(screen.queryByTestId("ask-where-it-hurts")).not.toBeInTheDocument(),
    );

    expect(send).not.toHaveBeenCalledWith({ type: "ended" });
    expect(usePeerChannel).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "K7Q2XM" }),
    );
  });

  it("ends only when the next patient starts, and says so to the phone", async () => {
    await pairedVisit();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("new-patient"));

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "ended" }));
    expect(loadDeviceMode()).toBeNull();
  });

  it("asks the next patient about their phone afresh", async () => {
    await pairedVisit();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("new-patient"));

    expect(await screen.findByTestId("device-choice")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-code")).not.toBeInTheDocument();
  });
});

describe("reloading a paired visit", () => {
  it("does not pretend the patient's phone is still there", async () => {
    // A reload drops the direct connection. Falling back to the shared
    // device screen would leave the phone showing a stale question while the
    // doctor believed they were talking to it.
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.LITERATE);

    render(<App />);

    expect(await screen.findByTestId("pairing-host-waiting")).toHaveTextContent(
      /reconnect the patient's phone/i,
    );
    expect(screen.queryByTestId("replying-on-patient-phone")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send to patient/i })).not.toBeInTheDocument();
  });

  it("offers a fresh code, and the shared device as the way out", async () => {
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);
    await screen.findByTestId("pairing-code");

    expect(screen.getByTestId("pairing-use-this-device")).toBeInTheDocument();
    expect(createPairing).toHaveBeenCalledTimes(1);
  });

  it("carries on as a shared visit when the doctor chooses to", async () => {
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.LITERATE);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("pairing-host-waiting");

    await user.click(screen.getByTestId("pairing-use-this-device"));

    expect(
      await screen.findByRole("button", { name: /send to patient/i }),
    ).toBeInTheDocument();
  });
});

describe("a visit begun before pairing existed", () => {
  it("is treated as a shared device visit, with no code asked for", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /send to patient/i }),
    ).toBeInTheDocument();
    expect(createPairing).not.toHaveBeenCalled();
  });
});

describe("the patient's own phone, at /join", () => {
  it("never mints a code, even in a browser that holds a paired answer", async () => {
    // Testing on one laptop puts both roles in browsers that can share
    // storage. The phone's page must not act as a doctor's.
    saveDeviceMode("paired");
    window.history.pushState({}, "", "/join");

    render(<App />);

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
    expect(createPairing).not.toHaveBeenCalled();
    expect(endPairing).not.toHaveBeenCalled();
  });
});

const TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA";

describe("a reload in the middle of a paired visit", () => {
  beforeEach(() => {
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveHostResume(TOKEN);
  });

  it("stays on the consultation instead of asking to pair again", async () => {
    render(<App />);

    expect(await screen.findByTestId("replying-on-patient-phone")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-host-waiting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pairing-code")).not.toBeInTheDocument();
  });

  it("goes back to the way it remembered and mints no new code", async () => {
    render(<App />);

    await waitFor(() => expect(registerResume).toHaveBeenCalledWith(TOKEN));
    expect(createPairing).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(usePeerChannel).toHaveBeenCalledWith(
        expect.objectContaining({ role: "host", code: TOKEN }),
      ),
    );
  });

  it("says the patient's phone is away, and that it will rejoin by itself", async () => {
    render(<App />);

    expect(await screen.findByTestId("patient-away")).toHaveTextContent(/rejoin by itself/i);
  });

  it("does not say so once the phone is back", async () => {
    connection = PeerState.CONNECTED;
    render(<App />);

    await screen.findByTestId("replying-on-patient-phone");
    expect(screen.queryByTestId("patient-away")).not.toBeInTheDocument();
  });

  it("never puts the way back on screen: it is a secret onto the consultation", async () => {
    const { container } = render(<App />);
    await screen.findByTestId("patient-away");

    expect(container.textContent).not.toContain(TOKEN);
  });

  it("lets the doctor give up on the old phone and pair a new one", async () => {
    createPairing.mockResolvedValue({ code: "NEW123" });
    render(<App />);

    await userEvent.click(await screen.findByTestId("patient-away-new-code"));

    expect(closePairing).toHaveBeenCalledWith(TOKEN);
    expect(loadHostResume()).toBeNull();
    expect(await screen.findByTestId("pairing-code")).toHaveTextContent("NEW123");
  });

  it("tells the phone which screen it is for, gives it the way back, and shows it the last question again", async () => {
    saveLastQuestion({
      type: "question",
      path: "literate",
      result: { transcript: "Where does it hurt?", caption: "x", sequence: { segments: [] } },
    });
    connection = PeerState.CONNECTED;

    render(<App />);

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "path", path: "literate", resume: TOKEN }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "question", resent: true, resume: TOKEN, path: "literate" }),
    );
  });

  it("sends the path before the question, so the question is the last thing the phone reads", async () => {
    saveLastQuestion({ type: "question", path: "literate", result: { transcript: "x" } });
    connection = PeerState.CONNECTED;

    render(<App />);

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "question", resent: true })),
    );
    const types = send.mock.calls.map(([message]) => message.type).filter((type) => type !== "ended");
    expect(types.indexOf("path")).toBeLessThan(types.indexOf("question"));
  });

  it("sends nothing about a question when there was none", async () => {
    connection = PeerState.CONNECTED;

    render(<App />);

    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "path" })));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "question" }));
  });
});

describe("a reload before the literacy question was answered", () => {
  it("waits for the phone to rejoin, and shows no code to type", async () => {
    saveDeviceMode("paired");
    saveHostResume(TOKEN);

    const { container } = render(<App />);

    expect(await screen.findByTestId("pairing-resuming")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-code")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(TOKEN);
  });

  it("gives the phone its way back as soon as it is connected, before any path exists", async () => {
    saveDeviceMode("paired");
    saveHostResume(TOKEN);
    connection = PeerState.CONNECTED;

    render(<App />);

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "resume", resume: TOKEN }));
  });
});

describe("ending the visit", () => {
  it("closes the rendezvous and forgets the way back and the last question", async () => {
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveHostResume(TOKEN);
    saveLastQuestion({ type: "question", path: "literate", result: { transcript: "x" } });
    render(<App />);

    await userEvent.click(await screen.findByTestId("new-patient"));

    await waitFor(() => expect(closePairing).toHaveBeenCalledWith(TOKEN));
    expect(loadHostResume()).toBeNull();
    expect(loadLastQuestion()).toBeNull();
  });

  it("does not close it merely because the page went away", async () => {
    saveDeviceMode("paired");
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveHostResume(TOKEN);
    const { unmount } = render(<App />);
    await screen.findByTestId("patient-away");

    unmount();

    expect(closePairing).not.toHaveBeenCalled();
    expect(loadHostResume()).toBe(TOKEN);
  });
});

describe("a reload on the emergency or prescription screen", () => {
  it("comes back to emergency triage", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveScreen("emergency");

    render(<App />);

    expect(await screen.findByTestId("emergency-triage")).toBeInTheDocument();
  });

  it("remembers opening it", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(await screen.findByTestId("enter-emergency"));

    expect(loadScreen()).toBe("emergency");
  });

  it("forgets it when it is left", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveScreen("emergency");
    render(<App />);

    await userEvent.click(await screen.findByTestId("leave-emergency"));

    expect(loadScreen()).toBeNull();
  });

  it("comes back to the prescription builder", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveScreen("prescription");

    render(<App />);

    expect(await screen.findByTestId("prescription-builder")).toBeInTheDocument();
  });

  it("does not open the prescription builder for a visit that no longer exists", async () => {
    saveScreen("prescription");

    render(<App />);

    await screen.findByTestId("device-choice");
    expect(screen.queryByTestId("prescription-builder")).not.toBeInTheDocument();
  });

  it("forgets the screen when the next patient starts", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    saveScreen("prescription");
    render(<App />);

    await userEvent.click(await screen.findByTestId("new-patient"));

    expect(loadScreen()).toBeNull();
  });
});
