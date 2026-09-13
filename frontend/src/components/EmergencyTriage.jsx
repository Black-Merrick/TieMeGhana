import { useEffect, useState } from "react";

import { fetchCriticalAlerts } from "../api/clips.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";
import BodyMap from "./BodyMap.jsx";
import CriticalAlerts from "./CriticalAlerts.jsx";
import PainScale from "./PainScale.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import SpokenResponse from "./SpokenResponse.jsx";

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
export default function EmergencyTriage({ outputLanguage, onLeave }) {
  const [alerts, setAlerts] = useState(null);
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

  const announce = (text) => {
    setLastSaid(text);
    spoken.speak({ text, sourceLanguage: "en", outputLanguage });
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text,
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
          <p className="triage__hint">
            Tap anything. Every tap is spoken aloud to the doctor. No typing
            needed.
          </p>
        </div>
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

      {/* What was said, at the top rather than in a panel below the fold. The
          patient cannot hear whether anything reached the doctor, so the one
          record of it must not be somewhere they have to scroll to find. */}
      {spoken.status === "idle" ? null : (
        <div className="triage__spoken">
          <SpokenResponse status={spoken.status} result={spoken.result} />
        </div>
      )}

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
                announce(alert.english_text);
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
                announce(option.label);
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
                announce(`Pain in the ${region.label.toLowerCase()}`);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
