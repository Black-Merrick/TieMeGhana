/**
 * Keeping a prescription on the patient's own phone, SRS FR 6.2.
 *
 * The service worker already caches the clips, which covers replaying the page
 * offline. It does not cover the phone being cleared, the browser evicting its
 * cache to free space, or the patient simply not finding the page again months
 * later. A file in the gallery survives all three: it plays in whatever video
 * player the phone came with, with nothing installed and no network. See
 * ADR 046.
 *
 * Two ways to keep it, offered in that order of durability.
 */
export default function SavePrescription({ playlist }) {
  // Only items that can be signed have anything to save. A refused item has
  // no video by design, per ADR 033.
  // `video_url` rather than the sequence's own stitched file: this is the one
  // that begins with the photograph, and a saved medicine with no picture is a
  // dose the patient cannot attach to a box.
  const savable = playlist.items.filter(
    (item) => item.sequence.is_safe_to_show && item.video_url,
  );

  const whole = playlist.video_url ?? null;

  return (
    <section className="save" data-testid="save-prescription">
      <h3 className="save__title">Keep this on your phone</h3>

      {whole ? (
        <>
          <p className="save__hint">
            Save one video of all your medicines. It goes to your phone&apos;s
            downloads or gallery and plays without internet.
          </p>
          <a
            className="save__download"
            href={whole}
            // The filename the patient sees in their gallery. Named for what
            // it is, not for the reference, which means nothing to them.
            download="my-prescription.mp4"
            data-testid="save-whole"
          >
            Save all my medicines as one video
          </a>
        </>
      ) : savable.length > 0 ? (
        <>
          {/* No single file, because one of the medicines was refused and a
              single file cannot say that something is missing from it. The
              ones that can be saved still can be, individually. */}
          <p className="save__hint">
            Save each medicine to your phone. They play without internet.
          </p>
          <ul className="save__list">
            {savable.map((item) => (
              <li key={item.position}>
                <a
                  className="save__download"
                  href={item.video_url}
                  download={`${item.label.toLowerCase().replace(/\s+/g, "-")}.mp4`}
                  data-testid={`save-item-${item.position}`}
                >
                  Save {item.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="save__hint" data-testid="nothing-to-save">
          There is no sign language video to save yet. Ask a nurse or
          pharmacist to explain your medicines.
        </p>
      )}

      {/* Static instructions rather than a browser install prompt. The prompt
          only exists on some browsers and only fires on some visits, and a
          button that sometimes does nothing is worse than a sentence that
          always works. */}
      <p className="save__hint save__hint--home">
        To find this page again, open your browser menu and choose{" "}
        <strong>Add to Home screen</strong>. It becomes an icon on your phone.
      </p>
    </section>
  );
}
