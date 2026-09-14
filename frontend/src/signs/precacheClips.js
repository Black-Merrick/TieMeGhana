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

/**
 * The cache the service worker serves media from.
 *
 * This string must equal the `cacheName` of the media rule in vite.config.js.
 * If the two drift, this module fills a cache that nothing reads and every
 * clip is still fetched from the network, with no error anywhere to say so. A
 * test asserts the two match, because this project has already had one cache
 * rule stop matching in silence when media moved to a bucket.
 */
export const MEDIA_CACHE = "ghsl-media";

/** How many clips to fetch at once. */
const CONCURRENCY = 3;

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
 * Download every resolvable clip into the media cache.
 *
 * Resolves to a summary rather than throwing, because there is no caller who
 * should stop what they are doing over this. `warmed` counts clips newly put
 * in the cache, `alreadyCached` ones that were there already, `failed` ones
 * that could not be fetched, and `unverified` those stored as opaque responses
 * whose status could not be read.
 */
export async function precacheClips({ signal } = {}) {
  const idle = { warmed: 0, alreadyCached: 0, failed: 0, unverified: 0 };

  if (typeof caches === "undefined") {
    // Every non secure context, and some private browsing modes. Not an error:
    // the app runs, clips are fetched when they are played.
    return { ...idle, supported: false };
  }

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
      clips.map((clip) => clip?.video_url).filter((url) => typeof url === "string" && url),
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

  const summary = { ...idle, supported: true };
  const queue = [...urls];

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
      const outcome = await warmOne(cache, url, signal);
      summary[outcome] += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );

  return summary;
}

/**
 * Put one clip in the cache, reporting which of the four outcomes happened.
 *
 * A same origin clip is fetched normally and its status checked. A cross origin
 * one is attempted with CORS first, so a real status can be read and a 404 is
 * not stored as though it were a video. Only if that fails is it refetched
 * opaquely, which works without the bucket's CORS policy but makes any response
 * at all look like success.
 */
async function warmOne(cache, url, signal) {
  try {
    if (await cache.match(url)) return "alreadyCached";
  } catch {
    return "failed";
  }

  try {
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok) return "failed";
    await cache.put(url, response);
    return "warmed";
  } catch {
    if (signal?.aborted) return "failed";
  }

  // No CORS headers on the bucket. Still cacheable, and the service worker's
  // rule accepts status 0 for exactly this reason, but the response is opaque:
  // a 404 and a video are indistinguishable from here, so it is counted apart
  // rather than reported as a clean warm up.
  try {
    const opaque = await fetch(url, { mode: "no-cors", signal, credentials: "omit" });
    await cache.put(url, opaque);
    return "unverified";
  } catch {
    return "failed";
  }
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
