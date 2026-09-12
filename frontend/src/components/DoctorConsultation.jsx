import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import PatientReply from "./PatientReply.jsx";
import SpokenResponse from "./SpokenResponse.jsx";
import TranscriptView from "./TranscriptView.jsx";
import useCaption from "../hooks/useCaption.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";

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
  const transcript = useTranscript();

  /** FR 4.1, the doctor's side of the exchange. */
  const askPatient = async (payload) => {
    const caption = await send(payload);
    if (caption) {
      transcript.record({
        direction: Direction.TO_PATIENT,
        text: caption.transcript,
        caption: caption.caption,
      });
    }
  };

  /** FR 4.1 and FR 3.1, the patient's typed reply, spoken and recorded. */
  const replyToDoctor = async ({ text, sourceLanguage }) => {
    const said = await spoken.speak({ text, sourceLanguage, outputLanguage });
    // Recorded as what the patient wrote, not the translation, because the
    // record is theirs and should read back in their own words.
    if (said) transcript.record({ direction: Direction.TO_DOCTOR, text });
  };

  return (
    <section className="consultation">
      <DoctorUtteranceForm onSend={askPatient} busy={status === "working"} />

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
      <PatientReply busy={spoken.status === "working"} onReply={replyToDoctor} />

      <SpokenResponse status={spoken.status} result={spoken.result} />

      <TranscriptView
        entries={transcript.entries}
        onDiscard={transcript.discard}
      />
    </section>
  );
}
