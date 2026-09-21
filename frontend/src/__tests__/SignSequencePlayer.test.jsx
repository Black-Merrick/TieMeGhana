import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignSequencePlayer from "../components/SignSequencePlayer.jsx";
import { crossOriginFor, forgetMediaCors, recordMediaCors } from "../signs/mediaCors.js";

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

/** End whichever clip is currently on screen, as a real browser would. */
function endCurrentClip() {
  fireEvent.ended(screen.getByTestId("sign-video"));
}

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

    endCurrentClip();

    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/clips/h.webm",
    );
  });

  it("hands over to the element that already holds the next clip", () => {
    // The point of ADR 030. The next clip is not loaded when the current one
    // ends, it was already loaded and decoding, so the swap costs no frames.
    // Asserted by element identity: the standby element becomes the playing
    // one, rather than the playing one being given a new src and reloading.
    render(<SignSequencePlayer sequence={sequence} />);
    const wasPlaying = screen.getByTestId("sign-video");
    const wasStandby = screen.getByTestId("sign-video-preload");

    endCurrentClip();

    expect(screen.getByTestId("sign-video")).toBe(wasStandby);
    expect(screen.getByTestId("sign-video-preload")).toBe(wasPlaying);
  });

  it("does not change the src of the clip it hands over to", () => {
    // If the src changed on handover the browser would reload it, which is the
    // flash of black this design exists to remove.
    render(<SignSequencePlayer sequence={sequence} />);
    const standbySrc = screen
      .getByTestId("sign-video-preload")
      .getAttribute("src");

    endCurrentClip();

    expect(screen.getByTestId("sign-video")).toHaveAttribute("src", standbySrc);
  });

  it("keeps both buffers fully preloaded, not merely hinted", () => {
    // `preload="auto"` is what makes the browser fetch the whole clip. It will
    // not decode a frame it has not fetched, so metadata alone would leave the
    // gap in place.
    render(<SignSequencePlayer sequence={sequence} />);

    expect(screen.getByTestId("sign-video")).toHaveAttribute("preload", "auto");
    expect(screen.getByTestId("sign-video-preload")).toHaveAttribute(
      "preload",
      "auto",
    );
  });

  it("hides the standby clip from assistive technology", () => {
    // Two videos are on screen at once. Only one is the utterance.
    render(<SignSequencePlayer sequence={sequence} />);

    expect(screen.getByTestId("sign-video-preload")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("flattens segments so a fingerspelled word plays letter by letter", () => {
    render(<SignSequencePlayer sequence={sequence} />);

    // Re-queried each time, because the two buffers alternate which one is on
    // screen. Only the playing element fires `ended` in a real browser.
    endCurrentClip();
    endCurrentClip();

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

    endCurrentClip();
    endCurrentClip();
    endCurrentClip();

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

describe("a stitched sentence", () => {
  const stitchedSequence = {
    ...sequence,
    stitched_video_url: "/media/stitched/abc123.mp4",
  };

  it("plays the whole sentence as one video", () => {
    // ADR 031. Two clips played back to back still show two lengths in the
    // control bar and restart the timer at every word, which reads as several
    // videos however smooth the picture is.
    render(<SignSequencePlayer sequence={stitchedSequence} />);

    expect(screen.getByTestId("sign-video")).toHaveAttribute(
      "src",
      "/media/stitched/abc123.mp4",
    );
  });

  it("needs no second buffer, because there is no handover", () => {
    render(<SignSequencePlayer sequence={stitchedSequence} />);

    expect(screen.queryByTestId("sign-video-preload")).not.toBeInTheDocument();
  });

  it("shows no per clip progress, since it is one clip now", () => {
    // "Sign 2 of 2" would contradict what the patient is watching.
    render(<SignSequencePlayer sequence={stitchedSequence} />);

    expect(screen.queryByText(/Sign \d+ of \d+/)).not.toBeInTheDocument();
  });

  it("reports the end of the sentence once", () => {
    const onFinished = vi.fn();
    render(
      <SignSequencePlayer sequence={stitchedSequence} onFinished={onFinished} />,
    );

    fireEvent.ended(screen.getByTestId("sign-video"));

    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("falls back to the clip playlist when nothing was stitched", () => {
    // ffmpeg unavailable, or the encode failed. The patient still sees every
    // sign, just as separate clips.
    render(<SignSequencePlayer sequence={{ ...sequence, stitched_video_url: null }} />);

    expect(screen.getByTestId("sign-video-preload")).toBeInTheDocument();
    expect(screen.getByText(/Sign 1 of 3/)).toBeInTheDocument();
  });
});

describe("asking for a clip with CORS", () => {
  // What lets the service worker keep a clip for offline replay and play it from
  // that copy (ADR 054). Only from a server the warm up found to allow it: asked
  // of one that does not, the video is refused outright.
  const bucket = (name) => `https://cdn.example/clips/${name}.mp4`;
  const remote = {
    source_text: "head",
    segments: [
      { token: "head", match: "gloss", clips: [{ gloss: "HEAD", video_url: bucket("head"), duration_ms: 900 }] },
      { token: "hurt", match: "gloss", clips: [{ gloss: "HURT", video_url: bucket("hurt"), duration_ms: 900 }] },
    ],
    total_duration_ms: 1800,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
  };

  beforeEach(() => forgetMediaCors());
  afterEach(() => forgetMediaCors());

  it("leaves it off for a server nothing is known about, which plays as it always did", () => {
    render(<SignSequencePlayer sequence={remote} />);

    expect(screen.getByTestId("sign-video")).not.toHaveAttribute("crossorigin");
  });

  it("turns it on for a server known to allow it, on both buffers", () => {
    recordMediaCors(bucket("head"), true);

    render(<SignSequencePlayer sequence={remote} />);

    expect(screen.getByTestId("sign-video")).toHaveAttribute("crossorigin", "anonymous");
    expect(screen.getByTestId("sign-video-preload")).toHaveAttribute("crossorigin", "anonymous");
  });

  it("turns it on for a stitched file from that server too", () => {
    recordMediaCors(bucket("head"), true);

    render(<SignSequencePlayer sequence={{ ...remote, stitched_video_url: "https://cdn.example/stitched/x.mp4" }} />);

    expect(screen.getByTestId("sign-video")).toHaveAttribute("crossorigin", "anonymous");
  });

  it("leaves it off for a server known not to", () => {
    recordMediaCors(bucket("head"), false);

    render(<SignSequencePlayer sequence={remote} />);

    expect(screen.getByTestId("sign-video")).not.toHaveAttribute("crossorigin");
  });

  it("never asks for one of the app's own clips that way", () => {
    recordMediaCors(bucket("head"), true);

    render(<SignSequencePlayer sequence={sequence} />);

    expect(screen.getByTestId("sign-video")).not.toHaveAttribute("crossorigin");
  });

  it("starts asking the right way as soon as the warm up finds out", () => {
    render(<SignSequencePlayer sequence={remote} />);
    expect(screen.getByTestId("sign-video")).not.toHaveAttribute("crossorigin");

    act(() => recordMediaCors(bucket("head"), true));

    expect(screen.getByTestId("sign-video")).toHaveAttribute("crossorigin", "anonymous");
  });

  it("stops asking when a video asked for that way fails, and remakes the element without", () => {
    // The server stopped allowing it, or the record was wrong. Without this the
    // patient would see "the sign video did not load" for every clip.
    recordMediaCors(bucket("head"), true);
    render(<SignSequencePlayer sequence={remote} />);
    const first = screen.getByTestId("sign-video");

    fireEvent.error(first);

    expect(crossOriginFor(bucket("head"))).toBeUndefined();
    const remade = screen.getByTestId("sign-video");
    expect(remade).not.toHaveAttribute("crossorigin");
    expect(remade).not.toBe(first);
    expect(remade.getAttribute("src")).toBe(bucket("head"));
  });

  it("does not blame the server for a video that failed without asking", () => {
    render(<SignSequencePlayer sequence={remote} />);

    fireEvent.error(screen.getByTestId("sign-video"));

    expect(crossOriginFor(bucket("head"))).toBeUndefined();
    expect(screen.getByTestId("player-status")).toBeInTheDocument();
  });

  it("plays the remade element", () => {
    recordMediaCors(bucket("head"), true);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<SignSequencePlayer sequence={remote} />);
    play.mockClear();

    fireEvent.error(screen.getByTestId("sign-video"));

    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });
});
