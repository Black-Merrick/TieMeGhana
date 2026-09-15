import { useEffect, useState } from "react";

import { precacheClips } from "../signs/precacheClips.js";

/**
 * Pull the sign clips onto the device on first open, and report the progress.
 *
 * The downloading itself already happened silently. What was missing was any
 * sign of it: a clinician opening the app for the first time on a hospital
 * connection saw a finished looking screen, tapped a question, and waited,
 * with nothing to say the app was still fetching the very videos that wait was
 * about. Work happening invisibly is indistinguishable from an app that is
 * simply slow.
 *
 * So it is announced, and only when there is something to announce. A second
 * visit finds everything cached, reports a total of zero and shows nothing:
 * telling somebody their app is ready every time they open it is noise, and
 * noise is what hides the message that matters.
 *
 * This is a status, never a gate. The app is fully usable throughout, and a
 * clip that has not been warmed is fetched when it is played exactly as it was
 * before. Blocking the screen on it would be the wrong trade: it would delay a
 * consultation to save time inside one.
 */
export default function useClipWarmup() {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    // Aborted on unmount so a warm up does not carry on writing into state
    // belonging to a screen that has gone.
    const controller = new AbortController();
    let idleHandle = null;
    let timeoutHandle = null;

    const start = () => {
      precacheClips({
        signal: controller.signal,
        onProgress: (update) => {
          if (controller.signal.aborted) return;
          setProgress(update);
        },
      }).catch(() => {
        // Warming is an optimisation, and a failed one changes nothing the
        // user needs to act on: the clip is fetched when it is played. Clearing
        // the indicator is the whole of the handling.
        if (!controller.signal.aborted) setProgress(null);
      });
    };

    // Deferred to idle rather than started here. The app's own assets are
    // still arriving at this point, and competing with them for a scarce
    // connection would slow down the screen this is meant to make fast.
    // requestIdleCallback is absent in Safari before 16.4, hence the fallback.
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(start, { timeout: 5000 });
    } else {
      timeoutHandle = setTimeout(start, 2000);
    }

    return () => {
      controller.abort();
      if (idleHandle !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, []);

  return progress;
}
