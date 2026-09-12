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
  const [naming, setNaming] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [nameWarning, setNameWarning] = useState(false);

  if (entries.length === 0) return null;

  const saveCopy = () => {
    const name = patientName.trim();
    if (!name) {
      // The name is the point of asking, so an unnamed record would defeat it.
      // Refusing with a visible reason beats saving a file the patient then has
      // to work out is theirs.
      setNameWarning(true);
      return;
    }

    // The transcript is deleted when the visit ends, because the device is
    // shared, so taking a copy has to be possible. An explicit patient action,
    // which is the exact wording NFR 4 uses for the only case where the
    // transcript may leave the device.
    const blob = new Blob([transcriptAsText(entries, { patientName: name })], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `tie-me-ghana-${fileSafe(name)}.txt`;
    link.click();

    URL.revokeObjectURL(url);

    // The name is not kept. See ADR 028: a name stored beside a clinical
    // transcript on a shared device would make a stray record identifying.
    setPatientName("");
    setNaming(false);
    setNameWarning(false);
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

      {naming ? (
        <div className="transcript__naming">
          <label className="consultation__field" htmlFor="patient-name">
            Patient name, for the saved copy
          </label>
          <input
            id="patient-name"
            type="text"
            className={
              nameWarning
                ? "consultation__input consultation__input--invalid"
                : "consultation__input"
            }
            value={patientName}
            onChange={(event) => {
              setPatientName(event.target.value);
              if (nameWarning) setNameWarning(false);
            }}
            aria-invalid={nameWarning}
            aria-describedby={nameWarning ? "patient-name-warning" : undefined}
            data-testid="patient-name"
          />

          {nameWarning ? (
            <p
              id="patient-name-warning"
              className="consultation__warning"
              role="alert"
              data-testid="patient-name-warning"
            >
              Enter the patient&apos;s name so it appears on the saved record.
            </p>
          ) : null}

          <p className="transcript__naming-note">
            Used only on the file you download. It is not stored on this device.
          </p>
        </div>
      ) : null}

      <div className="transcript__actions">
        {naming ? (
          <>
            <button
              type="button"
              className="transcript__save"
              onClick={saveCopy}
              data-testid="save-transcript"
            >
              Download the record
            </button>
            <button
              type="button"
              className="transcript__cancel"
              onClick={() => {
                setNaming(false);
                setNameWarning(false);
                setPatientName("");
              }}
              data-testid="cancel-save"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="transcript__save"
            onClick={() => setNaming(true)}
            data-testid="start-save-transcript"
          >
            Save a copy
          </button>
        )}

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

/** A filename the patient can find later, without path separators in it. */
function fileSafe(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "consultation"
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
