/**
 * What fills a pane while a screen's code is still arriving.
 *
 * The screens are split out of the main bundle, so emergency triage and the
 * prescription builder are fetched the first time they are opened rather than
 * on every visit. That trade is worth making on a hospital connection, but it
 * puts a short gap in front of a screen someone has just asked for, and that
 * gap has to look deliberate.
 *
 * Deliberately the same shape as the splash in index.html: the same mark, the
 * same filling bar. Loading looks like one thing throughout the app rather
 * than like three different waits.
 */
export default function ScreenLoader({ label = "Loading" }) {
  return (
    <div className="loader" role="status" aria-live="polite" data-testid="screen-loader">
      {/* The same mark as the splash, at the same size. By the time a lazy
          screen is being fetched the bundle has loaded and the service worker
          has this file precached, so a plain reference is enough here. */}
      <img className="loader__mark" src="/icon-96.png" alt="" width="96" height="96" />

      <p className="loader__label">{label}</p>

      <span className="loader__track" aria-hidden="true">
        <span className="loader__bar" />
      </span>
    </div>
  );
}
