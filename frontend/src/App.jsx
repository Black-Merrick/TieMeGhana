import { Suspense, lazy, useEffect, useState } from "react";

import { fetchHealth } from "./api/client.js";
import DoctorConsultation from "./components/DoctorConsultation.jsx";
import GuidedInterrogation from "./components/GuidedInterrogation.jsx";
import InstallApp from "./components/InstallApp.jsx";
import LiteracyCheck from "./components/LiteracyCheck.jsx";
import ScreenLoader from "./components/ScreenLoader.jsx";

/*
 * Split out of the main bundle, fetched the first time they are opened.
 *
 * The consultation is not, and that asymmetry is the point: it is what the
 * app opens into, so making it wait on a second request would put a gap in
 * front of every visit. Emergency triage and the prescription screens are
 * each reached by a deliberate tap, and prescription playback is a different
 * device entirely, arriving by QR code, where nothing else in the bundle is
 * wanted at all.
 */
const EmergencyTriage = lazy(() => import("./components/EmergencyTriage.jsx"));
const PrescriptionBuilder = lazy(
  () => import("./components/PrescriptionBuilder.jsx"),
);
const PrescriptionPlayback = lazy(
  () => import("./components/PrescriptionPlayback.jsx"),
);
import ConnectionStatus from "./components/ConnectionStatus.jsx";
import { referenceFromPath } from "./api/prescriptions.js";
import LegalScreen from "./legal/LegalScreen.jsx";
import {
  LegalDocument,
  legalDocumentFromPath,
  pathForLegalDocument,
} from "./legal/documents.js";
import { clearCurrentExchange } from "./consultation/currentExchange.js";
import {
  clearCurrentPrescription,
  loadCurrentPrescription,
} from "./prescription/currentPrescription.js";
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

  // The privacy policy and the terms, at /privacy and /terms. Held in state as
  // well as in the address so opening one does not tear down the consultation
  // behind it: a clinician checking what the app stores, mid visit, must come
  // back to the question they were on rather than to an empty screen.
  const [legal, setLegal] = useState(() => legalDocumentFromPath());

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
  //
  // Opened on load when a prescription is already issued, so a reload comes
  // back to the QR code rather than to the consultation behind it. Losing it
  // would mean issuing a second prescription, leaving the first one live and
  // scannable with nothing to say it was replaced.
  const [prescribing, setPrescribing] = useState(
    () => loadCurrentPrescription() !== null,
  );

  // The listener's language still applies in an emergency, and there may be no
  // visit yet to have set it.
  const outputLanguage = visit?.outputLanguage ?? DEFAULT_OUTPUT_LANGUAGE;

  /**
   * Open or close a legal document, keeping the address in step.
   *
   * pushState rather than assigning to location, so the consultation behind it
   * is never unloaded and coming back is instant even with no connection.
   */
  const openLegal = (document) => {
    setLegal(document);
    window.history.pushState({ legal: document }, "", pathForLegalDocument(document));
    // A document opened from the bottom of a long consultation would otherwise
    // begin part way down, which reads as a broken page rather than a new one.
    window.scrollTo(0, 0);
  };

  const leaveLegal = () => {
    setLegal(null);
    window.history.pushState({ legal: null }, "", "/");
  };

  // The browser's own back button, which is the one a patient will reach for.
  useEffect(() => {
    const onPopState = () => setLegal(legalDocumentFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

    // The prescription goes with the visit, for the reasons in ADR 026. The
    // reference identifies nobody, per ADR 044, but this device is handed from
    // one patient to the next and the next one must not find these medicines.
    clearCurrentPrescription();

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

  // The documents come first, and they are plain content with no dependency on
  // a visit, a connection or a database. Somebody sent a link to the privacy
  // policy must get the privacy policy, not a consultation screen that happens
  // to be what the app usually opens into.
  if (legal) {
    return (
      <div className="app">
        <main className="shell">
          <LegalScreen
            document={legal}
            onOpen={openLegal}
            onLeave={leaveLegal}
          />
        </main>
      </div>
    );
  }

  // Nothing else renders. No shell, no bar, no route back into the app: a link
  // anyone holding the phone can open shows a prescription and stops there.
  // FR 6.4.
  if (prescriptionReference) {
    return (
      <div className="app">
        <main className="shell">
          <h1 className="shell__title">Tie Me Ghana</h1>
          <Suspense fallback={<ScreenLoader label="Opening your prescription" />}>
            <PrescriptionPlayback reference={prescriptionReference} />
          </Suspense>
        </main>
        {/* The one exception to "no route back into the app", and it has to be.
            This is the screen a patient reaches on their own phone, so it is
            exactly where the policy has to be reachable. These are documents,
            not a way into a consultation. */}
        <LegalFooter onOpen={openLegal} />
      </div>
    );
  }

  // Two columns that scroll independently, on the screens built as two
  // columns: the consultation and emergency triage. Emergency qualifies with
  // no visit at all, because it is reachable before the literacy check.
  //
  // On a phone the columns are stacked and the page scrolls as one, because
  // two short scroll panes on top of each other is worse than one page.
  const split = emergency || (Boolean(visit) && !prescribing);

  // The prescription is two columns as well, so it takes the full width, but
  // it is not a pair of independent scroll panes: the code is sticky and the
  // medicines scroll with the page, which is one thing to follow rather than
  // two.
  const wide = split || prescribing;

  return (
    <div className={split ? "app app--split" : "app"}>
      <header className="topbar">
        <div className="topbar__brand">
          {/* The app's mark, from public/icon.png via tools/build_icons.py.
              The 96px derivative rather than the 512px source: it draws at
              about 38px, and the source is a quarter of a megabyte.

              The alt is empty because the name is right beside it, and
              announcing both would read the app's name twice. */}
          <img
            className="topbar__logo"
            src="/icon-96.png"
            alt=""
            width="38"
            height="38"
          />
          {/* Stacked beside the mark, not strung out after it: the name is the
              heading and the line under it describes the app. */}
          <div className="topbar__names">
            <h1 className="topbar__title">Tie Me Ghana</h1>
            <p className="topbar__subtitle">
              Hospital communication for Deaf and Hard of Hearing patients
            </p>
          </div>
        </div>

        {/* Four groups rather than one row of controls, so the layout can
            place them differently on a phone: the name and Emergency on the
            first line, the status under it, and the two secondary actions in a
            bar at the bottom of the screen where a thumb reaches. */}
        <div className="topbar__status">
          <ConnectionStatus state={connection} />

          {visit ? (
            <>
              {/* Section 4.1, the path indicator is never buried in
                  settings. */}
              <p className="pill pill--info shell__path" data-testid="literacy-path">
                {PATH_LABELS[visit.literacyPath]}
              </p>
            </>
          ) : null}
        </div>

        <div className="topbar__actions">
          {/* Always here, with or without a visit. It used to sit on the
              literacy screen, which meant it vanished the moment a
              consultation started and could only be found again by ending
              one. Installing is a one time action and belongs somewhere it
              can be reached at any point. */}
          <InstallApp />

          {visit ? (
            <>
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

        {/* Always present, with no visit required. A responder should not have
            to find a menu, and FR 5 exists for the case where there is no time
            to set anything up. First line on a phone, for the same reason. */}
        <div className="topbar__primary">
          {emergency ? null : (
            <button
              type="button"
              className="shell__emergency"
              onClick={() => setEmergency(true)}
              data-testid="enter-emergency"
            >
              <span className="btn__icon" aria-hidden="true">
                <AlertIcon />
              </span>
              Emergency
            </button>
          )}
        </div>
      </header>

      <main className={wide ? "shell shell--wide" : "shell"}>

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
        <Suspense fallback={<ScreenLoader label="Opening emergency mode" />}>
          <EmergencyTriage
            outputLanguage={outputLanguage}
            // Emergency is reachable before a visit exists, so it may be the
            // first screen anyone sees. Without this the responder was stuck
            // with whatever the default happened to be, and a Twi speaking
            // clinician heard every tap read out in English with no way to
            // change it.
            onOutputLanguageChange={changeOutputLanguage}
            onLeave={() => setEmergency(false)}
          />
        </Suspense>
      ) : prescribing && visit ? (
        <Suspense fallback={<ScreenLoader label="Opening the prescription" />}>
          <PrescriptionBuilder onLeave={() => setPrescribing(false)} />
        </Suspense>
      ) : visit ? (
        <PatientPath
          path={visit.literacyPath}
          outputLanguage={outputLanguage}
          onOutputLanguageChange={changeOutputLanguage}
        />
        ) : (
          <LiteracyCheck onDecided={() => setVisit(loadVisit())} />
        )}
      </main>

      <LegalFooter onOpen={openLegal} />
    </div>
  );
}

/**
 * Where the privacy policy and the terms are reachable from.
 *
 * On every screen, because a policy somebody has to go looking for is a policy
 * written for nobody. Real links with real addresses rather than buttons, so
 * they can be opened in a new tab, copied, and sent to a hospital's data
 * protection officer without first being found inside a running app.
 *
 * The click is intercepted to keep the consultation behind it alive; holding a
 * modifier, or right clicking, falls through to the browser and opens the
 * address properly.
 */
function LegalFooter({ onOpen }) {
  const open = (event, document) => {
    // Let the browser handle anything that is not a plain left click: a new
    // tab, a new window, a saved link.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onOpen(document);
  };

  return (
    <footer className="legal-footer" data-testid="legal-footer">
      <p className="legal-footer__note">
        A pilot for the MTN Ghana Tekyerema Pa Hackathon 2026. Not yet approved
        for clinical use.
      </p>
      <nav className="legal-footer__links" aria-label="Legal">
        <a
          href={pathForLegalDocument(LegalDocument.PRIVACY)}
          onClick={(event) => open(event, LegalDocument.PRIVACY)}
          data-testid="open-privacy"
        >
          Privacy Policy
        </a>
        <a
          href={pathForLegalDocument(LegalDocument.TERMS)}
          onClick={(event) => open(event, LegalDocument.TERMS)}
          data-testid="open-terms"
        >
          Terms of Use
        </a>
      </nav>
    </footer>
  );
}

/* Inline so the emergency control cannot lose its mark on a slow connection. */
function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M10 2.8 18.2 17H1.8L10 2.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 7.6v4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="1" fill="currentColor" />
    </svg>
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
function PatientPath({ path, outputLanguage, onOutputLanguageChange }) {
  if (path === LiteracyPath.LITERATE) {
    return (
      <DoctorConsultation
        outputLanguage={outputLanguage}
        onOutputLanguageChange={onOutputLanguageChange}
      />
    );
  }
  return (
    <GuidedInterrogation
      outputLanguage={outputLanguage}
      onOutputLanguageChange={onOutputLanguageChange}
    />
  );
}

const PATH_LABELS = {
  [LiteracyPath.LITERATE]: "Reads and writes",
  [LiteracyPath.GUIDED]: "Guided Interrogation",
};
