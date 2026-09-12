import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PatientReply from "../components/PatientReply.jsx";

/** FR 3.1, how a patient who reads and writes answers back. */

describe("PatientReply", () => {
  it("lets the patient choose the language they are writing in", () => {
    // FR 3.1 allows English or Twi. Assuming one would make the other
    // patient's reply translate from the wrong source.
    render(<PatientReply onReply={vi.fn()} />);

    const group = within(screen.getByTestId("reply-language"));
    expect(group.getByRole("radio", { name: /english/i })).toBeInTheDocument();
    expect(group.getByRole("radio", { name: /twi/i })).toBeInTheDocument();
  });

  it("defaults to Twi, the patient's likely written language", () => {
    render(<PatientReply onReply={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /twi/i })).toBeChecked();
  });

  it("sends the typed reply with its language", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    render(<PatientReply onReply={onReply} />);

    await user.type(screen.getByLabelText(/type your answer/i), "me tiri yɛ me ya");
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(onReply).toHaveBeenCalledWith({
      text: "me tiri yɛ me ya",
      sourceLanguage: "tw",
    });
  });

  it("sends an English reply when the patient chooses English", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    render(<PatientReply onReply={onReply} />);

    await user.click(screen.getByRole("radio", { name: /english/i }));
    await user.type(screen.getByLabelText(/type your answer/i), "my head hurts");
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(onReply).toHaveBeenCalledWith({
      text: "my head hurts",
      sourceLanguage: "en",
    });
  });

  it("will not send an empty reply", async () => {
    const onReply = vi.fn();
    const user = userEvent.setup();
    render(<PatientReply onReply={onReply} />);

    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(onReply).not.toHaveBeenCalled();
  });

  it("clears the field after sending, ready for the next answer", async () => {
    const user = userEvent.setup();
    render(<PatientReply onReply={vi.fn()} />);
    const field = screen.getByLabelText(/type your answer/i);

    await user.type(field, "yes");
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(field).toHaveValue("");
  });
});
