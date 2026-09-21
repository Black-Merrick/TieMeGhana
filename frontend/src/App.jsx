import { Suspense, useEffect, useState } from "react";

import { fetchHealth } from "./api/client.js";
import AppBrand from "./components/AppBrand.jsx";
import DeviceChoice from "./components/DeviceChoice.jsx";
import DoctorConsultation from "./components/DoctorConsultation.jsx";
import DoctorConsultationHost from "./components/DoctorConsultationHost.jsx";
import GuidedInterrogation from "./components/GuidedInterrogation.jsx";
import GuidedInterrogationHost from "./components/GuidedInterrogationHost.jsx";
import InstallApp from "./components/InstallApp.jsx";
import LiteracyCheck from "./components/LiteracyCheck.jsx";
import ScreenLoader from "./components/ScreenLoader.jsx";
import RoleChoice from "./components/RoleChoice.jsx";
import ScreenErrorBoundary from "./components/ScreenErrorBoundary.jsx";
import lazyScreen from "./lazyScreen.js";
import SetupProgress from "./components/SetupProgress.jsx";
import useClipWarmup from "./hooks/useClipWarmup.js";

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
const EmergencyTriage = lazyScreen(() => import("./components/EmergencyTriage.jsx"));
const PrescriptionBuilder = lazyScreen(
  () => import("./components/PrescriptionBuilder.jsx"),
);
const PrescriptionPlayback = lazyScreen(
  () => import("./components/PrescriptionPlayback.jsx"),
);
import ConnectionStatus from "./components/ConnectionStatus.jsx";
import PairingHostScreen from "./components/PairingHostScreen.jsx";
import PairingJoinScreen from "./components/PairingJoinScreen.jsx";
import usePairedHostSession from "./hooks/usePairedHostSession.js";
import {
  DeviceMode,
  clearDeviceMode,
  loadDeviceMode,
  saveDeviceMode,
} from "./pairing/deviceMode.js";
import { clearLastQuestion, loadLastQuestion } from "./pairing/lastQuestion.js";
import { loadRole, saveDoctorRole } from "./pairing/role.js";
import { PeerState } from "./webrtc/peerChannel.js";
import { referenceFromPath } from "./api/prescriptions.js";
import { isJoinPath } from "./api/pairing.js";
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
import { Screen, clearScreen, loadScreen, saveScreen } from "./visit/screen.js";
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

  // The patient's own device, joining a doctor's visit by a typed code, ADR
  // 053. Read once for the same reason as the prescription reference above:
  // this is a fresh page load on a phone that has never opened the app
  // before, and it must not be shown a literacy question or any other way
  // into the app.
  // State, not a constant, because the patient's own door into the app is a
  // button on the first screen rather than only a typed address: choosing it
  // moves the address to /join without loading a new page, which is what the
  // browser's back button then undoes.
  const [joining, setJoining] = useState(() => isJoinPath());

  // The privacy policy and the terms, at /privacy and /terms. Held in state as
  // well as in the address so opening one does not tear down the consultation
  // behind it: a clinician checking what the app stores, mid visit, must come
  // back to the question they were on rather than to an empty screen.
  const [legal, setLegal] = useState(() => legalDocumentFromPath());

  const [connection, setConnection] = useState("checking");

  // Stocking the device with sign videos on first open, reported on screen.
  // Null once everything is already cached, which is every visit after the
  // first, and the indicator then renders nothing.
  const clipWarmup = useClipWarmup();

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
  //
  // Remembered across a reload like the visit is, so refreshing the page
  // brings the doctor back to the screen they were on and not to the
  // consultation behind it.
  const [emergency, setEmergencyState] = useState(
    () => loadScreen() === Screen.EMERGENCY,
  );
  const setEmergency = (open) => {
    setEmergencyState(open);
    if (open) saveScreen(Screen.EMERGENCY);
    else clearScreen();
  };

  // The prescription builder, FR 6.1. Inside the visit, unlike emergency mode:
  // it is the last thing that happens in a consultation, so there is always a
  // visit by the time it is wanted.
  //
  // Opened on load when a prescription is already issued, so a reload comes
  // back to the QR code rather than to the consultation behind it. Losing it
  // would mean issuing a second prescription, leaving the first one live and
  // scannable with nothing to say it was replaced.
  const [prescribing, setPrescribingState] = useState(
    () =>
      loadCurrentPrescription() !== null ||
      (loadVisit() !== null && loadScreen() === Screen.PRESCRIPTION),
  );
  const setPrescribing = (open) => {
    setPrescribingState(open);
    if (open) saveScreen(Screen.PRESCRIPTION);
    else clearScreen();
  };

  // The listener's language still applies in an emergency, and there may be no
  // visit yet to have set it.
  const outputLanguage = visit?.outputLanguage ?? DEFAULT_OUTPUT_LANGUAGE;

  // Whether the patient has their own phone, asked before anything else. Kept
  // out of `visit` because it is answered before a visit exists, and read as
  // "shared" when a visit is present with no answer, which is how every visit
  // began before pairing existed. See ADR 053.
  const [deviceMode, setDeviceMode] = useState(() => loadDeviceMode());

  // Whether this device has been chosen as a doctor's. Asked once, before the
  // question above, so a patient's phone has somewhere to go that is not the
  // doctor's screen. See ADR 053.
  const [role, setRole] = useState(() => loadRole());
  const paired = deviceMode === DeviceMode.PAIRED;

  // The connection to the patient's phone, held here, above every screen, so
  // that opening Prescription, Emergency or a legal document mid visit cannot
  // drop it. Off on the patient's own phone (`/join`) and on a prescription
  // link, which share this browser's storage in testing and must never mint a
  // code of their own.
  const session = usePairedHostSession({
    enabled: paired && !joining && !prescriptionReference,
  });
  const patientConnected = session.state === PeerState.CONNECTED;

  // What the patient's phone needs to be on the right screen, sent every time
  // it connects, which includes coming back after a reload of either device,
  // and every time the doctor opens or leaves emergency mode.
  //
  // The literacy answer is given after the two devices connect, so the phone
  // learns which screen it is for from here. The token is the way back for the
  // next reload. And the last question is sent again, marked as such, so a
  // phone that has just reloaded is not left blank until the doctor's next one.
  // Sent in one place and in this order, because the connection hands a
  // component only its newest message: the last of these is the one a screen
  // reads, so each carries the token, the path and whether emergency mode is
  // open itself.
  //
  // Emergency mode goes last while it is open, so it is the one the phone
  // reads, and there is no question sent behind it: the phone is on the
  // emergency screen and the question waits. Leaving it sends the question
  // again, which is what puts the phone back on the consultation as it was.
  //
  // "Open" here means the doctor's own emergency screen is actually on screen,
  // not that it was asked for. It is a separate screen fetched when first
  // opened, and can fail to arrive or to draw; a phone sent there while the
  // doctor's device could not follow would let the patient tap into a screen
  // nobody is listening to. So the phone follows what the doctor can see.
  const [emergencyShown, setEmergencyShown] = useState(false);
  const mirroredEmergency = emergency && emergencyShown;
  const literacyPath = visit?.literacyPath ?? null;
  useEffect(() => {
    if (!paired || !patientConnected) return;
    const resume = session.token ?? undefined;

    if (!literacyPath) {
      if (mirroredEmergency) {
        session.channel.send({ type: "emergency", emergency: true, resume });
      } else if (resume) {
        session.channel.send({ type: "resume", resume, emergency: mirroredEmergency });
      }
      return;
    }

    session.channel.send({
      type: "path",
      path: literacyPath,
      resume,
      emergency: mirroredEmergency,
    });
    if (mirroredEmergency) {
      session.channel.send({
        type: "emergency",
        path: literacyPath,
        resume,
        emergency: true,
      });
      return;
    }

    const last = loadLastQuestion();
    if (last) {
      session.channel.send({
        ...last,
        path: literacyPath,
        resume,
        emergency: false,
        resent: true,
      });
    }
    // `send` is stable for the life of a connection; the connection itself
    // is what this is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, patientConnected, literacyPath, mirroredEmergency, session.code, session.token]);

  // The literacy check, which is what the app opens into before a visit
  // exists. `visit` alone would be enough, since the prescription builder is
  // only reachable inside one, but emergency mode is reachable without a visit
  // at all and must not carry the footer either.
  const showingOpeningScreen = !emergency && !visit;

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

  // Between the two doors of the first screen. pushState for the same reason
  // as the legal documents: nothing is unloaded, and back returns to the choice.
  const goToJoin = () => {
    setJoining(true);
    window.history.pushState({ join: true }, "", "/join");
    window.scrollTo(0, 0);
  };

  const leaveJoin = () => {
    setJoining(false);
    window.history.pushState({ join: false }, "", "/");
    window.scrollTo(0, 0);
  };

  const chooseDoctor = () => setRole(saveDoctorRole());

  const leaveLegal = () => {
    setLegal(null);
    window.history.pushState({ legal: null }, "", "/");
  };

  // The browser's own back button, which is the one a patient will reach for.
  useEffect(() => {
    const onPopState = () => {
      setLegal(legalDocumentFromPath());
      setJoining(isJoinPath());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // The health check is for the hospital device. A patient opening their
    // prescription may well be offline, which is the point of FR 6.2, and
    // telling them the hospital system is unreachable would be alarming and
    // irrelevant. The same reasoning covers a patient joining a paired
    // visit: that screen has no topbar to show a status on, and the
    // connection that matters to it is the one straight to the doctor's
    // device, not this one.
    if (prescriptionReference || joining) return undefined;

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
  }, [prescriptionReference, joining]);

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
    clearLastQuestion();
    clearScreen();

    // The next patient is asked about their phone afresh. Turning the mode off
    // is also what ends the connection, and tells the phone that was on it.
    clearDeviceMode();
    setDeviceMode(null);

    setVisit(null);
  };

  const chooseDeviceMode = (mode) => setDeviceMode(saveDeviceMode(mode));
  const useThisDeviceInstead = () => setDeviceMode(saveDeviceMode(DeviceMode.SHARED));

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
        <SetupProgress progress={clipWarmup} />
      </div>
    );
  }

  // The patient's own device, reached by typing in a code rather than by a QR
  // scan. Its own shell rather than the doctor's: a brand bar and one centred
  // column that fills out on a desktop, with none of the doctor's controls,
  // since nothing in them is for a patient. The clips are warmed here as well,
  // so the doctor's first message plays without waiting on a download. ADR 053.
  if (joining) {
    return (
      <div className="app app--patient">
        <header className="topbar topbar--patient">
          <AppBrand />
        </header>
        <main className="shell shell--patient">
          {/* A fault in one screen must not blank this phone. Its place in the
              consultation is kept on the phone, so reloading, which is what
              this offers, comes back to it. */}
          <ScreenErrorBoundary
            title="Something went wrong on this screen"
            keepsVisit
            reloadable
          >
            <PairingJoinScreen onLeave={leaveJoin} />
          </ScreenErrorBoundary>
        </main>
        <SetupProgress progress={clipWarmup} />
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
        <AppBrand />

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

      {/* A fault in whichever screen is showing stays in that screen. The
          connection to the patient's phone is held above this, and used to be
          taken down with it: the page went blank and the phone was told the
          consultation had ended. The error is cleared on moving to another
          screen. */}
      <ScreenErrorBoundary
        resetKey={emergency ? "emergency" : prescribing ? "prescription" : "main"}
        keepsVisit={Boolean(visit) && paired}
        onBack={emergency ? () => setEmergency(false) : prescribing ? () => setPrescribing(false) : null}
        backLabel={emergency ? "Leave emergency mode" : "Back to the consultation"}
      >
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
            onShownChange={setEmergencyShown}
            // In a paired visit the patient's phone shows this screen too, and
            // its taps arrive here to be spoken. See ADR 053.
            channel={paired ? session.channel : null}
            patientPhone={paired ? (patientConnected ? "connected" : "away") : null}
          />
        </Suspense>
      ) : prescribing && visit ? (
        <Suspense fallback={<ScreenLoader label="Opening the prescription" />}>
          <PrescriptionBuilder onLeave={() => setPrescribing(false)} />
        </Suspense>
      ) : visit ? (
        paired ? (
          patientConnected || session.resumable ? (
            <>
              {/* The doctor stays on the consultation while the patient's phone
                  is away, and is told. It comes back by itself: nothing here
                  needs doing, and nothing on the screen moves. */}
              {patientConnected ? null : (
                <PatientAway onNewCode={session.retry} />
              )}
              <PairedPatientPath
                path={visit.literacyPath}
                channel={session.channel}
                outputLanguage={outputLanguage}
                onOutputLanguageChange={changeOutputLanguage}
              />
            </>
          ) : (
            <PairingHostScreen
              session={session}
              reconnecting
              onUseThisDeviceInstead={useThisDeviceInstead}
            />
          )
        ) : (
          <PatientPath
            path={visit.literacyPath}
            outputLanguage={outputLanguage}
            onOutputLanguageChange={changeOutputLanguage}
          />
        )
      ) : deviceMode === null && role === null ? (
        <RoleChoice onDoctor={chooseDoctor} onPatient={goToJoin} />
      ) : deviceMode === null ? (
        <DeviceChoice onChosen={chooseDeviceMode} onJoinInstead={goToJoin} />
      ) : paired && !patientConnected ? (
        <PairingHostScreen
          session={session}
          onUseThisDeviceInstead={useThisDeviceInstead}
        />
      ) : (
        <LiteracyCheck onDecided={() => setVisit(loadVisit())} />
      )}
      </ScreenErrorBoundary>
      </main>

      {/* The opening screen only.

          These belong where somebody is deciding whether to use the app, not
          under a consultation that is already happening. On every other screen
          the footer competed with the work: it sat beneath the body map in an
          emergency, and under the doctor's message box mid visit, offering a
          document to read to somebody who is treating a patient.

          Both addresses still work when typed or followed from elsewhere, so
          nothing is unreachable. They are simply not advertised on top of a
          consultation. */}
      {showingOpeningScreen ? <LegalFooter onOpen={openLegal} /> : null}
      <SetupProgress progress={clipWarmup} />
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
/**
 * The user manual, built by tools/build-manual.mjs into public/.
 *
 * A plain path rather than an import, because it is a static file copied
 * through the build rather than a module, and because the name is also typed
 * into the manual's own build script: keeping it in one named constant here is
 * what makes a broken link findable.
 */
