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
export default function CaptionResult({ result, onShown }) {
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

  return <ShownUtterance result={result} />;
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
function ShownUtterance({ result }) {
  return (
    <div className="result">
      {result.language_provider === "stub" ? (
        <p className="result__warning" data-testid="provider-warning">
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

      <p
        className="result__caption"
        data-testid="caption"
        lang={result.caption_language}
      >
        {result.caption}
      </p>

      <SignSequencePlayer sequence={result.sequence} />
    </div>
  );
}
