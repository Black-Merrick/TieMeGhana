/**
 * The first screen of the app: who is using this device.
 *
 * Two doors into one app. A doctor goes on to start a visit; a patient goes to
 * the page where a pairing code is typed in. Before this, the patient's phone
 * opened the doctor's screen and there was nowhere on it to find the code
 * box, short of knowing to type `/join` by hand.
 *
 * Staff facing text, printed only: like the device question after it, this is
 * asked of whoever is holding the device, not signed to a patient. See ADR
 * 053.
 */
export default function RoleChoice({ onDoctor, onPatient }) {
  return (
    <section className="entry" data-testid="role-choice">
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        Welcome
      </p>

      <div className="entry__intro">
        <h2 className="literacy__question">Who is using this device?</h2>
        <p className="entry__lead">
          Tie Me Ghana connects a doctor and a Deaf or Hard of Hearing patient,
          on one shared device or on one each.
        </p>
      </div>

      <div className="entry__cards">
        <button
          type="button"
          className="entry__card"
          onClick={onDoctor}
          data-testid="role-doctor"
        >
          <span className="entry__icon entry__icon--doctor" aria-hidden="true">
            <StethoscopeIcon />
          </span>
          <span className="entry__title">I&apos;m a doctor</span>
          <span className="entry__text">
            Start a visit with a patient, on this device or with their phone
            paired to it.
          </span>
          <span className="entry__cta">Continue as a doctor</span>
        </button>

        <button
          type="button"
          className="entry__card"
          onClick={onPatient}
          data-testid="role-patient"
        >
          <span className="entry__icon entry__icon--patient" aria-hidden="true">
            <PhoneIcon />
          </span>
          <span className="entry__title">I&apos;m a patient</span>
          <span className="entry__text">
            Join your doctor from your own phone with the code they show you.
          </span>
          <span className="entry__cta">Join with a code</span>
        </button>
      </div>
    </section>
  );
}

/* Inline, like every other icon in the app, so they cannot fail to load on a
   slow connection and leave two unlabelled cards. */
function StethoscopeIcon() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <path
        d="M14 6v11a8 8 0 0 0 16 0V6M10 6h8M26 6h8M22 25v5a8 8 0 0 0 16 0v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="38" cy="23" r="4" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 48 48" focusable="false">
      <rect
        x="14"
        y="5"
        width="20"
        height="38"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path d="M21 37h6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
