import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * One captioned utterance as the patient sees it: the Twi caption and the GhSL
 * video together, never as tabs, per SRS section 4.1.
 *
 * Shared by both interaction paths, so a caption looks identical whichever
 * path the patient is on.
 */
export default function CaptionResult({ result }) {
  const { fingerspelled_tokens: spelled, unavailable_tokens: missing } =
    result.sequence;

  return (
    <div className="result">
      {result.language_provider === "stub" ? (
        <p className="result__warning" data-testid="provider-warning">
          {result.transcript_source === "spoken" ? (
            <>
              Development language service. Your speech was{" "}
              <strong>not transcribed</strong>, the text below is placeholder
              content and not what you said. Switch to the Khaya provider to
              transcribe real speech.
            </>
          ) : (
            <>
              Development language service. This caption was{" "}
              <strong>not translated</strong> into Twi, so it still reads in the
              language it was typed in. Switch to the Khaya provider for real
              translation.
            </>
          )}
        </p>
      ) : null}

      <p
        className="result__caption"
        data-testid="caption"
        lang={result.caption_language}
      >
        {result.caption}
      </p>

      <SignSequencePlayer sequence={result.sequence} />

      {spelled.length > 0 || missing.length > 0 ? (
        <div className="result__coverage" data-testid="coverage-notice">
          <p>
            {spelled.length > 0 ? (
              <>
                Spelled letter by letter, no sign in the library yet:{" "}
                <strong>{spelled.join(", ")}</strong>.{" "}
              </>
            ) : null}
            {missing.length > 0 ? (
              <>
                Could not be signed at all: <strong>{missing.join(", ")}</strong>
                .
              </>
            ) : null}
          </p>
          {/* Signs are keyed on English glosses, so when one is missing the
              doctor needs to see the English that was actually searched for.
              With Twi input that is a translation, not what they typed. */}
          <p data-testid="lookup-text">
            Signs were looked up from: “{result.sign_lookup_text}”
          </p>
        </div>
      ) : null}
    </div>
  );
}
