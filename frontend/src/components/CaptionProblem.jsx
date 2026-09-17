/**
 * Why a caption is untranslated, said in a way that is actually true.
 *
 * Production returned 503 for every caption once Khaya's free tier answered
 * "Out of call volume quota. Quota will be replenished in 14:19:29". The screen
 * said "Could not reach the language service. Try again", which is exactly
 * wrong: the allowance comes back in hours, and a clinician mid consultation
 * would have retried all day.
 *
 * So the two are told apart. An outage is worth another go in a moment. A
 * spent allowance is not, and the honest thing is to say the translation is
 * off until it resets rather than to send somebody back to a button.
 *
 * Both are quiet notices, not alarms. The signs still played, which is the
 * part that matters, and the patient still read the doctor's words. Only the
 * Twi is missing.
 */

const PROBLEMS = {
  quota: {
    title: "The translation service has used up its daily allowance",
    detail:
      "The signs still played, and the patient is reading your own words rather than Twi. Translation comes back when the allowance resets, later today. Retrying will not bring it back sooner.",
  },
  unavailable: {
    title: "The translation service could not be reached",
    detail:
      "The signs still played, and the patient is reading your own words rather than Twi. Sending the next message may work.",
  },
};

export default function CaptionProblem({ problem }) {
  const message = PROBLEMS[problem];
  if (!message) return null;

  return (
    <p
      className="notice notice--warn"
      data-testid="caption-problem"
      data-problem={problem}
      // polite, not an alert. Nothing failed that the doctor has to act on
      // before carrying on: the question reached the patient.
      role="status"
    >
      <strong>{message.title}.</strong> {message.detail}
    </p>
  );
}
