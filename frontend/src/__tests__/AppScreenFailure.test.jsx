import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBodyLocations, fetchCriticalAlerts } from "../api/clips.js";
import { closePairing, createPairing, endPairing, registerResume } from "../api/pairing.js";
import { saveDeviceMode } from "../pairing/deviceMode.js";
import { loadHostResume, saveHostResume } from "../pairing/resume.js";
import { saveDoctorRole } from "../pairing/role.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";
import { PeerState } from "../webrtc/peerChannel.js";
import usePeerChannel from "../hooks/usePeerChannel.js";
import App from "../App.jsx";

vi.mock("../hooks/usePeerChannel.js", () => ({ default: vi.fn() }));
vi.mock("../components/EmergencyTriage.jsx", () => ({
  default: () => {
    throw new Error("emergency fell over");
  },
}));
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

/**
 * A screen failing while a patient's phone is attached.
 *
 * Reported from real use: the doctor pressed Emergency, the page went blank,
 * and the phone was told the consultation had ended. A render error unmounted
 * the whole app, and with it the connection, which said "ended" on its way out.
 */

const TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA";
const send = vi.fn();

beforeEach(() => {
  localStorage.clear();
  send.mockClear();
  saveDoctorRole();
  saveDeviceMode("paired");
  saveLiteracyPath(LiteracyPath.LITERATE);
  saveHostResume(TOKEN);
  window.history.pushState({}, "", "/");
  usePeerChannel.mockReset().mockImplementation(() => ({
    state: PeerState.CONNECTED,
    send,
    close: vi.fn(),
    lastMessage: null,
  }));
  createPairing.mockResolvedValue({ code: "K7Q2XM" });
  endPairing.mockResolvedValue(null);
  registerResume.mockResolvedValue(null);
  closePairing.mockResolvedValue(null);
  fetchBodyLocations.mockResolvedValue([]);
  fetchCriticalAlerts.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
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
  vi.restoreAllMocks();
});

describe("the emergency screen failing in a paired visit", () => {
  async function pressEmergency() {
    render(<App />);
    await userEvent.click(await screen.findByTestId("enter-emergency"));
    return screen.findByTestId("screen-error", {}, { timeout: 5000 });
  }

  it("shows a message where the screen was, not a blank page", async () => {
    const message = await pressEmergency();

    expect(message).toBeInTheDocument();
    expect(screen.getByTestId("screen-error-message")).toHaveTextContent("emergency fell over");
    expect(screen.getByTestId("literacy-path")).toBeInTheDocument();
  });

  it("does not tell the phone the consultation has ended", async () => {
    await pressEmergency();

    expect(send).not.toHaveBeenCalledWith({ type: "ended" });
  });

  it("never sends the phone to an emergency screen the doctor's device could not open", async () => {
    // Otherwise the patient taps into a screen nobody is listening to.
    await pressEmergency();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "emergency", emergency: true }),
    );
  });

  it("keeps the connection and the way back for the phone", async () => {
    await pressEmergency();

    expect(closePairing).not.toHaveBeenCalled();
    expect(loadHostResume()).toBe(TOKEN);
  });

  it("lets the doctor leave it, and carry on with the consultation", async () => {
    await pressEmergency();

    await userEvent.click(screen.getByTestId("screen-error-back"));

    expect(await screen.findByRole("button", { name: /send to patient/i })).toBeInTheDocument();
    expect(screen.queryByTestId("screen-error")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "path", emergency: false })),
    );
    expect(send).not.toHaveBeenCalledWith({ type: "ended" });
  });
});
