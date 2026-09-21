import { useEffect, useRef, useState } from "react";

import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * One captioned utterance, and the gate in front of it.
 *
 * Nothing reaches the patient until it is safe to show. A word that cannot be
 * signed is simply absent from playback, and absence changes meaning: "no
 * pain" becomes "pain", "two tablets" becomes "tablets". The patient answers
 * the sentence they were shown, and neither person in the room can catch the
 * difference, because the doctor does not read GhSL and the patient never saw
 * the typed words.
 *
 * So there are three outcomes, per ADR 033:
 *
 * - Refused. A negation, dose or severity could not be signed, or a content
 *   word is missing entirely. The sentence is not shown at any quality.
 * - Confirm first. It is safe, but something differs from what was typed, so
 *   the doctor reads back exactly what the patient will see.
 * - Straight through. Every word rendered in a reviewed sign, nothing to warn
 *   about, no friction.
 *
 * The third case matters as much as the first. Confirming a sentence with
 * nothing wrong with it would teach the doctor to tap through the
 * confirmation without reading it, which would make the gate worthless.
 */
export default function CaptionResult({ result, onShown, answers = null }) {
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState(result);

  // Which utterance has already been reported as shown. A ref rather than
  // state, for two reasons. Reporting must not itself cause a render, and the
  // callback's identity changes on every render of the caller, so without this
  // the effect would fire, set state, re-render, and fire again forever. It
  // also guarantees one transcript entry per utterance rather than one per
  // render.
  const reportedFor = useRef(null);

  // A new utterance is never pre-confirmed. Adjusted during render rather than
  // in an effect, so the previous sentence's confirmation cannot survive for a
  // frame into the next one and let it through unread.
  if (confirmedFor !== result) {
    setConfirmedFor(result);
    setConfirmed(false);
  }

  const sequence = result.sequence;
  const showing =
    sequence.is_safe_to_show && (!sequence.needs_confirmation || confirmed);

  // Reported so the caller knows the patient has actually seen this, rather
  // than inferring it from the caption having arrived. A refused sentence, or
  // one still waiting behind the gate, was never shown, so the patient must
  // not be asked to answer it and it must not be written into the record as
  // something they were asked.
  useEffect(() => {
    if (!showing || reportedFor.current === result) return;

    reportedFor.current = result;
    onShown?.(result);
  }, [showing, result, onShown]);

  if (!sequence.is_safe_to_show) {
    return <RefusedUtterance result={result} />;
  }

  if (sequence.needs_confirmation && !confirmed) {
    return (
      <ConfirmUtterance result={result} onShow={() => setConfirmed(true)} />
    );
  }

  return <CaptionStage result={result} answers={answers} />;
}

/** The sentence cannot be signed without changing what it means. */
function RefusedUtterance({ result }) {
  const { blocking_tokens: blocking, unavailable_tokens: missing } =
    result.sequence;

  return (
    <div className="gate gate--refused" data-testid="utterance-refused" role="alert">
      <h2 className="gate__title">Not shown to the patient</h2>

      {blocking.length > 0 ? (
        <p data-testid="refused-blocking">
          <strong>{blocking.join(", ")}</strong> has no sign yet, and leaving it
          out would change what the sentence means. The patient would answer a
          different question without either of you knowing.
        </p>
      ) : null}

      {missing.length > 0 ? (
        <p data-testid="refused-missing">
          <strong>{missing.join(", ")}</strong> can be neither signed nor
          spelled, so the patient would see only part of the sentence and might
          guess at the rest.
        </p>
      ) : null}

      {/* The refusal names an English word, and with Twi input that is a word
          the doctor never typed. Without this the message is baffling: type
          "bisa" and be told "inquire" cannot be signed, with nothing on screen
          connecting the two.

          The confirmation panel has said this for a while. The refusal is
          where it matters more, because a refusal is the moment somebody has
          to work out what to write instead. */}
      {result.sign_lookup_text !== result.transcript ? (
        <p className="gate__advice" data-testid="refused-lookup-text">
          You typed <strong>{result.transcript}</strong>, and signs are keyed on
          English, so they were matched from{" "}
          <strong>{result.sign_lookup_text}</strong>. The translation is a
          synonym the clip library may simply not have under that name.
        </p>
      ) : null}

      <p className="gate__advice">
        Rephrase using words the library has, or ask the patient in person.
      </p>
    </div>
  );
}

/** Safe to show, but the doctor should see what changed before it is shown. */
function ConfirmUtterance({ result, onShow }) {
  const {
    back_translation: signs,
    omitted_tokens: omitted,
    fingerspelled_tokens: spelled,
  } = result.sequence;

  return (
    <div className="gate gate--confirm" data-testid="utterance-confirm">
      <h2 className="gate__title">Check before the patient sees this</h2>

      <p className="gate__row">
        <span className="gate__label">You wrote</span>
        <span data-testid="confirm-typed">{result.transcript}</span>
      </p>

      {/* The whole point of the gate. Showing the doctor their own words back
          would prove nothing: the difference is what matters. */}
      <p className="gate__row">
        <span className="gate__label">Patient will see</span>
        <strong data-testid="confirm-signs">{signs.join("  ")}</strong>
      </p>

      {omitted.length > 0 ? (
        <p className="gate__note" data-testid="confirm-omitted">
          Left out: <strong>{omitted.join(", ")}</strong>. Ghanaian Sign
          Language does not use these words, so leaving them out does not
          change the meaning.
        </p>
      ) : null}

      {result.sign_lookup_text !== result.transcript ? (
        <p className="gate__note" data-testid="lookup-text">
          Signs were matched from: “{result.sign_lookup_text}”. Signs are keyed
          on English, so with Twi input this is a translation rather than what
          you typed.
        </p>
      ) : null}

      {spelled.length > 0 ? (
        <p className="gate__note" data-testid="confirm-spelled">
          Spelled letter by letter, no sign yet:{" "}
          <strong>{spelled.join(", ")}</strong>. A spelled clinical word may not
          be understood.
        </p>
      ) : null}

      <button
        type="button"
        className="gate__show"
        onClick={onShow}
        data-testid="confirm-show"
      >
        Show to patient
      </button>
    </div>
  );
}

