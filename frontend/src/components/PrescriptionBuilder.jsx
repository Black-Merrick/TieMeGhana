import { useEffect, useState } from "react";

import {
  cachePlaylistClips,
  fetchPlaylist,
  issuePrescription,
  playlistUrl,
} from "../api/prescriptions.js";
import {
  clearCurrentPrescription,
  loadCurrentPrescription,
  saveCurrentPrescription,
} from "../prescription/currentPrescription.js";
import useQrCode from "../hooks/useQrCode.js";
import {
  AMOUNTS,
  FREQUENCIES,
  MEALS,
  TIMES_OF_DAY,
  UNITS,
  previewInstruction,
} from "../prescription/dosing.js";
import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import PrescriptionPlaylist from "./PrescriptionPlaylist.jsx";
import PrescriptionQr from "./PrescriptionQr.jsx";
import ScreenLoader from "./ScreenLoader.jsx";

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
  // The dose, as choices rather than free text. ADR 049.
  amount: "1",
  unit: "TABLET",
  times: [],
  frequencyChoice: "TWICE",
  meal: "",
  days: "",
  // The File itself, plus a preview URL made from it. Kept together so
  // clearing the photograph cannot leave a thumbnail of it behind.
  image: null,
  preview: null,
});

export default function PrescriptionBuilder({
  onLeave,
  // In a paired visit: called with the reference once a prescription is issued
  // (or found already issued), so the patient's phone can be given it, and
  // whether that phone is there. Both null on a shared device.
  onIssued = null,
  patientPhone = null,
}) {
  const [items, setItems] = useState([blankItem()]);
  // "editing", "issuing", "issued", or "restoring" while a reference found in
  // storage is being fetched back.
  const [status, setStatus] = useState(() =>
    loadCurrentPrescription() ? "restoring" : "editing",
  );
  const [playlist, setPlaylist] = useState(null);
  const [problem, setProblem] = useState(null);
  const [offline, setOffline] = useState(null);

  // A prescription already issued is fetched back rather than rebuilt from
  // storage. Only the reference was kept, per ADR 043: the signs are resolved
  // on every read so a withdrawn clip stops playing, and a playlist cached
  // here would be the frozen copy that decision exists to avoid.
  useEffect(() => {
    const reference = loadCurrentPrescription();
    if (!reference) return undefined;

    let cancelled = false;

    fetchPlaylist(reference)
      .then((restored) => {
        if (cancelled) return;

        if (!Array.isArray(restored?.items)) {
          // A reference that resolves to something unexpected. Dropped rather
          // than shown, and the doctor starts a new prescription instead of
          // handing over a QR code nobody can explain.
          clearCurrentPrescription();
          setStatus("editing");
          return;
        }

        setPlaylist(restored);
        setStatus("issued");
        // A reload on the issued screen: the phone is given it again if it was
        // not already. The same reference changes nothing.
        onIssued?.(restored.reference ?? reference);
      })
      .catch(() => {
        if (cancelled) return;

        // Gone from the server, or no connection. Either way there is nothing
        // to show, so the screen goes back to a blank prescription.
        clearCurrentPrescription();
        setStatus("editing");
      });

    return () => {
      cancelled = true;
    };
    // Once, on opening. `onIssued` is only told what was found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      amount: item.amount,
      unit: item.unit,
      times: item.times,
      // Specific times say strictly more than a count, so when both are set
      // the count is dropped rather than sent to be ignored.
      frequency_choice: item.times.length > 0 ? "" : item.frequencyChoice,
      meal: item.meal,
      days: item.days ? Number(item.days) : null,
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

    const unscheduled = filled.findIndex(
      (item) => item.times.length === 0 && !item.frequency_choice,
    );
    if (unscheduled !== -1) {
      setProblem(
        `Medicine ${unscheduled + 1} needs a time: tick the times of day, or choose how many times a day.`,
      );
      return;
    }

    setStatus("issuing");
    setProblem(null);

    try {
      const issued = await issuePrescription(filled);
      setPlaylist(issued);
      setStatus("issued");
      saveCurrentPrescription(issued.reference);
      onIssued?.(issued.reference);
      vibrate(VibrationPattern.TRANSCRIPT_SAVED);

      // FR 6.2. Pulled into the cache now, on the hospital connection, rather
      // than on first play at home where there may be no connection at all.
      setOffline(await cachePlaylistClips(issued));
    } catch {
      setStatus("editing");
      setProblem("The prescription could not be saved. Check the connection and try again.");
    }
  };

  if (status === "restoring") {
    return <ScreenLoader label="Opening the prescription" />;
  }

  if (status === "issued" && playlist) {
    return (
      <section
        className="prescription prescription--issued"
        data-testid="prescription-issued"
      >
        <div className="prescription__header">
          <h2 className="prescription__title">Prescription ready</h2>
          <button
            type="button"
            className="triage__leave"
            onClick={() => {
              // Forgotten on the way out. The reference identifies nobody, per
              // ADR 044, but this device is handed from one patient to the
              // next and the next one must not find these medicines on screen.
              clearCurrentPrescription();
              onLeave();
            }}
            data-testid="leave-prescription"
          >
            Done
          </button>
        </div>

        <p className="prescription__hint prescription__hint--screen">
          The patient scans this with their own phone. It works afterwards
          without a connection.
        </p>

        {/* In a paired visit it is already on the patient's phone, and the
            doctor is told, so the patient is not sent to scan a code on a
            screen they are looking at. Said either way: a doctor who thinks it
            arrived, and is wrong, is worse off than one who was never told. */}
        {patientPhone === "connected" ? (
          <p className="prescription__ok" data-testid="issued-on-phone">
            It is on the patient&apos;s phone now. They can play and save the
            videos there.
          </p>
        ) : null}
        {patientPhone === "away" ? (
          <p
            className="prescription__warning"
            role="status"
            data-testid="issued-phone-away"
          >
            The patient&apos;s phone is not connected. It will be given the
            prescription when it is back. They can also scan this code.
          </p>
        ) : null}

        {/* Two columns rather than one column and a scroll. The doctor is
            holding the phone up to be scanned while reading the medicines back
            to the patient, so the code and the list are wanted at the same
            time, not one after the other. Same arrangement as the printed
            sheet. */}

        {/* Paper is the most reliable thing in the room. It survives a flat
            battery, a phone with no camera, and a patient who is handed the
            slip by a relative, and the pharmacist can read the medicines off
            it directly. The printed sheet carries the code and the words: it
            is not a receipt for the QR code, it is the prescription. */}
        <div className="issued">
          <div className="issued__code">
            <PrescriptionQr url={playlistUrl(playlist.reference)} />

            <button
              type="button"
              className="prescription__print"
              onClick={() => window.print()}
              data-testid="print-prescription"
            >
              <span className="btn__icon" aria-hidden="true">
                <PrinterIcon />
              </span>
              Print for the patient
            </button>

            {offline ? (
              <p className="prescription__offline" data-testid="offline-status">
                {offline.total === 0
                  ? "There are no sign clips to save yet."
                  : `Saved ${offline.saved} of ${offline.total} sign clips to this phone for offline replay.`}
              </p>
            ) : null}
          </div>

          <div className="issued__medicines">
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

            <PrescriptionPlaylist playlist={playlist} />
          </div>
        </div>

        <PrintSlip playlist={playlist} />
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

            <label className="prescription__field prescription__name">
              <span>Medicine {item.image ? "(optional)" : ""}</span>
              <input
                type="text"
                value={item.medicine}
                onChange={(event) => update(index, "medicine", event.target.value)}
                placeholder={item.image ? "Not needed with a photo" : "Paracetamol"}
                data-testid={`medicine-${index}`}
              />
            </label>

            {/* The dose, chosen rather than typed. A prescription is a dose, a
                time, a relation to food and sometimes a length of course, and
                choosing from those means the app can promise to sign whatever
                the doctor enters. ADR 049. */}
            <div className="dose">
              <div className="dose__row">
                <label className="prescription__field">
                  <span>How much</span>
                  <select
                    value={item.amount}
                    onChange={(event) => update(index, "amount", event.target.value)}
                    data-testid={`amount-${index}`}
                  >
                    {AMOUNTS.map((amount) => (
                      <option key={amount.value} value={amount.value}>
                        {amount.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prescription__field">
                  <span>Of what</span>
                  <select
                    value={item.unit}
                    onChange={(event) => update(index, "unit", event.target.value)}
                    data-testid={`unit-${index}`}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="dose__times">
                <legend>When</legend>
                {/* Times of day and a count are two ways of saying the same
                    thing, and the times say more: a patient told "morning and
                    evening" knows when, where one told "twice a day" has to
                    decide and may take both together. Choosing times therefore
                    turns the count off rather than sitting alongside it. */}
                {TIMES_OF_DAY.map((time) => (
                  <label key={time.value} className="dose__time">
                    <input
                      type="checkbox"
                      checked={item.times.includes(time.value)}
                      onChange={(event) =>
                        update(
                          index,
                          "times",
                          event.target.checked
                            ? [...item.times, time.value]
                            : item.times.filter((one) => one !== time.value),
                        )
                      }
                      data-testid={`time-${time.value}-${index}`}
                    />
                    {time.label}
                  </label>
                ))}
              </fieldset>

              <div className="dose__row">
                <label className="prescription__field">
                  <span>{item.times.length > 0 ? "How often (set by the times above)" : "How often"}</span>
                  <select
                    value={item.times.length > 0 ? "" : item.frequencyChoice}
                    disabled={item.times.length > 0}
                    onChange={(event) =>
                      update(index, "frequencyChoice", event.target.value)
                    }
                    data-testid={`frequency-${index}`}
                  >
                    <option value="">Choose</option>
                    {FREQUENCIES.map((frequency) => (
                      <option key={frequency.value} value={frequency.value}>
                        {frequency.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prescription__field">
                  <span>Food</span>
                  <select
                    value={item.meal}
                    onChange={(event) => update(index, "meal", event.target.value)}
                    data-testid={`meal-${index}`}
                  >
                    {MEALS.map((meal) => (
                      <option key={meal.value} value={meal.value}>
                        {meal.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prescription__field">
                  <span>For how long</span>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={item.days}
                    onChange={(event) => update(index, "days", event.target.value)}
                    placeholder="days"
                    data-testid={`days-${index}`}
                  />
                </label>
              </div>

              {/* The sentence the patient will get, while it can still be
                  changed. A row of separate controls does not read as an
                  instruction, and the doctor should see what they are
                  prescribing before issuing it rather than after. */}
              {previewInstruction(item) ? (
                <p className="dose__preview" data-testid={`dose-preview-${index}`}>
                  <span className="dose__preview-label">The patient is told</span>
                  {item.medicine ? `${item.medicine}, ` : ""}
                  {previewInstruction(item)}
                </p>
              ) : null}
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

/**
 * The sheet the doctor hands over, on paper.
 *
 * Printed only, and it is the whole page: the print stylesheet blanks
 * everything else rather than naming the parts to hide, because naming them is
 * how the last version broke. It listed `.shell__bar`, which stopped existing
 * when the top bar was restructured, so the navigation, the Emergency button
 * and the install bar all printed.
 *
 * Two columns, code beside table. The pharmacist reads the table and the
 * patient scans the code, and on one A5 of paper neither should have to be
 * found underneath the other.
 */
function PrintSlip({ playlist }) {
  const url = playlistUrl(playlist.reference);
  const { image } = useQrCode(url, 420);

  return (
    <div className="slip print-only" aria-hidden="true">
      <div className="slip__head">
        <span className="slip__brand">Tie Me Ghana</span>
        <span className="slip__kind">Prescription</span>
      </div>

      <div className="slip__body">
        <div className="slip__qr">
          {image ? <img className="slip__code" src={image} alt="" /> : null}
          <p className="slip__scan">
            <strong>Scan this</strong> to watch these instructions in Ghanaian
            Sign Language. It works afterwards with no internet.
          </p>
          {/* The link in text as well, because a phone with no working camera
              still has a keyboard, and losing the code must not lose the
              prescription. */}
          <p className="slip__url">{url}</p>
        </div>

        <div className="slip__meds">
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
                      <img className="slip__photo" src={item.image_url} alt="" />
                    ) : null}
                    <span className="slip__name">{item.label}</span>
                  </td>
                  <td className="slip__dose">{item.dosage}</td>
                  <td className="slip__dose">{item.frequency}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* The one line on the page somebody has to act on, so it prints
              whatever else is trimmed. */}
          {playlist.is_fully_signable ? null : (
            <p className="slip__warning">
              Medicine {playlist.unsignable_positions.join(", ")} cannot be
              shown in sign language and must be explained in person before the
              patient leaves.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* Inline so the control cannot lose its mark on a slow connection. */
function PrinterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M6 7.5V3h8v4.5M6 14h8v3.5H6V14Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6 14H3.5v-5A1.5 1.5 0 0 1 5 7.5h10a1.5 1.5 0 0 1 1.5 1.5v5H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
