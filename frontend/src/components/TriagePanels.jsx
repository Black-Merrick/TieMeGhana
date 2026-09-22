import { tapForAlert, tapForPain, tapForRegion } from "../emergency/triageTaps.js";
import BodyMap from "./BodyMap.jsx";
import CriticalAlerts from "./CriticalAlerts.jsx";
import PainScale from "./PainScale.jsx";

/**
 * The three things a patient can tap in emergency mode, laid out once.
 *
 * Used by the doctor's screen and by the patient's own phone, so the two are
 * the same screen and not two that have to be kept alike. It reports each tap
 * as the tap it is (`onTap`, see triageTaps.js) and knows nothing about what
 * happens next: speaking it, or sending it to be spoken.
 *
 * Two columns, same reason as the consultation: the device is turned between
 * the patient and whoever is treating them. The body gets a column of its own
 * so the figure is large enough to point at, which is the whole mechanism of
 * FR 5.2.
 */
export default function TriagePanels({ alerts, chosen, disabled, onTap }) {
  return (
    <div className="triage__columns">
      <div className="triage__side">
        {/* FR 5.3 first. It is the only group here that can be about
            something stopping the patient breathing, so it is what a
            responder should reach without scrolling. */}
        <div className="panel">
          <div className="panel__header">
            <h3 className="panel__title">Tell them what is wrong</h3>
            <span className="pill triage__priority panel__aside">Immediate</span>
          </div>
          <CriticalAlerts
            alerts={alerts}
            disabled={disabled}
            chosenId={chosen.alert}
            onChoose={(alert) => onTap(tapForAlert(alert))}
          />
        </div>

        <div className="panel">
          <div className="panel__header">
            <h3 className="panel__title">How much pain</h3>
          </div>
          <PainScale
            disabled={disabled}
            chosenLevel={chosen.pain}
            onChoose={(option) => onTap(tapForPain(option))}
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
            disabled={disabled}
            chosenId={chosen.location}
            onChoose={(region) => onTap(tapForRegion(region))}
          />
        </div>
      </div>
    </div>
  );
}
