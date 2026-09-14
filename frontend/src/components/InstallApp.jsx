import { useEffect, useState } from "react";

/**
 * Installing the app onto the device, NFR 5.
 *
 * Worth a control of its own rather than leaving it to the browser's own
 * prompt, for a reason specific to this app: an installed copy keeps the
 * service worker and the cached GhSL clips, which is what makes a prescription
 * replay at home with no connection. A patient who only ever opens it as a
 * tab loses that the first time the browser reclaims storage.
 *
 * Two paths, because the platforms differ and only one of them will talk to us:
 *
 * - Chrome, Edge and Android fire `beforeinstallprompt`. The event is kept and
 *   replayed when the patient taps, which is the only way a browser will show
 *   the real dialog: it must come from a gesture.
 * - Safari on iOS fires nothing and exposes no API at all, so there the
 *   instructions are the feature. Written out rather than hidden, because
 *   iPhones are common and "install" silently missing looks like a bug.
 */
export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showingHelp, setShowingHelp] = useState(false);

  useEffect(() => {
    // Already running as an installed app, so there is nothing to offer.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return undefined;
    }

    const captured = (event) => {
      // The browser's own banner is suppressed so the offer appears in one
      // place, at a moment the patient chose, rather than over the top of a
      // consultation.
      event.preventDefault();
      setPrompt(event);
    };

    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", captured);
    window.addEventListener("appinstalled", done);

    return () => {
      window.removeEventListener("beforeinstallprompt", captured);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) {
      setShowingHelp((open) => !open);
      return;
    }

    prompt.prompt();
    const { outcome } = await prompt.userChoice;

    // The event is single use. Whether they accepted or dismissed it, it
    // cannot be replayed, so it is dropped either way and the instructions
    // take over if they change their mind.
    setPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  };

  return (
    <div className="install">
      <button
        type="button"
        className="install__button"
        onClick={install}
        data-testid="install-app"
      >
        <span className="btn__icon" aria-hidden="true">
          <DownloadIcon />
        </span>
        <span className="install__label">Install app</span>
      </button>

      {showingHelp ? (
        <div className="install__help" data-testid="install-help">
          <button
            type="button"
            className="install__close"
            onClick={() => setShowingHelp(false)}
            aria-label="Close"
            data-testid="close-install-help"
          >
            ×
          </button>

          <p className="install__help-title">To install on this device</p>
          <ol className="install__steps">
            <li>
              <strong>iPhone or iPad:</strong> tap the Share button in Safari,
              then <strong>Add to Home Screen</strong>.
            </li>
            <li>
              <strong>Android:</strong> open the browser menu, then{" "}
              <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </li>
            <li>
              <strong>Computer:</strong> look for the install icon in the
              address bar, at the right hand end.
            </li>
          </ol>
          <p className="install__why">
            Installing keeps the sign language videos on the device, so a
            prescription still plays at home with no connection.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* Inline so the control cannot lose its mark on a slow connection. */
function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M10 2.8v9.4m0 0L6.2 8.4M10 12.2l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 14.4v1.3a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
