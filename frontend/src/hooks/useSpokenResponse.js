import { useCallback, useEffect, useRef, useState } from "react";

import { audioUrlFrom, speakResponse } from "../api/speech.js";
import {
  canSpeak as deviceCanSpeak,
  speakOnDevice,
  stopDevice,
} from "../audio/deviceSpeech.js";
import { remainingHoldMs } from "../feedback/speechHold.js";
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
  // idle, working, playing, spoken, stopped, blocked, failed
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const audioRef = useRef(null);

  // Whether the talking face is still to be shown after the sound has ended,
  // because the sentence would take longer to say than the audio did. See
  // feedback/speechHold.js. Never longer than it takes, and cleared the moment
  // anything but a finished answer is known.
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);
  const playedAt = useRef(null);

  const endHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    setHolding(false);
  }, []);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  /**
   * What is being spoken right now, so it cannot be started twice.
   *
   * A ref rather than state, and that is the point. The buttons are disabled
   * while speaking, but `disabled` only takes effect after React re-renders,
   * and a second tap landing inside that gap gets through. The result is the
   * same answer spoken twice over itself, which to a clinician sounds like the
   * patient said it twice.
   *
   * Keyed on the text, not a plain busy flag, so a patient who taps a
   * different answer while one is still playing is not silently ignored. That
   * is a correction, and losing it would be worse than overlapping audio.
   */
  const speakingRef = useRef(null);

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
        playedAt.current = Date.now();
        setStatus("playing");
        // Two short pulses, SRS section 6. The patient's physical cue that
        // their answer is being spoken, for an event they cannot hear.
        vibrate(VibrationPattern.AUDIO_STARTED);
      };

      audio.onended = () => {
        setStatus("spoken");
        vibrate(VibrationPattern.AUDIO_FINISHED);

        // Kept on screen for as long as the sentence would take to say, if the
        // audio was shorter. The face is the patient's evidence that it was.
        const sinceStarted =
          playedAt.current === null ? null : Date.now() - playedAt.current;
        const more = remainingHoldMs(spoken?.spoken_text, sinceStarted);
        clearTimeout(holdTimer.current);
        if (more > 0) {
          setHolding(true);
          holdTimer.current = setTimeout(() => setHolding(false), more);
        }
        speakingRef.current = null;
        release();
      };

      audio.onerror = () => {
        endHold();
        setStatus("failed");
        speakingRef.current = null;
        release();
      };

      try {
        // play() rejects when autoplay is blocked, which is recoverable: the
        // answer can be replayed by hand, so it must not surface as an
        // unhandled rejection.
        await audio.play();
      } catch (error) {
        speakingRef.current = null;
        // Told apart from a real failure, because the remedy is different and
        // the answer is not lost. A browser only lets a page make sound once
        // somebody has touched it, and a doctor's device that has been
        // reloaded since it was last tapped, and is now speaking a patient's
        // reply from their own phone, has not been. The audio is in hand, so
        // it is played by the tap that follows (`replay`), not thrown away as
        // "could not be spoken". Found on two real devices, where it showed up
        // as the patient's screen flashing and giving up.
        endHold();
        setStatus(error?.name === "NotAllowedError" ? "blocked" : "failed");
      }
    },
    [release, endHold],
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
    // The device may be the one talking, so both are silenced.
    stopDevice();
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
    endHold();
    speakingRef.current = null;
    setStatus((current) => (current === "idle" ? current : "stopped"));
  }, [release, endHold]);

  /** Say the last answer again. Nothing to do if there has not been one. */
  const replay = useCallback(async () => {
    if (!result) return;
    // Asked for deliberately, so it is not caught by the guard above: a doctor
    // who missed the answer is not double tapping, they want it again.
    speakingRef.current = null;
    endHold();
    await play(result);
  }, [play, result, endHold]);

  const speak = useCallback(
    async (payload) => {
      // The same answer, already on its way. Ignored rather than queued: the
      // patient tapped twice, they did not say it twice.
      if (speakingRef.current === payload?.text) return null;
      speakingRef.current = payload?.text ?? null;

      release();
      endHold();
      setStatus("working");
      setResult(null);

      let spoken;
      try {
        spoken = await speakResponse(payload);
      } catch {
        // The service could not produce audio. Before giving up, see whether
        // this device can say it itself.
        //
        // Added after a spent daily allowance stopped every answer being
        // spoken. Captions had something to degrade to, because signs need no
        // translation to resolve. Speech had nothing, and an answer nobody
        // hears is an answer nobody receives.
        const saidHere = await _speakHere(payload);
        setStatus(saidHere ? "spoken" : "failed");
        speakingRef.current = null;
        return null;
      }

      setResult(spoken);
      await play(spoken);
      return spoken;
    },
    [play, release, endHold],
  );

  // Up while it is being prepared or said, and after, for as long as the
  // sentence takes. What the talking face is shown for.
  const showing =
    status === "working" || status === "playing" || (holding && status === "spoken");

  return { status, result, speak, replay, stop, canReplay: result !== null, showing };
}

/**
 * Last resort: have the device read the answer out.
 *
 * Only where it can be honest about it. The device cannot translate, so the
 * text must already be in the language the listener asked for, and it cannot
 * invent a voice, so one has to exist. Reading Twi in an English voice would
 * be confident mispronunciation of clinical words, which is worse than
 * silence.
 */
async function _speakHere(payload) {
  // Awaited, because the browser fills its voice list asynchronously. Asking
  // synchronously answers "no voices" for the first moments of every session,
  // which is exactly when the first answer tends to be given.
  if (!(await deviceCanSpeak(payload ?? {}))) return false;

  return speakOnDevice({
    text: payload.text,
    outputLanguage: payload.outputLanguage,
  });
}
