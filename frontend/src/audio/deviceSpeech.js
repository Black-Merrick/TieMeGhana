/**
 * Speaking an answer with the device's own voice, when the service cannot.
 *
 * Added after Khaya's free tier answered "Out of call volume quota. Quota will
 * be replenished in 14:19:29" and the patient's answers stopped being spoken
 * at all. Captions degraded gracefully, because the signs need no translation
 * to resolve. Speech had nothing to degrade to: without the service there was
 * no audio, and FR 3.1 to 3.5 exist because an answer nobody hears is an
 * answer nobody receives.
 *
 * Every browser ships a speech synthesiser. It costs nothing, needs no network,
 * and is on the device already. It is a worse voice than Khaya's and it is not
 * a translator, so it is a fallback and never the first choice.
 *
 * Two limits, both hard, and both the reason this is small:
 *
 * It cannot translate. If the patient wrote Twi and the clinician is listening
 * in English, something has to translate before anything can be spoken, and
 * that is the service. This only helps when the text is already in the
 * language it needs to be spoken in.
 *
 * It cannot invent a voice. Nearly every device has English; almost none has
 * Twi. Speaking Twi text with an English voice would produce confident
 * mispronunciation of clinical words, so a missing voice means staying silent
 * and saying so rather than making a noise that sounds like it worked.
 */

/** Whether this browser has a synthesiser at all. */
export function isSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * A voice for this language, or null.
 *
 * Matched on the primary subtag, so "en-GB" and "en-US" both answer for "en".
 * A device with no matching voice returns null rather than the default one,
 * because the default is whatever the operating system is set to and reading
 * Twi in it is worse than silence.
 */
export function voiceFor(language) {
  if (!isSupported()) return null;

  let voices = [];
  try {
    voices = window.speechSynthesis.getVoices() ?? [];
  } catch {
    return null;
  }

  return (
    voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${language}-`)) ??
    voices.find((voice) => voice.lang?.toLowerCase() === language) ??
    null
  );
}

/**
 * Whether this answer could be spoken here, without the service.
 *
 * Both conditions matter. Same language, because this cannot translate; and a
 * real voice for it, because it cannot invent one.
 */
export function canSpeak({ text, sourceLanguage, outputLanguage }) {
  if (!text?.trim()) return false;
  if (sourceLanguage !== outputLanguage) return false;

  return voiceFor(outputLanguage) !== null;
}

/**
 * Speak it, resolving when the voice has finished.
 *
 * Resolves false rather than throwing when anything goes wrong, because the
 * caller is already in a failure path and a second exception there would
 * replace a useful message with a crash.
 */
export function speakOnDevice({ text, outputLanguage }) {
  if (!isSupported()) return Promise.resolve(false);

  const voice = voiceFor(outputLanguage);
  if (!voice) return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      // Anything already queued is abandoned. The clinician wants this answer,
      // not a backlog of earlier ones read out in order.
      window.speechSynthesis.cancel();

      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve(false);
    }
  });
}

/** Stop the device mid sentence, for the same reason the player has a Stop. */
export function stopDevice() {
  if (!isSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to do. There is no state of this we can repair from here.
  }
}
