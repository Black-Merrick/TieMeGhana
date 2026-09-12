import { useCallback, useRef, useState } from "react";

import { audioUrlFrom, speakResponse } from "../api/speech.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

/**
 * Speaking a patient response, and the feedback around it.
 *
 * The feedback is the point, not a decoration. A Deaf patient cannot hear
 * whether their answer was spoken, so SRS section 4.2 requires both a physical
 * and a visual cue, and section 6 fixes which vibration means what: two short
 * pulses when speech starts, one long pulse when it ends.
 */
export default function useSpokenResponse() {
  // idle, working, playing, spoken, failed
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const audioRef = useRef(null);

  /** Release the previous clip's blob URL, which the browser will not. */
  const release = useCallback(() => {
    const previous = audioRef.current;
    if (!previous) return;

    previous.onplay = null;
    previous.onended = null;
    previous.onerror = null;
    if (previous.src) URL.revokeObjectURL(previous.src);
    audioRef.current = null;
  }, []);

  const speak = useCallback(
    async (payload) => {
      release();
      setStatus("working");
      setResult(null);

      let spoken;
      try {
        spoken = await speakResponse(payload);
      } catch {
        setStatus("failed");
        return null;
      }

      setResult(spoken);

      let audio;
      try {
        audio = new Audio(audioUrlFrom(spoken));
      } catch {
        // The response arrived but cannot be turned into playable audio. The
        // text is still on screen, so the exchange is not lost.
        setStatus("failed");
        return spoken;
      }

      audioRef.current = audio;

      audio.onplay = () => {
        setStatus("playing");
        // Two short pulses, SRS section 6. The patient's physical cue that
        // their answer is being spoken, for an event they cannot hear.
        vibrate(VibrationPattern.AUDIO_STARTED);
      };

      audio.onended = () => {
        setStatus("spoken");
        vibrate(VibrationPattern.AUDIO_FINISHED);
        release();
      };

      audio.onerror = () => {
        setStatus("failed");
        release();
      };

      try {
        // play() rejects when autoplay is blocked, which is recoverable: the
        // doctor can tap to replay, so it must not surface as an unhandled
        // rejection.
        await audio.play();
      } catch {
        setStatus("failed");
      }

      return spoken;
    },
    [release],
  );

  return { status, result, speak };
}
