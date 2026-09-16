/**
 * Speaking an answer with the device's own voice, when the service cannot.
 *
 * Added after Khaya's free tier answered "Out of call volume quota" and the
 * patient's answers stopped being spoken at all. Captions degraded gracefully,
 * because signs need no translation to resolve. Speech had nothing to degrade
 * to, and FR 3.1 to 3.5 exist because an answer nobody hears is an answer
 * nobody receives.
 *
 * Every browser ships a synthesiser. It costs nothing, needs no network, and
 * is on the device already. It is a worse voice than Khaya's, so it is reached
 * for only after the service has refused, never instead of it.
 *
 * Three limits, all hard.
 *
 * It cannot translate. Twi in with an English listener still needs the
 * service, so this only helps where the text is already in the language it is
 * to be spoken in.
 *
 * It cannot invent a voice. Nearly every device has English and almost none
 * has Twi: espeak-ng, the usual Linux synthesiser, ships 945 English voices
 * and no Akan at all. A missing voice means silence, because reading Twi in
 * whatever voice the system defaults to is confident mispronunciation of
 * clinical words.
 *
 * And the list does not exist yet when the page loads. `getVoices` returns an
 * empty array on Chrome until the browser has finished asking the operating
 * system, then fires `voiceschanged`. Reading it once and believing the answer
 * is the bug this module was written with: on a device that has voices, the
 * first answer of every session would have been refused as though it had none.
 */

/** How long to wait for the browser to finish loading its voice list. */
const VOICES_TIMEOUT_MS = 3000;

let cached = null;

/** Whether this browser has a synthesiser at all. */
export function isSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

function read() {
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

/**
 * The voice list, waiting for it if the browser has not filled it yet.
 *
 * Resolves with whatever is available when the wait runs out rather than
 * hanging, because an empty list is a real answer: some Linux desktops have no
 * synthesiser behind speech-dispatcher and genuinely have none.
 */
export function loadVoices({ timeoutMs = VOICES_TIMEOUT_MS } = {}) {
  if (!isSupported()) return Promise.resolve([]);
  if (cached?.length) return Promise.resolve(cached);

  const immediate = read();
  if (immediate.length) {
    cached = immediate;
    return Promise.resolve(cached);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cached = read();
      resolve(cached);
    };

    try {
      window.speechSynthesis.addEventListener("voiceschanged", finish, {
        once: true,
      });
    } catch {
      // Older browsers expose it only as a property.
      window.speechSynthesis.onvoiceschanged = finish;
    }

    setTimeout(finish, timeoutMs);
  });
}

/**
 * A voice for this language from a list, or null.
 *
 * Matched on the primary subtag, so "en-GB" and "en-US" both answer for "en".
 * Never falls through to the list's first entry: the default is whatever the
 * operating system is set to, and reading Twi in it is worse than silence.
 */
export function pickVoice(voices, language) {
  if (!language) return null;

  const wanted = language.toLowerCase();

  return (
    (voices ?? []).find((voice) =>
      voice.lang?.toLowerCase().startsWith(`${wanted}-`),
    ) ??
    (voices ?? []).find((voice) => voice.lang?.toLowerCase() === wanted) ??
    null
  );
}

/**
 * Whether this answer could be spoken here, without the service.
 *
 * Asynchronous because the voice list is. A synchronous answer would be "no"
 * for the first few hundred milliseconds of every session, which is exactly
 * when the first answer tends to be given.
 */
export async function canSpeak({ text, sourceLanguage, outputLanguage }) {
  if (!text?.trim()) return false;
  // It is a voice, not a translator.
  if (sourceLanguage !== outputLanguage) return false;

  return pickVoice(await loadVoices(), outputLanguage) !== null;
}

/**
 * Speak it, resolving when the voice has finished.
 *
 * Resolves false rather than throwing when anything goes wrong, because the
 * caller is already in a failure path and a second exception there would
 * replace a useful message with a crash.
 */
export async function speakOnDevice({ text, outputLanguage }) {
  if (!isSupported()) return false;

  const voice = pickVoice(await loadVoices(), outputLanguage);
  if (!voice) return false;

  return new Promise((resolve) => {
    try {
      // Anything already queued is abandoned. The clinician wants this answer,
      // not a backlog of earlier ones read out in order after it.
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
    // Nothing to repair from here. The element is being discarded either way.
  }
}

/** Forget the cached list. For tests, and for a device whose voices change. */
export function forgetVoices() {
  cached = null;
}

// Asked for as soon as the module loads, because on Chrome the request is what
// starts the browser populating the list. By the time an answer needs speaking
// it is usually already there.
if (isSupported()) loadVoices();
