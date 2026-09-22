import { useEffect, useState } from "react";

import { phraseToSpeak } from "../emergency/spokenPhrases.js";
import { TapKind, resolveTap } from "../emergency/triageTaps.js";
import useSpeakingReports from "../hooks/useSpeakingReports.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import useTriageVocabulary from "../hooks/useTriageVocabulary.js";
import { Direction } from "../transcript/transcript.js";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import SpokenResponse, { StubNotice } from "./SpokenResponse.jsx";
import TriagePanels from "./TriagePanels.jsx";

/**
 * Emergency Visual Triage Mode, SRS FR 5.1 to FR 5.5.
 *
 * For the case the rest of the app cannot serve: an accident, no interpreter,
 * no time for a guided conversation, and possibly no idea yet whether the
 * patient reads. Everything here is one tap, and every tap is spoken aloud to
 * whoever is treating them.
 *
 * Three things make this the mode that works first and degrades last:
 *
 * - It needs no footage. The pain scale is faces and the body map is a drawing,
 *   so the patient is pointing rather than choosing between sign videos.
 * - It needs no literacy answer, so it is reachable before the literacy check
 *   has been asked. A patient who cannot breathe is not asked whether they
 *   read first.
 * - There is no text input anywhere, per FR 5.4, so a first responder who has
 *   never seen the app cannot be stuck looking for what to type.
 */
/**
 * The voices a tapped answer can be read out in, FR 5.5.
 *
 * English and Twi only. This chooses the voice, and there is no mixed voice to
 * choose, so offering one would mean picking behind the responder's back.
 */
const VOICES = [
  { value: "en", label: "English" },
  { value: "tw", label: "Twi" },
];

