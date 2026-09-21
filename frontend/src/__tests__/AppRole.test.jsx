import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App.jsx";
import { fetchBodyLocations, fetchCriticalAlerts } from "../api/clips.js";
import { loadDeviceMode } from "../pairing/deviceMode.js";
import { loadRole, saveDoctorRole } from "../pairing/role.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";

vi.mock("../hooks/usePeerChannel.js", () => ({
  default: vi.fn(() => ({
    state: "connecting",
    send: vi.fn(),
    close: vi.fn(),
    lastMessage: null,
  })),
}));
vi.mock("../api/pairing.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPairing: vi.fn().mockResolvedValue({ code: "K7Q2XM" }),
    endPairing: vi.fn().mockResolvedValue(null),
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

const { createPairing } = await import("../api/pairing.js");

/**
 * The first screen of the app, and the two ways out of it. What this pins is
 * that a patient's phone has somewhere to go that is not the doctor's screen,
 * that a doctor is asked once and not once per patient, and that the patient's
 * page carries none of the doctor's controls.
 */

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
  fetchBodyLocations.mockResolvedValue([]);
  fetchCriticalAlerts.mockResolvedValue([]);
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
  window.history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a device that has not been chosen", () => {
  it("asks who is using it, before anything about a patient", async () => {
    render(<App />);

    expect(await screen.findByTestId("role-choice")).toBeInTheDocument();
    expect(screen.queryByTestId("device-choice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("goes on to the phone question when it is a doctor", async () => {
    render(<App />);

    await userEvent.click(await screen.findByTestId("role-doctor"));

    expect(await screen.findByTestId("device-choice")).toBeInTheDocument();
    expect(screen.queryByTestId("role-choice")).not.toBeInTheDocument();
  });

  it("remembers a doctor's device, so the question is not asked again", async () => {
    const { unmount } = render(<App />);
    await userEvent.click(await screen.findByTestId("role-doctor"));
    expect(loadRole()).toBe("doctor");
    unmount();

    render(<App />);

    expect(await screen.findByTestId("device-choice")).toBeInTheDocument();
    expect(screen.queryByTestId("role-choice")).not.toBeInTheDocument();
  });

  it("takes a patient to the page where the code is typed", async () => {
    render(<App />);

    await userEvent.click(await screen.findByTestId("role-patient"));

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/join");
  });

  it("does not remember a patient, or set a doctor's device up for them", async () => {
    render(<App />);

    await userEvent.click(await screen.findByTestId("role-patient"));
    await screen.findByTestId("pairing-join-form");

    expect(loadRole()).toBeNull();
    expect(loadDeviceMode()).toBeNull();
    expect(createPairing).not.toHaveBeenCalled();
  });
});

describe("the patient's page", () => {
  async function openAsPatient() {
    render(<App />);
    await userEvent.click(await screen.findByTestId("role-patient"));
    await screen.findByTestId("pairing-join-form");
  }

  it("has none of the doctor's controls", async () => {
    await openAsPatient();

    expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enter-prescription")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-patient")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legal-footer")).not.toBeInTheDocument();
  });

  it("still shows the app's name", async () => {
    await openAsPatient();

    expect(screen.getByRole("heading", { name: /tie me ghana/i })).toBeInTheDocument();
  });

  it("goes back to the first screen for someone who chose it by mistake", async () => {
    await openAsPatient();

    await userEvent.click(screen.getByTestId("join-leave"));

    expect(await screen.findByTestId("role-choice")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("goes back with the browser's own back button", async () => {
    await openAsPatient();

    window.history.back();

    expect(await screen.findByTestId("role-choice")).toBeInTheDocument();
  });

  it("opens straight onto the code form from a typed address", async () => {
    window.history.pushState({}, "", "/join");

    render(<App />);

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
    expect(screen.queryByTestId("role-choice")).not.toBeInTheDocument();
  });
});

describe("a doctor's device", () => {
  it("offers a patient who landed on it a way to join", async () => {
    saveDoctorRole();
    render(<App />);

    await userEvent.click(await screen.findByTestId("join-instead"));

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
  });

  it("is not asked who it is again when the next patient starts", async () => {
    saveDoctorRole();
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(await screen.findByTestId("new-patient"));

    expect(await screen.findByTestId("device-choice")).toBeInTheDocument();
    expect(screen.queryByTestId("role-choice")).not.toBeInTheDocument();
    expect(loadRole()).toBe("doctor");
  });

  it("is not asked at all in the middle of a visit begun before this existed", async () => {
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("literacy-path")).toBeInTheDocument());
    expect(screen.queryByTestId("role-choice")).not.toBeInTheDocument();
  });
});
