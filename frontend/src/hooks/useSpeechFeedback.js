import { useCallback, useEffect, useRef, useState } from "react";

import { MIN_OVERLAY_MS, remainingHoldMs } from "../feedback/speechHold.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

// Kept here as well as in speechHold.js, where the reasoning is: the phone's
// screens and their tests have always read it from this hook.
export { MIN_OVERLAY_MS };

/**
 * The patient's phone following its own answer while another device speaks it.
 *
 * SRS section 4.2: a Deaf patient cannot hear whether their answer reached the
 * doctor, so it has to be shown and felt on the device in their hand. On one
 * shared device the speech hook is right there. With two, the sound is made on
 * the doctor's device and reports back as `speaking` messages, and this turns
 * those into the same three things the shared screen has: a status to draw, a
 * physical cue, and a way to cut it short. See ADR 053.
 *
 * Only reports about an answer this phone gave are believed. The doctor's
 * device also speaks things the patient never tapped, such as the doctor's own
 * confirmation of a nod, and showing "your answer is being spoken" for those,
 * beside the words of an earlier answer, would be untrue.
 *
 * The physical cue is the app's existing vocabulary, section 6: two short
 * pulses when speech starts, one long one when it ends. Nothing vibrates for a
 * failure, because there is no pattern for one and none may be invented; it is
 * shown on screen.
 */
export default function useSpeechFeedback(channel) {
  const [status, setStatus] = useState("idle");
  const [text, setText] = useState("");
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);

  // A ref beside the state, because the message handler must read the current
  // answer's state and not whatever the last render happened to close over.
  const pending = useRef(false);
  const felt = useRef("idle");
  // When this answer was given and when the sound began, so the face can be
  // held for as long as the sentence takes to say. See feedback/speechHold.js.
  const beganAt = useRef(0);
  const playingAt = useRef(null);
  const spokenText = useRef("");

  const hold = useCallback((ms) => {
    clearTimeout(holdTimer.current);
    if (ms <= 0) {
      setHolding(false);
      return;
    }
    setHolding(true);
    holdTimer.current = setTimeout(() => setHolding(false), ms);
  }, []);

  const release = useCallback(() => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  }, []);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  useEffect(() => {
    const message = channel.lastMessage;
    if (message?.type !== "speaking" || typeof message.status !== "string") return;
    if (!pending.current) return;

    setStatus(message.status);

    if (message.status === "playing" && playingAt.current === null) {
      playingAt.current = Date.now();
    }

    // "blocked" is not the end: the doctor taps and it is spoken after all,
    // and that report has to be believed, so the answer stays pending.
    if (["spoken", "failed", "stopped"].includes(message.status)) {
      pending.current = false;
    }
    if (["failed", "stopped", "blocked"].includes(message.status)) release();

    if (message.status === "spoken") {
      // The sound has finished, which is not the moment to take the face away:
      // it stays for as long as the sentence would take to say, and for the
      // shortest time it is ever shown, counted from when the answer was given.
      const now = Date.now();
      const sinceStarted = playingAt.current === null ? null : now - playingAt.current;
      const forSentence = remainingHoldMs(spokenText.current, sinceStarted);
      const forMinimum = MIN_OVERLAY_MS - (now - beganAt.current);
      hold(Math.max(forSentence, forMinimum));
    }
  }, [channel.lastMessage, release, hold]);

  useEffect(() => {
    const before = felt.current;
    felt.current = status;
    if (status === before) return;

    if (status === "playing") vibrate(VibrationPattern.AUDIO_STARTED);
    else if (status === "spoken") vibrate(VibrationPattern.AUDIO_FINISHED);
  }, [status]);

  /** The patient has just given this answer. Assumed on its way until told. */
  const begin = useCallback(
    (answer) => {
      pending.current = true;
      beganAt.current = Date.now();
      playingAt.current = null;
      spokenText.current = answer;
      setText(answer);
      setStatus("working");
      // Nothing to hold yet: it is on screen for as long as it is working or
      // playing, and held for the sentence once it is spoken.
      hold(0);
    },
    [hold],
  );

  /** Ask for the last answer to be said again, and follow that too. */
  const replay = useCallback(() => {
    pending.current = true;
    beganAt.current = Date.now();
    playingAt.current = null;
    // Up at once, before the doctor's device has said it has started.
    hold(MIN_OVERLAY_MS);
    channel.send({ type: "replay" });
  }, [channel, hold]);

  /**
   * Cut it short. The way out of the overlay, which covers the screen while an
   * answer is spoken and must never trap a patient behind a device that has
   * stopped reporting.
   */
  const stop = useCallback(() => {
    pending.current = false;
    release();
    channel.send({ type: "stop" });
    setStatus("stopped");
  }, [channel, release]);

  /**
   * Let go of an answer the doctor's device is not going to speak, because it
   * had already been answered some other way. Nothing is left waiting, and
   * nothing is claimed about it.
   */
  const cancel = useCallback(() => {
    pending.current = false;
    release();
    setStatus("idle");
    setText("");
  }, [release]);

  /**
   * A new turn from the doctor. The last answer's confirmation was about that
   * answer, and left up it would read as confirmation of the next one. An
   * answer still on its way is left alone.
   */
  const reset = useCallback(() => {
    if (pending.current) return;
    setStatus("idle");
    setText("");
  }, []);

  // Held up for the minimum only when it has gone well. Anything else has
  // something to say and says it at once.
  const busy =
    status === "working" || status === "playing" || (holding && status === "spoken");

  return { status, text, busy, begin, replay, stop, reset, cancel };
}