export default function EmergencyTriage({
  outputLanguage,
  onOutputLanguageChange = null,
  onLeave,
  // The connection to the patient's own phone, in a paired visit, and whether
  // that phone is there. Both null on a shared device, which is unchanged.
  channel = null,
  patientPhone = null,
  // Told when this screen is on screen and when it stops being, so a paired
  // phone is sent here only once the doctor's device can follow.
  onShownChange = null,
}) {
  useEffect(() => {
    onShownChange?.(true);
    return () => onShownChange?.(false);
    // Once per showing. The callback is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { alerts, phrases } = useTriageVocabulary();
  const [chosen, setChosen] = useState({ pain: null, location: null, alert: null });
  const spoken = useSpokenResponse();
  const transcript = useTranscript();

  /**
   * Speak a selection aloud and record it, FR 5.5 and FR 4.1.
   *
   * The spoken output is the whole point of a tap here. The doctor's hands and
   * eyes are on the patient, not the screen, so an answer nobody hears is an
   * answer nobody receives.
   */
  // What the overlay says while the response is still being prepared. The
  // spoken text only arrives with the response, and the wait is the part of
  // the cycle where the patient most needs to see something happening.
  const [lastSaid, setLastSaid] = useState("");

  /**
   * Speak one tap, using the rendering the server prepared for it.
   *
   * `key` names the phrase in the fixed vocabulary; `english` is the label on
   * screen, used when the server has never heard of that key.
   *
   * The source language passed to the server is the language the text is
   * already in, not the one that was asked for. That is what removes the
   * translation call: the server has nothing to translate and goes straight to
   * speech. It is also what keeps an unreviewed phrase honest, because the
   * chooser hands back English and says so rather than sending Twi nobody has
   * checked.
   */
  const announce = (key, fallbackEnglish) => {
    const { text, language } = phraseToSpeak(
      phrases,
      key,
      outputLanguage,
      fallbackEnglish,
    );

    setLastSaid(text);
    spoken.speak({ text, sourceLanguage: language, outputLanguage });

    // Recorded as the sentence that was said rather than the label on the
    // button. A record reading "Head" says where the patient pointed; one
    // reading "I have a headache" says what they told the clinician, which is
    // what a record is for.
    const stored = phrases.byKey?.[key];
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: stored?.en ?? fallbackEnglish,
      language: "en",
      // Only a reviewed translation is kept, for the same reason only a
      // reviewed one is spoken: a record is read later, by people who were not
      // in the room to notice it was wrong.
      translation: stored?.tw_reviewed ? stored.tw : undefined,
      translationLanguage: stored?.tw_reviewed ? "tw" : undefined,
      answeredBy: "patient",
    });
  };

  /** One tap, from this device or from the patient's phone: highlighted, then spoken. */
  const takeTap = (tap) => {
    const slot = {
      [TapKind.ALERT]: "alert",
      [TapKind.PAIN]: "pain",
      [TapKind.LOCATION]: "location",
    }[tap.kind];
    setChosen((previous) => ({
      ...previous,
      [slot]: tap.id,
    }));
    announce(tap.key, tap.english);
  };

  // The patient's phone tapping, and asking for it again. Only what this
  // device can name is believed: see triageTaps.js. A tap it cannot name is
  // answered with a failure, so the phone does not wait on it for ever.
  useEffect(() => {
    const message = channel?.lastMessage;
    if (message?.type === "triage") {
      const tap = resolveTap(message, alerts);
      if (tap) takeTap(tap);
      else channel.send({ type: "speaking", status: "failed" });
    } else if (message?.type === "replay" && spoken.canReplay) {
      spoken.replay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.lastMessage]);

  // Tells the phone how its tap is going, and lets it stop one.
  useSpeakingReports(channel, spoken);

  // Covers both halves of the wait: asking the language service, then the
  // audio actually playing. From the patient's side it is one action.
  const speaking = spoken.showing;

  return (
    <section className="triage" data-testid="emergency-triage">
      {/* Covers the screen while an answer is being spoken, so a second tap
          cannot queue a second answer the doctor hears with no idea which tap
          produced which. */}
      {speaking ? (
        <SpeakingOverlay
          text={spoken.result?.spoken_text ?? lastSaid}
          status={spoken.status}
          onStop={spoken.stop}
        />
      ) : null}

      <div className="triage__header">
        <div>
          <h2 className="triage__title">Emergency</h2>
          <p className="triage__hint">No typing needed.</p>
          {/* In a paired visit, whether the patient's phone is showing this
              screen. Said either way, because a doctor who believes the
              patient can see it, and is wrong, is worse off than one who was
              never told. Their own taps here still work: a patient who cannot
              use a phone is exactly who emergency mode is for. */}
          {patientPhone === "connected" ? (
            <p className="triage__hint triage__phone" data-testid="triage-patient-phone">
              The patient&apos;s phone shows this screen too. What they tap
              there is spoken here.
            </p>
          ) : null}
          {patientPhone === "away" ? (
            <p
              className="triage__hint triage__phone triage__phone--away"
              role="status"
              data-testid="triage-patient-phone-away"
            >
              The patient&apos;s phone is not connected. It will show this
              screen as soon as it is back. You can tap here in the meantime.
            </p>
          ) : null}
        </div>

        {/* FR 5.5 speaks every tap aloud, and who is listening is not knowable
            in advance: emergency can be the first screen anyone opens, before
            a visit exists and before anyone has chosen anything. A Twi
            speaking responder was previously stuck hearing English with no
            control to change it. Two radios rather than a menu, because
            section 4.1 asks for choices to be on screen, and here more than
            anywhere: this has to be usable in seconds by someone who has never
            seen the app. */}
        {onOutputLanguageChange ? (
          <fieldset className="triage__voice" data-testid="triage-voice">
            <legend className="triage__voice-legend">Read answers in</legend>
            {VOICES.map((voice) => (
              <label key={voice.value} className="triage__voice-option">
                <input
                  type="radio"
                  name="triage-output-language"
                  value={voice.value}
                  checked={outputLanguage === voice.value}
                  onChange={() => onOutputLanguageChange(voice.value)}
                />
                {voice.label}
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="triage__said">
          {spoken.canReplay && !speaking ? (
            <button
              type="button"
              className="triage__leave"
              onClick={spoken.replay}
              data-testid="replay-answer"
            >
              Say it again
            </button>
          ) : null}

          <button
            type="button"
            className="triage__leave"
            onClick={onLeave}
            data-testid="leave-emergency"
          >
            Leave emergency mode
          </button>
        </div>
      </div>

      {/* What was said, at the top rather than in a panel below the fold: the
          patient cannot hear whether anything reached the doctor, so the one
          record of it must not be somewhere they have to scroll to find.

          Always on screen, holding the instruction until there is something to
          report. It used to appear only after a tap, which pushed the alerts
          and the body map down the page at the exact moment the patient had a
          finger on them. A strip that is always there cannot move anything. */}
      <div className="triage__spoken">
        {spoken.status === "idle" ? (
          <p className="triage__ready" data-testid="triage-ready">
            {patientPhone
              ? "Tap anything, or the patient can on their phone. Every tap is spoken aloud here."
              : "Tap anything. Every tap is spoken aloud to the doctor."}
          </p>
        ) : (
          <SpokenResponse
            status={spoken.status}
            result={spoken.result}
            showProviderNotice={false}
            // A phone's tap is spoken here and this device may need touching
            // before the browser will make the sound.
            onPlay={patientPhone ? spoken.replay : null}
            heardHere={Boolean(patientPhone)}
          />
        )}
      </div>

      <TriagePanels
        alerts={alerts}
        chosen={chosen}
        disabled={speaking}
        onTap={takeTap}
      />

      {/* Once, at the foot of the page, rather than after every tap. It is a
          development notice: true, and worth saying, but it says the same
          thing each time and repeating it in the strip above would be the one
          thing that changed the strip's height. */}
      <StubNotice result={spoken.result} />
    </section>
  );
}
