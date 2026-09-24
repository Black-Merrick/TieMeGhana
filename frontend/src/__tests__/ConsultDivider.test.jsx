import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultation from "../components/DoctorConsultation.jsx";
import DoctorConsultationHost from "../components/DoctorConsultationHost.jsx";
import GuidedInterrogation from "../components/GuidedInterrogation.jsx";
import GuidedInterrogationHost from "../components/GuidedInterrogationHost.jsx";
import { fetchBodyLocations } from "../api/clips.js";
import { forgetYesNoSigns } from "../hooks/useYesNoSigns.js";

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));
vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn().mockResolvedValue(null),
    fetchBodyLocations: vi.fn(),
  };
});

/**
 * The screen is divided only where two people are actually sharing it.
 *
 * In a paired visit the patient's half is on their own phone, so there is no
 * line to draw on the doctor's screen and a heading saying "Patient" over a
 * column the patient cannot see would be a lie about where they are.
 */

const channel = () => ({ send: vi.fn(), lastMessage: null, state: "connected" });

beforeEach(() => {
  localStorage.clear();
  forgetYesNoSigns();
  fetchBodyLocations.mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("on one shared device", () => {
  it("marks both halves in the literate consultation", () => {
    const { container } = render(<DoctorConsultation outputLanguage="en" />);

    expect(screen.getByTestId("side-doctor")).toBeInTheDocument();
    expect(screen.getByTestId("side-patient")).toBeInTheDocument();
    expect(container.querySelector(".consult--shared")).not.toBeNull();
  });

  it("marks both halves in guided interrogation", () => {
    const { container } = render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.getByTestId("side-doctor")).toBeInTheDocument();
    expect(screen.getByTestId("side-patient")).toBeInTheDocument();
    expect(container.querySelector(".consult--shared")).not.toBeNull();
  });

  it("puts the doctor's half before the patient's in the document", () => {
    // The stylesheet turns that into left and right on a wide screen, and
    // reverses it on a phone so the video is what opens.
    render(<DoctorConsultation outputLanguage="en" />);

    const marks = screen.getAllByTestId(/^side-/).map((el) => el.dataset.testid);
    expect(marks).toEqual(["side-doctor", "side-patient"]);
  });
});

describe("when the patient has their own phone", () => {
  it("draws no divide on the doctor's screen, for the literate path", () => {
    const { container } = render(
      <DoctorConsultationHost outputLanguage="en" channel={channel()} />,
    );

    expect(screen.queryByTestId("side-doctor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("side-patient")).not.toBeInTheDocument();
    expect(container.querySelector(".consult--shared")).toBeNull();
  });

  it("draws no divide for the guided path either", () => {
    const { container } = render(
      <GuidedInterrogationHost outputLanguage="en" channel={channel()} />,
    );

    expect(screen.queryByTestId("side-patient")).not.toBeInTheDocument();
    expect(container.querySelector(".consult--shared")).toBeNull();
  });
});
