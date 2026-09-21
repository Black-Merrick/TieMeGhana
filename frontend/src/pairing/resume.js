/**
 * What each device remembers so a reload puts it back where it was.
 *
 * A reload drops the direct connection, and without this the doctor's device
 * came back to a "reconnect" page and the patient's phone to an empty code
 * box, in the middle of a consultation. Each keeps the rendezvous token the
 * pair agreed on, and the patient's phone also its path, so both can go
 * straight back to the screen they were on and find each other again by
 * themselves. See ADR 053.
 *
 * On the device only, expiring with the visit like everything else held about
 * one, and cleared when the visit ends. The token is a bearer secret onto the
 * consultation, so it is kept no longer than the consultation is.
 */

import { VISIT_MAX_AGE_MS } from "../visit/visit.js";
import { isResumeToken } from "./token.js";

const HOST_KEY = "tiemeghana.host-resume";
const GUEST_KEY = "tiemeghana.guest-resume";
const PATHS = new Set(["guided", "literate"]);

function read(key, now) {
  let saved;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isResumeToken(saved?.token) || !Number.isFinite(saved?.startedAt)) return null;
  if (now - saved.startedAt > VISIT_MAX_AGE_MS) {
    remove(key);
    return null;
  }
  return saved;
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full disk. It holds for this page load; a reload then
    // falls back to pairing again, which is what happened before.
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove from.
  }
}

/** The doctor's device: the token, or null. */
export function loadHostResume(now = Date.now()) {
  return read(HOST_KEY, now)?.token ?? null;
}

export function saveHostResume(token, now = Date.now()) {
  if (!isResumeToken(token)) throw new Error("Not a resume token");
  write(HOST_KEY, { token, startedAt: now });
  return token;
}

export function clearHostResume() {
  remove(HOST_KEY);
}

/**
 * The patient's phone: `{ token, path, emergency, ended }`, or null.
 *
 * `emergency` is whether the doctor had emergency mode open, so a reload comes
 * back to that screen and not to the consultation behind it while the doctor's
 * device is found again.
 *
 * `ended` is kept as well as the token so that a reload after the doctor
 * closed the consultation still lands on the ended screen, where the patient's
 * own record can be read and deleted, and not on an empty code box.
 */
export function loadGuestResume(now = Date.now()) {
  const saved = read(GUEST_KEY, now);
  if (!saved) return null;
  return {
    token: saved.token,
    path: PATHS.has(saved.path) ? saved.path : null,
    emergency: saved.emergency === true,
    ended: saved.ended === true,
  };
}

/** Merges into what is there, keeping when it began. */
export function saveGuestResume({ token, path, emergency, ended }, now = Date.now()) {
  const before = read(GUEST_KEY, now);
  const nextToken = isResumeToken(token) ? token : before?.token;
  if (!nextToken) return null;

  const next = {
    token: nextToken,
    path: PATHS.has(path) ? path : (before?.path ?? null),
    emergency:
      typeof emergency === "boolean" ? emergency : before?.emergency === true,
    ended: ended === undefined ? before?.ended === true : ended === true,
    startedAt: before?.token === nextToken ? before.startedAt : now,
  };
  write(GUEST_KEY, next);
  return next;
}

export function clearGuestResume() {
  remove(GUEST_KEY);
}
