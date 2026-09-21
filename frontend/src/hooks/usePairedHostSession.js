import { useCallback, useEffect, useRef, useState } from "react";

import {
  closePairing,
  createPairing,
  endPairing,
  registerResume,
} from "../api/pairing.js";
import {
  clearHostResume,
  loadHostResume,
  saveHostResume,
} from "../pairing/resume.js";
import { generateResumeToken } from "../pairing/token.js";
import { PeerRole, PeerState } from "../webrtc/peerChannel.js";
import usePeerChannel from "./usePeerChannel.js";

/**
 * How long to wait before trying to reconnect, growing while nobody comes.
 *
 * The first try is almost at once: a phone that has just been refreshed, which
 * is by far the commonest reason for a drop, is back in a second or two, and
 * 1.5 seconds of waiting before even looking was a large share of the delay
 * anyone noticed. Only if it is not there does it settle down.
 */
const REARM_FIRST_MS = 250;
const REARM_BASE_MS = 1500;
const REARM_MAX_MS = 60000;

/**
 * The doctor's end of a paired visit, held above every screen.
 *
 * Owned by `App` rather than by whichever consultation screen happens to be
 * showing. Prescription and Emergency both replace the consultation mid
 * visit, and a connection that lived inside the consultation would be torn
 * down by opening either, telling the patient's phone the visit had ended when
 * the doctor had only turned to another screen. Here it lives exactly as long
 * as the visit's device choice does: `enabled` goes false when the next
 * patient starts, and that is the only thing that ends it. See ADR 053.
 *
 * It first meets the phone over a six character code. Once they are connected
 * it makes a long random token, the rendezvous the pair use to find each other
 * again, keeps it, and it is handed to the phone over their own connection.
 * From then on a dropped connection, whoever's reload caused it, is not the
 * end: this registers the rendezvous again and waits for the phone to return,
 * and the screen the doctor is on never changes. A reloaded page starts from
 * the kept token instead of a new code, for the same reason.
 *
 * `retry` is the doctor's way out when that is not working: it forgets the
 * token, closes the old rendezvous so the old phone is told it is over, and
 * mints a fresh code.
 */
