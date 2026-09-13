import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import { singleClipSequence } from "../signs/sequence.js";
import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * One-tap critical alerts, SRS FR 5.3.
 *
 * An alert is offered whether its GhSL clip is filmed or not, which is the
 * opposite of the body location grid in ADR 022 and deliberate: an icon a
 * patient half recognises beats having no way to say "cannot breathe" at all.
 * See ADR 040.
 */

// Drawn inline rather than loaded, so an alert cannot fail to render on a slow
// hospital connection and leave an unlabelled button in an emergency.
const ICONS = {
  breathing: (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M32 12v18M32 30c0 10-7 14-13 14s-8-5-8-11 3-14 9-16M32 30c0 10 7 14 13 14s8-5 8-11-3-14-9-16"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M18 46l28-28" strokeWidth="5" strokeLinecap="round" />
    </svg>
  ),
  asthma: (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M32 14v16M32 30c0 11-6 16-12 16s-7-6-7-12 2-13 8-15M32 30c0 11 6 16 12 16s7-6 7-12-2-13-8-15"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  ),
  pregnancy: (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="30" cy="14" r="7" />
      <path
        d="M30 22c-6 0-9 5-9 11v8c0 8 3 15 3 15M30 26c9 0 14 5 14 12s-6 10-11 10"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M24 56h12" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ),
};

export default function CriticalAlerts({ alerts, onChoose, chosenId = null, disabled = false }) {
  if (alerts === null) {
    return (
      <p className="consultation__working" data-testid="alerts-loading">
        <span className="consultation__pulse" aria-hidden="true" />
        Loading alerts
      </p>
    );
  }

  if (alerts.length === 0) {
    return (
      <p className="consultation__note" data-testid="alerts-unavailable">
        Critical alerts could not be loaded. Call for help directly.
      </p>
    );
  }

  const choose = (alert) => {
    if (disabled) return;

    // Three short, sharp pulses. SRS section 6 gives the highest stakes action
    // in the app its own pattern, so the patient feels that this was not an
    // ordinary tap.
    vibrate(VibrationPattern.EMERGENCY_ALERT);
    onChoose(alert);
  };

  return (
    <div className="alerts" role="group" aria-label="Critical alerts">
      {alerts.map((alert) => (
        <button
          key={alert.id}
          type="button"
          className={
            chosenId === alert.id ? "alerts__option alerts__option--chosen" : "alerts__option"
          }
          onClick={() => choose(alert)}
          disabled={disabled}
          aria-pressed={chosenId === alert.id}
          data-testid={`alert-${alert.id}`}
        >
          <span className="alerts__icon">{ICONS[alert.icon]}</span>

          {/* The GhSL clip when it exists, per FR 5.3. Silent and looping, so
              the card itself stays the tap target. */}
          {alert.is_playable ? (
            <span className="alerts__clip">
              <SignSequencePlayer
                sequence={singleClipSequence(alert.clip)}
                controls={false}
                loop
              />
            </span>
          ) : null}

          {/* Read by the clinician. The patient has the icon and, once filmed,
              the sign video. */}
          <span className="alerts__label">{alert.english_text}</span>
        </button>
      ))}
    </div>
  );
}
