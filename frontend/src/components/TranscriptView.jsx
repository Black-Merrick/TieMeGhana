import { useState } from "react";

import { Direction, transcriptAsText } from "../transcript/transcript.js";

/**
 * The patient's record of the consultation, SRS FR 4.1 to FR 4.3.
 *
 * Theirs, not the hospital's. It is stored on this device and nowhere else, it
 * can be read and scrolled while the consultation happens, and the patient can
 * delete it. The abstract's point is that this reduces the pressure to bring a
 * family member or pastor along purely to interpret, so it has to be visibly
 * the patient's own.
 */
export default function TranscriptView({ entries, onDiscard }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (entries.length === 0) return null;

  const saveCopy = () => {
    // The transcript is deleted when the visit ends, because the device is
    // shared, so taking a copy has to be possible. An explicit patient action,
    // which is the exact wording NFR 4 uses for the only case where the
    // transcript may leave the device.
    const blob = new Blob([transcriptAsText(entries)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "tie-me-ghana-consultation.txt";
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <section className="transcript" data-testid="transcript">
      <h2 className="transcript__title">Your record of this consultation</h2>

      <p className="transcript__privacy" data-testid="transcript-privacy">
        Kept on this device only. It is never sent to the hospital or to us, and
        it is deleted when the visit ends.
      </p>

      {/* Scrollable per FR 4.3, so a long consultation stays readable without
          pushing the controls off screen. */}
      <ol className="transcript__list" data-testid="transcript-list">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`transcript__entry transcript__entry--${entry.direction}`}
          >
            <span className="transcript__who">
              {entry.direction === Direction.TO_PATIENT ? "Doctor" : "You"}
            </span>
            <span className="transcript__text">{entry.text}</span>

            {/* FR 2.7's distinction, shown rather than only stored. A nod was
                confirmed by the doctor, a tap came from the patient, and the
                record must not blur the two: a patient reading this later has
                to be able to see which answers were their own. */}
            {ATTRIBUTION[entry.answeredBy] ? (
              <span className="transcript__by">
                {ATTRIBUTION[entry.answeredBy]}
              </span>
            ) : null}

            <time className="transcript__time" dateTime={entry.at}>
              {formatTime(entry.at)}
            </time>
          </li>
        ))}
      </ol>

      <div className="transcript__actions">
        <button
          type="button"
          className="transcript__save"
          onClick={saveCopy}
          data-testid="save-transcript"
        >
          Save a copy
        </button>

        {confirmingDelete ? (
          <>
            {/* Confirmed rather than immediate. Deleting is the patient's right
                under FR 4.3, but it is also irreversible, and a mistap during a
                consultation would destroy the only record they have. */}
            <span className="transcript__confirm" data-testid="confirm-delete">
              Delete this record for good?
            </span>
            <button
              type="button"
              className="transcript__delete"
              onClick={() => {
                onDiscard();
                setConfirmingDelete(false);
              }}
              data-testid="confirm-delete-yes"
            >
              Yes, delete it
            </button>
            <button
              type="button"
              className="transcript__cancel"
              onClick={() => setConfirmingDelete(false)}
              data-testid="confirm-delete-no"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="transcript__delete"
            onClick={() => setConfirmingDelete(true)}
            data-testid="delete-transcript"
          >
            Delete my record
          </button>
        )}
      </div>
    </section>
  );
}

const ATTRIBUTION = {
  doctor: "confirmed by the doctor",
  patient: "tapped by the patient",
};

/** Time of day only. The date is the visit's, and it is already on screen. */
function formatTime(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
