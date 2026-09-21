import { useCallback, useEffect, useRef, useState } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";

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
/**
 * The least time the talking face stays up once shown.
 *
 * The answer can be spoken in well under a second, and a face that appears and
 * is gone before it can be read is not feedback, it is a flicker. Seen on a
 * real phone against the development service, whose audio is a fraction of a
 * second of silence. Held only for an answer that went well: a failure, a
 * blocked sound or a stop is shown the instant it is known.
 */
export const MIN_OVERLAY_MS = 1800;

export default function useSpeechFeedback(channel) {
  const [status, setStatus] = useState("idle");
  const [text, setText] = useState("");
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);

  // A ref beside the state, because the message handler must read the current
  // answer's state and not whatever the last render happened to close over.
  const pending = useRef(false);
  const felt = useRef("idle");

  const hold = useCallback(() => {
    clearTimeout(holdTimer.current);
    setHolding(true);
    holdTimer.current = setTimeout(() => setHolding(false), MIN_OVERLAY_MS);
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
    // "blocked" is not the end: the doctor taps and it is spoken after all,
    // and that report has to be believed, so the answer stays pending.
    if (["spoken", "failed", "stopped"].includes(message.status)) {
      pending.current = false;
    }
    if (["failed", "stopped", "blocked"].includes(message.status)) release();
  }, [channel.lastMessage, release]);

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
      setText(answer);
      setStatus("working");
      hold();
    },
    [hold],
  );

  /** Ask for the last answer to be said again, and follow that too. */
  const replay = useCallback(() => {
    pending.current = true;
    hold();
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

  return { status, text, busy, begin, replay, stop, reset };
}
