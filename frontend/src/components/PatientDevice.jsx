import { useEffect, useRef, useState } from "react";

import {
  announcedEmergency,
  announcedLiteracy,
  announcedPath,
  announcedPrescription,
} from "../pairing/announcedScreen.js";
import { saveGuestResume } from "../pairing/resume.js";
import DoctorConsultationGuest from "./DoctorConsultationGuest.jsx";
import EmergencyTriageGuest from "./EmergencyTriageGuest.jsx";
import LiteracyCheck from "./LiteracyCheck.jsx";
import GuidedInterrogationGuest from "./GuidedInterrogationGuest.jsx";
import JoinAnother from "./JoinAnother.jsx";
import PrescriptionGuest from "./PrescriptionGuest.jsx";

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
 * The prescription is followed the same way. When the doctor issues one, the
 * phone is sent its reference (all it is ever sent: the medicines are fetched
 * from the server, as after scanning the code) and opens it, and it stays the
 * patient's: it is not taken away when the doctor presses Done, when emergency
 * mode opens and closes, or when the consultation ends. The patient can go back
 * to the conversation and return to it from a bar at the top. A reference the
 * phone already has, sent again when a connection comes back, does not pull the
 * patient away from where they were.
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
  prescription: rememberedPrescription = null,
  prescriptionOpen: rememberedOpen = false,
  offline = false,
  ended = false,
  onLeave = null,
}) {
  const [path, setPath] = useState(PATHS.has(rememberedPath) ? rememberedPath : null);
  const [emergency, setEmergency] = useState(rememberedEmergency === true);
  // Whether the doctor is asking the literacy question. Not remembered across
  // a reload: it is true only while there is no answer, and the doctor's device
  // says so again the moment this phone reconnects.
  const [asked, setAsked] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [reference, setReference] = useState(rememberedPrescription);
  const [looking, setLooking] = useState(rememberedPrescription !== null && rememberedOpen);
  const referenceRef = useRef(rememberedPrescription);
  const [toldEnded, setToldEnded] = useState(false);

  useEffect(() => {
    const message = channel.lastMessage;
    if (!message) return;

    if (message.type === "ended") setToldEnded(true);

    const announced = announcedPath(message);
    if (PATHS.has(announced)) setPath(announced);

    const inEmergency = announcedEmergency(message);
    if (inEmergency !== undefined) setEmergency(inEmergency);

    if (announcedLiteracy(message)) setAsked(true);
    // Answered, by whichever device answered it: the doctor's next message
    // says which consultation this is, and the question is over.
    if (PATHS.has(announced)) {
      setAsked(false);
      setAnswered(false);
    }

    // A prescription this phone has not seen: opened, and remembered so a
    // reload comes back to it. One it already has changes nothing.
    const issued = announcedPrescription(message);
    if (issued && issued !== referenceRef.current) {
      referenceRef.current = issued;
      setReference(issued);
      setLooking(true);
      saveGuestResume({ prescription: issued, prescriptionOpen: true });
    }
  }, [channel.lastMessage]);

  const over = ended || toldEnded;

  const look = (open) => {
    setLooking(open);
    saveGuestResume({ prescriptionOpen: open });
  };

  const reconnecting = offline && !over ? <Reconnecting onLeave={onLeave} /> : null;
  // What is kept for the patient, offered wherever else they are.
  const bar =
    reference && !looking ? (
      <MedicinesBar onOpen={() => look(true)} />
    ) : null;
  const away = (
    <>
      {reconnecting}
      {bar}
    </>
  );

  // The doctor's emergency screen, mirrored. Not once the consultation is over,
  // which is shown as over whatever the doctor had open when it ended.
  if (emergency && !over) {
    return (
      <>
        {reconnecting}
        <EmergencyTriageGuest channel={channel} offline={offline} />
      </>
    );
  }

  // The medicines, when the patient is looking at them. Over the consultation,
  // which is where "back" goes, and still here once the consultation has ended.
  if (reference && looking) {
    return (
      <>
        {reconnecting}
        <PrescriptionGuest reference={reference} over={over} onBack={() => look(false)} />
      </>
    );
  }

  // The literacy question, asked on this phone as well as on the doctor's
  // screen. FR 2.1: a Deaf patient cannot be asked whether they read by being
  // shown words on a device across the room. Either device may answer it, and
  // the doctor's device records whichever came first. See ADR 060.
  if (asked && !path && !over) {
    return (
      <>
        {away}
        {answered ? (
          <section className="pairing pairing--card" data-testid="literacy-answered">
            <p className="literacy__eyebrow">
              <span className="shell__dot shell__dot--connected" aria-hidden="true" />
              Answer sent
            </p>
            <h2 className="pairing__title">Thank you</h2>
            <p className="pairing__status" role="status">
              <span className="pairing__pulse" aria-hidden="true" />
              Your doctor is starting the consultation.
            </p>
          </section>
        ) : (
          <LiteracyCheck
            onOwnPhone
            onDecided={(chosen) => {
              setAnswered(true);
              channel.send({
                type: "literacy-answer",
                value: chosen === "literate",
              });
            }}
          />
        )}
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
      <>
      {bar}
      <section className="pairing pairing--card" data-testid="pairing-ended">
        <h2 className="pairing__title">This consultation has ended</h2>
        <p className="pairing__hint" role="status">
          You can close this page. To join another consultation, open the app
          again and enter a new code.
        </p>
        {onLeave ? <JoinAnother onLeave={onLeave} /> : null}
      </section>
      </>
    );
  }

  if (offline) {
    return (
      <>
      {bar}
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
      </>
    );
  }

  return (
    <>
    {bar}
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
    </>
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

/**
 * Said at the top of every screen but the medicines and the emergency, once the
 * doctor has issued a prescription, so the patient can always get back to it.
 * A button they can see rather than a thing to remember: it is the one part of
 * the visit they take home.
 */
function MedicinesBar({ onOpen }) {
  return (
    <div className="medicines-bar" data-testid="medicines-bar">
      <p className="medicines-bar__text">Your medicines are ready.</p>
      <button
        type="button"
        className="medicines-bar__open"
        onClick={onOpen}
        data-testid="view-medicines"
      >
        View my medicines
      </button>
    </div>
  );
}
