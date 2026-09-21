import { useCallback, useEffect, useRef, useState } from "react";

import usePeerChannel from "../hooks/usePeerChannel.js";
import {
  clearGuestResume,
  loadGuestResume,
  saveGuestResume,
} from "../pairing/resume.js";
import { announcedEmergency } from "../pairing/announcedScreen.js";
import { isResumeToken } from "../pairing/token.js";
import { PeerRole, PeerState } from "../webrtc/peerChannel.js";
import PatientDevice from "./PatientDevice.jsx";

/**
 * How long to wait before looking for the doctor's device again. The first look
 * is almost at once, since a device that has just been refreshed is back in a
 * second or two; only if it is not does the wait grow.
 */
const REJOIN_FIRST_MS = 250;
const REJOIN_BASE_MS = 1500;
const REJOIN_MAX_MS = 15000;

/**
 * The patient's side of joining a doctor's device onto this visit.
 *
 * A code, typed in rather than scanned, once. After that the phone keeps the
 * way back the doctor's device hands it, so reloading this page, or the doctor
 * reloading theirs, puts it back on the screen it was on and reconnects by
 * itself, and only the doctor ending the consultation ends it here. Once
 * connected the consultation runs entirely between the two devices, never
 * through this server, per ADR 053.
 */
export default function PairingJoinScreen({ onLeave }) {
  // What this phone remembers of a consultation it is already in, if it is.
  const [saved, setSaved] = useState(() => loadGuestResume());
  const [ended, setEnded] = useState(() => saved?.ended === true);
  const [enteredCode, setEnteredCode] = useState("");
  const [joiningCode, setJoiningCode] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const rejoins = useRef(0);

  // The typed code while it is the connection in use, then the remembered way
  // back. Nothing at all once the consultation has ended, which closes the
  // connection and stops every attempt to reopen it.
  const rendezvous = ended ? null : (joiningCode ?? saved?.token ?? null);

  const channel = usePeerChannel({
    role: PeerRole.GUEST,
    code: rendezvous,
    attempt,
  });

  // Whether a consultation has been on this screen, and so must stay on it.
  // Held from the start when there is one remembered: a reloaded phone is in
  // the middle of one, however briefly it has been disconnected.
  const [hadConnection, setHadConnection] = useState(() => saved !== null);
  useEffect(() => {
    if (channel.state !== PeerState.CONNECTED) return;
    setHadConnection(true);
    rejoins.current = 0;
  }, [channel.state]);

  // Stable, on purpose: the effects below depend on it, and one that changed
  // whenever what is remembered changed would re-run them on every update.
  const endConsultation = useCallback(() => {
    // Kept, marked as ended, so a reload lands on the ended screen where the
    // patient's own record can be read and deleted, and not on an empty code
    // box that would leave it stranded on the phone.
    saveGuestResume({ ended: true });
    setSaved((before) => (before ? { ...before, ended: true } : before));
    setEnded(true);
  }, []);

  useEffect(() => {
    const message = channel.lastMessage;
    if (!message) return;

    // The way back, and which screen it was for. Carried on every message the
    // doctor's device sends when it connects, because the connection hands a
    // component only the newest one.
    const path =
      message.type === "path" || message.type === "question" || message.type === "emergency"
        ? message.path
        : undefined;
    const emergency = announcedEmergency(message);
    if (isResumeToken(message.resume) || path || emergency !== undefined) {
      const next = saveGuestResume({ token: message.resume, path, emergency });
      if (next) {
        // Only when something actually changed, so a message that says what is
        // already known cannot set off another render.
        setSaved((before) =>
          before &&
          before.token === next.token &&
          before.path === next.path &&
          before.emergency === next.emergency &&
          before.ended === next.ended
            ? before
            : {
                token: next.token,
                path: next.path,
                emergency: next.emergency,
                ended: next.ended,
              },
        );
      }
    }

    if (message.type === "ended") endConsultation();
  }, [channel.lastMessage, endConsultation]);

  // The doctor closed the consultation while this phone was away, and said so
  // when it came back. Not a fault, and not retried.
  useEffect(() => {
    if (channel.state === PeerState.ENDED) endConsultation();
  }, [channel.state, endConsultation]);

  // A connection that has gone, whoever's reload it was, is waited out: look for
  // the doctor's device again under the remembered way back, and keep looking,
  // a little less often each time. Only where there is a way back to look
  // under; without one the consultation cannot be rejoined and is over.
  const gone =
    !ended &&
    Boolean(saved?.token) &&
    hadConnection &&
    (channel.state === PeerState.CLOSED || channel.state === PeerState.FAILED);

  useEffect(() => {
    if (!gone) return undefined;

    const wait =
      rejoins.current === 0
        ? REJOIN_FIRST_MS
        : Math.min(REJOIN_MAX_MS, REJOIN_BASE_MS * 2 ** (rejoins.current - 1));
    rejoins.current += 1;
    const timer = setTimeout(() => {
      setJoiningCode(null);
      setAttempt((count) => count + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [gone, attempt]);

  // This phone having no network just then, its Wi-Fi dropping and coming back
  // for instance, is not the code being wrong or the two devices being unable
  // to reach each other. It looks again under the same code, a little less often
  // each time, for as long as the doctor's code is good, and says so.
  const noNetwork =
    !saved &&
    Boolean(joiningCode) &&
    channel.state === PeerState.FAILED &&
    channel.failure === "no-network";

  useEffect(() => {
    if (!noNetwork) return undefined;

    const wait = Math.min(15000, 2000 * 2 ** Math.min(rejoins.current, 3));
    rejoins.current += 1;
    const timer = setTimeout(() => setAttempt((count) => count + 1), wait);
    return () => clearTimeout(timer);
  }, [noNetwork, attempt]);

  const join = (event) => {
    event.preventDefault();
    const trimmed = enteredCode.trim().toUpperCase();
    if (trimmed) setJoiningCode(trimmed);
  };

  const tryAgain = () => {
    setHadConnection(false);
    setJoiningCode(null);
    setEnteredCode("");
  };

  // Leaving a consultation for good, from the ended screen or the "reconnecting"
  // line: forget it, so the next thing on this phone is the code box.
  const leaveConsultation = () => {
    clearGuestResume();
    setSaved(null);
    setEnded(false);
    setHadConnection(false);
    setJoiningCode(null);
    setEnteredCode("");
    rejoins.current = 0;
  };

  const connected = channel.state === PeerState.CONNECTED;

  if (ended || connected || hadConnection) {
    // Without a way back a lost connection is the end: there is nothing to
    // rejoin, so it is said so, as it always was.
    const over = ended || (!connected && !saved?.token);
    return (
      <PatientDevice
        channel={channel}
        path={saved?.path ?? null}
        emergency={saved?.emergency === true}
        ended={over}
        offline={!connected && !over}
        onLeave={leaveConsultation}
      />
    );
  }

  if (noNetwork) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-join-no-network">
        <h2 className="pairing__title">Waiting for your connection</h2>
        <p className="pairing__status" role="status">
          <span className="pairing__pulse" aria-hidden="true" />
          This phone has no network connection just now. It will try again by
          itself.
        </p>
        <p className="pairing__hint">
          Check that Wi-Fi or mobile data is on. Keep this page open.
        </p>
      </section>
    );
  }

  if (channel.state === PeerState.FAILED) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-join-failed">
        <p className="notice notice--danger" role="alert">
          Couldn't connect to that device. Check the code and that both
          devices have a connection, then try again.
        </p>
        <div className="pairing__actions">
          <button
            type="button"
            className="pairing__primary"
            onClick={tryAgain}
            data-testid="pairing-try-again"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (joiningCode) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-join-waiting">
        <h2 className="pairing__title">Connecting to your doctor</h2>
        <p className="pairing__status" role="status">
          <span className="pairing__pulse" aria-hidden="true" />
          Connecting to the doctor&apos;s device…
        </p>
        <p className="pairing__hint">
          This usually takes a few seconds. Keep this page open.
        </p>
      </section>
    );
  }

  return (
    <section className="pairing pairing--card" data-testid="pairing-join-form">
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        Patient
      </p>

      <h2 className="pairing__title">Join your doctor</h2>
      <p className="pairing__instruction">
        Enter the six character code shown on the doctor&apos;s device. You
        will then see the doctor&apos;s messages here in sign language and can
        reply from this screen.
      </p>

      <form onSubmit={join} className="pairing__form">
        <label className="pairing__field">
          <span className="pairing__label">Code</span>
          <input
            type="text"
            className="pairing__input"
            value={enteredCode}
            onChange={(event) => setEnteredCode(event.target.value.toUpperCase())}
            maxLength={6}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABC123"
            data-testid="pairing-code-input"
          />
        </label>

        <button
          type="submit"
          className="pairing__primary"
          disabled={!enteredCode.trim()}
          data-testid="pairing-join-submit"
        >
          Connect
        </button>
      </form>

      {onLeave ? (
        <p className="entry__switch">
          Are you the doctor?{" "}
          <button
            type="button"
            className="entry__link"
            onClick={onLeave}
            data-testid="join-leave"
          >
            Go to the doctor&apos;s screen
          </button>
        </p>
      ) : null}
    </section>
  );
}
