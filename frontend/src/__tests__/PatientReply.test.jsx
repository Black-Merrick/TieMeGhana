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

  it("says why nothing was spoken instead of doing nothing", async () => {
    // A Deaf patient cannot hear whether anything was spoken, so a silent no
    // op would leave them believing they had answered the doctor.
    const user = userEvent.setup();
    render(<PatientReply onReply={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(screen.getByTestId("empty-reply-warning")).toBeInTheDocument();
  });

  it("clears the warning once the patient starts typing", async () => {
    const user = userEvent.setup();
    render(<PatientReply onReply={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    await user.type(screen.getByLabelText(/type your answer/i), "y");

    expect(screen.queryByTestId("empty-reply-warning")).not.toBeInTheDocument();
  });

  it("marks the field itself as invalid, not only the message", async () => {
    // So the connection between the warning and the field is not left to the
    // reader, and a screen reader announces it with the field.
    const user = userEvent.setup();
    render(<PatientReply onReply={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    expect(screen.getByLabelText(/type your answer/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
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
