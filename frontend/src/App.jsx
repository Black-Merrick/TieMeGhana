import { useEffect, useState } from "react";

import { fetchHealth } from "./api/client.js";
import DoctorConsultation from "./components/DoctorConsultation.jsx";
import LiteracyCheck from "./components/LiteracyCheck.jsx";
import { LiteracyPath, endVisit, loadVisit } from "./visit/visit.js";

/**
 * Application shell.
 *
 * Holds what SRS section 4.1 requires to be permanently visible rather than
 * hidden behind a menu, and routes the patient to the interaction path their
 * literacy answer selected, per FR 2.2.
 */
export default function App() {
  const [connection, setConnection] = useState("checking");

  // Read once on mount. A patient who reloads mid consultation keeps their
  // path, and a visit older than the safety window is treated as finished.
  const [visit, setVisit] = useState(() => loadVisit());

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then(() => {
        if (!cancelled) setConnection("connected");
      })
      .catch(() => {
        if (!cancelled) setConnection("offline");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Finish this visit so the next patient is asked fresh.
   *
   * Always on screen rather than in a settings menu, because it is the control
   * that stops one patient's literacy answer being applied to the next person
   * handed the same device.
   */
  const startNewPatient = () => {
    endVisit();
    setVisit(null);
  };

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

        {visit ? (
          <>
            {/* Section 4.1, the path indicator is never buried in settings. */}
            <p className="shell__path" data-testid="literacy-path">
              {PATH_LABELS[visit.literacyPath]}
            </p>
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

      {visit ? (
        <PatientPath path={visit.literacyPath} />
      ) : (
        <LiteracyCheck onDecided={() => setVisit(loadVisit())} />
      )}
    </main>
  );
}

/** Whichever consultation flow the literacy answer selected. */
function PatientPath({ path }) {
  if (path === LiteracyPath.LITERATE) return <DoctorConsultation />;

  // Guided Interrogation Mode, FR 2.4 to 2.7, is the next sprint. Staff facing
  // rather than patient facing, since it is the doctor who drives that flow.
  return (
    <p className="consultation__note" data-testid="guided-not-built">
      This patient needs Guided Interrogation Mode, which is not built yet.
      Use the clinical question bank on paper for now, and do not fall back to
      typed captions for this patient.
    </p>
  );
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
