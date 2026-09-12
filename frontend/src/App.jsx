import { useEffect, useState } from "react";

import { fetchHealth } from "./api/client.js";

/**
 * Application shell for the Sprint 0 walking skeleton.
 *
 * Its only job right now is to prove the frontend, the API, and the database
 * are connected end to end. Feature screens replace this content as each P0
 * item lands.
 */
export default function App() {
  const [connection, setConnection] = useState("checking");

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then(() => {
        if (!cancelled) setConnection("connected");
      })
      .catch(() => {
        if (!cancelled) setConnection("offline");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1 className="shell__title">Tie Me Ghana</h1>
      <p className="shell__subtitle">
        Hospital communication for Deaf and Hard of Hearing patients
      </p>

      <p className="shell__status" data-testid="connection-status">
        <span
          className={`shell__dot shell__dot--${connection}`}
          aria-hidden="true"
        />
        {CONNECTION_LABELS[connection]}
      </p>
    </main>
  );
}

// Status wording is user facing, so it lives in one place rather than being
// assembled inline, ready for translation alongside the rest of the UI copy.
const CONNECTION_LABELS = {
  checking: "Checking connection to the hospital system",
  connected: "Connected to the hospital system",
  offline: "Offline, cached content only",
};
