import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import PatientReply from "./PatientReply.jsx";
import SpokenResponse from "./SpokenResponse.jsx";
import useCaption from "../hooks/useCaption.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";

/**
 * The literate patient's path, SRS FR 1.1 to FR 1.7 and FR 2.3.
 *
 * The doctor types or speaks, and the patient reads the Twi caption alongside
 * the GhSL video. A patient on this path can read, so free captioning is
 * appropriate here and only here.
 */
export default function DoctorConsultation({ outputLanguage }) {
  const { result, status, send } = useCaption();
  const spoken = useSpokenResponse();

  return (
    <section className="consultation">
      <DoctorUtteranceForm onSend={send} busy={status === "working"} />

      {status === "working" ? (
        <p className="consultation__working" data-testid="working-indicator">
          <span className="consultation__pulse" aria-hidden="true" />
          Translating and finding signs
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="consultation__error" data-testid="caption-error" role="alert">
          Could not reach the language service. Try again, or type the message
          for the patient to read.
        </p>
      ) : null}

      {result ? <CaptionResult result={result} /> : null}

      {/* FR 3.1 and 3.4. The patient types, and their answer is spoken aloud
          in whichever language the hearing listener set for this visit. */}
      <PatientReply
        busy={spoken.status === "working"}
        onReply={({ text, sourceLanguage }) =>
          spoken.speak({ text, sourceLanguage, outputLanguage })
        }
      />

      <SpokenResponse status={spoken.status} result={spoken.result} />
    </section>
  );
}
