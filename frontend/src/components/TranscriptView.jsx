import { useEffect, useState } from "react";

import { Direction, transcriptAsText } from "../transcript/transcript.js";

/**
 * The patient's record of the consultation, SRS FR 4.1 to FR 4.3.
 *
 * Theirs, not the hospital's. It is stored on this device and nowhere else, it
 * can be read and scrolled while the consultation happens, and the patient can
 * delete it. The abstract's point is that this reduces the pressure to bring a
 * family member or pastor along purely to interpret, so it has to be visibly
 * the patient's own.
 *
 * `onOwnPhone` is for a patient's own phone in a paired visit, where the
 * privacy line has to say how long the record really stays. See ADR 053.
 */
export default function TranscriptView({ entries, onDiscard, onOwnPhone = false }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [naming, setNaming] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [nameWarning, setNameWarning] = useState(false);

  useEffect(() => {
    if (!naming) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") cancelNaming();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [naming]);

  if (entries.length === 0) return null;

  const cancelNaming = () => {
    setNaming(false);
    setNameWarning(false);
    setPatientName("");
  };

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
    cancelNaming();
  };

  return (
    <section className="panel transcript" data-testid="transcript">
      {/* Title and controls on one row. Saving and deleting are the patient's
          own actions under FR 4.3, so they belong at the top of their record
          rather than under a list that can be scrolled past. */}
      <div className="transcript__top">
        <div>
          <h2 className="transcript__title">Your record of this consultation</h2>
          <p className="transcript__privacy" data-testid="transcript-privacy">
            {/* The shared device's copy goes when the next patient starts. A
                patient's own phone has no such moment: nothing there ends the
                visit for them, and it is theirs. Saying "deleted
                automatically" of a record that stays would be untrue. */}
            {onOwnPhone
              ? "Kept on this phone only. It stays here until you delete it."
              : "Kept on this device only. Deleted automatically when the visit ends."}
          </p>
        </div>

        <div className="transcript__actions">
          <button
            type="button"
            className="transcript__save"
            onClick={() => setNaming(true)}
            data-testid="start-save-transcript"
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
      </div>

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

      {/* A dialog rather than a panel under the list.

          The panel appeared below a transcript that scrolls, so on a long
          consultation the field the patient had just asked for was off screen,
          and the button that completed the action was back up in the header,
          away from the field it belonged to. A dialog puts the question, the
          field and the answer in one place and stops the page moving
          underneath. */}
      {naming ? (
        <div className="modal" data-testid="name-dialog">
          <form
            className="modal__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="patient-name-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveCopy();
            }}
          >
            <h3 className="modal__title" id="patient-name-title">
              Save a copy of this record
            </h3>

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
              // Focused on open, so the patient can type straight away rather
              // than hunting for the one field in a dialog that exists only to
              // hold it.
              autoFocus
              aria-invalid={nameWarning}
              aria-describedby={
                nameWarning ? "patient-name-warning" : "patient-name-note"
              }
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

            {/* ADR 028. The name is written into the downloaded file and
                nowhere else, because a name stored beside a clinical
                transcript on a shared device is what makes a stray record
                identifying. */}
            <p className="modal__note" id="patient-name-note">
              Used only on the file you download. It is not stored on this
              device.
            </p>

            <div className="modal__actions">
              <button
                type="button"
                className="transcript__cancel"
                onClick={cancelNaming}
                data-testid="cancel-save"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="consultation__send"
                data-testid="save-transcript"
              >
                Download the record
              </button>
            </div>
          </form>
        </div>
      ) : null}
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
