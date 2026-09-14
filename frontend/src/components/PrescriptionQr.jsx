import useQrCode from "../hooks/useQrCode.js";

/**
 * The QR code a patient scans to take their prescription home, SRS FR 6.3.
 *
 * Encodes a URL containing nothing but the opaque reference. There is no
 * patient name in it, no visit, and no transcript, and the endpoint it reaches
 * has no field that could carry one. That is FR 6.4, and it holds because of
 * what the payload is made of rather than because of a permission check.
 *
 * The drawing itself is in `useQrCode`, because the printed slip needs the same
 * code at a different size and the two must not be able to point at different
 * prescriptions.
 */
export default function PrescriptionQr({ url, size = 240 }) {
  const { image, failed } = useQrCode(url, size);

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
