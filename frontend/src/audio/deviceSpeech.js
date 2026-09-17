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

/** A shade under the default. See the note where it is applied. */
const SPEAKING_RATE = 0.92;

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
 * Voices that are intelligible but not pleasant, preferred last.
 *
 * espeak is a formant synthesiser: it is robotic, and on a clinical sentence
 * that costs comprehension rather than only charm. It is usually the only
 * thing installed on a Linux desktop, so it is used rather than refused, but
 * anything else on the device is used ahead of it.
 *
 * Phones and laptops mostly ship something better under some other name, and
 * this is how they get chosen without having to enumerate them all.
 */
const LAST_RESORT = /espeak|e-speak|flite|robo/i;

/**
 * A voice for this language from a list, or null.
 *
 * Matched on the primary subtag, so "en-GB" and "en-US" both answer for "en".
 * Never falls through to the list's first entry: the default is whatever the
 * operating system is set to, and reading Twi in it is worse than silence.
 *
 * Among the voices that do match, the best sounding one wins. A device with
 * nineteen English voices usually has a range, and picking whichever came
 * first in the list is how a clinician ends up straining to understand a
 * sentence about their patient.
 */
export function pickVoice(voices, language) {
  if (!language) return null;

  const wanted = language.toLowerCase();
  const matching = (voices ?? []).filter((voice) => {
    const lang = voice.lang?.toLowerCase() ?? "";
    return lang === wanted || lang.startsWith(`${wanted}-`);
  });

  if (!matching.length) return null;

  // Ranked rather than filtered, so a device with nothing but espeak still
  // speaks. Better to be understood with effort than not heard at all.
  const ranked = [...matching].sort(
    (a, b) => _rank(a) - _rank(b) || _preferPlainName(a) - _preferPlainName(b),
  );

  return ranked[0];
}

/** Lower is better. */
function _rank(voice) {
  const name = voice.name ?? "";

  if (LAST_RESORT.test(name)) return 2;
  // A local voice is preferred over a network one, because this is the
  // fallback for the network service having already failed.
  return voice.localService === false ? 1 : 0;
}

/**
 * Prefer a plainly named voice over a novelty one.
 *
 * espeak exposes hundreds of variants, and a name carrying a "+" is one of
 * them: "English+Half-LifeAnnouncementSystem" is a real entry on this
 * machine's list. None of them belong in a consultation.
 */
function _preferPlainName(voice) {
  return /[+]/.test(voice.name ?? "") ? 1 : 0;
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

      // Slightly under the default, which is tuned for people who listen to
      // synthetic speech all day. A clinician hears this a handful of times
      // and needs to catch a clinical word first time, and espeak in
      // particular is much easier to follow a little slowed. Not slower than
      // this: a drawl is its own kind of hard to follow, and the answer is
      // being waited on in front of a patient.
      utterance.rate = SPEAKING_RATE;
      utterance.pitch = 1;
      utterance.volume = 1;

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
