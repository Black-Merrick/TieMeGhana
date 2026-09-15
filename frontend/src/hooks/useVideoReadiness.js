import { useEffect, useRef, useState } from "react";

/**
 * Track whether a sign video can actually play yet, so the wait can be shown.
 *
 * The gap this fills: the request finishing and the video playing are two
 * different moments, and only the first had anything on screen. Once the
 * caption came back the working indicator went away, the player appeared, and
 * then a black rectangle sat there while the clip downloaded. To a Deaf patient
 * watching for a sign, a black rectangle is indistinguishable from a broken
 * app, and there is nothing to ask. On a hospital connection that wait is the
 * normal case rather than the exception.
 *
 * Phases:
 *
 * - `preparing`  nothing playable yet. The first load, or a new utterance.
 * - `ready`      playing, or able to.
 * - `buffering`  it started and then ran out, mid sign.
 * - `failed`     the browser gave up on this source.
 *
 * `buffering` is kept apart from `preparing` because they mean different
 * things to whoever is watching: one is "it has not started", the other is
 * "it stopped part way", and a patient who sees the same message for both
 * cannot tell whether they missed a sign.
 */
export default function useVideoReadiness({ source, graceMs = 250 } = {}) {
  const [phase, setPhase] = useState("preparing");

  // Kept apart from `phase` so the overlay can lag behind the truth. A clip
  // already in the cache is ready within a frame or two, and flashing "getting
  // ready" for 30ms reads as a glitch rather than as feedback.
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  const timer = useRef(null);

  // A new source is a new wait. Reset here rather than in an effect, because
  // an effect runs after the render that already painted the previous state,
  // which shows one frame of "ready" over a video that has not loaded.
  const [watched, setWatched] = useState(source);
  if (watched !== source) {
    setWatched(source);
    setPhase("preparing");
    setWaitedLongEnough(false);
  }

  useEffect(() => {
    if (phase === "ready" || phase === "failed") {
      setWaitedLongEnough(false);
      return undefined;
    }

    timer.current = setTimeout(() => setWaitedLongEnough(true), graceMs);
    return () => clearTimeout(timer.current);
  }, [phase, source, graceMs]);

  return {
    phase,

    /**
     * Whether to show the waiting overlay.
     *
     * A failure shows immediately: there is nothing further to wait for, and
     * delaying the only explanation the patient gets helps nobody.
     */
    showOverlay:
      phase === "failed" || (phase !== "ready" && waitedLongEnough),

    /**
     * Spread onto the `<video>` element.
     *
     * `onCanPlay` rather than `onLoadedData`: loaded data only means the first
     * frame exists, and a video that can show one frame but not continue would
     * clear the overlay and then stall behind it.
     */
    handlers: {
      onCanPlay: () => setPhase("ready"),
      onPlaying: () => setPhase("ready"),
      onWaiting: () => setPhase((current) => (current === "ready" ? "buffering" : current)),
      onStalled: () => setPhase((current) => (current === "ready" ? "buffering" : current)),
      onError: () => setPhase("failed"),
    },
  };
}
