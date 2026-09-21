/**
 * A direct connection between a doctor's device and a patient's own device.
 *
 * Once open, everything the two devices exchange, the question just asked,
 * the answer just tapped, travels straight between them over the
 * `RTCDataChannel` this module opens. Nothing about the consultation itself
 * reaches our server, not even in transit: the only thing that touches it is
 * the handshake below, one short lived pairing code and two small SDP blobs
 * neither device's own content is inside. See ADR 053.
 *
 * Pure connection mechanics, no React, so the whole thing is mockable in a
 * test by stubbing `global.RTCPeerConnection`, which jsdom does not itself
 * implement.
 */

import {
  fetchAnswer,
  fetchOffer,
  postAnswer,
  postOffer,
} from "../api/pairing.js";
import { isResumeToken } from "../pairing/token.js";

export const PeerRole = { HOST: "host", GUEST: "guest" };

export const PeerState = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  FAILED: "failed",
  CLOSED: "closed",
  /** The doctor closed this consultation. Not a fault, and never retried. */
  ENDED: "ended",
};

/**
 * A free, standard STUN server. It sees only each device's public IP and
 * port while the two are finding each other, never the SDP itself and never
 * anything either device sends afterward. Needed because hospital networks
 * commonly separate staff and guest wifi, or one device is on mobile data,
 * either of which stops the two devices discovering each other unaided.
 * Named here rather than buried in the connection code so replacing it is a
 * one line change.
 */
export const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * How long to wait between looks at the other device's handshake message.
 *
 * Quick to begin with, slow afterwards. Two devices finding each other again
 * after a refresh are usually a second or two apart, and a fixed 1.5 seconds
 * between looks, on each side, was seconds of the wait that nobody could see.
 * A device that is genuinely absent is not polled hard for long: after the
 * first several seconds it settles to the old pace.
 */
export const FAST_POLL_MS = 300;
export const SLOW_POLL_MS = 1500;
const FAST_POLLS = 30;

function pollDelay(attempt) {
  return attempt < FAST_POLLS ? FAST_POLL_MS : SLOW_POLL_MS;
}
const CONNECT_TIMEOUT_MS = 25000;

/**
 * A dedicated budget for ICE gathering, separate from the overall connection
 * timeout.
 *
 * Found by real two-device testing, not assumed: gathering can legitimately
 * take several seconds (a STUN round trip, a slow interface enumeration), and
 * this used to share `timeoutMs` with the overall connection timer. When
 * gathering used the whole budget falling back, the overall timer expired at
 * essentially the same moment, killing the connection before the offer it had
 * just produced could even be posted. Kept well under `CONNECT_TIMEOUT_MS` so
 * there is always real time left afterward for posting, the other device
 * polling for it, and the connectivity check that follows.
 */
export const ICE_GATHERING_TIMEOUT_MS = 8000;

/**
 * How long a connection may read "disconnected" before it is treated as gone.
 * A phone that briefly loses signal recovers on its own within moments, and
 * treating that as the end would tear a consultation down over a glitch.
 */
export const DISCONNECT_GRACE_MS = 4000;

/**
 * Whether a session description offers any address to be reached at.
 *
 * Found on a real laptop whose Wi-Fi dropped and came back in the middle of
 * pairing: both browsers built a description with no candidates in it, posted
 * it, and sat "connecting" until the timeout, each waiting for the other to
 * reach an address neither had offered. A description with none can never lead
 * to a connection, so it is treated as what it is, a device with no network
 * just then, instead of as something to wait on.
 */
export function hasCandidates(sdp) {
  return typeof sdp === "string" && /^a=candidate:/m.test(sdp);
}

/** The longest a close waits for queued messages to leave. See `close`. */
export const CLOSE_GRACE_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What has been gathered so far, kept from the moment the connection exists so
 * that no candidate is missed between creating it and waiting on it.
 */
function trackCandidates(pc) {
  const seen = { count: 0, reflexive: false };
  pc.addEventListener("icecandidate", (event) => {
    if (!event.candidate) return;
    seen.count += 1;
    // A server reflexive or relayed candidate is what a device on another
    // network needs; a host candidate alone only ever works on the same one.
    if (event.candidate.type === "srflx" || event.candidate.type === "relay") {
      seen.reflexive = true;
    }
  });
  return seen;
}

/** Quiet time after the last candidate, once one that works across networks is in. */
export const CANDIDATE_QUIET_MS = 150;

/** How long to hold out for one, when only local addresses have turned up. */
export const CANDIDATE_HOST_ONLY_MS = 1500;

