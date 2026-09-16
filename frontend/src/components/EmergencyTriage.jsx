import { useEffect, useState } from "react";

import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import {
  NO_PHRASES,
  anyFallsBackToEnglish,
  indexPhrases,
  phraseToSpeak,
} from "../emergency/spokenPhrases.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";
import BodyMap from "./BodyMap.jsx";
import CriticalAlerts from "./CriticalAlerts.jsx";
import PainScale from "./PainScale.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import SpokenResponse, { StubNotice } from "./SpokenResponse.jsx";

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
}) {
  const [alerts, setAlerts] = useState(null);

  // The fixed vocabulary, in both languages, fetched once. Emergency mode has
  // no free text, so everything it can say is known in advance and is
  // translated on the server rather than at the moment of a tap. That is what
  // makes a tap speak in about three seconds rather than five, and what keeps
  // an unreviewed clinical translation from being read aloud during triage.
  const [phrases, setPhrases] = useState(NO_PHRASES);
  const [chosen, setChosen] = useState({ pain: null, location: null, alert: null });
  const spoken = useSpokenResponse();
  const transcript = useTranscript();

  useEffect(() => {
    let cancelled = false;

    fetchCriticalAlerts()
      .then((loaded) => {
        if (cancelled) return;

        // Shape checked rather than trusted. A payload that is not a list
        // would throw inside render and take the whole screen down with it,
        // including the pain scale and body map, which need nothing from the
        // server and must survive anything the server does.
        setAlerts(Array.isArray(loaded) ? loaded : []);
      })
      .catch(() => {
        // The pain scale and body map still work, so triage degrades rather
        // than failing. Both are drawings and need nothing from the server.
        if (!cancelled) setAlerts([]);
      });

    // Failure here is survivable in the same way: without the vocabulary
    // every tap is spoken in English, which is the behaviour before this
    // existed rather than a broken screen.
    fetchEmergencySpeech()
      .then((payload) => {
        if (!cancelled) setPhrases(indexPhrases(payload));
      })
      .catch(() => {
        if (!cancelled) setPhrases(NO_PHRASES);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
  const announce = (key, english) => {
    const { text, language } = phraseToSpeak(phrases, key, outputLanguage, english);

    setLastSaid(text);
    spoken.speak({ text, sourceLanguage: language, outputLanguage });

    // Both renderings are kept, because the record is read afterwards and may
    // be read by somebody who does not share the language it was spoken in.
    // The second one costs nothing here: the server already prepared it.
    const stored = phrases.byKey?.[key];
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: english,
      language: "en",
      translation: stored?.tw_reviewed ? stored.tw : undefined,
      translationLanguage: stored?.tw_reviewed ? "tw" : undefined,
      answeredBy: "patient",
    });
  };

  // Covers both halves of the wait: asking the language service, then the
  // audio actually playing. From the patient's side it is one action.
  const speaking = spoken.status === "working" || spoken.status === "playing";

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

      {/* Said once, quietly, rather than after every tap. A responder who asked
          for Twi and keeps hearing English needs to know why, and the honest
          answer is that nobody has checked the translations yet. */}
      {anyFallsBackToEnglish(phrases, outputLanguage) ? (
        <p className="notice notice--warn" data-testid="twi-pending-review">
          <strong>Some answers are read in English.</strong> The Twi for those
          taps has not been checked by a Twi speaker yet, and an unchecked
          clinical translation is not read aloud.
        </p>
      ) : null}

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
            Tap anything. Every tap is spoken aloud to the doctor.
          </p>
        ) : (
          <SpokenResponse
            status={spoken.status}
            result={spoken.result}
            showProviderNotice={false}
          />
        )}
      </div>

      {/* Two columns, same reason as the consultation: the device is turned
          between the patient and whoever is treating them. The body gets a
          column of its own so the figure is large enough to point at, which is
          the whole mechanism of FR 5.2. */}
      <div className="triage__columns">
        <div className="triage__side">
          {/* FR 5.3 first. It is the only group here that can be about
              something stopping the patient breathing, so it is what a
              responder should reach without scrolling. */}
          <div className="panel">
            <div className="panel__header">
              <h3 className="panel__title">Tell them what is wrong</h3>
              <span className="pill triage__priority panel__aside">
                Immediate
              </span>
            </div>
            <CriticalAlerts
              alerts={alerts}
              disabled={speaking}
              chosenId={chosen.alert}
              onChoose={(alert) => {
                setChosen((previous) => ({ ...previous, alert: alert.id }));
                announce(alert.id, alert.english_text);
              }}
            />
          </div>

          <div className="panel">
            <div className="panel__header">
              <h3 className="panel__title">How much pain</h3>
            </div>
            <PainScale
              disabled={speaking}
              chosenLevel={chosen.pain}
              onChoose={(option) => {
                setChosen((previous) => ({ ...previous, pain: option.level }));
                // Spoken as words rather than "4 of 5", because a number out
                // of context tells the clinician nothing they can act on.
                announce(`PAIN_${option.level}`, option.label);
              }}
            />
          </div>

        </div>

        <div className="triage__side">
          <div className="panel">
            <div className="panel__header">
              <h3 className="panel__title">Point to where it hurts</h3>
              <span className="pill panel__aside">Front view</span>
            </div>
            <BodyMap
              disabled={speaking}
              chosenId={chosen.location}
              onChoose={(region) => {
                setChosen((previous) => ({ ...previous, location: region.id }));
                announce(region.id, `Pain in the ${region.label.toLowerCase()}`);
              }}
            />
          </div>
        </div>
      </div>

      {/* Once, at the foot of the page, rather than after every tap. It is a
          development notice: true, and worth saying, but it says the same
          thing each time and repeating it in the strip above would be the one
          thing that changed the strip's height. */}
      <StubNotice result={spoken.result} />
    </section>
  );
}
