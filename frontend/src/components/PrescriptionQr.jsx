import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The QR code a patient scans to take their prescription home, SRS FR 6.3.
 *
 * Encodes a URL containing nothing but the opaque reference. There is no
 * patient name in it, no visit, and no transcript, and the endpoint it reaches
 * has no field that could carry one. That is FR 6.4, and it holds because of
 * what the payload is made of rather than because of a permission check.
 *
 * Error correction is set high rather than left at the default. This code is
 * photographed off a phone screen, in a hospital, possibly with a cracked
 * lens, a fingerprint, or glare across half of it. A higher level survives
 * more of the code being unreadable, at the cost of a slightly denser image.
 */
export default function PrescriptionQr({ url, size = 240 }) {
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    QRCode.toDataURL(url, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: size,
      // Explicit black on white. A themed QR code is a QR code that some
      // scanners refuse, and the contrast here is functional, not decorative.
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setImage(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (failed) {
    // The link is shown as text, so the prescription is still reachable when
    // the code cannot be drawn. Losing the QR must not lose the prescription.
    return (
      <p className="qr__fallback" data-testid="qr-fallback">
        The QR code could not be drawn. Open this link on the patient&apos;s
        phone instead: <span className="qr__url">{url}</span>
      </p>
    );
  }

  if (!image) {
    return (
      <p className="consultation__working" data-testid="qr-working">
        <span className="consultation__pulse" aria-hidden="true" />
        Preparing the code
      </p>
    );
  }

  return (
    <figure className="qr">
      <img
        className="qr__image"
        src={image}
        width={size}
        height={size}
        // Describes what the code is for, not what it encodes: reading a URL
        // aloud character by character helps nobody.
        alt="QR code linking to this prescription in sign language"
        data-testid="qr-image"
      />
      {/* Printed under the code so the prescription can still be reached by
          typing, which matters on a phone with no working camera. */}
      <figcaption className="qr__url" data-testid="qr-url">
        {url}
      </figcaption>
    </figure>
  );
}
