import { useEffect, useState } from "react";

import { fetchCriticalAlerts } from "../api/clips.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";
import BodyMap from "./BodyMap.jsx";
import CriticalAlerts from "./CriticalAlerts.jsx";
import PainScale from "./PainScale.jsx";
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
  const announce = (text) => {
    spoken.speak({ text, sourceLanguage: "en", outputLanguage });
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text,
      answeredBy: "patient",
    });
  };

  return (
    <section className="triage" data-testid="emergency-triage">
      <div className="triage__header">
        <h2 className="triage__title">Emergency</h2>
        <button
          type="button"
          className="triage__leave"
          onClick={onLeave}
          data-testid="leave-emergency"
        >
          Leave emergency mode
        </button>
      </div>

      <p className="triage__hint">
        Tap anything. Every tap is spoken aloud. No typing needed.
      </p>

      {/* FR 5.3 first. It is the only group here that can be about something
          stopping the patient breathing, so it is what a responder should
          reach without scrolling. */}
      <h3 className="triage__group">Tell them what is wrong</h3>
      <CriticalAlerts
        alerts={alerts}
        chosenId={chosen.alert}
        onChoose={(alert) => {
          setChosen((previous) => ({ ...previous, alert: alert.id }));
          announce(alert.english_text);
        }}
      />

      <h3 className="triage__group">Point to where it hurts</h3>
      <BodyMap
        chosenId={chosen.location}
        onChoose={(region) => {
          setChosen((previous) => ({ ...previous, location: region.id }));
          announce(`Pain in the ${region.label.toLowerCase()}`);
        }}
      />

      <h3 className="triage__group">How much pain</h3>
      <PainScale
        chosenLevel={chosen.pain}
        onChoose={(option) => {
          setChosen((previous) => ({ ...previous, pain: option.level }));
          // Spoken as words rather than "4 of 5", because a number out of
          // context tells the clinician nothing they can act on.
          announce(option.label);
        }}
      />

      <SpokenResponse status={spoken.status} result={spoken.result} />
    </section>
  );
}
