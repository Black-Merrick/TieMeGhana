import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SignSequencePlayer from "../components/SignSequencePlayer.jsx";

/**
 * FR 1.7 asks for matched clips "stitched into a single sign video". ADR 008
 * implements that as an ordered playlist played back to back by this one
 * component, so seamless playback is its responsibility and these tests are
 * where that responsibility is pinned down.
 */

const sequence = {
  source_text: "head hurts",
  segments: [
    {
      token: "head",
      match: "gloss",
      clips: [{ gloss: "HEAD", video_url: "/media/clips/head.webm", duration_ms: 900 }],
    },
    {
      token: "hurts",
      match: "fingerspell",
      clips: [
        { gloss: "H", video_url: "/media/clips/h.webm", duration_ms: 200 },
        { gloss: "U", video_url: "/media/clips/u.webm", duration_ms: 200 },
      ],
    },
  ],
  total_duration_ms: 1300,
  fingerspelled_tokens: ["hurts"],
  unavailable_tokens: [],
};

const emptySequence = {
  source_text: "",
  segments: [],
  total_duration_ms: 0,
  fingerspelled_tokens: [],
  unavailable_tokens: [],
};

describe("SignSequencePlayer", () => {
  it("starts on the first clip of the sequence", () => {
    render(<SignSequencePlayer sequence={sequence} />);

    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/clips/head.webm",
    );
  });

  it("advances to the next clip when the current one ends", () => {
    // This is what makes a sentence read as one continuous signed utterance
    // rather than a single word.
    render(<SignSequencePlayer sequence={sequence} />);

    fireEvent.ended(screen.getByTestId("sign-video"));

    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/clips/h.webm",
    );
  });

  it("flattens segments so a fingerspelled word plays letter by letter", () => {
    render(<SignSequencePlayer sequence={sequence} />);
    const video = screen.getByTestId("sign-video");

    fireEvent.ended(video);
    fireEvent.ended(video);

    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/clips/u.webm",
    );
  });

  it("preloads the next clip while the current one plays", () => {
    // ADR 008 traded server side stitching for playlist playback, which makes
    // a visible stutter between clips a real defect. Preloading is the fix.
    render(<SignSequencePlayer sequence={sequence} />);

    expect(screen.getByTestId("sign-video-preload")).toHaveAttribute(
      "src",
      "/media/clips/h.webm",
    );
  });

  it("reports when the whole sequence has finished", () => {
    const onFinished = vi.fn();
    render(<SignSequencePlayer sequence={sequence} onFinished={onFinished} />);
    const video = screen.getByTestId("sign-video");

    fireEvent.ended(video);
    fireEvent.ended(video);
    fireEvent.ended(video);

    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("explains itself when there is nothing to play", () => {
    // With no footage uploaded yet this is the normal case, so it has to say
    // something honest rather than render a blank box.
    render(<SignSequencePlayer sequence={emptySequence} />);

    expect(screen.queryByTestId("sign-video")).not.toBeInTheDocument();
    expect(screen.getByTestId("sign-video-empty")).toBeInTheDocument();
  });

  it("restarts from the beginning when given a new sequence", () => {
    const { rerender } = render(<SignSequencePlayer sequence={sequence} />);
    fireEvent.ended(screen.getByTestId("sign-video"));

    const nextSequence = {
      ...emptySequence,
      source_text: "chest",
      segments: [
        {
          token: "chest",
          match: "gloss",
          clips: [
            { gloss: "CHEST", video_url: "/media/clips/chest.webm", duration_ms: 800 },
          ],
        },
      ],
    };
    rerender(<SignSequencePlayer sequence={nextSequence} />);

    // A new utterance must start at its own first clip, never resume from
    // wherever the previous sentence happened to stop.
    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/clips/chest.webm",
    );
  });
});
