import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import YesNoChoice from "../components/YesNoChoice.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { forgetYesNoSigns } from "../hooks/useYesNoSigns.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchClipByGloss: vi.fn() };
});

/**
 * Yes and No in Ghanaian Sign Language, where those signs have been filmed.
 *
 * A tick and a cross are a convention the patient has to already share. The
 * sign is their own language, and FR 2.1 asks the literacy check to put its
 * question without depending on text at all. The drawing stays as the fallback,
 * because a sign that is unfilmed or unapproved must leave the button exactly
 * as it was rather than empty.
 */

const clip = (gloss) => ({
  gloss,
  video_url: `/media/clips/${gloss.toLowerCase()}.mp4`,
  duration_ms: 3242,
});

beforeEach(() => {
  forgetYesNoSigns();
  fetchClipByGloss.mockImplementation(async (gloss) => clip(gloss));
});

afterEach(() => vi.clearAllMocks());

describe("showing the signs", () => {
  it("plays the YES and NO clips on the buttons", async () => {
    render(<YesNoChoice onChoose={vi.fn()} signed />);

    expect(await screen.findByTestId("choice-yes-sign")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no-sign")).toBeInTheDocument();
  });

  it("asks for them by gloss", async () => {
    render(<YesNoChoice onChoose={vi.fn()} signed />);

    await screen.findByTestId("choice-yes-sign");
    expect(fetchClipByGloss).toHaveBeenCalledWith("YES");
    expect(fetchClipByGloss).toHaveBeenCalledWith("NO");
  });

  it("keeps the words under the sign, so the clinician can read the button too", async () => {
    render(<YesNoChoice onChoose={vi.fn()} signed />);

    await screen.findByTestId("choice-yes-sign");
    expect(screen.getByTestId("choice-yes")).toHaveTextContent(/Yes/);
    expect(screen.getByTestId("choice-no")).toHaveTextContent(/Daabi/);
  });

  it("still answers when the sign is tapped", async () => {
    const onChoose = vi.fn();
    render(<YesNoChoice onChoose={onChoose} signed />);
    await screen.findByTestId("choice-yes-sign");

    await userEvent.click(screen.getByTestId("choice-yes"));

    expect(onChoose).toHaveBeenCalledWith(true);
  });

  it("fetches them once however many buttons are on screen", async () => {
    render(
      <>
        <YesNoChoice onChoose={vi.fn()} signed />
        <YesNoChoice onChoose={vi.fn()} signed />
      </>,
    );

    await waitFor(() => expect(screen.getAllByTestId("choice-yes-sign")).toHaveLength(2));
    expect(fetchClipByGloss).toHaveBeenCalledTimes(2);
  });
});

describe("when the sign is not there", () => {
  it("keeps the drawing when the clip is unfilmed or unapproved", async () => {
    // The API reports all of those as a 404, and the button must still work.
    fetchClipByGloss.mockRejectedValue(new Error("404"));
    const { container } = render(<YesNoChoice onChoose={vi.fn()} signed />);

    await waitFor(() => expect(fetchClipByGloss).toHaveBeenCalled());

    expect(screen.queryByTestId("choice-yes-sign")).not.toBeInTheDocument();
    expect(container.querySelector(".choice__option--yes > svg")).toBeInTheDocument();
  });

  it("keeps the drawing when only one of the two has been filmed", async () => {
    fetchClipByGloss.mockImplementation(async (gloss) => {
      if (gloss === "NO") throw new Error("404");
      return clip(gloss);
    });
    const { container } = render(<YesNoChoice onChoose={vi.fn()} signed />);

    expect(await screen.findByTestId("choice-yes-sign")).toBeInTheDocument();
    expect(screen.queryByTestId("choice-no-sign")).not.toBeInTheDocument();
    expect(container.querySelector(".choice__option--no > svg")).toBeInTheDocument();
  });

  it("answers as before with no signs at all", async () => {
    fetchClipByGloss.mockRejectedValue(new Error("404"));
    const onChoose = vi.fn();
    render(<YesNoChoice onChoose={onChoose} signed />);

    await userEvent.click(screen.getByTestId("choice-no"));

    expect(onChoose).toHaveBeenCalledWith(false);
  });
});

describe("where the question is not for a patient", () => {
  it("asks for nothing and shows the drawing", async () => {
    // The same control asks the doctor whether the patient has a phone. That
    // is an English question about logistics, not one to put in GhSL.
    const { container } = render(<YesNoChoice onChoose={vi.fn()} />);

    await waitFor(() => expect(fetchClipByGloss).not.toHaveBeenCalled());
    expect(screen.queryByTestId("choice-yes-sign")).not.toBeInTheDocument();
    expect(container.querySelector(".choice__option--yes > svg")).toBeInTheDocument();
  });
});