export default function usePairedHostSession({ enabled }) {
  const [token, setToken] = useState(() => loadHostResume());
  const [code, setCode] = useState(null);
  const [codeFailed, setCodeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Refs beside the state, because the arming effect must read the token as it
  // is now without re-running, and re-running it would replace a live
  // connection.
  const tokenRef = useRef(token);
  const minted = useRef({ attempt: -1, token: 0 });
  const endedFor = useRef(null);
  const sendRef = useRef(null);
  const wasEnabled = useRef(false);
  const enabledRef = useRef(enabled);
  const rearms = useRef(0);
  // Set when the next attempt is to keep the code it has, for a device that had
  // no network just then and is trying again under the code already on screen.
  const keepCode = useRef(false);
  enabledRef.current = enabled;

  const adopt = useCallback((next) => {
    tokenRef.current = next;
    setToken(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // The visit is over, or this device stopped being paired. Close the
      // rendezvous so a phone that was offline finds out, and forget the
      // token. Only on a real change: a first render that was never enabled
      // has nothing to close.
      if (wasEnabled.current && tokenRef.current) {
        closePairing(tokenRef.current).catch(() => {
          // Best effort. It expires on its own; this only tells a phone that
          // is offline sooner.
        });
        clearHostResume();
        adopt(null);
      }
      wasEnabled.current = false;
      setCode(null);
      setCodeFailed(false);
      minted.current.attempt = -1;
      rearms.current = 0;
      return;
    }
    wasEnabled.current = true;

    // React runs every effect twice on mount in development. Without this a
    // single "pair" tap minted two codes, one of them never used, and spent
    // two of the thirty an hour PairingCreateThrottle allows.
    if (minted.current.attempt === attempt) return;
    minted.current.attempt = attempt;

    // A retry under the same code: nothing to mint or register. The code on
    // screen is still the one the patient is typing.
    if (keepCode.current) {
      keepCode.current = false;
      return;
    }

    const mark = (minted.current.token += 1);
    const current = () => minted.current.token === mark;
    const resuming = tokenRef.current;

    const arm = resuming
      ? registerResume(resuming).then(() => resuming)
      : createPairing().then((body) => body.code);

    arm
      .then((rendezvous) => {
        if (current()) setCode(rendezvous);
      })
      .catch((error) => {
        if (!current()) return;
        if (resuming && [404, 405, 410].includes(error?.status)) {
          // Closed from somewhere else (410), or a server that has no such
          // endpoint (404, 405: one older than this page, which happens in
          // development when only the frontend was updated). Either way there
          // is nothing to come back to, so begin again with a fresh code rather
          // than retrying, for ever, a name that cannot work.
          clearHostResume();
          adopt(null);
          minted.current.attempt = -1;
          setAttempt((count) => count + 1);
          return;
        }
        setCodeFailed(true);
      });
  }, [enabled, attempt, adopt]);

  // Declared before the connection's own hook on purpose. React runs an
  // unmounting component's cleanups in declaration order, and the connection
  // closes in its own cleanup, so this one has to run first or the message
  // would be sent into a connection that was already gone.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => sendRef.current?.({ type: "ended" });
  }, [enabled]);

  const channel = usePeerChannel({
    role: PeerRole.HOST,
    code: enabled ? code : null,
    attempt,
  });
  sendRef.current = channel.send;

  useEffect(() => {
    if (channel.state !== PeerState.CONNECTED || !code) return;
    const connection = `${code}:${attempt}`;
    if (endedFor.current === connection) return;
    endedFor.current = connection;
    rearms.current = 0;

    const resume = tokenRef.current;
    if (code !== resume) {
      // Just met over the short code. It has done its job.
      endPairing(code).catch(() => {
        // Best effort. The code was already spent the instant the connection
        // formed, so nothing depends on this call succeeding.
      });

      let fresh = null;
      try {
        fresh = generateResumeToken();
      } catch {
        // No secure random source. The visit carries on as it did before this
        // existed: a reload will need pairing again.
      }
      if (!fresh) return;

      // Registered with the server BEFORE it is kept or given to the phone. A
      // server that cannot take it (an older one that has no such endpoint, or
      // one that is down) must not leave the phone holding a way back that goes
      // nowhere: it would sit "reconnecting" for good after its first reload.
      // Without a token the pair behave as they did before this existed, and
      // say so, instead of promising what cannot be kept.
      registerResume(fresh)
        .then(() => {
          if (!enabledRef.current) {
            // The visit ended while this was in flight. Nothing to come back
            // to, and nothing should be left open.
            closePairing(fresh).catch(() => {});
            return;
          }
          saveHostResume(fresh);
          adopt(fresh);
        })
        .catch(() => {
          // Carry on without a way back.
        });
      return;
    }

    // Registered again, so the slots are empty and the rendezvous exists for a
    // phone that comes back before this device notices it left.
    registerResume(resume).catch(() => {
      // Best effort. The next re-arm registers it again.
    });
  }, [channel.state, code, attempt, adopt]);

  // A connection that has gone, whoever's reload or lost signal it was, is
  // waited out rather than abandoned: register the rendezvous again and open a
  // new attempt under the same token, so the phone finds it when it returns.
  // Backing off while nobody comes, so a phone left in a drawer is not polled
  // at full speed for the rest of the shift.
  const gone =
    enabled &&
    Boolean(token) &&
    (codeFailed ||
      (Boolean(code) &&
        (channel.state === PeerState.CLOSED ||
          channel.state === PeerState.FAILED)));

  useEffect(() => {
    if (!gone) return undefined;

    const wait =
      rearms.current === 0
        ? REARM_FIRST_MS
        : Math.min(REARM_MAX_MS, REARM_BASE_MS * 3 ** (rearms.current - 1));
    rearms.current += 1;
    const timer = setTimeout(() => {
      if (!enabledRef.current) return;
      setCode(null);
      setCodeFailed(false);
      minted.current.attempt = -1;
      setAttempt((count) => count + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [gone, attempt]);

  // Trying the same code again after this device had no network. The doctor's
  // Wi-Fi dropping and coming back while a code is on screen is not a reason
  // to make the patient type a new one: the code is good for ten minutes and
  // the attempt that failed had nothing to do with it. Only for the first
  // pairing; once there is a token the re-arm above already does this.
  const noNetwork =
    enabled &&
    !token &&
    Boolean(code) &&
    channel.state === PeerState.FAILED &&
    channel.failure === "no-network";

  useEffect(() => {
    if (!noNetwork) return undefined;

    const wait = Math.min(15000, 2000 * 2 ** Math.min(rearms.current, 3));
    rearms.current += 1;
    const timer = setTimeout(() => {
      if (!enabledRef.current) return;
      keepCode.current = true;
      setAttempt((count) => count + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [noNetwork, attempt]);

  const retry = useCallback(() => {
    // The way out. Forget the token and tell the old rendezvous it is over, so
    // the phone that used it is not left waiting on a device that has moved on.
    if (tokenRef.current) {
      closePairing(tokenRef.current).catch(() => {});
      clearHostResume();
      adopt(null);
    }
    rearms.current = 0;
    setCode(null);
    setCodeFailed(false);
    minted.current.attempt = -1;
    setAttempt((count) => count + 1);
  }, [adopt]);

  // With no code yet there is no connection to have a state, and the channel
  // hook would still be reporting whatever the previous attempt ended in,
  // which after a retry would flash "failed" while a fresh code is minted.
  let state = channel.state;
  if (codeFailed) state = PeerState.FAILED;
  else if (!code) state = PeerState.CONNECTING;

  return {
    code,
    // The six characters a patient can type, or null when the connection is on
    // the long token instead. Never the token itself: it is a secret onto the
    // consultation and must not be put on a screen.
    pairingCode: code && code !== token ? code : null,
    token,
    channel,
    retry,
    state,
    // Why the connection failed, when there is a reason worth telling apart.
    failure: channel.failure ?? null,
    codeFailed,
    // Whether a dropped connection will be waited out and rejoined by itself,
    // so the screen should stay where it is and say so, not move to pairing.
    resumable: Boolean(token),
  };
}
