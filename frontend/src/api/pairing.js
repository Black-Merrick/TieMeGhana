import { apiRequest } from "./client.js";

/**
 * The signaling handshake for a direct, device to device WebRTC connection.
 *
 * Every call here only ever carries a short code and an SDP blob, the
 * connection setup metadata WebRTC itself needs to find the other device.
 * Nothing about the consultation passes through these endpoints or this
 * server at all: once the two devices are connected, everything else goes
 * straight between them over the data channel these calls exist to open.
 */

export function createPairing() {
  return apiRequest("/pairing/", { method: "POST" });
}

/**
 * Register the rendezvous the two devices use to find each other again after
 * either of them reloads. The doctor's device calls this, once per attempt: it
 * clears whatever the last connection left in the slots. A 410 means the
 * visit was closed and nothing may reopen it. See ADR 053.
 */
export function registerResume(token) {
  return apiRequest("/pairing/resume/", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/**
 * The doctor ended the visit. Leaves a marker so a phone that was offline at
 * the time is told, when it comes back, that this is over for good.
 */
export function closePairing(token) {
  return apiRequest(`/pairing/${encodeURIComponent(token)}/close/`, {
    method: "POST",
  });
}

export function postOffer(code, sdp) {
  return apiRequest(`/pairing/${encodeURIComponent(code)}/offer/`, {
    method: "POST",
    body: JSON.stringify({ sdp }),
  });
}

export function fetchOffer(code) {
  return apiRequest(`/pairing/${encodeURIComponent(code)}/offer/`);
}

export function postAnswer(code, sdp) {
  return apiRequest(`/pairing/${encodeURIComponent(code)}/answer/`, {
    method: "POST",
    body: JSON.stringify({ sdp }),
  });
}

export function fetchAnswer(code) {
  return apiRequest(`/pairing/${encodeURIComponent(code)}/answer/`);
}

/**
 * Best effort. Called the moment either device sees the connection come up,
 * so the handshake data is gone within moments rather than waiting on its
 * own expiry, but nothing downstream depends on this succeeding: the code
 * was already spent the instant the connection formed.
 */
export function endPairing(code) {
  return apiRequest(`/pairing/${encodeURIComponent(code)}/`, {
    method: "DELETE",
  });
}

/**
 * Whether the current address is the patient's own entry point for joining
 * a paired visit.
 *
 * A plain path check rather than a router, the same reasoning
 * `referenceFromPath` in `api/prescriptions.js` uses for its one deep link:
 * this is the only other route the app has, and a routing library would be a
 * dependency and a bundle cost for one comparison.
 */
export function isJoinPath(pathname = window.location.pathname) {
  return /^\/join\/?$/.test(pathname);
}
