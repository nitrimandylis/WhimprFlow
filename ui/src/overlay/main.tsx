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

  /* Hover cluster. Entrances only: the row unmounts on leave, so exit is
     instant, which is what a hover state that fires dozens of times a day
     should do. Motion is opacity + transform only. */
  .pill-label, .qc-chip {
    opacity: 1;
    transform: none;
    transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1), transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .pill-label { transition-delay: 60ms; }
  .qc-chip { transform-origin: top center; }
  .qc-chip:nth-child(2) { transition-delay: 30ms; }
  .qc-chip:nth-child(3) { transition-delay: 60ms; }
  .qc-chip:nth-child(4) { transition-delay: 90ms; }
  @starting-style {
    .pill-label { opacity: 0; }
    .qc-chip { opacity: 0; transform: translateY(-4px) scale(0.96); }
  }
  .qc-chip:hover { background: ${palette.slate800} !important; }
  .qc-chip:active, .pill-btn:active { transform: scale(0.96); }
  .pill-btn { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
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
