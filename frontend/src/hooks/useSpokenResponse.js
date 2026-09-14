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
  // idle, working, playing, spoken, stopped, failed
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

  /**
   * Play one spoken response, wiring the cues around it.
   *
   * Separate from `speak` because the same audio has to be playable again
   * without asking the language service for it a second time. A doctor who
   * did not catch the answer needs it repeated, and the patient cannot know
   * whether it was heard: they have no way to tell a doctor looking away from
   * one who simply missed it. Repeating from the response already in hand also
   * spends no further Khaya credit, per ADR 015.
   */
  const play = useCallback(
    async (spoken) => {
      release();

      let audio;
      try {
        audio = new Audio(audioUrlFrom(spoken));
      } catch {
        // The response arrived but cannot be turned into playable audio. The
        // text is still on screen, so the exchange is not lost.
        setStatus("failed");
        return;
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
        // answer can be replayed by hand, so it must not surface as an
        // unhandled rejection.
        await audio.play();
      } catch {
        setStatus("failed");
      }
    },
    [release],
  );

  /**
   * Cut playback short.
   *
   * Reported as "stopped" rather than "spoken", because part of an answer
   * reaching the doctor is not the same as all of it and the patient has no
   * way to hear the difference. Claiming it was spoken would be the ADR 011
   * failure in another costume.
   */
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Cleared first: pausing fires nothing, but a stalled element can still
      // reach onended afterwards and overwrite the status we are setting here.
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // Nothing to do. The element is being discarded either way.
      }
    }

    release();
    setStatus((current) => (current === "idle" ? current : "stopped"));
  }, [release]);

  /** Say the last answer again. Nothing to do if there has not been one. */
  const replay = useCallback(async () => {
    if (!result) return;
    await play(result);
  }, [play, result]);

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
      await play(spoken);
      return spoken;
    },
    [play, release],
  );

  return { status, result, speak, replay, stop, canReplay: result !== null };
}
