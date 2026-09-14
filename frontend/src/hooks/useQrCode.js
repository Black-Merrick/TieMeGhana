import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Draw a QR code for a URL, as a data URI.
 *
 * A hook rather than part of the QR component, because the same code is needed
 * twice: once on screen, and once in the printed slip, at a different size.
 * Generating it in one place means the screen and the paper cannot end up
 * pointing at different prescriptions.
 *
 * Error correction is set high rather than left at the default. This code is
 * photographed off a phone screen or off paper, in a hospital, possibly with a
 * cracked lens, a fingerprint, or glare across half of it. A higher level
 * survives more of the code being unreadable, at the cost of a denser image.
 */
export default function useQrCode(url, size = 240) {
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

  return { image, failed };
}
