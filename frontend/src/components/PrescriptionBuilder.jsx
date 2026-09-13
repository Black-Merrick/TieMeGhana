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

const blankItem = () => ({ medicine: "", dosage: "", frequency: "" });

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
    setItems((previous) => previous.filter((_, at) => at !== index));

  const issue = async () => {
    const filled = items.map((item) => ({
      medicine: item.medicine.trim(),
      dosage: item.dosage.trim(),
      frequency: item.frequency.trim(),
    }));

    // Checked here as well as on the server, because the useful message is the
    // one that arrives before the request. A blank field is the likeliest
    // mistake, and a 400 from the API cannot say which row it was.
    const incomplete = filled.findIndex(
      (item) => !item.medicine || !item.dosage || !item.frequency,
    );
    if (incomplete !== -1) {
      setProblem(
        `Medicine ${incomplete + 1} needs a name, a dosage and how often to take it.`,
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

        <p className="prescription__hint">
          The patient scans this with their own phone. It works afterwards
          without a connection.
        </p>

        <PrescriptionQr url={playlistUrl(playlist.reference)} />

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
            <div className="prescription__fields">
              <label className="prescription__field">
                <span>Medicine</span>
                <input
                  type="text"
                  value={item.medicine}
                  onChange={(event) => update(index, "medicine", event.target.value)}
                  placeholder="Paracetamol"
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
