import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import YesNoChoice from "../components/YesNoChoice.jsx";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

vi.mock("../feedback/vibration.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, vibrate: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("YesNoChoice", () => {
  it("offers exactly two options", () => {
    render(<YesNoChoice onChoose={vi.fn()} />);

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no")).toBeInTheDocument();
  });

  it("shows no visible text on either option", () => {
    // FR 2.1 requires icon based options with no text, because this control is
    // shown to patients who may not read print. A label that renders on screen
    // would defeat the entire purpose of the literacy check.
    render(<YesNoChoice onChoose={vi.fn()} />);

    expect(screen.getByTestId("choice-yes")).toHaveTextContent("");
    expect(screen.getByTestId("choice-no")).toHaveTextContent("");
  });

  it("still names each option for assistive technology", () => {
    // Read aloud rather than displayed, so this does not breach FR 2.1 while
    // keeping the control usable with a screen reader.
    render(<YesNoChoice onChoose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
  });

  it("reports a yes", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={onChoose} />);

    await user.click(screen.getByTestId("choice-yes"));

    expect(onChoose).toHaveBeenCalledWith(true);
  });

  it("reports a no", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={onChoose} />);

    await user.click(screen.getByTestId("choice-no"));

    expect(onChoose).toHaveBeenCalledWith(false);
  });

  it("fires the tap selection pattern from the shared vocabulary", async () => {
    // SRS section 6 defines one pattern for a registered tap. Using the named
    // constant rather than a literal is what stops a sixth pattern appearing.
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={vi.fn()} />);

    await user.click(screen.getByTestId("choice-yes"));

    expect(vibrate).toHaveBeenCalledWith(VibrationPattern.TAP_SELECTION);
  });

  it("highlights the chosen option", async () => {
    // Section 4.2 requires immediate, unambiguous visual confirmation, and
    // NFR 3 requires it to stand alone where the device cannot vibrate.
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={vi.fn()} />);

    await user.click(screen.getByTestId("choice-no"));

    expect(screen.getByTestId("choice-no")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("choice-yes")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("confirms visually even when the device cannot vibrate", async () => {
    vibrate.mockReturnValue(false);
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={vi.fn()} />);

    await user.click(screen.getByTestId("choice-yes"));

    expect(screen.getByTestId("choice-yes").className).toContain(
      "choice__option--chosen",
    );
  });

  it("accepts no taps while disabled", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<YesNoChoice onChoose={onChoose} disabled />);

    await user.click(screen.getByTestId("choice-yes"));

    expect(onChoose).not.toHaveBeenCalled();
  });
});
