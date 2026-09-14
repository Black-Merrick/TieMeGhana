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

  it("puts the icon first and never lets the label stand alone", () => {
    // FR 2.1 asked for no text at all. The label is here at the team's
    // direction, ADR 047, and what keeps it safe is that the icon always
    // exists and comes first: a patient who does not read acts on the mark,
    // not on the word beside it.
    render(<YesNoChoice onChoose={() => {}} />);

    for (const testId of ["choice-yes", "choice-no"]) {
      const option = screen.getByTestId(testId);
      const icon = option.querySelector("svg");

      expect(icon).not.toBeNull();
      // The icon precedes the label in the DOM, so it is also what a screen
      // reader and a keyboard user reach first.
      expect(icon.compareDocumentPosition(option.querySelector(".choice__label")))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("labels each option in English and Twi", () => {
    render(<YesNoChoice onChoose={() => {}} />);

    expect(screen.getByTestId("choice-yes")).toHaveTextContent("Aane");
    expect(screen.getByTestId("choice-no")).toHaveTextContent("Daabi");
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
