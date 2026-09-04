import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastEventBridge, ToastProvider } from "./Toast";
import { THEME_CSS, applyStoredTheme } from "./theme";

applyStoredTheme();

// Global accessibility rules: a visible keyboard-focus ring in the theme
// accent, and no decorative motion when the OS asks for reduced motion (GSAP
// already gates itself via prefersReduced; this covers CSS transitions too).
const A11Y_CSS = `
  *:focus-visible { outline: 2px solid var(--wf-accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

const style = document.createElement("style");
style.textContent = THEME_CSS + `html, body, #root { margin: 0; height: 100%; } * { box-sizing: border-box; } body { background: var(--wf-pageBg); }` + A11Y_CSS;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <ToastEventBridge />
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
