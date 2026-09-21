/**
 * Warm the sign clip cache when the app opens, so the first play is instant.
 *
 * The service worker already caches a clip once it has been played, CacheFirst,
 * under the rule in vite.config.js. That is enough for offline replay of a
 * prescription the patient has already watched, FR 6.2, but it does nothing for
 * the first time a sign is needed. In a consultation that first time is the one
 * that matters: a doctor asks "where does it hurt", and the patient waits on a
 * hospital connection while a video downloads. NFR 1 gives that exchange a
 * budget, and the clip library is small enough to simply have on the device
 * before anyone asks for it.
 *
 * So this fetches every resolvable clip into the same cache the service worker
 * reads from, in the background, after the app is usable. It is a warm up, not
 * a dependency: nothing here blocks rendering, and every failure is survivable
 * because an unwarmed clip is fetched on demand exactly as it was before.
 *
 * Two things it deliberately does not do. It does not run during the first
 * paint, because competing with the app's own assets for a scarce connection
 * would make the thing it is meant to speed up slower. And it does not fail the
 * caller when the cache is full or unavailable: a browser in private mode has
 * no persistent cache, and the app still works there.
 */

import { fetchResolvableClips } from "../api/clips.js";
import { recordMediaCors } from "./mediaCors.js";

/**
 * The cache the service worker serves media from.
 *
 * This string must equal the `cacheName` of the media rule in vite.config.js.
 * If the two drift, this module fills a cache that nothing reads and every
 * clip is still fetched from the network, with no error anywhere to say so. A
 * test asserts the two match, because this project has already had one cache
 * rule stop matching in silence when media moved to a bucket.
 *
 * Versioned, and the version is the point. The first version of this cache
 * accepted opaque responses, and a browser cannot play a video out of one: the
 * clip was in the cache, the service worker served it, and the player said
 * "the sign video did not load", on every device that had ever warmed it, for
 * as long as the entry lived. Renaming the cache is what abandons those
 * entries; `retireLegacyCaches` is what deletes them.
 */
export const MEDIA_CACHE = "ghsl-media-v2";

/** Cache names this app once used and must not leave behind. */
export const LEGACY_MEDIA_CACHES = ["ghsl-media"];

/** How many clips to fetch at once. */
const CONCURRENCY = 3;

/**
 * Delete the caches an earlier version of this app filled with clips it could
 * not play. Best effort, and cheap when there is nothing there.
 */
async function retireLegacyCaches() {
  for (const name of LEGACY_MEDIA_CACHES) {
    try {
      await caches.delete(name);
    } catch {
      // Nothing to delete, or storage is blocked. Neither changes what happens
      // next.
    }
  }
}

/**
 * Leave this much of the storage quota unused.
 *
 * A cross origin response fetched without CORS is opaque, and browsers charge
 * opaque entries against the quota with a large fixed padding rather than their
 * real size. A handful of videos can therefore fill a quota that, measured
 * honestly, they are nowhere near. Stopping short leaves room for the
 * prescription playlists, which a patient needs at home and these clips only
 * make faster.
 */
const QUOTA_HEADROOM = 0.8;

/**
 * Fetch order, not filtering: everything still gets warmed, but a patient who
 * taps something in the first few seconds should find the clip most likely to
 * be needed already there.
 *
 * PROMPT is what the app itself asks before a doctor has done anything, the
 * FR 2.1 literacy check among them, so it is the first thing that can
 * possibly be on screen. ALERT is Emergency Triage, FR 5, the single most
 * time critical path in the app. LETTER is the fingerspelling alphabet: FR 1.6
 * and the whole reasoning in BACKLOG.md's filming list, twenty six clips that
 * cover every content word and medicine name the library has no sign for, so
 * they are reused across almost every free text message. PHRASE and WORD are
 * everything else, the long tail that a given consultation may never touch.
 *
 * A kind missing from this list sorts last rather than throwing, so a clip
 * kind added later degrades to "warmed in whatever order the API returned it"
 * instead of breaking the warm up.
 */
const KIND_PRIORITY = ["prompt", "alert", "letter", "phrase", "word"];

function priority(kind) {
  const index = KIND_PRIORITY.indexOf(kind);
  return index === -1 ? KIND_PRIORITY.length : index;
}

/**
 * Download every resolvable clip into the media cache.
 *
 * Resolves to a summary rather than throwing, because there is no caller who
 * should stop what they are doing over this. `warmed` counts clips newly put
 * in the cache, `alreadyCached` ones that were there already, `failed` ones
 * that could not be fetched, and `unstorable` those on a server that sends no
 * CORS headers, whose responses the page cannot read and so cannot keep in a
 * form a video can play from. Those are left to the browser's own HTTP cache,
 * which the server's Cache-Control already feeds, and are not counted as saved.
 */
