import { Suspense } from "react";

import { playlistUrl } from "../api/prescriptions.js";
import lazyScreen from "../lazyScreen.js";
import PrescriptionQr from "./PrescriptionQr.jsx";
import ScreenLoader from "./ScreenLoader.jsx";

// Split out like the doctor's own prescription screens: fetched the first time
// it is opened, and it is the screen a scanned code opens, so it is the same
// component and the patient gets the same medicines, the same replay and the
// same saving whichever way they arrived.
const PrescriptionPlayback = lazyScreen(() => import("./PrescriptionPlayback.jsx"));

/**
 * The prescription the doctor issued, on the patient's own phone.
 *
 * The doctor's device sends only the reference; everything shown here is
 * fetched from the server by it, exactly as after scanning the QR code, so a
 * clip a consultant withdraws stops playing here too (ADR 043). It opens the
 * same screen the code opens (`PrescriptionPlayback`): each medicine's sign
 * video with its photograph and caption, played as often as wanted, cached on
 * this phone for offline replay, and saved as a file to the phone (FR 6.2).
 *
 * The QR code is here as well, for the patient to open the same medicines on
 * another phone, such as a relative's, without the doctor's device. The
 * reference in it identifies nobody (ADR 044). See ADR 053.
 */
export default function PrescriptionGuest({ reference, over = false, onBack }) {
  return (
    <section className="prescription-guest" data-testid="prescription-guest">
      <button
        type="button"
        className="prescription-guest__back"
        onClick={onBack}
        data-testid="medicines-back"
      >
        {over ? "Back" : "Back to the conversation"}
      </button>

      {over ? (
        <p className="prescription-guest__ended" role="status" data-testid="medicines-after-visit">
          The consultation has ended. Your medicines stay here until you leave.
        </p>
      ) : null}

      <Suspense fallback={<ScreenLoader label="Opening your medicines" />}>
        <PrescriptionPlayback reference={reference} />
      </Suspense>

      <div className="prescription-guest__share" data-testid="medicines-share">
        <h3 className="save__title">Open these on another phone</h3>
        <p className="save__hint">
          Someone who looks after you can scan this to see the same medicines.
        </p>
        <PrescriptionQr url={playlistUrl(reference)} size={220} />
      </div>
    </section>
  );
}
