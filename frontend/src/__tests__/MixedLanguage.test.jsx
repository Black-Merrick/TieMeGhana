/**
 * The language controls on the doctor's panel.
 *
 * "Both" was offered here for a while, because code switching is how clinical
 * speech in Ghana actually works: much medical vocabulary has no Twi word and
 * a speaker moves between the two inside a sentence. It was removed from the
 * interface as one control too many to read mid consultation.
 *
 * The server still accepts a mixed declaration and the resolver and safety
 * gate still handle it, which backend tests cover. These only assert what a
 * clinician is actually offered.
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
  it("offers the two languages the app speaks", async () => {
    render(<DoctorUtteranceForm onSend={vi.fn()} />);

    const group = screen.getByTestId("doctor-language");
    expect(group).toHaveTextContent("English");
    expect(group).toHaveTextContent("Twi");
  });

  it("no longer offers Both", async () => {
    render(<DoctorUtteranceForm onSend={vi.fn()} />);

    expect(screen.queryByRole("radio", { name: "Both" })).toBeNull();
  });

  it("sends whichever language was chosen with the message", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<DoctorUtteranceForm onSend={onSend} />);

    await user.click(screen.getByRole("radio", { name: "Twi" }));
    await user.type(screen.getByLabelText(/message for the patient/i), "Bisa");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({ sourceLanguage: "tw", text: "Bisa" }),
    );
  });
});

describe("the microphone", () => {
  it("is available whichever language is chosen", async () => {
    // It used to be disabled while Both was selected, because speech
    // recognition handles one language at a time. With Both gone there is no
    // longer a selection that can turn it off.
    render(<DoctorUtteranceForm onSend={vi.fn()} />);
    expect(screen.getByTestId("microphone-button")).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Twi" }));

    expect(screen.getByTestId("microphone-button")).toBeEnabled();
    expect(screen.queryByTestId("microphone-mixed")).not.toBeInTheDocument();
  });
});

describe("the language answers are spoken in", () => {
  it("offers English and Twi, and nothing else", async () => {
    // It picks the voice, and there is no mixed voice: offering one would mean
    // choosing English or Twi behind the doctor's back.
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
