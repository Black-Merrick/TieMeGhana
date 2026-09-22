import { useState } from "react";

import { saveFile } from "../prescription/saveFile.js";

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
  // What became of each save, by its link: saving, saved, or failed. A tap that
  // appears to do nothing is the worst outcome for a patient who cannot hear or
  // read what went wrong, so each says.
  const [saves, setSaves] = useState({});

  const save = async (event, key, url, filename) => {
    // Not for a modified click: let the browser open it in its own tab.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();

    setSaves((before) => ({ ...before, [key]: "saving" }));
    const saved = await saveFile(url, filename);
    setSaves((before) => ({ ...before, [key]: saved ? "saved" : "failed" }));
  };

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
            onClick={(event) => save(event, "whole", whole, "my-prescription.mp4")}
            data-testid="save-whole"
          >
            Save all my medicines as one video
          </a>
          <SaveStatus state={saves.whole} url={whole} />
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
                  onClick={(event) =>
                    save(
                      event,
                      item.position,
                      item.video_url,
                      `${item.label.toLowerCase().replace(/\s+/g, "-")}.mp4`,
                    )
                  }
                  data-testid={`save-item-${item.position}`}
                >
                  Save {item.label}
                </a>
                <SaveStatus state={saves[item.position]} url={item.video_url} />
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

/**
 * What became of a save. Nothing until one is tried. A failure keeps the plain
 * link, opened in its own tab, where the phone's own player offers to save.
 */
function SaveStatus({ state, url }) {
  if (!state) return null;

  if (state === "saving") {
    return (
      <p className="save__status" role="status" data-testid="save-status-saving">
        Saving…
      </p>
    );
  }

  if (state === "saved") {
    return (
      <p className="save__status save__status--done" role="status" data-testid="save-status-saved">
        <span aria-hidden="true">✓ </span>Saved to your phone. Look in your downloads or gallery.
      </p>
    );
  }

  return (
    <p className="save__status save__status--failed" role="alert" data-testid="save-status-failed">
      It could not be saved from here.{" "}
      <a href={url} target="_blank" rel="noopener" data-testid="save-open">
        Open the video
      </a>{" "}
      and hold it to save it.
    </p>
  );
}
