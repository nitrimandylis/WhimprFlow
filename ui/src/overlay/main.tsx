import React from "react";
import ReactDOM from "react-dom/client";
import { FlowBar } from "./FlowBar";
import { palette } from "../tokens/values";

// The overlay window is transparent; keep the document background clear so only
// the pill paints. (Global reset lives here rather than a CSS file to keep the
// always-resident overlay bundle minimal.) Also: a visible keyboard-focus ring
// in the accent, and no pill morph animation under reduced motion.
const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; height: 100%; background: transparent; }
  * { box-sizing: border-box; }
  *:focus-visible { outline: 2px solid ${palette.accent400}; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FlowBar />
  </React.StrictMode>,
);
