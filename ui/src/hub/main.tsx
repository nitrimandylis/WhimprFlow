import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastEventBridge, ToastProvider } from "./Toast";
import "./hub.css";

// Inside Tauri the sidebar is transparent over window vibrancy; in a plain
// browser preview there is no vibrancy, so hub.css paints a flat fallback.
if ("__TAURI_INTERNALS__" in window) document.documentElement.classList.add("in-tauri");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <ToastEventBridge />
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
