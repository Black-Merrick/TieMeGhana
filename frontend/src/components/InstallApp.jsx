import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { detectPlatform } from "../pwa/platform.js";

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

      {showingHelp ? <InstallHelp onClose={() => setShowingHelp(false)} /> : null}
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

/**
 * How to install, for whichever device this is.
 *
 * A sheet over the screen rather than a panel hanging off the button. The
 * button sits in a bar at the foot of a phone, or in a corner of the patient's
 * header, and a panel anchored to it opened off the edge of a small screen
 * where nobody could see it, which made "Install app" look as though it did
 * nothing at all.
 *
 * Only the steps for this device where it is known, since three sets of
 * instructions, two of them for other devices, read as a fault. All of them
 * where it is not.
 */
function InstallHelp({ onClose }) {
  const platform = detectPlatform();
  const known = platform.ios || platform.android;

  // Into the document's body, out of whatever the button sits in. On a phone it
  // sits in a bar fixed to the foot of the screen, and a fixed element inside
  // one that is itself positioned or filtered is placed against that bar, not
  // the screen, and clipped to it.
  return createPortal(
    <div className="install__overlay" onClick={onClose} data-testid="install-overlay">
      <div
        className="install__help"
        role="dialog"
        aria-modal="true"
        aria-label="Install on this device"
        onClick={(event) => event.stopPropagation()}
        data-testid="install-help"
      >
        <button
          type="button"
          className="install__close"
          onClick={onClose}
          aria-label="Close"
          data-testid="close-install-help"
        >
          ×
        </button>

        <p className="install__help-title">To install on this device</p>

        {platform.iosSafari || (!known && !platform.iosOther) ? (
          <IosSteps heading={known ? null : "iPhone or iPad"} />
        ) : null}

        {platform.iosOther ? <IosOtherBrowser /> : null}

        {platform.android || !known ? (
          <ol className="install__steps" data-testid="install-steps-android">
            <li>
              {known ? null : <strong>Android: </strong>}
              Open the browser menu, then <strong>Install app</strong> or{" "}
              <strong>Add to Home screen</strong>.
            </li>
          </ol>
        ) : null}

        {!known ? (
          <ol className="install__steps" data-testid="install-steps-computer">
            <li>
              <strong>Computer: </strong>look for the install icon in the
              address bar, at the right hand end.
            </li>
          </ol>
        ) : null}

        <p className="install__why">
          Installing keeps the sign language videos on the device, so a
          prescription still plays at home with no connection.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** Safari on an iPhone or iPad: no dialog exists, so the steps are the feature. */
function IosSteps({ heading }) {
  return (
    <div data-testid="install-steps-ios">
      {heading ? <p className="install__platform">{heading}</p> : null}
      <ol className="install__steps">
        <li>
          Tap the <strong>Share</strong> button <ShareIcon /> in Safari. On an
          iPhone it is in the bar at the bottom of the screen; on an iPad, at the
          top.
        </li>
        <li>
          Scroll down and tap <strong>Add to Home Screen</strong>.
        </li>
        <li>
          Tap <strong>Add</strong>. The app is now an icon on your home screen.
        </li>
      </ol>
      <p className="install__note" data-testid="install-ios-note">
        The installed app starts fresh, without a consultation already joined.
        Install it before a consultation, not in the middle of one.
      </p>
    </div>
  );
}

/**
 * Another browser on an iPhone or iPad, or a web page inside another app.
 * Adding to the home screen is done from Safari, so the address is offered to
 * take there.
 */
function IosOtherBrowser() {
  const [copied, setCopied] = useState(false);
  // The page they are on, so Safari opens where they were: a patient on /join
  // lands on /join and not on the doctor's first question.
  const address = typeof window === "undefined" ? "" : window.location.href;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // No clipboard here. The address is on screen to be copied by hand.
    }
  };

  return (
    <div data-testid="install-steps-ios-other">
      <p className="install__platform">This is not Safari</p>
      <p className="install__note install__note--lead">
        On an iPhone or iPad the app can only be added to the home screen from
        Safari. Open this address in Safari, then follow the steps there.
      </p>
      <p className="install__address" data-testid="install-address">
        {address}
      </p>
      <button type="button" className="install__copy" onClick={copy} data-testid="copy-address">
        {copied ? "Copied" : "Copy the address"}
      </button>
      <IosSteps heading="Then, in Safari" />
    </div>
  );
}

/** The mark iOS puts on its Share button: a square with an arrow leaving it. */
function ShareIcon() {
  return (
    <svg
      className="install__share-icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      role="img"
      aria-label="the Share icon"
      focusable="false"
    >
      <path
        d="M10 2.5v9.5M10 2.5 6.6 5.9M10 2.5l3.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 8.6H5.3a1.3 1.3 0 0 0-1.3 1.3v6.3a1.3 1.3 0 0 0 1.3 1.3h9.4a1.3 1.3 0 0 0 1.3-1.3V9.9a1.3 1.3 0 0 0-1.3-1.3H14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
