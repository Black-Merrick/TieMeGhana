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
    body.append("audio", audio, "utterance.webm");
    return apiRequest("/caption/", { method: "POST", body });
  }

  return apiRequest("/caption/", {
    method: "POST",
    body: JSON.stringify({ source_language: sourceLanguage, text }),
  });
}