export async function precacheClips({ signal, onProgress } = {}) {
  const idle = { warmed: 0, alreadyCached: 0, failed: 0, unstorable: 0 };

  if (typeof caches === "undefined") {
    // Every non secure context, and some private browsing modes. Not an error:
    // the app runs, clips are fetched when they are played.
    return { ...idle, supported: false };
  }

  await retireLegacyCaches();

  let clips;
  try {
    clips = await fetchResolvableClips();
  } catch {
    // Offline at startup is the ordinary case this app is built for. The
    // clips already in the cache from previous visits stay there.
    return { ...idle, supported: true };
  }

  // Shape checked rather than trusted. An error payload reaching `.filter` as
  // an object is how the triage screen once went blank: a catch handles the
  // server failing, not the server answering with something else.
  if (!Array.isArray(clips)) {
    return { ...idle, supported: true };
  }

  const urls = [
    ...new Set(
      [...clips]
        .sort((a, b) => priority(a?.kind) - priority(b?.kind))
        .map((clip) => clip?.video_url)
        .filter((url) => typeof url === "string" && url),
    ),
  ];

  if (!urls.length) {
    return { ...idle, supported: true };
  }

  let cache;
  try {
    cache = await caches.open(MEDIA_CACHE);
  } catch {
    return { ...idle, supported: false };
  }

  // What is already here is settled before any downloading starts, so the
  // count reported to the interface is the real amount of work rather than a
  // total that keeps being revised downwards as cached entries are discovered.
  // On a second visit this is the whole list and nothing is announced at all.
  const missing = [];
  const summary = { ...idle, supported: true };

  for (const url of urls) {
    if (await isCached(cache, url)) {
      summary.alreadyCached += 1;
      // Only a response fetched with CORS is ever stored, so being here means
      // the server allowed it when it was. Keeps the record alive on the visits
      // that have nothing left to download, which are most of them.
      recordMediaCors(url, true);
    } else missing.push(url);
  }

  if (!missing.length) {
    onProgress?.({ total: 0, completed: 0, done: true });
    return summary;
  }

  // Checked before the first download as well as between the rest, so a device
  // already close to its quota is not asked to store even one.
  if (await isQuotaNearlyFull()) return summary;

  // The first download is done on its own, before the rest are started, because
  // it answers a question the rest depend on: does this server let the page
  // keep what it sends? If it does not, every other clip from the same place
  // has the same answer, and starting a progress bar for downloads that cannot
  // be kept would tell the clinician "ready to use offline" when it is not.
  const blocked = new Set();
  const queue = [...missing];
  const first = queue.shift();

  const firstOutcome = await warmOne(cache, first, signal, blocked);
  summary[firstOutcome] += 1;

  const remaining = queue.filter((url) => {
    if (!blocked.has(originOf(url))) return true;
    summary.unstorable += 1;
    return false;
  });
  queue.length = 0;
  queue.push(...remaining);

  const counted = firstOutcome === "unstorable" ? 0 : 1;
  const total = counted + queue.length;

  if (total === 0) {
    onProgress?.({ total: 0, completed: 0, done: true });
    return summary;
  }

  let completed = counted;
  onProgress?.({ total, completed, done: false });

  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      if (await isQuotaNearlyFull()) {
        // Stop rather than evict. The browser evicts under pressure on its own
        // terms, and racing it would mean thrashing the connection this is
        // supposed to spare.
        queue.length = 0;
        return;
      }

      const url = queue.shift();
      const outcome = await warmOne(cache, url, signal, blocked);
      summary[outcome] += 1;

      if (outcome !== "unstorable") completed += 1;
      onProgress?.({ total, completed, done: false });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );

  onProgress?.({ total, completed, done: true });

  return summary;
}

/** Whether this url is already in the cache, treating a broken cache as no. */
async function isCached(cache, url) {
  try {
    return Boolean(await cache.match(url));
  } catch {
    return false;
  }
}

/** The origin a clip is served from, or null when the url cannot be read. */
function originOf(url) {
  try {
    return new URL(url, globalThis.location?.href).origin;
  } catch {
    return null;
  }
}

/**
 * Put one clip in the cache, reporting which of the outcomes happened.
 *
 * The response has to be one the page can read, which means the server allowed
 * it: same origin, or cross origin with CORS headers. That is how a 404 is told
 * from a video, and, more to the point, how a full 200 response ends up in the
 * cache, which the service worker can then serve byte ranges out of.
 *
 * A cross origin server that sends no CORS headers makes the fetch throw. The
 * way out that used to be here was to fetch again with `no-cors` and store the
 * opaque result. That is what broke playback: an opaque response cannot be cut
 * into the byte ranges a video element asks for, so the clip sat in the cache
 * and would not play. It is not stored now. The origin is remembered as
 * unable, so its other clips are not fetched for nothing, and the browser's
 * ordinary HTTP cache, fed by the server's own Cache-Control, is left to keep
 * them. Turning CORS on for the bucket is what turns this back into a warm up.
 */
async function warmOne(cache, url, signal, blocked) {
  const origin = originOf(url);
  if (origin && blocked.has(origin)) return "unstorable";

  try {
    const response = await fetch(url, { signal, credentials: "omit" });
    // The server answered a CORS request, whatever it answered: it allows it.
    recordMediaCors(url, true);
    if (!response.ok) return "failed";
    await cache.put(url, response);
    return "warmed";
  } catch {
    if (signal?.aborted) return "failed";
  }

  const crossOrigin = origin !== null && origin !== globalThis.location?.origin;
  if (!crossOrigin) return "failed";

  // The fetch threw, and for a server on another origin that is what a missing
  // CORS policy looks like. The player is told, so it asks for this server's
  // clips the way that works.
  recordMediaCors(url, false);
  blocked.add(origin);
  return "unstorable";
}

/** Whether the origin is close enough to its storage quota to stop writing. */
async function isQuotaNearlyFull() {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
    if (!usage || !quota) return false;
    return usage / quota > QUOTA_HEADROOM;
  } catch {
    // An unsupported or blocked estimate is not a reason to skip caching.
    return false;
  }
}
