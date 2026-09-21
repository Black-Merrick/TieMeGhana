/**
 * Whether the server the sign videos come from lets the page read them.
 *
 * A video can only be kept in the service worker's cache, and played back out of
 * it, offline, if it was fetched with CORS: otherwise the response is opaque, a
 * video element cannot play from one, and ADR 054 is the story of what happened
 * when the app tried. So the player asks for a clip with `crossorigin` only from
 * a server known to allow it, and without it from one that is not, which plays
 * exactly as it always did. Asking with it from a server that does not allow it
 * would refuse the video outright.
 *
 * What is known comes from the warm up, which is the first thing to fetch clips
 * with CORS: a fetch that succeeds records the server as allowing it, one that
 * throws records that it does not. Kept on the device between visits, so the
 * first video of the next visit is asked for the right way, and given a lifetime
 * so a server that turns CORS on, or off, is noticed.
 */

const STORAGE_KEY = "tiemeghana.media-cors";

/** Long for a yes, which the cache it goes with also lasts for; short for a no. */
const ALLOWED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFUSED_TTL_MS = 60 * 60 * 1000;

const listeners = new Set();
let version = 0;
let known = null;

function load() {
  if (known) return known;
  known = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") known = parsed;
  } catch {
    // Unreadable or blocked storage: nothing is known, which is the safe answer.
  }
  return known;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
  } catch {
    // Held in memory for this page load; it just will not survive a reload.
  }
}

export function originOf(url) {
  try {
    return new URL(url, globalThis.location?.href).origin;
  } catch {
    return null;
  }
}

function isSameOrigin(origin) {
  return origin !== null && origin === globalThis.location?.origin;
}

/** Record what a fetch with CORS just showed about the server behind `url`. */
export function recordMediaCors(url, allowed, now = Date.now()) {
  const origin = originOf(url);
  if (!origin || isSameOrigin(origin)) return;

  const before = load()[origin];
  if (before && before.allowed === allowed && now - before.at < 60 * 1000) return;

  known[origin] = { allowed: Boolean(allowed), at: now };
  save();
  version += 1;
  listeners.forEach((listener) => listener());
}

/**
 * The value for a video element's `crossOrigin`: "anonymous" when the server is
 * known to allow it, otherwise undefined, which leaves the attribute off.
 * Same origin never needs it.
 */
export function crossOriginFor(url, now = Date.now()) {
  const origin = originOf(url);
  if (!origin || isSameOrigin(origin)) return undefined;

  const entry = load()[origin];
  if (!entry) return undefined;

  const lifetime = entry.allowed ? ALLOWED_TTL_MS : REFUSED_TTL_MS;
  if (now - entry.at > lifetime) return undefined;

  return entry.allowed ? "anonymous" : undefined;
}

/** For `useSyncExternalStore`: a number that changes when anything is recorded. */
export function subscribeMediaCors(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mediaCorsVersion() {
  return version;
}

/** For tests, and for a device that wants to start again. */
export function forgetMediaCors() {
  known = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
  version += 1;
  listeners.forEach((listener) => listener());
}
