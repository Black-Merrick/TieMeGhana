import { PeerState } from "../webrtc/peerChannel.js";

/**
 * The doctor's side of pairing a patient's own device, while it is not
 * connected.
 *
 * Purely what is on screen: the code, the wait, and the honest failure. The
 * session it reports on is owned by `App` through `usePairedHostSession`, so
 * that opening Prescription or Emergency mid visit cannot drop the connection.
 * See ADR 053.
 *
 * `reconnecting` is true when a visit is already under way, which means this
 * is not the first pairing but the connection having gone, whether the doctor
 * reloaded, or a phone lost signal. The code shown is a fresh one either way,
 * since the last one was discarded the moment it was used.
 */
export default function PairingHostScreen({
  session,
  reconnecting = false,
  onUseThisDeviceInstead,
}) {
  // This device having no network just then, Wi-Fi dropping and coming back for
  // instance, is not the two devices failing to reach each other, and is tried
  // again by itself under the same code. It is said, but it is not "failed".
  const offline = !session.codeFailed && session.failure === "no-network";

  const failed =
    !offline &&
    (session.codeFailed ||
      session.state === PeerState.FAILED ||
      session.state === PeerState.CLOSED);

  if (failed) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-failed">
        <p className="notice notice--danger" role="alert">
          {session.codeFailed
            ? "Could not open a pairing code. Check the connection and try again, or continue on this device."
            : reconnecting
              ? "The patient's device was disconnected. Pair it again, or continue on this device."
              : "Couldn't connect these two devices directly. This can happen on different WiFi networks. Try again, or continue on one device instead."}
        </p>
        <div className="pairing__actions">
          <button
            type="button"
            className="pairing__primary"
            onClick={session.retry}
            data-testid="pairing-try-again"
          >
            Pair again
          </button>
          <button
            type="button"
            className="pairing__secondary"
            onClick={onUseThisDeviceInstead}
            data-testid="pairing-use-this-device"
          >
            Continue on this device
          </button>
        </div>
      </section>
    );
  }

  // The way back is already there: the phone rejoins by itself and there is no
  // code to type. Shown only where there is no consultation on screen to stay
  // on, which is before the doctor has answered the literacy question.
  if (session.resumable && !session.pairingCode) {
    return (
      <section className="pairing pairing--card" data-testid="pairing-resuming">
        <p className="literacy__eyebrow">
          <span className="shell__dot shell__dot--connected" aria-hidden="true" />
          Two devices
        </p>
        <h2 className="pairing__title">Waiting for the patient&apos;s phone</h2>
        <p className="pairing__status" role="status">
          <span className="pairing__pulse" aria-hidden="true" />
          It will rejoin by itself. Keep it open on the patient&apos;s side.
        </p>
        <div className="pairing__actions">
          <button
            type="button"
            className="pairing__secondary"
            onClick={session.retry}
            data-testid="pairing-new-code"
          >
            Pair with a new code instead
          </button>
          <button
            type="button"
            className="pairing__secondary"
            onClick={onUseThisDeviceInstead}
            data-testid="pairing-use-this-device"
          >
            Use this device instead
          </button>
        </div>
      </section>
    );
  }

  // Where the patient goes, written out in full. "/join" alone assumes they
  // know the address of the app, which on a phone in a waiting room they may
  // not; the origin is whatever this page is being served from.
  const address = `${window.location.host}`;

  return (
    <section className="pairing pairing--card" data-testid="pairing-host-waiting">
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        {reconnecting ? "Connection lost" : "Two devices"}
      </p>

      <h2 className="pairing__title">
        {reconnecting ? "Reconnect the patient's phone" : "Pair the patient's phone"}
      </h2>

      <ol className="pairing__steps">
        <li>
          On the patient&apos;s phone, open <strong>{address}</strong>.
        </li>
        <li>
          Tap <strong>I&apos;m a patient</strong>.
        </li>
        <li>Enter this code.</li>
      </ol>

      {session.pairingCode ?? session.code ? (
        <p
          className="pairing__code"
          data-testid="pairing-code"
          aria-live="polite"
        >
          {session.pairingCode ?? session.code}
        </p>
      ) : (
        <p className="pairing__code pairing__code--loading" role="status">
          Getting a code…
        </p>
      )}

      {offline ? (
        <p className="notice notice--warn" role="status" data-testid="pairing-no-network">
          This device has no network connection just now. It will try again by
          itself, and the code stays the same. Check the Wi-Fi if this goes on.
        </p>
      ) : null}

      <p className="pairing__status" role="status">
        <span className="pairing__pulse" aria-hidden="true" />
        Waiting for the patient&apos;s phone to connect…
      </p>

      <button
        type="button"
        className="pairing__secondary"
        onClick={onUseThisDeviceInstead}
        data-testid="pairing-use-this-device"
      >
        Use this device instead
      </button>
    </section>
  );
}
