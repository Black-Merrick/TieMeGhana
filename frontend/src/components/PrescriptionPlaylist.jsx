import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * The prescription as the patient sees it, SRS FR 6.1.
 *
 * One card per medicine, in the order the doctor wrote them, each with its
 * sign video and its caption. Shared by the doctor's confirmation screen and
 * the patient's replay screen so that what the doctor checked is provably the
 * same rendering the patient gets, rather than two components that agree until
 * one of them is edited.
 */
export default function PrescriptionPlaylist({ playlist }) {
  return (
    <ol className="playlist" data-testid="prescription-playlist">
      {playlist.items.map((item) => (
        <li className="playlist__item" key={item.position}>
          {/* The photograph first, because it is what identifies the medicine
              for a patient who does not read print: they match it to the box in
              their hand. */}
          {item.image_url ? (
            <img
              className="playlist__photo"
              src={item.image_url}
              alt={`Photograph of ${item.label}`}
              data-testid={`playlist-photo-${item.position}`}
            />
          ) : null}

          {/* Medicine, dose and frequency on their own lines. A patient
              checking whether they have already taken today's dose should not
              have to read a sentence to find the number.

              `label` rather than `medicine`, so an item identified only by its
              photograph still has a heading rather than an empty one. */}
          <h3 className="playlist__medicine">{item.label}</h3>
          <dl className="playlist__facts">
            <dt>How much</dt>
            <dd data-testid={`playlist-dosage-${item.position}`}>{item.dosage}</dd>
            <dt>How often</dt>
            <dd data-testid={`playlist-frequency-${item.position}`}>{item.frequency}</dd>
          </dl>

          {item.sequence.is_safe_to_show ? (
            <div className="playlist__video">
              <SignSequencePlayer sequence={item.sequence} />
            </div>
          ) : (
            /* Refused rather than partially shown, per ADR 033. A prescription
               rendered without its dosage is the difference between one tablet
               and four, so the sentence is withheld whole and the patient is
               told plainly that someone must explain this one out loud. */
            <p
              className="playlist__refused"
              role="alert"
              data-testid={`playlist-refused-${item.position}`}
            >
              This one cannot be shown in sign language yet. Ask a nurse or
              pharmacist to explain it.
            </p>
          )}

          {/* The caption, labelled with the language it is actually in. When
              translation was unreachable at issue time it is English, and
              saying so is better than presenting English as Twi. */}
          <p
            className="playlist__caption"
            lang={item.caption_language}
            data-testid={`playlist-caption-${item.position}`}
          >
            {item.caption}
          </p>

          {/* ADR 011. The stub provider returns its input unchanged, so
              without this the caption above is English text sitting under a
              lang="tw" attribute, indistinguishable from a real translation.
              Shown to the patient as well as the doctor: whoever is reading it
              is the one who needs to know it was never translated. */}
          {item.caption_provider === "stub" ? (
            <p
              className="playlist__untranslated"
              data-testid={`playlist-untranslated-${item.position}`}
            >
              Development language service. This caption was{" "}
              <strong>not translated</strong>, so it still reads in English.
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
