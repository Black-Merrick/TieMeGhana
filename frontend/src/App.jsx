import { useEffect, useState } from "react";

import { fetchHealth } from "./api/client.js";
import DoctorConsultation from "./components/DoctorConsultation.jsx";
import EmergencyTriage from "./components/EmergencyTriage.jsx";
import GuidedInterrogation from "./components/GuidedInterrogation.jsx";
import LiteracyCheck from "./components/LiteracyCheck.jsx";
import PrescriptionBuilder from "./components/PrescriptionBuilder.jsx";
import PrescriptionPlayback from "./components/PrescriptionPlayback.jsx";
import { referenceFromPath } from "./api/prescriptions.js";
import { clearCurrentExchange } from "./consultation/currentExchange.js";
import { clearTranscript } from "./transcript/transcript.js";
import {
  DEFAULT_OUTPUT_LANGUAGE,
  LiteracyPath,
  OutputLanguage,
  endVisit,
  loadVisit,
  saveOutputLanguage,
} from "./visit/visit.js";

/**
 * Application shell.
 *
 * Holds what SRS section 4.1 requires to be permanently visible rather than
 * hidden behind a menu, and routes the patient to the interaction path their
 * literacy answer selected, per FR 2.2.
 */
export default function App() {
  // A scanned QR code, FR 6.3. Read once, before anything else: this is the
  // patient's own phone at home, not a hospital device, and it must not be
  // shown a consultation shell, a literacy question, or any way into a visit.
  // Read from the path rather than held in state because nothing in the app
  // navigates to it; a scan is always a fresh page load.
  const [prescriptionReference] = useState(() => referenceFromPath());

  const [connection, setConnection] = useState("checking");

  // Migrations written but not applied to this database, reported by the
  // health endpoint. Surfaced here because the alternative is finding out from
  // a 500 mid consultation, about a column nobody has heard of, while the test
  // suite stays green because pytest builds its database from scratch.
  const [pendingMigrations, setPendingMigrations] = useState(null);

  // Read once on mount. A patient who reloads mid consultation keeps their
  // path, and a visit older than the safety window is treated as finished.
  const [visit, setVisit] = useState(() => loadVisit());

  // Emergency Visual Triage sits outside the visit, deliberately. FR 5 is for
  // a patient who may have arrived unconscious after an accident, and asking
  // whether they read before letting them say they cannot breathe would be
  // the wrong order. See ADR 040.
  const [emergency, setEmergency] = useState(false);

  // The prescription builder, FR 6.1. Inside the visit, unlike emergency mode:
  // it is the last thing that happens in a consultation, so there is always a
  // visit by the time it is wanted.
  const [prescribing, setPrescribing] = useState(false);

  // The listener's language still applies in an emergency, and there may be no
  // visit yet to have set it.
  const outputLanguage = visit?.outputLanguage ?? DEFAULT_OUTPUT_LANGUAGE;

  useEffect(() => {
    // The health check is for the hospital device. A patient opening their
    // prescription may well be offline, which is the point of FR 6.2, and
    // telling them the hospital system is unreachable would be alarming and
    // irrelevant.
    if (prescriptionReference) return undefined;

    let cancelled = false;

    fetchHealth()
      .then((health) => {
        if (cancelled) return;

        setConnection("connected");
        if (health?.migrations === "pending") {
          setPendingMigrations(health.pending_migrations ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setConnection("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [prescriptionReference]);

  /**
   * Finish this visit so the next patient is asked fresh.
   *
   * Always on screen rather than in a settings menu, because it is the control
   * that stops one patient's literacy answer being applied to the next person
   * handed the same device.
   */
  const startNewPatient = () => {
    endVisit();
    setEmergency(false);
    setPrescribing(false);

    // The transcript goes with the visit. This device is handed from one
    // patient to the next, and these consultations are about pregnancy,
    // sexually transmitted infections, and HIV status. Leaving one behind for
    // a stranger to read is the precise harm the project exists to prevent.
    // See ADR 026.
    clearTranscript();

    // Otherwise the next patient would find the previous patient's question
    // still on screen, waiting for them to answer it.
    clearCurrentExchange();

    setVisit(null);
  };

  /**
   * Change the language the patient's answers are spoken in, FR 3.4.
   *
   * Set once and applied for the rest of the visit, and permanently on screen
   * rather than in settings, per section 4.1.
   */
  const changeOutputLanguage = (language) => {
    setVisit(saveOutputLanguage(language) ?? loadVisit());
  };

  // Nothing else renders. No shell, no bar, no route back into the app: a link
  // anyone holding the phone can open shows a prescription and stops there.
  // FR 6.4.
  if (prescriptionReference) {
    return (
      <main className="shell">
        <h1 className="shell__title">Tie Me Ghana</h1>
        <PrescriptionPlayback reference={prescriptionReference} />
      </main>
    );
  }

  return (
    <main className="shell">
      <h1 className="shell__title">Tie Me Ghana</h1>
      <p className="shell__subtitle">
        Hospital communication for Deaf and Hard of Hearing patients
      </p>

      <div className="shell__bar">
        <p className="shell__status" data-testid="connection-status">
          <span
            className={`shell__dot shell__dot--${connection}`}
            aria-hidden="true"
          />
          {CONNECTION_LABELS[connection]}
        </p>

        {/* Always on screen, with no visit required. A responder should not
            have to find a menu, and FR 5 exists for the case where there is no
            time to set anything up. */}
        {emergency ? null : (
          <button
            type="button"
            className="shell__emergency"
            onClick={() => setEmergency(true)}
            data-testid="enter-emergency"
          >
            Emergency
          </button>
        )}

        {visit ? (
          <>
            {/* Section 4.1, the path indicator is never buried in settings. */}
            <p className="shell__path" data-testid="literacy-path">
              {PATH_LABELS[visit.literacyPath]}
            </p>
            <fieldset className="shell__output" data-testid="output-language">
              <legend className="shell__output-legend">Speak answers in</legend>
              {[
                { value: OutputLanguage.ENGLISH, label: "English" },
                { value: OutputLanguage.TWI, label: "Twi" },
              ].map((language) => (
                <label key={language.value} className="consultation__language">
                  <input
                    type="radio"
                    name="output-language"
                    value={language.value}
                    checked={visit.outputLanguage === language.value}
                    onChange={() => changeOutputLanguage(language.value)}
                  />
                  {language.label}
                </label>
              ))}
            </fieldset>

            {prescribing ? null : (
              <button
                type="button"
                className="shell__prescribe"
                onClick={() => setPrescribing(true)}
                data-testid="enter-prescription"
              >
                Prescription
              </button>
            )}

            <button
              type="button"
              className="shell__new-patient"
              onClick={startNewPatient}
              data-testid="new-patient"
            >
              New patient
            </button>
          </>
        ) : null}
      </div>

      {/* Development only in practice, but shown rather than logged: a
          console warning is a warning nobody reads. */}
      {pendingMigrations ? (
        <p className="shell__schema" role="alert" data-testid="pending-migrations">
          This database is missing {pendingMigrations.length} migration
          {pendingMigrations.length === 1 ? "" : "s"}. Parts of the app will
          fail with a database error until you run{" "}
          <code>python manage.py migrate</code>.
          {pendingMigrations.length ? ` Pending: ${pendingMigrations.join(", ")}.` : ""}
        </p>
      ) : null}

      {emergency ? (
        <EmergencyTriage
          outputLanguage={outputLanguage}
          onLeave={() => setEmergency(false)}
        />
      ) : prescribing && visit ? (
        <PrescriptionBuilder onLeave={() => setPrescribing(false)} />
      ) : visit ? (
        <PatientPath path={visit.literacyPath} outputLanguage={outputLanguage} />
      ) : (
        <LiteracyCheck onDecided={() => setVisit(loadVisit())} />
      )}
    </main>
  );
}

/**
 * Whichever consultation flow the literacy answer selected.
 *
 * The two paths are mutually exclusive by construction. A patient on the
 * guided path is never rendered a caption input, which is the structural
 * version of the constraint in SRS section 4.3 rather than a rule someone has
 * to remember.
 */
function PatientPath({ path, outputLanguage }) {
  if (path === LiteracyPath.LITERATE) {
    return <DoctorConsultation outputLanguage={outputLanguage} />;
  }
  return <GuidedInterrogation outputLanguage={outputLanguage} />;
}

// Status wording is user facing, so it lives in one place rather than being
// assembled inline, ready for translation alongside the rest of the UI copy.
const CONNECTION_LABELS = {
  checking: "Checking connection to the hospital system",
  connected: "Connected to the hospital system",
  offline: "Offline, cached content only",
};

const PATH_LABELS = {
  [LiteracyPath.LITERATE]: "Reads and writes",
  [LiteracyPath.GUIDED]: "Guided Interrogation",
};
