import { lazy } from "react";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Load a split-out screen, trying again when the first attempt fails.
 *
 * A screen fetched the first time it is opened can fail to arrive for reasons
 * that pass in a second: a network that dropped just then, a development
 * server busy rebuilding. `lazy` remembers a failure for good, so left alone
 * one bad moment made the screen impossible to open until the page was
 * reloaded, and, before screens had somewhere to fail to, took the whole app
 * down with it. Retried here, inside the promise `lazy` waits on, so the
 * screen simply takes a little longer.
 */
export function loadWithRetry(load, { tries = 3, waitMs = 400 } = {}) {
  return (async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await load();
      } catch (error) {
        if (attempt >= tries) throw error;
        await sleep(waitMs * attempt);
      }
    }
  })();
}

export default function lazyScreen(load, options) {
  return lazy(() => loadWithRetry(load, options));
}
