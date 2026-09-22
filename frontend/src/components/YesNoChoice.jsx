import { useState } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import useYesNoSigns from "../hooks/useYesNoSigns.js";
import { singleClipSequence } from "../signs/sequence.js";
import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * The app's single Yes and No control, SRS section 4.4.
 *
 * The SRS requires the same icon set to mean Yes and No everywhere: in the
 * literacy check, in Guided Interrogation answers, in Emergency Triage, and in
 * any future confirmation. So this component exists once and is imported,
 * rather than each screen drawing its own pair of buttons.
 *
 * Each option carries a bilingual label under its icon. FR 2.1 asks for icon
 * options with no text; the label is here at the team's direction, recorded as
 * ADR 047.
 *
 * The rule that keeps it safe is that the icon comes first and always exists.
 * A patient who does not read sees a large green tick or a large red cross,
 * which is what they act on. The label is secondary, smaller, and never the
 * only thing in the button.
 *
 * With `signed`, each option shows the GhSL sign for it instead of the drawing,
 * where that sign has been filmed and approved. A tick is a convention the
 * patient has to already share; the sign is their own language, and FR 2.1 asks
 * the literacy check to put its question without depending on text. The drawing
 * stays as the fallback, so an unfilmed or unapproved sign leaves the button
 * exactly as it was rather than empty. Off by default: the same control asks
 * the doctor whether the patient has a phone, and that is an English question
 * about logistics, not something to put to a patient in GhSL. See ADR 059.
 */
export default function YesNoChoice({ onChoose, disabled = false, signed = false }) {
  const signs = useYesNoSigns({ enabled: signed });
  // Section 4.2 requires an immediate, unambiguous response to every tap.
  // Holding the choice locally is what lets the chosen option stay highlighted
  // even while the parent is still deciding what to do about it.
  const [chosen, setChosen] = useState(null);

  const choose = (value) => {
    setChosen(value);

    // Physical confirmation, for a patient whose eyes are on the doctor rather
    // than the screen. Falls back to the visual highlight alone where
    // vibration is unsupported, per NFR 3.
    vibrate(VibrationPattern.TAP_SELECTION);

    onChoose(value);
  };

  return (
    <div className="choice">
      <button
        type="button"
        className={optionClass("yes", chosen === true)}
        onClick={() => choose(true)}
        disabled={disabled}
        aria-label="Yes"
        aria-pressed={chosen === true}
        data-testid="choice-yes"
      >
        <ChoiceMark clip={signed ? signs.yes : null} testid="choice-yes-sign">
          <YesIcon />
        </ChoiceMark>
        <span className="choice__label">
          Yes <span className="choice__label-twi" lang="tw">/ Aane</span>
        </span>
      </button>

      <button
        type="button"
        className={optionClass("no", chosen === false)}
        onClick={() => choose(false)}
        disabled={disabled}
        aria-label="No"
        aria-pressed={chosen === false}
        data-testid="choice-no"
      >
        <ChoiceMark clip={signed ? signs.no : null} testid="choice-no-sign">
          <NoIcon />
        </ChoiceMark>
        <span className="choice__label">
          No <span className="choice__label-twi" lang="tw">/ Daabi</span>
        </span>
      </button>
    </div>
  );
}

/**
 * The sign, or the drawing it falls back to.
 *
 * Silent and looping with no controls of its own, like the emergency alert
 * cards: the card is the tap target, and a video's controls inside a button
 * swallow the tap.
 */
function ChoiceMark({ clip, testid, children }) {
  if (!clip?.video_url) return children;

  return (
    <span className="choice__clip" data-testid={testid}>
      <SignSequencePlayer
        sequence={singleClipSequence(clip)}
        controls={false}
        loop
      />
    </span>
  );
}

function optionClass(variant, isChosen) {
  return [
    "choice__option",
    `choice__option--${variant}`,
    isChosen ? "choice__option--chosen" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/* Icons are inline SVG rather than an icon font or image, so they cannot fail
   to load on a slow hospital connection and leave an unlabelled button. They
   use shape as well as colour, so they stay distinguishable to a colour blind
   patient. */

function YesIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" className="choice__icon-ground" />
      <path
        d="M18 33.5 27.5 43 46 24"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="choice__icon-mark"
      />
    </svg>
  );
}

function NoIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" className="choice__icon-ground" />
      <path
        d="M21 21 43 43 M43 21 21 43"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="choice__icon-mark"
      />
    </svg>
  );
}
