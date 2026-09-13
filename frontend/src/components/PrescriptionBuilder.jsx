import { useState } from "react";

import { cachePlaylistClips, issuePrescription, playlistUrl } from "../api/prescriptions.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import PrescriptionPlaylist from "./PrescriptionPlaylist.jsx";
import PrescriptionQr from "./PrescriptionQr.jsx";

/**
 * Where the doctor writes the take home instructions, SRS FR 6.1 and FR 6.3.
 *
 * Three fields per medicine rather than one free text box. The dosage and the
 * frequency are the two facts a patient cannot afford to lose, and separating
 * them means the interface can show each one on its own line, and the safety
 * gate can report which of them failed to render rather than refusing an
 * opaque sentence.
 */

const blankItem = () => ({
  medicine: "",
  dosage: "",
  frequency: "",
  // The File itself, plus a preview URL made from it. Kept together so
  // clearing the photograph cannot leave a thumbnail of it behind.
  image: null,
  preview: null,
});

export default function PrescriptionBuilder({ onLeave }) {
  const [items, setItems] = useState([blankItem()]);
  const [status, setStatus] = useState("editing");
  const [playlist, setPlaylist] = useState(null);
  const [problem, setProblem] = useState(null);
  const [offline, setOffline] = useState(null);

  const update = (index, field, value) => {
    setItems((previous) =>
      previous.map((item, at) => (at === index ? { ...item, [field]: value } : item)),
    );
    setProblem(null);
  };

  const addItem = () => setItems((previous) => [...previous, blankItem()]);

  const removeItem = (index) =>
    setItems((previous) => {
      // The preview URL is released rather than left to the browser, which
      // holds an object URL for the lifetime of the document.
      const going = previous[index];
      if (going?.preview) URL.revokeObjectURL(going.preview);
      return previous.filter((_, at) => at !== index);
    });

  const setImage = (index, file) => {
    setItems((previous) =>
      previous.map((item, at) => {
        if (at !== index) return item;

        if (item.preview) URL.revokeObjectURL(item.preview);
        return {
          ...item,
          image: file,
          preview: file ? URL.createObjectURL(file) : null,
        };
      }),
    );
    setProblem(null);
  };

  const issue = async () => {
    const filled = items.map((item) => ({
      medicine: item.medicine.trim(),
      dosage: item.dosage.trim(),
      frequency: item.frequency.trim(),
      image: item.image,
    }));

    // Checked here as well as on the server, because the useful message is the
    // one that arrives before the request. A blank field is the likeliest
    // mistake, and a 400 from the API cannot say which row it was.
    const unidentified = filled.findIndex(
      (item) => !item.medicine && !item.image,
    );
    if (unidentified !== -1) {
      setProblem(
        `Medicine ${unidentified + 1} needs a photo or a name, so the patient can tell which one it is.`,
      );
      return;
    }

    const incomplete = filled.findIndex(
      (item) => !item.dosage || !item.frequency,
    );
    if (incomplete !== -1) {
      setProblem(
        `Medicine ${incomplete + 1} needs a dosage and how often to take it.`,
      );
      return;
    }

    setStatus("issuing");
    setProblem(null);

    try {
      const issued = await issuePrescription(filled);
      setPlaylist(issued);
      setStatus("issued");
      vibrate(VibrationPattern.TRANSCRIPT_SAVED);

      // FR 6.2. Pulled into the cache now, on the hospital connection, rather
      // than on first play at home where there may be no connection at all.
      setOffline(await cachePlaylistClips(issued));
    } catch {
      setStatus("editing");
      setProblem("The prescription could not be saved. Check the connection and try again.");
    }
  };

  if (status === "issued" && playlist) {
    return (
      <section className="prescription" data-testid="prescription-issued">
        <div className="prescription__header">
          <h2 className="prescription__title">Prescription ready</h2>
          <button
            type="button"
            className="triage__leave"
            onClick={onLeave}
            data-testid="leave-prescription"
          >
            Done
          </button>
        </div>

        <p className="prescription__hint prescription__hint--screen">
          The patient scans this with their own phone. It works afterwards
          without a connection.
        </p>

        {/* Paper is the most reliable thing in the room. It survives a flat
            battery, a phone with no camera, and a patient who is handed the
            slip by a relative, and the pharmacist can read the medicines off
            it directly. The printed sheet carries the code and the words: it
            is not a receipt for the QR code, it is the prescription. */}
        <button
          type="button"
          className="prescription__print"
          onClick={() => window.print()}
          data-testid="print-prescription"
        >
          Print for the patient
        </button>

        <PrescriptionQr url={playlistUrl(playlist.reference)} />

        {/* Printed only. On screen the medicines are already below, in the
            playlist, with their videos. On paper there are no videos, so the
            words have to carry the whole prescription by themselves. */}
        <div className="print-only" aria-hidden="true">
          <h3 className="slip__title">Your medicines</h3>
          <table className="slip__table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>How much</th>
                <th>How often</th>
              </tr>
            </thead>
            <tbody>
              {playlist.items.map((item) => (
                <tr key={item.position}>
                  <td>
                    {/* Printed as well as shown. For a medicine identified
                        only by its photograph this is the only thing on the
                        paper that says which one it is, so the slip would
                        otherwise carry a dose belonging to nothing. */}
                    {item.image_url ? (
                      <img
                        className="slip__photo"
                        src={item.image_url}
                        alt=""
                      />
                    ) : null}
                    {item.label}
                  </td>
                  <td>{item.dosage}</td>
                  <td>{item.frequency}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="slip__note">
            Scan the code above to watch these in sign language.
            {playlist.is_fully_signable
              ? ""
              : ` Medicine ${playlist.unsignable_positions.join(", ")} cannot be shown in sign language and must be explained in person.`}
          </p>
        </div>

        {/* Said plainly, and before the doctor walks away. An item that cannot
            be signed is not a rendering detail: someone has to explain that
            medicine another way, and they can only do that if they are told
            while the patient is still in the room. */}
        {playlist.is_fully_signable ? (
          <p className="prescription__ok" data-testid="fully-signable">
            Every instruction can be shown in sign language.
          </p>
        ) : (
          <p
            className="prescription__warning"
            role="alert"
            data-testid="not-fully-signable"
          >
            {playlist.unsignable_positions.length === 1
              ? `Medicine ${playlist.unsignable_positions[0]} cannot be shown in sign language safely.`
              : `Medicines ${playlist.unsignable_positions.join(", ")} cannot be shown in sign language safely.`}{" "}
            Explain those to the patient another way before they leave.
          </p>
        )}

        {offline ? (
          <p className="prescription__offline" data-testid="offline-status">
            {offline.total === 0
              ? "There are no sign clips to save yet."
              : `Saved ${offline.saved} of ${offline.total} sign clips to this phone for offline replay.`}
          </p>
        ) : null}

        <PrescriptionPlaylist playlist={playlist} />
      </section>
    );
  }

  return (
    <section className="prescription" data-testid="prescription-builder">
      <div className="prescription__header">
        <h2 className="prescription__title">Prescription</h2>
        <button
          type="button"
          className="triage__leave"
          onClick={onLeave}
          data-testid="leave-prescription"
        >
          Cancel
        </button>
      </div>

      <p className="prescription__hint">
        One row per medicine. The patient takes these home as sign language
        video.
      </p>

      <ol className="prescription__items">
        {items.map((item, index) => (
          <li className="prescription__item" key={index}>
            {/* The photograph, first, because it is the better identifier for
                a patient who does not read print: they match it to the box in
                their hand, where a drug name has no sign and has to be
                fingerspelled letter by letter. */}
            <div className="photo">
              {item.preview ? (
                <div className="photo__taken">
                  <img
                    className="photo__preview"
                    src={item.preview}
                    alt={`Photograph of medicine ${index + 1}`}
                    data-testid={`medicine-photo-${index}`}
                  />
                  <button
                    type="button"
                    className="photo__clear"
                    onClick={() => setImage(index, null)}
                    data-testid={`clear-photo-${index}`}
                  >
                    Remove photo
                  </button>
                </div>
              ) : (
                <label className="photo__pick">
                  <input
                    type="file"
                    accept="image/*"
                    // Opens the rear camera straight away on a phone, rather
                    // than a file browser. The doctor is holding the box.
                    capture="environment"
                    onChange={(event) =>
                      setImage(index, event.target.files?.[0] ?? null)
                    }
                    data-testid={`photo-input-${index}`}
                  />
                  <span className="photo__icon" aria-hidden="true">
                    <CameraIcon />
                  </span>
                  <span>
                    <strong>Photograph the medicine</strong>
                    <span className="photo__hint">
                      The patient sees this picture, then the dose in sign
                      language. With a photo the name is optional.
                    </span>
                  </span>
                </label>
              )}

              {/* Said at the point the camera opens, because it cannot be
                  undone afterwards: the image travels with the QR code, and a
                  dispensing label often carries the patient's own name. */}
              <p className="photo__warning">
                Photograph the medicine itself, not a pharmacy label. A label
                may carry the patient&apos;s name, and this picture goes home
                with the QR code.
              </p>
            </div>

            <div className="prescription__fields">
              <label className="prescription__field">
                <span>Medicine {item.image ? "(optional)" : ""}</span>
                <input
                  type="text"
                  value={item.medicine}
                  onChange={(event) => update(index, "medicine", event.target.value)}
                  placeholder={item.image ? "Not needed with a photo" : "Paracetamol"}
                  data-testid={`medicine-${index}`}
                />
              </label>
              <label className="prescription__field">
                <span>How much</span>
                <input
                  type="text"
                  value={item.dosage}
                  onChange={(event) => update(index, "dosage", event.target.value)}
                  placeholder="one tablet"
                  data-testid={`dosage-${index}`}
                />
              </label>
              <label className="prescription__field">
                <span>How often</span>
                <input
                  type="text"
                  value={item.frequency}
                  onChange={(event) => update(index, "frequency", event.target.value)}
                  placeholder="twice a day"
                  data-testid={`frequency-${index}`}
                />
              </label>
            </div>

            {items.length > 1 ? (
              <button
                type="button"
                className="prescription__remove"
                onClick={() => removeItem(index)}
                data-testid={`remove-${index}`}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="prescription__actions">
        <button
          type="button"
          className="prescription__add"
          onClick={addItem}
          data-testid="add-medicine"
        >
          Add another medicine
        </button>
        <button
          type="button"
          className="prescription__issue"
          onClick={issue}
          disabled={status === "issuing"}
          data-testid="issue-prescription"
        >
          {status === "issuing" ? "Saving" : "Create QR code"}
        </button>
      </div>

      {problem ? (
        <p className="consultation__error" role="alert" data-testid="prescription-problem">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/* Inline so the control cannot lose its mark on a slow connection. */
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5A2 2 0 0 1 5 6.5h1.8l1.2-2h8l1.2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="13"
        r="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}
