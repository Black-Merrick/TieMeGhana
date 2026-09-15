/**
 * Speaking both languages at once, and choosing a voice in emergency mode.
 *
 * Code switching is how clinical speech in Ghana actually works: much medical
 * vocabulary has no Twi word, plenty of Twi has no single English one, and a
 * speaker moves between them inside a sentence. Forcing a choice made the
 * doctor declare something untrue, and the translator acted on it confidently.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorUtteranceForm from "../components/DoctorUtteranceForm.jsx";

vi.mock("../hooks/useAudioRecorder.js", () => ({
  default: () => ({
    status: "idle",
    support: "supported",
    isSupported: true,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

let user;

beforeEach(() => {
  user = userEvent.setup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the doctor's input language", () => {
  it("offers both languages together", async () => {
    render(<DoctorUtteranceForm onSend={vi.fn()} />);

    const group = screen.getByTestId("doctor-language");
    expect(group).toHaveTextContent("English");
    expect(group).toHaveTextContent("Twi");
    expect(group).toHaveTextContent("Both");
  });

  it("sends the mixed declaration with the message", async () => {
    // The backend needs to know not to translate. Sending "en" for a mixed
    // sentence is what produced fluent, wrong Twi.
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<DoctorUtteranceForm onSend={onSend} />);

    await user.click(screen.getByRole("radio", { name: "Both" }));
    await user.type(
      screen.getByLabelText(/message for the patient/i),
      "Take two tablet after food",
    );
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({
        sourceLanguage: "mixed",
        text: "Take two tablet after food",
      }),
    );
  });
});

describe("the microphone while both languages are selected", () => {
  it("is disabled, because recognition handles one language at a time", async () => {
    render(<DoctorUtteranceForm onSend={vi.fn()} />);
    expect(screen.getByTestId("microphone-button")).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Both" }));

    expect(screen.getByTestId("microphone-button")).toBeDisabled();
  });

  it("says why, and what to do instead", async () => {
    // A greyed out control with no reason beside it is the thing people file
    // bugs about. Mid consultation the alternative has to be in the same
    // glance.
    render(<DoctorUtteranceForm onSend={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: "Both" }));

    const note = screen.getByTestId("microphone-mixed");
    expect(note).toHaveTextContent(/one language at a time/i);
    expect(note).toHaveTextContent(/type the message/i);
  });

  it("comes back when a single language is chosen again", async () => {
    render(<DoctorUtteranceForm onSend={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: "Both" }));
    await user.click(screen.getByRole("radio", { name: "Twi" }));

    expect(screen.getByTestId("microphone-button")).toBeEnabled();
    expect(screen.queryByTestId("microphone-mixed")).not.toBeInTheDocument();
  });
});

describe("the language answers are spoken in", () => {
  it("does not offer a mixed voice", async () => {
    // This picks the voice, and there is no mixed voice. Offering one would
    // mean choosing English or Twi behind the doctor's back and reporting
    // whichever was chosen as though they had asked for it.
    render(
      <DoctorUtteranceForm
        onSend={vi.fn()}
        outputLanguage="en"
        onOutputLanguageChange={vi.fn()}
      />,
    );

    const group = screen.getByTestId("output-language");
    expect(group).toHaveTextContent("English");
    expect(group).toHaveTextContent("Twi");
    expect(group).not.toHaveTextContent("Both");
  });
});