/**
 * Resolve once there is enough to build a connection from, or after `timeoutMs`
 * with whatever was gathered so far.
 *
 * Waited for rather than trickled: candidates are baked into one offer or
 * answer and sent as a single message, because trickling them one at a time
 * only pays for itself over a live channel like a websocket. Over the
 * polling relay this connects through, it would mean extra round trips for a
 * latency saving that does not matter to two people setting this up in the
 * same room.
 *
 * But "enough" is not "everything". Gathering routinely never reports complete
 * (a browser keeps looking on interfaces that will never answer), and waiting
 * for it made every connection, and every reconnection after a refresh, take
 * the whole ICE budget on each side: about ten seconds measured, for a message
 * whose useful contents were there in a fraction of a second. So it goes once
 * an address that works across networks has arrived and gone quiet, or after a
 * short wait for one when only local addresses have; a device that has none at
 * all is left to the gathering state and the hard limit, as before.
 */
function waitForIceGatheringComplete(pc, timeoutMs, seen = { count: 0, reflexive: false }) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let quiet = null;
    let hard = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(quiet);
      clearTimeout(hard);
      pc.removeEventListener("icegatheringstatechange", evaluate);
      pc.removeEventListener("icecandidate", evaluate);
      resolve();
    };

    function evaluate() {
      if (pc.iceGatheringState === "complete") return finish();
      if (!seen.count) return;

      clearTimeout(quiet);
      quiet = setTimeout(
        finish,
        seen.reflexive ? CANDIDATE_QUIET_MS : CANDIDATE_HOST_ONLY_MS,
      );
    }

    pc.addEventListener("icegatheringstatechange", evaluate);
    pc.addEventListener("icecandidate", evaluate);
    hard = setTimeout(finish, timeoutMs);
    evaluate();
  });
}

/**
 * Open (host) or join (guest) a peer connection over a short pairing code.
 *
 * Returns immediately. The connection itself, creating an offer or answer,
 * waiting on ICE gathering, polling the signaling endpoints for the other
 * side, is all asynchronous and can take anywhere from under a second to the
 * full timeout, so progress is reported through `subscribeState` rather than
 * awaited here.
 */
