/**
 * The app's mark and name, shared by the doctor's top bar and the patient's.
 *
 * The 96px derivative of public/icon.png rather than the 512px source: it
 * draws at about 38px, and the source is a quarter of a megabyte. The alt is
 * empty because the name is right beside it, and announcing both would read
 * the app's name twice.
 */
export default function AppBrand() {
  return (
    <div className="topbar__brand">
      <img
        className="topbar__logo"
        src="/icon-96.png"
        alt=""
        width="38"
        height="38"
      />
      {/* Stacked beside the mark, not strung out after it: the name is the
          heading and the line under it describes the app. */}
      <div className="topbar__names">
        <h1 className="topbar__title">Tie Me Ghana</h1>
        <p className="topbar__subtitle">
          Hospital communication for Deaf and Hard of Hearing patients
        </p>
      </div>
    </div>
  );
}