const MANUAL_PDF = "/tie-me-ghana-manual.pdf";

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
        {/* A real file at a real address, opened in its own tab. The browser's
            own viewer shows it and offers the download, which is one link
            doing both jobs rather than two links doing one each.

            Not routed through the app: a manual is what somebody reaches for
            when the app is confusing them, so it must not depend on the app
            working. It is also the one thing here worth having open beside the
            app rather than instead of it. */}
        <a
          href={MANUAL_PDF}
          target="_blank"
          rel="noopener"
          data-testid="open-manual"
        >
          User Manual
        </a>
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

/**
 * Said above the consultation while the patient's phone is not connected.
 *
 * Not a screen of its own, on purpose. Reloading either device drops the
 * connection, and it is rejoined without anyone doing anything, so the
 * consultation stays where it is and this line says why the phone is quiet.
 * The button is for when it is not coming back: a fresh code, and the old
 * phone is told it is over. See ADR 053.
 */
function PatientAway({ onNewCode }) {
  return (
    <div className="away" role="status" data-testid="patient-away">
      <span className="pairing__pulse" aria-hidden="true" />
      <p className="away__text">
        The patient&apos;s phone has disconnected. It will rejoin by itself when
        it is open again.
      </p>
      <button
        type="button"
        className="away__action"
        onClick={onNewCode}
        data-testid="patient-away-new-code"
      >
        Pair with a new code
      </button>
    </div>
  );
}

/**
 * The doctor's half of a paired visit: the same two flows, each split so the
 * patient's half is on their own phone. The connection is `App`'s, not this
 * component's, so it outlives the screen.
 */
function PairedPatientPath({ path, channel, outputLanguage, onOutputLanguageChange }) {
  if (path === LiteracyPath.LITERATE) {
    return (
      <DoctorConsultationHost
        channel={channel}
        outputLanguage={outputLanguage}
        onOutputLanguageChange={onOutputLanguageChange}
      />
    );
  }
  return (
    <GuidedInterrogationHost
      channel={channel}
      outputLanguage={outputLanguage}
      onOutputLanguageChange={onOutputLanguageChange}
    />
  );
}

const PATH_LABELS = {
  [LiteracyPath.LITERATE]: "Reads and writes",
  [LiteracyPath.GUIDED]: "Guided Interrogation",
};
