import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignSequencePlayer from "../components/SignSequencePlayer.jsx";

/**
 * The stage takes the shape of the clip in it.
 *
 * The footage is filmed on a phone held upright, 406 by 720. A stage fixed at
 * 4 by 3 put that in a letterbox, so the signer was a narrow strip in a black
 * rectangle; the emergency cards cropped it instead, which took the head and
 * the hands and left a torso. Reported from real use, on both screens.
 */

function sequence(overrides = {}) {
  return {
    source_text: "morning",
    segments: [
      {
        token: "morning",
        match: "gloss",
        clips: [
          { gloss: "MORNING", video_url: "/media/clips/morning.mp4", duration_ms: 4278 },
        ],
      },
    ],
    total_duration_ms: 4278,
    stitched_video_url: null,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
    omitted_tokens: [],
    blocking_tokens: [],
    back_translation: ["MORNING"],
    is_safe_to_show: true,
    needs_confirmation: false,
    ...overrides,
  };
}

const stageOf = (container) => container.querySelector(".player__stage");

function reportDimensions(video, width, height) {
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  fireEvent.loadedMetadata(video);
}

describe("the shape of the stage", () => {
  it("leaves it to the stylesheet until the clip says what shape it is", () => {
    const { container } = render(<SignSequencePlayer sequence={sequence()} />);

    expect(stageOf(container).style.getPropertyValue("--clip-shape")).toBe("");
  });

  it("takes the clip's own shape once the video reports it", () => {
    const { container } = render(<SignSequencePlayer sequence={sequence()} />);

    reportDimensions(screen.getByTestId("sign-video"), 406, 720);

    expect(stageOf(container).style.getPropertyValue("--clip-shape")).toBe("406 / 720");
  });

  it("does the same for a sentence stitched into one file", () => {
    const { container } = render(
      <SignSequencePlayer
        sequence={sequence({ stitched_video_url: "/media/stitched/whole.mp4" })}
      />,
    );

    reportDimensions(screen.getByTestId("sign-video"), 406, 720);

    expect(stageOf(container).style.getPropertyValue("--clip-shape")).toBe("406 / 720");
  });

  it("takes a landscape clip's shape just as readily", () => {
    // Nothing here assumes upright footage; it asks the clip.
    const { container } = render(<SignSequencePlayer sequence={sequence()} />);

    reportDimensions(screen.getByTestId("sign-video"), 1280, 720);

    expect(stageOf(container).style.getPropertyValue("--clip-shape")).toBe("1280 / 720");
  });

  it("ignores a video that reports no dimensions at all", () => {
    // A source that failed to load reports zero, and a stage of zero by zero
    // would collapse the player to nothing.
    const { container } = render(<SignSequencePlayer sequence={sequence()} />);

    reportDimensions(screen.getByTestId("sign-video"), 0, 0);

    expect(stageOf(container).style.getPropertyValue("--clip-shape")).toBe("");
  });

  it("never crops, whatever shape the clip turns out to be", () => {
    // `contain` is the whole promise: the hands at the end of a sign are the
    // part a crop takes, and they are the part that carries the meaning.
    render(<SignSequencePlayer sequence={sequence()} />);

    expect(screen.getByTestId("sign-video").className).toContain("player__video");
  });
});
