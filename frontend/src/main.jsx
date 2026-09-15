import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { dismissSplash } from "./boot/splash.js";
import { precacheClips } from "./signs/precacheClips.js";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the first render, not before: the splash in index.html is what the
// patient looks at until there is something else to look at.
dismissSplash();

// Pull the sign clips onto the device in the background, so the first sign a
// doctor asks for plays immediately instead of downloading over a hospital
// connection while the patient waits.
//
// Deferred to idle rather than started here. The app's own assets are still
// arriving at this point, and competing with them for a scarce connection
// would slow down the screen this is meant to make fast. requestIdleCallback
// is not in Safari before 16.4, hence the timeout fallback.
const warmWhenIdle = () => {
  precacheClips().catch(() => {
    // Warming is an optimisation. A clip that was not warmed is fetched when
    // it is played, exactly as it was before, so there is nothing to report.
  });
};

if (typeof requestIdleCallback === "function") {
  requestIdleCallback(warmWhenIdle, { timeout: 5000 });
} else {
  setTimeout(warmWhenIdle, 2000);
}
