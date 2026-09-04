// Shared GSAP setup for the Hub. Bundled locally (no CDN) so it works offline and
// under Tauri's CSP. ScrollTrigger is driven off the scrolling <main> element, not
// the window, since that's where the Hub actually scrolls.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export const prefersReduced = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The Hub's scroll container (the <main> pane). ScrollTrigger needs this as its
 *  scroller because content scrolls there, not on the window. */
export const scrollerEl = (): HTMLElement | null => document.querySelector("main");

/** House easings/durations so motion feels consistent and intentional app-wide. */
export const EASE = "power3.out";
export const EASE_EXPO = "expo.out";
