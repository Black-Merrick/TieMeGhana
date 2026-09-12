import { useCallback, useState } from "react";

import {
  appendEntry,
  clearTranscript,
  readTranscript,
} from "../transcript/transcript.js";

/**
 * The session transcript as a component sees it, SRS FR 4.1 to FR 4.3.
 *
 * Reads what is already stored on mount, so a patient who reloads mid
 * consultation does not lose the record of what has been said so far.
 */
export default function useTranscript() {
  const [entries, setEntries] = useState(() => readTranscript());

  const record = useCallback((entry) => {
    setEntries(appendEntry(entry));
  }, []);

  const discard = useCallback(() => {
    clearTranscript();
    setEntries([]);
  }, []);

  return { entries, record, discard };
}
