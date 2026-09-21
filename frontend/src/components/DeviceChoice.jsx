import YesNoChoice from "./YesNoChoice.jsx";
import { DeviceMode } from "../pairing/deviceMode.js";

/**
 * The first question a visit asks, before the literacy check: does this
 * patient have their own phone?
 *
 * Asked of the doctor, not the patient, and so printed only. It is a question
 * about equipment in the room, not about the patient's language or literacy,
 * which is why it has no sign video and no Twi rendering. The shared Yes and
 * No controls are reused rather than redrawn, per SRS section 4.4: one answer
 * mechanism across the app.
 *
 * Yes starts pairing. No is the shared device, exactly as the app has always
 * run. Emergency mode never comes through here: it is reachable before any
 * question is asked, per ADR 040. See ADR 053.
 */
export default function DeviceChoice({ onChosen, onJoinInstead }) {
  return (
    <section className="literacy" data-testid="device-choice">
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        Before the visit starts
      </p>

      <div>
        <h2 className="literacy__question">
          Does this patient have their own phone?
        </h2>
        <p className="entry__lead">
          Yes joins their phone to this one, so each of you has your own
          screen. No shares this device between you, as usual.
        </p>
      </div>

      <YesNoChoice
        onChoose={(hasPhone) =>
          onChosen(hasPhone ? DeviceMode.PAIRED : DeviceMode.SHARED)
        }
      />

      {/* For a patient who has picked up the doctor's device, or a phone that
          was once set up as one. Small, because it is not the question. */}
      {onJoinInstead ? (
        <p className="entry__switch">
          Is this the patient&apos;s own phone?{" "}
          <button
            type="button"
            className="entry__link"
            onClick={onJoinInstead}
            data-testid="join-instead"
          >
            Join with a code
          </button>
        </p>
      ) : null}
    </section>
  );
}
