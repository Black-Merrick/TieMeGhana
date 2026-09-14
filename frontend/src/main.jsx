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
