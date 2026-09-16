/**
 * Showing one recorded line in a chosen language.
 *
 * The record cannot be translated on demand, and that is deliberate rather
 * than a gap. Translating it would mean sending a whole consultation to a
 * third party, and this app promises that the record never leaves the device:
 * there is no endpoint that accepts one, and a test fails the build if one
 * appears. Those consultations cover pregnancy, sexually transmitted
 * infections and HIV status.
 *
 * It does not need to be. Both renderings already exist at the moment a line
 * is created. The doctor's message was translated to Twi so the patient could
 * read it; the patient's reply was translated so the doctor could hear it. So
 * both are kept then, and this only chooses between them. Nothing is sent
 * anywhere, and it works offline.
 *
 * Where a line has only one rendering, it is shown as it is. That covers
 * emergency taps whose Twi is still unreviewed, anything typed as Both, and
 * every line recorded before this existed.
 */

/**
 * The text to show for one entry, and whether it is in the language asked for.
 *
 * `available` is false when the line exists only in the other language. The
 * caller marks those rather than hiding them: a record missing half its lines
 * would be worse than one that is honest about which are untranslated.
 */
export function renderEntry(entry, language) {
  const original = entry?.text ?? "";

  // No language on the entry means it predates this, so it is shown as it is
  // rather than guessed at.
  if (!entry?.language) return { text: original, available: true };

  if (entry.language === language) return { text: original, available: true };

  if (entry.translation && entry.translationLanguage === language) {
    return { text: entry.translation, available: true };
  }

  return { text: original, available: false, shownIn: entry.language };
}

/** Whether any line would be shown in the wrong language at this setting. */
export function someEntriesUntranslated(entries, language) {
  return (entries ?? []).some(
    (entry) => renderEntry(entry, language).available === false,
  );
}

/** Languages the record can be shown in. Fixed, like every other choice here. */
export const RECORD_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tw", label: "Twi" },
];
