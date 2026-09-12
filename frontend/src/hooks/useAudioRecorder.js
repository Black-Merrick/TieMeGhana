import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Microphone capture for the doctor's spoken input, SRS FR 1.2.
 *
 * Wraps MediaRecorder so the component never touches browser media APIs
 * directly, which keeps the permission and cleanup rules in one place instead
 * of spread through a view.
 */

// In preference order. Opus in WebM is the best quality per byte and matters
// on a hospital connection. audio/mp4 is here because Safari on iOS records
// only that, and NFR 6 lists iOS Safari as a target, so a webm only list would
// make the microphone silently unusable on every iPhone.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/**
 * Why recording is or is not available: "ok", "insecure", or "unsupported".
 *
 * The two failures are distinguished because the fix differs and only one of
 * them is ours. `getUserMedia` is gated on a secure context: localhost counts,
 * but a phone opening the app over plain http on a hospital network does not,
 * and the browser then hides the microphone with no error. ADR 007
 * deliberately leaves HTTPS off so a demo cannot be made unreachable by a
 * forced redirect, which makes this exactly the situation a hospital demo
 * lands in. Saying "this browser cannot record" there would be wrong and
 * would send someone debugging the wrong thing.
 */
export function recordingSupport() {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "insecure";
  }

  const hasApi =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  return hasApi ? "ok" : "unsupported";
}

/** Whether this browser can record audio at all. */
export function isRecordingSupported() {
  return recordingSupport() === "ok";
}

/**
 * Pick the best container this browser can actually record.
 *
 * Returns an empty string when none of the candidates are supported, which
 * tells MediaRecorder to choose for itself rather than throwing.
 */
export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";

  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export default function useAudioRecorder() {
  // idle, requesting, recording, denied, failed, unsupported
  const [status, setStatus] = useState("idle");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  /**
   * Stop every track so the browser's microphone indicator goes out.
   *
   * Stopping the recorder is not enough, the underlying stream stays live. In
   * a consultation about something private, an indicator that stays on after
   * the doctor finished speaking is a real problem, not a cosmetic one.
   */
  const releaseMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // The doctor may navigate away or the session may end mid recording, and an
  // orphaned stream would keep the microphone open indefinitely.
  useEffect(() => releaseMicrophone, [releaseMicrophone]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Refused, dismissed, or no microphone. All mean the same thing to the
      // doctor: type instead.
      setStatus("denied");
      return;
    }

    streamRef.current = stream;

    try {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };

      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch {
      // Permission was already granted, so the stream is open and would stay
      // open without this.
      releaseMicrophone();
      setStatus("failed");
    }
  }, [releaseMicrophone]);

  const stop = useCallback(
    () =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;
        if (!recorder) {
          resolve(null);
          return;
        }

        recorder.onstop = () => {
          const type = recorder.mimeType || "audio/webm";
          const audio = new Blob(chunksRef.current, { type });

          releaseMicrophone();
          chunksRef.current = [];
          setStatus("idle");

          // An empty recording means the doctor tapped stop instantly. Sending
          // it would spend a transcription call to get nothing back.
          resolve(audio.size > 0 ? audio : null);
        };

        recorder.stop();
      }),
    [releaseMicrophone],
  );

  return {
    status,
    start,
    stop,
    isSupported: isRecordingSupported(),
    support: recordingSupport(),
  };
}
