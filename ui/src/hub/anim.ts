// Shared GSAP setup for the Hub. Bundled locally so it works offline and under
// Tauri's CSP. Used for one thing: a short enter-stagger when a pane mounts.
import { gsap } from "gsap";

export { gsap };

export const prefersReduced = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const EASE = "power2.out";
