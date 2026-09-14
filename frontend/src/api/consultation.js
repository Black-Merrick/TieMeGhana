import { apiRequest } from "./client.js";

/**
 * Caption one doctor utterance and get back the GhSL clips that render it.
 *
 * FR 1.1 to FR 1.7 in a single request. Pass either `text` for a typed message
 * or `audio` for a recording, never both, which the backend rejects rather
 * than guessing at.
 */
export function captionUtterance({ sourceLanguage, text, audio }) {
  if (audio) {
    const body = new FormData();
    body.append("source_language", sourceLanguage);
    // The filename extension is derived from the blob's own type rather than
    // hardcoded, because the recorder converts to WAV before upload and a
    // stale .webm name would misdescribe the bytes to anything that trusts it.
    body.append("audio", audio, `utterance.${extensionFor(audio.type)}`);
    return apiRequest("/caption/", { method: "POST", body });
  }

  return apiRequest("/caption/", {
    method: "POST",
    body: JSON.stringify({ source_language: sourceLanguage, text }),
  });
}

const EXTENSIONS = { "audio/wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a" };

function extensionFor(mimeType = "") {
  // Strip any codec suffix, "audio/webm;codecs=opus" is still webm.
  return EXTENSIONS[mimeType.split(";")[0].trim()] ?? "bin";
}
