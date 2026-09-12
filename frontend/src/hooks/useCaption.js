import { useCallback, useState } from "react";

import { captionUtterance } from "../api/consultation.js";

/**
 * Captioning one doctor utterance, shared by both interaction paths.
 *
 * Both the literate path and Guided Interrogation put the doctor's words
 * through the same pipeline, so they share this rather than each holding their
 * own copy of the request, the status, and the failure handling. If they
 * diverged, one path would eventually gain a fix the other did not.
 */
export default function useCaption() {
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");

  const send = useCallback(async (payload) => {
    setStatus("working");
    setResult(null);

    try {
      const caption = await captionUtterance(payload);
      setResult(caption);
      setStatus("idle");
      return caption;
    } catch {
      // The doctor's next action is to retry or type, so the failure has to be
      // visible. Swallowing it would leave them waiting silently.
      setStatus("failed");
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setStatus("idle");
  }, []);

  return { result, status, send, clear };
}
