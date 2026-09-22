/**
 * Giving the connection to the clip somebody is actually watching for.
 *
 * The warm up (ADR 052) pulls the whole library onto the device so a later
 * message plays from storage. That is right, and it was competing with the
 * thing it exists to make fast: the bucket gives about 150 KB a second whether
 * one file is asked for or ten, so three warm up downloads take the whole pipe,
 * and a sign the doctor has just sent queues behind them. Measured against the
 * real bucket with the real library: a clip already stored played in 11 ms, and
 * the same clip fetched while the warm up was running did not arrive within
 * twenty seconds. On screen that is "Getting ready to sign" for half a minute,
 * which is indistinguishable from a broken app.
 *
 * So a player claims priority while its video is still loading, and the warm up
 * waits. Nothing is cancelled: downloads already in flight finish, the queue
 * simply stops being fed until the person watching has what they are waiting
 * for. The warm up is an optimisation and must never be the reason a patient is
 * kept waiting. See ADR 057.
 *
 * A claim expires by itself. A video element that never reports either success
 * or failure, which a stalled connection produces, would otherwise hold the
 * warm up off for the rest of the session.
 */

/** The longest one claim can hold the connection before it is ignored. */
export const MAX_CLAIM_MS = 20000;

let claims = 0;
const waiting = new Set();

function settle() {
  if (claims > 0) return;
  for (const resolve of [...waiting]) resolve();
  waiting.clear();
}

/**
 * Say that something is waiting on a clip right now.
 *
 * Returns the function that gives the connection back. Calling it twice counts
 * once, so a player that releases on both "ready" and unmount cannot make the
 * count negative and leave the warm up paused for ever.
 */
export function claimPlayback({ maxMs = MAX_CLAIM_MS } = {}) {
  claims += 1;
  let held = true;

  const release = () => {
    if (!held) return;
    held = false;
    claims -= 1;
    clearTimeout(timer);
    settle();
  };

  const timer = setTimeout(release, maxMs);
  return release;
}

/** Whether the connection is currently spoken for. */
export function isWatching() {
  return claims > 0;
}

/**
 * Resolve once nothing is waiting on a clip.
 *
 * Resolves immediately when nothing is, which is the ordinary case: the warm up
 * runs at full speed when nobody is watching a video.
 */
export function whenNobodyIsWatching() {
  if (claims === 0) return Promise.resolve();
  return new Promise((resolve) => waiting.add(resolve));
}

/** For tests, so one case cannot leave a claim behind for the next. */
export function resetPlaybackPriority() {
  claims = 0;
  settle();
}
