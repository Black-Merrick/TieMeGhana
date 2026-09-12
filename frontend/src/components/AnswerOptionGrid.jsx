import { useState } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import { singleClipSequence } from "../signs/sequence.js";
import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * The grid of sign video answers a patient taps, SRS FR 2.5.
 *
 * Each option is a sign video, not a text label, because the patient using
 * this mode may not read print at all. The whole card is the tap target, with
 * generous spacing and a clear border, per section 4.5 Affordances.
 *
 * The same tap to select pattern is used here and in Emergency Visual Triage,
 * per section 4.4, so a patient who learns one already understands the other.
 */
export default function AnswerOptionGrid({ options, onChoose, disabled = false }) {
  const [chosenId, setChosenId] = useState(null);

  const choose = (option) => {
    setChosenId(option.id);
    // Physical confirmation, so the patient feels the tap register even with
    // their eyes on the doctor. Degrades to the visual highlight alone, NFR 3.
    vibrate(VibrationPattern.TAP_SELECTION);
    onChoose(option);
  };

  if (options.length === 0) {
    return (
      <p className="grid__empty" data-testid="answer-grid-empty">
        This question has no answer options yet.
      </p>
    );
  }

  return (
    <div className="grid" role="group" aria-label="Answer options">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={
            chosenId === option.id ? "grid__option grid__option--chosen" : "grid__option"
          }
          onClick={() => choose(option)}
          disabled={disabled}
          aria-pressed={chosenId === option.id}
          aria-label={option.english_text}
          data-testid={`answer-option-${option.id}`}
        >
          <SignSequencePlayer
            sequence={singleClipSequence(option.clip)}
            controls={false}
            loop
          />
          {/* Doctor facing. The patient answers from the sign video above, but
              the doctor shares this screen and needs to read what was tapped. */}
          <span className="grid__label">{option.english_text}</span>
        </button>
      ))}
    </div>
  );
}
