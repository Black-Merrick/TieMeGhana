import { LegalDocument } from "./documents.js";
import PrivacyPolicy from "./PrivacyPolicy.jsx";
import TermsOfUse from "./TermsOfUse.jsx";

/**
 * The privacy policy and the terms, each on its own address.
 *
 * Two documents rather than one page with tabs. They are read for different
 * reasons and at different moments: a clinician checks the terms before relying
 * on the app, and a patient or a hospital's data protection officer looks up
 * the privacy policy long afterwards. Each therefore needs an address that can
 * be sent to somebody on its own.
 *
 * Reached at /privacy and /terms. Both are plain content with no dependency on
 * a visit, a connection or the database, so a link to either works when the
 * rest of the app does not.
 */
export default function LegalScreen({ document, onOpen, onLeave }) {
  const other =
    document === LegalDocument.PRIVACY
      ? LegalDocument.TERMS
      : LegalDocument.PRIVACY;

  return (
    <section className="legal-screen" data-testid="legal-screen">
      <nav className="legal-screen__bar" aria-label="Document">
        <button
          type="button"
          className="legal-screen__back"
          onClick={onLeave}
          data-testid="leave-legal"
        >
          Back to the app
        </button>

        <button
          type="button"
          className="legal-screen__switch"
          onClick={() => onOpen(other)}
          data-testid="switch-legal"
        >
          {other === LegalDocument.TERMS
            ? "Read the Terms of Use"
            : "Read the Privacy Policy"}
        </button>
      </nav>

      {document === LegalDocument.TERMS ? <TermsOfUse /> : <PrivacyPolicy />}
    </section>
  );
}
