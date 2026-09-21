import { PAIN_LEVELS } from "../emergency/painLevels.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";

/**
 * A one-tap pain scale, SRS FR 5.1.
 *
 * Faces rather than numbers. A number needs the patient to already share a
 * convention about what 7 out of 10 means, and in an emergency they may not
 * read print at all. A face is understood without instruction, which is
 * section 4.5's affordance requirement.
 *
 * Needs no footage, so it works before a single clip is filmed.
 */

export default function PainScale({ onChoose, chosenLevel = null, disabled = false }) {
  const choose = (option) => {
    if (disabled) return;

    vibrate(VibrationPattern.TAP_SELECTION);
    onChoose(option);
  };

  return (
    <div className="pain" role="group" aria-label="How much pain" data-testid="pain-scale">
      {PAIN_LEVELS.map((option) => (
        <button
          key={option.level}
          type="button"
          className={
            chosenLevel === option.level
              ? "pain__option pain__option--chosen"
              : "pain__option"
          }
          onClick={() => choose(option)}
          disabled={disabled}
          aria-pressed={chosenLevel === option.level}
          // The label is for assistive technology and for the clinician's own
          // screen reader. The patient reads the face, not the words.
          aria-label={option.label}
          data-testid={`pain-level-${option.level}`}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle cx="50" cy="50" r="46" className={`pain__face pain__face--${option.level}`} />
            <circle cx="36" cy="40" r="5" className="pain__eye" />
            <circle cx="64" cy="40" r="5" className="pain__eye" />
            <path d={option.mouth} className="pain__mouth" fill="none" strokeWidth="5" strokeLinecap="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}