export function createPeerChannel({
  role,
  code,
  iceServers = DEFAULT_ICE_SERVERS,
  timeoutMs = CONNECT_TIMEOUT_MS,
}) {
  let state = PeerState.CONNECTING;
  // Why the channel failed, when there is a reason worth telling apart from the
  // rest. "no-network": this device had no address to offer the other.
  let failure = null;
  let closed = false;
  let pc = null;
  let dataChannel = null;
  const outbox = [];
  const stateListeners = new Set();
  const messageListeners = new Set();

  const setState = (next) => {
    if (closed && next !== PeerState.CLOSED) return;
    if (state === next) return;
    state = next;
    stateListeners.forEach((listener) => listener(next));
  };

  const fail = (reason) => {
    failure = reason;
    setState(PeerState.FAILED);
  };

  const flushOutbox = () => {
    while (outbox.length && dataChannel?.readyState === "open") {
      dataChannel.send(outbox.shift());
    }
  };

  const attachDataChannel = (channel) => {
    dataChannel = channel;

    const becameOpen = () => {
      flushOutbox();
      setState(PeerState.CONNECTED);
    };
    channel.addEventListener("open", becameOpen);
    // The guest's copy of this channel arrives through the `datachannel`
    // event, which itself only fires once SCTP is already up, so the
    // channel can already read "open" the instant it's handed to this
    // function. The `open` event already happened by then; a listener
    // attached this late never sees an event that already fired. Missed
    // in the first real two-device test this ran against: the host reached
    // "connected" every time, the guest never did.
    if (channel.readyState === "open") becameOpen();

    channel.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        // Not a message this module sent. Ignored rather than crashing the
        // screen watching it over one malformed frame.
        return;
      }
      messageListeners.forEach((listener) => listener(message));
    });
    channel.addEventListener("close", () => {
      if (!closed) setState(PeerState.CLOSED);
    });
  };

  let disconnectTimer = null;

  const watchConnectionFailure = () => {
    pc.addEventListener("connectionstatechange", () => {
      const connection = pc.connectionState;
      clearTimeout(disconnectTimer);

      if (connection === "failed" && state === PeerState.CONNECTING) {
        setState(PeerState.FAILED);
        return;
      }

      // A connection that was up and is not any more. The data channel's own
      // close event covers a peer that closes cleanly; this covers the one
      // that just vanishes, a phone that lost signal or went to sleep, which
      // otherwise left the screen looking connected to nobody.
      if (state !== PeerState.CONNECTED) return;
      if (connection === "failed" || connection === "closed") {
        setState(PeerState.CLOSED);
      } else if (connection === "disconnected") {
        disconnectTimer = setTimeout(() => {
          if (state === PeerState.CONNECTED) setState(PeerState.CLOSED);
        }, DISCONNECT_GRACE_MS);
      }
    });
  };

  const overallTimeout = setTimeout(() => {
    if (state === PeerState.CONNECTING) setState(PeerState.FAILED);
  }, timeoutMs);

  const runHost = async () => {
    pc = new RTCPeerConnection({ iceServers });
    const gathered = trackCandidates(pc);
    watchConnectionFailure();
    attachDataChannel(pc.createDataChannel("consultation"));

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGatheringComplete(pc, ICE_GATHERING_TIMEOUT_MS, gathered);
    if (closed) return;

    if (!hasCandidates(pc.localDescription.sdp)) {
      fail("no-network");
      return;
    }
    await postOffer(code, pc.localDescription.sdp);

    for (let poll = 0; !closed && state === PeerState.CONNECTING; poll += 1) {
      const { sdp } = await fetchAnswer(code);
      // An answer with no candidates is one from a phone that had no network
      // when it made it, or a leftover from an earlier attempt: not something
      // a connection can be made from, so it is not acted on, and the phone's
      // next try replaces it.
      if (sdp && hasCandidates(sdp)) {
        await pc.setRemoteDescription({ type: "answer", sdp });
        return;
      }
      await sleep(pollDelay(poll));
    }
  };

  const runGuest = async () => {
    pc = new RTCPeerConnection({ iceServers });
    const gathered = trackCandidates(pc);
    watchConnectionFailure();
    pc.addEventListener("datachannel", (event) => attachDataChannel(event.channel));

    // Going back to a consultation by its long token, the doctor's device may
    // simply not be there yet, having been refreshed too, and the rendezvous
    // is then reported as not found. That is "not yet", and is waited out, where
    // for a code typed in by hand it is a wrong code and fails at once.
    const waitingForDoctor = isResumeToken(code);

    let offerSdp = null;
    for (let poll = 0; !closed && !offerSdp; poll += 1) {
      let sdp = null;
      try {
        ({ sdp } = await fetchOffer(code));
      } catch (error) {
        if (!(waitingForDoctor && error?.status === 404)) throw error;
      }
      // Only an offer with somewhere to be reached at. See `hasCandidates`.
      if (sdp && hasCandidates(sdp)) {
        offerSdp = sdp;
        break;
      }
      await sleep(pollDelay(poll));
    }
    if (closed) return;

    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIceGatheringComplete(pc, ICE_GATHERING_TIMEOUT_MS, gathered);
    if (closed) return;

    if (!hasCandidates(pc.localDescription.sdp)) {
      fail("no-network");
      return;
    }
    await postAnswer(code, pc.localDescription.sdp);
  };

  // A page that is going away closes its end now, rather than leaving the
  // other device to find out from a timeout. Without it, a doctor who reloads
  // leaves the phone believing it is still connected for the better part of a
  // minute, and it is the phone noticing that starts its way back.
  const onPageHide = () => {
    try {
      dataChannel?.close();
      pc?.close();
    } catch {
      // The page is going either way.
    }
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);

  if (typeof RTCPeerConnection === "undefined") {
    clearTimeout(overallTimeout);
    setState(PeerState.FAILED);
  } else {
    const run = role === PeerRole.HOST ? runHost : runGuest;
    run()
      .then(() => clearTimeout(overallTimeout))
      .catch((error) => {
        clearTimeout(overallTimeout);
        // 410 is the doctor having ended the consultation: an answer, not a
        // fault, and a device holding a way back must stop trying.
        setState(error?.status === 410 ? PeerState.ENDED : PeerState.FAILED);
      });
  }

  return {
    get state() {
      return state;
    },

    /** Why it failed, or null. See `failure` above. */
    get failure() {
      return failure;
    },

    /** Returns an unsubscribe function, the same convention as an effect cleanup. */
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    /** Returns an unsubscribe function. */
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },

    /**
     * Send one message to the other device.
     *
     * Queued rather than dropped when the channel is not open yet, since a
     * caller reacting to its own local state (the doctor's question just
     * resolved) has no reason to know whether the handshake has finished on
     * the wire yet.
     */
    send(message) {
      const encoded = JSON.stringify(message);
      if (dataChannel?.readyState === "open") {
        dataChannel.send(encoded);
      } else {
        outbox.push(encoded);
      }
    },

    close() {
      if (closed) return;
      closed = true;
      clearTimeout(overallTimeout);
      clearTimeout(disconnectTimer);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
      outbox.length = 0;
      const wasOpen = dataChannel?.readyState === "open";
      try {
        dataChannel?.close();
      } catch {
        // Already gone. Closing is the goal, not confirming it was open.
      }

      const closeConnection = () => {
        try {
          pc?.close();
        } catch {
          // Same reasoning.
        }
      };

      if (wasOpen && dataChannel.readyState !== "closed") {
        // Closing the connection in the same breath as the channel throws
        // away whatever was sent just before it, and the last thing sent is
        // usually the one that matters: the doctor's "ended", sent as the
        // next patient starts. Found running two real browsers, where the
        // phone never heard it. The channel's own close finishes sending what
        // was queued first, so wait for that, with a limit so a peer that has
        // vanished cannot hold the connection open.
        dataChannel.addEventListener("close", closeConnection, { once: true });
        setTimeout(closeConnection, CLOSE_GRACE_MS);
      } else {
        closeConnection();
      }
      setState(PeerState.CLOSED);
    },
  };
}
