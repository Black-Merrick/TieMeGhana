import { VibrationPattern, vibrate } from "../feedback/vibration.js";

/**
 * Answers a patient can tap instead of typing, FR 3.1.
 *
 * Typing is still the general case, because a patient on this path reads and
 * writes. These are the handful of answers frequent enough that typing them
 * again is friction rather than expression, and each one goes through exactly
 * the same path as a typed reply: spoken aloud, then recorded in the
 * transcript as the patient's own words. Nothing is said on their behalf that
 * they did not tap.
 *
 * Deliberately short. A long list becomes a menu to read, which is the thing
 * this is meant to save them from.
 */
const QUICK_REPLIES = [
  { text: "Yes", twi: "Aane" },
  { text: "No", twi: "Daabi" },
  { text: "The pain is severe" },
  { text: "I have taken the medicine" },
  { text: "Please show that again" },
];

export default function QuickReplies({ onChoose, busy }) {
  return (
    <div className="quick" role="group" aria-label="Quick answers">
      {QUICK_REPLIES.map((reply) => (
        <button
          key={reply.text}
          type="button"
          className="quick__option"
          onClick={() => {
            // Section 4.2, an answer to the tap itself, ahead of the wait.
            vibrate(VibrationPattern.TAP_SELECTION);
            onChoose(reply.text);
          }}
          disabled={busy}
          data-testid={`quick-reply-${reply.text.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {reply.text}
          {reply.twi ? (
            <span className="quick__twi" lang="tw">
              / {reply.twi}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
