/**
 * The wait between a caption arriving and a sign playing, made visible.
 *
 * The gap these cover: the request finishing and the video playing are two
 * different moments, and only the first had anything on screen. Once the
 * caption came back the working indicator went away, the player appeared, and
 * a black rectangle sat there while the clip downloaded.
 *
 * A hearing patient waiting on a slow video hears the room, and can ask. A Deaf
 * patient watching a black rectangle has neither, and cannot tell waiting from
 * broken. On a hospital connection that wait is the normal case.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignSequencePlayer from "../components/SignSequencePlayer.jsx";

const sequenceWith = (overrides = {}) => ({
  segments: [
    { token: "ask", match: "gloss", clips: [{ gloss: "ASK", video_url: "/ask.mp4" }] },
  ],
  stitched_video_url: null,
  ...overrides,
});

/** Past the grace period that stops an instantly ready video from flashing. */
const afterTheGracePeriod = async () => {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // jsdom has no media pipeline, so play() is absent and the component's own
  // catch never gets a promise to handle.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("while the sign video is still loading", () => {
  it("tells the patient something is being got ready", async () => {
    render(<SignSequencePlayer sequence={sequenceWith()} />);

    await afterTheGracePeriod();

    const status = await screen.findByTestId("player-status");
    expect(status).toHaveAttribute("data-phase", "preparing");
    expect(status).toHaveTextContent(/getting ready/i);
  });

  it("announces the wait to a screen reader without interrupting", async () => {
    // The doctor's eyes are on the patient, not the screen. polite rather than
    // assertive, so this never cuts across something clinical being read out.
    render(<SignSequencePlayer sequence={sequenceWith()} />);

    await afterTheGracePeriod();

    const status = await screen.findByTestId("player-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("does not flash for a video that is ready immediately", async () => {
    // A clip already in the cache is playable within a frame or two. Showing
    // "getting ready" for thirty milliseconds reads as a glitch, not feedback.
    render(<SignSequencePlayer sequence={sequenceWith()} />);

    act(() => {
      screen.getByTestId("sign-video").dispatchEvent(new Event("canplay"));
    });
    await afterTheGracePeriod();

    expect(screen.queryByTestId("player-status")).not.toBeInTheDocument();
  });

  it("clears as soon as the video can play", async () => {
    render(<SignSequencePlayer sequence={sequenceWith()} />);
    await afterTheGracePeriod();
    expect(await screen.findByTestId("player-status")).toBeInTheDocument();

    act(() => {
      screen.getByTestId("sign-video").dispatchEvent(new Event("canplay"));
    });

    await waitFor(() =>
      expect(screen.queryByTestId("player-status")).not.toBeInTheDocument(),
    );
  });
});

describe("when a video stalls part way through", () => {
  it("says something different from not having started", async () => {
    // A patient shown the same message for both cannot tell whether they
    // missed a sign.
    render(<SignSequencePlayer sequence={sequenceWith()} />);
    const video = screen.getByTestId("sign-video");

    act(() => video.dispatchEvent(new Event("canplay")));
    act(() => video.dispatchEvent(new Event("waiting")));
    await afterTheGracePeriod();

    const status = await screen.findByTestId("player-status");
    expect(status).toHaveAttribute("data-phase", "buffering");
    expect(status).toHaveTextContent(/still loading/i);
  });
});

describe("when the video cannot load at all", () => {
  it("says so straight away rather than waiting", async () => {
    // There is nothing further to wait for, and delaying the only explanation
    // the patient gets helps nobody.
    render(<SignSequencePlayer sequence={sequenceWith()} />);

    act(() => {
      screen.getByTestId("sign-video").dispatchEvent(new Event("error"));
    });

    const status = await screen.findByTestId("player-status");
    expect(status).toHaveAttribute("data-phase", "failed");
    expect(status).toHaveTextContent(/did not load/i);
  });
});

describe("a stitched sentence", () => {
  it("reports its wait the same way as separate clips", async () => {
    // Section 4.4: one player, so a patient who learns one learns them all.
    // The two paths are different code and could easily drift.
    render(
      <SignSequencePlayer
        sequence={sequenceWith({ stitched_video_url: "/whole-sentence.mp4" })}
      />,
    );

    await afterTheGracePeriod();

    expect(await screen.findByTestId("player-status")).toHaveAttribute(
      "data-phase",
      "preparing",
    );
  });
});

describe("moving on to the next sign", () => {
  it("waits again rather than reporting the previous clip as ready", async () => {
    const twoClips = {
      segments: [
        {
          token: "ask",
          match: "gloss",
          clips: [
            { gloss: "ASK", video_url: "/ask.mp4" },
            { gloss: "ABOUT", video_url: "/about.mp4" },
          ],
        },
      ],
      stitched_video_url: null,
    };
    render(<SignSequencePlayer sequence={twoClips} />);

    const video = screen.getByTestId("sign-video");
    act(() => video.dispatchEvent(new Event("canplay")));
    await waitFor(() =>
      expect(screen.queryByTestId("player-status")).not.toBeInTheDocument(),
    );

    // The first clip ends and the buffers swap to the second.
    act(() => video.dispatchEvent(new Event("ended")));
    await afterTheGracePeriod();

    expect(await screen.findByTestId("player-status")).toHaveAttribute(
      "data-phase",
      "preparing",
    );
  });
});
