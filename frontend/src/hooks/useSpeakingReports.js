import { useEffect, useRef } from "react";

/**
 * The doctor's device telling the patient's phone how its answer is going, and
 * doing what the phone asks about it.
 *
 * The sound is made here, where the doctor can hear it (FR 3.5), so the phone
 * has no way to know it has been spoken unless it is told. Reported as the
 * status changes, not on every render, and not for the idle a fresh screen
 * starts in: the phone assumes idle. The phone can also ask for it to be
 * stopped, which is its way out of the overlay it is shown meanwhile.
 * See ADR 053.
 */
export default function useSpeakingReports(channel, spoken) {
  const reported = useRef("idle");

  useEffect(() => {
    // No connection to report to on a shared device, where this is a no-op.
    if (!channel || spoken.status === reported.current) return;
    reported.current = spoken.status;
    channel.send({ type: "speaking", status: spoken.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spoken.status]);

  useEffect(() => {
    if (channel?.lastMessage?.type !== "stop") return;
    // Only while there is something to stop. A stop that arrives after the
    // answer has finished must not turn a spoken answer into a stopped one.
    if (spoken.status === "working" || spoken.status === "playing") spoken.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.lastMessage]);
}
