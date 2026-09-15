import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import { dismissSplash } from "./boot/splash.js";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the first render, not before: the splash in index.html is what the
// patient looks at until there is something else to look at.
dismissSplash();

// The sign clips are warmed by App, via useClipWarmup, rather than here.
// It was fire and forget at this point, which meant nothing could report it:
// a clinician on a hospital connection saw a finished looking screen while
// the videos their first question needed were still downloading. Owning it
// inside the tree lets the progress be shown and cancelled with the app.
