import { useEffect, useState } from "react";

/**
 * What the app shows while it is stocking the device on first open.
 *
 * Feedback rather than decoration, for the same reason the player says it is
 * loading: work happening invisibly is indistinguishable from an app that is
 * slow. A clinician setting this up in a clinic should be able to see that it
 * is doing something useful, and see when it is finished, so they know whether
 * the device is ready to take into a consultation.
 *
 * It says what is actually happening rather than "Loading". "Saving sign
 * videos to this device" tells somebody why it is worth waiting for and what
 * they get at the end of it, which a spinner does not.
 *
 * Fixed to the corner rather than placed in the layout, deliberately. The
 * consultation and emergency screens divide the viewport between two panes
 * that scroll on their own, and a banner in that flow would take height from
 * the body map a patient is trying to point at.
 */

/** How long the finished message stays before it fades. */
const DONE_VISIBLE_MS = 2600;

export default function SetupProgress({ progress }) {
  const [hidden, setHidden] = useState(false);

  const running = Boolean(progress) && progress.total > 0 && !progress.done;
  const finished = Boolean(progress) && progress.total > 0 && progress.done;

  useEffect(() => {
    if (!finished) return undefined;

    const timer = setTimeout(() => setHidden(true), DONE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [finished]);

  // Nothing to say. A second visit finds every clip cached and reports a total
  // of zero, and announcing "ready" on every open is noise that would teach
  // people to ignore the corner this appears in.
  if (!running && !finished) return null;
  if (hidden) return null;

  const percent = progress.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <aside
      className={`setup${finished ? " setup--done" : ""}`}
      data-testid="setup-progress"
      data-state={finished ? "done" : "working"}
      // polite, so it never interrupts a screen reader mid sentence on
      // something clinical. This is background work, and it reads as such.
      role="status"
      aria-live="polite"
    >
      <div className="setup__row">
        {finished ? (
          <span className="setup__icon setup__icon--done" aria-hidden="true">
            <CheckIcon />
          </span>
        ) : (
          <span className="setup__spinner" aria-hidden="true" />
        )}

        <div className="setup__text">
          <strong className="setup__title">
            {finished ? "Ready to use offline" : "Setting up this device"}
          </strong>
          <span className="setup__detail">
            {finished
              ? `${progress.total} sign ${
                  progress.total === 1 ? "video is" : "videos are"
                } saved. They now play instantly.`
              : `Saving sign videos so they play instantly. ${progress.completed} of ${progress.total}.`}
          </span>
        </div>

        {finished ? null : (
          <span className="setup__count" aria-hidden="true">
            {percent}%
          </span>
        )}
      </div>

      {finished ? null : (
        <div
          className="setup__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-label="Saving sign videos to this device"
        >
          <div className="setup__bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {/* The app is usable throughout, and somebody who does not know that
          will wait for the bar rather than starting work. Said once, only
          while it is running. */}
      {finished ? null : (
        <p className="setup__note">You can start using the app now.</p>
      )}
    </aside>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" width="14" height="14">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
