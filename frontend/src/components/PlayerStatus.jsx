/**
 * What the patient sees while a sign video is not yet playing.
 *
 * Feedback is not decoration in this app. A hearing patient waiting on a slow
 * video hears the room, the doctor, someone explaining that it is loading. A
 * Deaf patient watching a black rectangle has none of that, cannot ask, and
 * has no way to tell waiting from broken. So the wait is stated, in words and
 * in motion, on the same surface the sign will appear on.
 *
 * Three signals rather than one, because a single spinner is ambiguous:
 *
 * - Motion, which says the app is alive even if the words are not read.
 * - Words, short and plain, for whoever reads them.
 * - `role="status"`, so a screen reader announces the change for the doctor,
 *   whose eyes are on the patient rather than the screen.
 */

const MESSAGES = {
  preparing: {
    title: "Getting ready to sign",
    detail: "The video is loading.",
  },
  buffering: {
    // Deliberately different wording from preparing. One means it has not
    // started, the other that it stopped part way, and a patient shown the
    // same message for both cannot tell whether they missed a sign.
    title: "Still loading",
    detail: "Waiting for the rest of the video.",
  },
  failed: {
    title: "The sign video did not load",
    detail: "Read the message below, or ask for it again.",
  },
};

export default function PlayerStatus({ phase }) {
  const message = MESSAGES[phase];
  if (!message) return null;

  const failed = phase === "failed";

  return (
    <div
      className={`player__status${failed ? " player__status--failed" : ""}`}
      data-testid="player-status"
      data-phase={phase}
      // polite, not assertive: this must never cut across a screen reader
      // announcing something clinical.
      role="status"
      aria-live="polite"
    >
      {failed ? (
        <span className="player__status-icon" aria-hidden="true">
          !
        </span>
      ) : (
        // Three dots rather than a spinning ring. A ring at this size reads as
        // a loading web page; a signing rhythm reads as something being got
        // ready, and it stays legible on a small phone screen.
        <span className="player__status-pulse" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}

      <span className="player__status-text">
        <strong className="player__status-title">{message.title}</strong>
        <span className="player__status-detail">{message.detail}</span>
      </span>
    </div>
  );
}
