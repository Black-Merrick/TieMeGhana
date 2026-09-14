import { apiRequest } from "./client.js";

/**
 * Speak a patient response aloud to the hearing listener, FR 3.1 to FR 3.5.
 *
 * Used for typed responses and tapped ones alike. FR 3.5 requires the tapped
 * case to be audible too, because the doctor's hands are on the patient rather
 * than the screen.
 */
export function speakResponse({ text, sourceLanguage, outputLanguage }) {
  return apiRequest("/speak/", {
    method: "POST",
    body: JSON.stringify({
      text,
      source_language: sourceLanguage,
      output_language: outputLanguage,
    }),
  });
}

/**
 * Turn the base64 audio from the API into something the browser can play.
 *
 * Exported separately so the decoding can be tested without a real audio
 * device, which jsdom does not have.
 */
export function audioUrlFrom({ audio_base64: encoded, audio_media_type: type }) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return URL.createObjectURL(new Blob([bytes], { type }));
}
