import { useEffect, useState } from "react";

import { cachePlaylistClips, fetchPlaylist } from "../api/prescriptions.js";
import PrescriptionPlaylist from "./PrescriptionPlaylist.jsx";
import SavePrescription from "./SavePrescription.jsx";

/**
 * What a scanned QR code opens, SRS FR 6.2 and FR 6.3.
 *
 * The patient's own screen, at home, on their own phone, possibly weeks after
 * the consultation and possibly with no connection. It renders from the
 * reference in the URL and nothing else: there is no session to have expired
 * and no account to have been locked out of.
 *
 * This screen shows a prescription and nothing else. It is reached by a link
 * that anyone holding the phone can open, so it must never be a door into the
 * rest of the app: no transcript, no consultation history, no way back into a
 * visit. FR 6.4.
 */
export default function PrescriptionPlayback({ reference }) {
  const [playlist, setPlaylist] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchPlaylist(reference)
      .then((loaded) => {
        if (cancelled) return;

        // Shape checked rather than trusted, the same lesson as the alerts
        // fetch: a catch handles the server failing, not the server answering
        // wrongly, and those are different failures.
        if (!Array.isArray(loaded?.items)) {
          setFailed(true);
          return;
        }

        setPlaylist(loaded);
        // Re-cached on every open, so a clip filmed since the last visit is
        // saved for the next time the patient is offline.
        cachePlaylistClips(loaded).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (failed) {
    return (
      <section className="prescription" data-testid="playback-failed">
        <h2 className="prescription__title">Prescription not found</h2>
        <p className="prescription__hint">
          This link did not open a prescription. If you have no connection and
          have not opened it on this phone before, try again where there is
          network.
        </p>
      </section>
    );
  }

  if (!playlist) {
    return (
      <p className="consultation__working" data-testid="playback-working">
        <span className="consultation__pulse" aria-hidden="true" />
        Opening your prescription
      </p>
    );
  }

  return (
    <section className="prescription" data-testid="prescription-playback">
      <h2 className="prescription__title">Your medicines</h2>
      <p className="prescription__hint">
        Play each one as often as you like. Nothing here needs a connection once
        it has opened on this phone.
      </p>

      {!playlist.is_fully_signable ? (
        <p className="prescription__warning" role="alert" data-testid="playback-incomplete">
          Some of these cannot be shown in sign language yet. Ask a nurse or
          pharmacist to explain those.
        </p>
      ) : null}

      <PrescriptionPlaylist playlist={playlist} />

      <SavePrescription playlist={playlist} />
    </section>
  );
}
