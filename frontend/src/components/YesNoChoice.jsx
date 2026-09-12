import { useState } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";

/**
 * The app's single Yes and No control, SRS section 4.4.
 *
 * The SRS requires the same icon set to mean Yes and No everywhere: in the
 * literacy check, in Guided Interrogation answers, in Emergency Triage, and in
 * any future confirmation. So this component exists once and is imported,
 * rather than each screen drawing its own pair of buttons.
 *
 * It carries no visible text, per FR 2.1, because it is shown to patients who
 * may not read print. Accessible labels are present for screen readers, which
 * are read aloud rather than displayed, so they do not breach that.
 */
export default function YesNoChoice({ onChoose, disabled = false }) {
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
        <YesIcon />
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
        <NoIcon />
      </button>
    </div>
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