/**
 * The caption and the sign video together, never as tabs, per SRS 4.1.
 *
 * Reached only once the sentence is safe, and confirmed if anything about it
 * differed from what the doctor typed.
 */
/**
 * How long the last sign stays on screen before the answers replace it.
 *
 * A sign ends on a handshape, and the final one carries meaning. Swapping the
 * video out on the same frame as the `ended` event cuts that shape off and
 * makes the change feel like something went wrong rather than like the
 * question finishing. Long enough to read as deliberate, short enough that
 * nobody waits.
 */
const ANSWER_DELAY_MS = 650;

/**
 * Exported as `CaptionStage` for the patient's own device in two-device
 * mode: `GuidedInterrogationGuest` receives a result only after it has
 * already cleared the doctor's gate above, so it renders this directly
 * rather than duplicating its watched-state and replay logic.
 */
export function CaptionStage({ result, answers }) {
  // Whether the patient has watched the question through to the end. Held per
  // utterance, so a new question starts unwatched however the last one ended.
  const [watched, setWatched] = useState(false);
  const [watchedFor, setWatchedFor] = useState(result);

  // A counter rather than a boolean, because replaying means mounting a fresh
  // player: the key below changes, the old one is discarded, and the new one
  // starts at the first clip. That is exactly "show it again".
  const [replays, setReplays] = useState(0);

  if (watchedFor !== result) {
    setWatchedFor(result);
    setWatched(false);
    setReplays(0);
  }

  // Cleared on unmount and whenever the question changes, so a pending swap
  // from the previous question cannot land on the next one and show its
  // answers before it has played.
  const settle = useRef(null);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [result],
  );

  const finished = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setWatched(true), ANSWER_DELAY_MS);
  };

  // Nothing to play, which happens when every word resolved to an omission.
  // The sentence is still safe to show and still answerable, but no video will
  // ever fire its ended event, so waiting for one would leave the patient with
  // no way to answer at all. Treated as already watched.
  const hasVideo = (result.sequence.segments ?? []).some(
    (segment) => (segment.clips ?? []).length > 0,
  );

  // The answers take the video's place rather than sitting under it. A patient
  // who has to scroll to find Yes and No may not find them, and the doctor
  // cannot see what they are looking at. Section 4.5: the option has to be
  // where the patient is already looking.
  const answering = answers !== null && (watched || !hasVideo);

  return (
    <div className="result">
      {result.language_provider === "stub" ? (
        <p className="notice notice--warn" data-testid="provider-warning">
          <span className="notice__icon" aria-hidden="true">
            <InfoIcon />
          </span>
          {result.transcript_source === "spoken" ? (
            <>
              Development language service. Your speech was{" "}
              <strong>not transcribed</strong>, the text below is placeholder
              content and not what you said. Switch to the Khaya provider to
              transcribe real speech.
            </>
          ) : (
            <>
              Development language service. This caption was{" "}
              <strong>not translated</strong> into Twi, so it still reads in the
              language it was typed in. Switch to the Khaya provider for real
              translation.
            </>
          )}
        </p>
      ) : null}

      {/* The sign and the caption on one panel, never as tabs, per section
          4.1. The video is the message and gets the contrast; the caption sits
          beneath it on the same dark ground, so the patient reads both without
          looking away. */}
      <div className="stage">
        <div className="stage__bar">
          <span className="stage__chip">
            <span className="shell__dot" aria-hidden="true" />
            {answering ? "Your answer" : "Sign video"}
          </span>
          <span className="stage__room">Ghanaian Sign Language</span>
        </div>

        {answering ? (
          <div className="stage__answers" data-testid="stage-answers">
            {answers}

            {/* Always offered when there is something to replay. A sign seen
                once may not have been understood, and a patient who cannot ask
                for a repeat will guess. */}
            {hasVideo ? (
              <button
                type="button"
                className="stage__replay"
                onClick={() => {
                  setWatched(false);
                  setReplays((count) => count + 1);
                }}
                data-testid="replay-question"
              >
                Show the question again
              </button>
            ) : null}
          </div>
        ) : (
          <SignSequencePlayer
            key={replays}
            sequence={result.sequence}
            onFinished={finished}
          />
        )}

        <p className="stage__caption" data-testid="caption" lang={result.caption_language}>
          <span className="stage__caption-label">The doctor said</span>
          {result.caption}
        </p>
      </div>
    </div>
  );
}

/* Inline so a notice cannot lose the mark that distinguishes it from body
   text on a slow connection. */
function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 8.8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1.05" fill="currentColor" />
    </svg>
  );
}
