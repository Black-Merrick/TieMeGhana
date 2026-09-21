import { useEffect, useState } from "react";

import { announcedEmergency } from "../pairing/announcedScreen.js";
import DoctorConsultationGuest from "./DoctorConsultationGuest.jsx";
import EmergencyTriageGuest from "./EmergencyTriageGuest.jsx";
import GuidedInterrogationGuest from "./GuidedInterrogationGuest.jsx";
import JoinAnother from "./JoinAnother.jsx";

/**
 * The patient's own phone, once it has connected to the doctor's device.
 *
 * Connecting happens before the literacy question is answered, so at first
 * this phone has no idea which screen it is for. The doctor's device tells it
 * with a `path` message the moment that answer lands, and every `question`
 * repeats the path too: the connection hands a component only the newest
 * message, so a `path` that arrived in the same instant as a question would
 * otherwise be lost, and this screen would wait for a word that was already
 * said. A phone that has been here before starts from the path it remembered,
 * so a reload comes back to the screen it was on.
 *
 * Emergency mode is followed the same way. When the doctor opens it this phone
 * shows the patient the emergency screen, wherever it was, and when the doctor
 * leaves it the phone goes back to the consultation, which the doctor's device
 * sends again for the purpose. It is told by `emergency` on every message that
 * says where the phone should be, for the reason `path` is (see
 * announcedScreen.js), and it is remembered across a reload.
 *
 * Only the two paths the app has are believed. Anything else is ignored
 * rather than guessed at, since a phone that renders the wrong half of a
 * consultation is worse than one that keeps waiting. See ADR 053.
 *
 * Whether the connection is up is not this screen's to decide. The join
 * screen owns that, and says so through `offline` (waiting to rejoin) and
 * `ended` (over), so the consultation stays where it is through a reload.
 */
const PATHS = new Set(["guided", "literate"]);

/** How long reconnecting can go on before the phone stops saying it is routine. */
export const STALLED_AFTER_MS = 30000;

export default function PatientDevice({
  channel,
  path: rememberedPath = null,
  emergency: rememberedEmergency = false,
  offline = false,
  ended = false,
  onLeave = null,
}) {
  const [path, setPath] = useState(PATHS.has(rememberedPath) ? rememberedPath : null);
  const [emergency, setEmergency] = useState(rememberedEmergency === true);
  const [toldEnded, setToldEnded] = useState(false);

  useEffect(() => {
    const message = channel.lastMessage;
    if (!message) return;

    if (message.type === "ended") setToldEnded(true);

    const announced =
      message.type === "path" || message.type === "question" || message.type === "emergency"
        ? message.path
        : null;
    if (PATHS.has(announced)) setPath(announced);

    const inEmergency = announcedEmergency(message);
    if (inEmergency !== undefined) setEmergency(inEmergency);
  }, [channel.lastMessage]);

  const over = ended || toldEnded;

  const away = offline && !over ? <Reconnecting onLeave={onLeave} /> : null;

  // The doctor's emergency screen, mirrored. Not once the consultation is over,
  // which is shown as over whatever the doctor had open when it ended.
  if (emergency && !over) {
    return (
      <>
        {away}
        <EmergencyTriageGuest channel={channel} offline={offline} />
      </>
    );
  }

  if (path === "guided") {
    return (
      <>
        {away}
        <GuidedInterrogationGuest
          channel={channel}
          offline={offline}
          forceEnded={over}
          onLeave={onLeave}
        />
      </>
    );
  }
  if (path === "literate") {
    return (
      <>
        {away}
        <DoctorConsultationGuest
          channel={channel}
          offline={offline}
          forceEnded={over}
          onLeave={onLeave}
        />
      </>
    );
  }

  if (over) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-ended">
        <h2 className="pairing__title">This consultation has ended</h2>
        <p className="pairing__hint" role="status">
          You can close this page. To join another consultation, open the app
          again and enter a new code.
        </p>
        {onLeave ? <JoinAnother onLeave={onLeave} /> : null}
      </section>
    );
  }

  if (offline) {
    return (
      <section className="pairing pairing--card" data-testid="patient-reconnecting">
        <p className="literacy__eyebrow">
          <span className="shell__dot shell__dot--connected" aria-hidden="true" />
          Reconnecting
        </p>
        <h2 className="pairing__title">Reconnecting to your doctor</h2>
        <p className="pairing__status" role="status">
          <span className="pairing__pulse" aria-hidden="true" />
          This usually takes a few seconds. Keep this page open.
        </p>
        {onLeave ? <LeaveLink onLeave={onLeave} /> : null}
      </section>
    );
  }

  return (
    <section className="pairing pairing--card" data-testid="patient-waiting">
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        Connected
      </p>
      <h2 className="pairing__title">You are connected to your doctor</h2>
      <p className="pairing__status" role="status">
        <span className="pairing__pulse" aria-hidden="true" />
        Waiting for the doctor to begin. Keep this screen open.
      </p>
    </section>
  );
}

/**
 * Said above the consultation while the phone is finding the doctor's device
 * again. The consultation itself stays on screen behind it, with its record,
 * so a reload does not take the patient's place away.
 */
function Reconnecting({ onLeave }) {
  // After a while of not finding the doctor's device, say so and say what to
  // do, instead of the same reassurance for ever. A few seconds is ordinary;
  // this long means the doctor's device is closed, offline, or not able to
  // take the phone back.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={stalled ? "away away--patient away--stalled" : "away away--patient"}
      role="status"
      data-testid="patient-reconnecting-banner"
      data-stalled={stalled || undefined}
    >
      <span className="pairing__pulse" aria-hidden="true" />
      <p className="away__text" data-testid="patient-reconnecting-text">
        {stalled
          ? "Still cannot reach your doctor's device. Ask the doctor to check that it is open and online. If it does not come back, leave and join again with a new code."
          : "Reconnecting to your doctor. You can carry on reading; replies are paused until it is back."}
      </p>
      {onLeave ? (
        <button
          type="button"
          className="away__action"
          onClick={onLeave}
          data-testid="leave-consultation"
        >
          Leave this consultation
        </button>
      ) : null}
    </div>
  );
}

function LeaveLink({ onLeave }) {
  return (
    <p className="entry__switch">
      <button
        type="button"
        className="entry__link"
        onClick={onLeave}
        data-testid="leave-consultation"
      >
        Leave this consultation
      </button>
    </p>
  );
}
