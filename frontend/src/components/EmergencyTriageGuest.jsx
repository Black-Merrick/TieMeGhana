import { useState } from "react";

import { TapKind, tapMessage } from "../emergency/triageTaps.js";
import useSpeechFeedback from "../hooks/useSpeechFeedback.js";
import useTranscript from "../hooks/useTranscript.js";
import useTriageVocabulary from "../hooks/useTriageVocabulary.js";
import { Direction } from "../transcript/transcript.js";
import SentReplyStatus from "./SentReplyStatus.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import TriagePanels from "./TriagePanels.jsx";

/**
 * Emergency triage on the patient's own phone, SRS FR 5.
 *
 * The doctor opened emergency mode on their device and this phone follows it:
 * the same alerts, the same pain scale, the same body, so the patient can point
 * at what is wrong instead of the doctor having to hold a device out to them.
 *
 * It is the same screen as the doctor's (TriagePanels), with what belongs to
 * the doctor left off. There is no voice picker, because the voice is chosen by
 * whoever is listening; and no way to leave, because the doctor ends emergency
 * mode and this phone goes back to the consultation by itself.
 *
 * A tap is not spoken here. It is sent to the doctor's device, which says it
 * aloud where they are standing (FR 3.5), and reports how that is going
 * (`speaking`), so the patient sees and feels each stage on the device in their
 * hand, as section 4.2 requires and as on every other screen of this phone.
 *
 * Each tap is recorded in this phone's own record as it is made, like every
 * other answer it gives (FR 4.2). There is still no text input anywhere, per
 * FR 5.4. See ADR 053.
 */
export default function EmergencyTriageGuest({ channel, offline = false }) {
  const { alerts, phrases } = useTriageVocabulary();
  const [chosen, setChosen] = useState({ pain: null, location: null, alert: null });
  const transcript = useTranscript();
  const speech = useSpeechFeedback(channel);

  const speaking = speech.busy;

  const tap = (choice) => {
    const slot = {
      [TapKind.ALERT]: "alert",
      [TapKind.PAIN]: "pain",
      [TapKind.LOCATION]: "location",
    }[choice.kind];
    setChosen((previous) => ({ ...previous, [slot]: choice.id }));

    // The sentence it means rather than the label on the button, as the
    // doctor's own record has it: read later by people who were not there.
    const stored = phrases.byKey?.[choice.key];
    const sentence = stored?.en ?? choice.english;
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: sentence,
      language: "en",
      answeredBy: "patient",
    });

    // Assumed on its way until the doctor's device says otherwise, so a second
    // tap in the moment before its first report arrives is not a second answer.
    speech.begin(sentence);
    channel.send(tapMessage(choice));
  };

  return (
    <section className="triage triage--guest" data-testid="emergency-triage-guest">
      {speaking ? (
        <SpeakingOverlay text={speech.text} status={speech.status} onStop={speech.stop} />
      ) : null}

      <div className="triage__header">
        <div>
          <h2 className="triage__title">Emergency</h2>
          <p className="triage__hint">No typing needed.</p>
        </div>

        <div className="triage__said">
          {speech.status === "spoken" || speech.status === "stopped" ? (
            <button
              type="button"
              className="triage__leave"
              onClick={speech.replay}
              data-testid="replay-answer"
            >
              Say it again
            </button>
          ) : null}
        </div>
      </div>

      {/* Always on screen, so it cannot move anything under a finger: holding
          the instruction until there is something to report. */}
      <div className="triage__spoken">
        {speech.status === "idle" ? (
          <p className="triage__ready" data-testid="triage-ready">
            Tap anything. Every tap is spoken aloud to the doctor.
          </p>
        ) : (
          <SentReplyStatus status={speech.status} text={speech.text} />
        )}
      </div>

      {/* Locked while this phone is finding the doctor's device again: a tap
          sent now would be spoken later, out of turn. Still shown, so the
          patient keeps their place. */}
      <div className="offline-lock" inert={offline}>
        <TriagePanels
          alerts={alerts}
          chosen={chosen}
          disabled={speaking || offline}
          onTap={tap}
        />
      </div>
    </section>
  );
}
