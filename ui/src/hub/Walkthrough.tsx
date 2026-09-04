import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Icon } from "./icons";
import type { Page } from "./Sidebar";

const STORAGE_KEY = "whimpr:walkthrough-complete";

const STEPS: { page: Page; eyebrow: string; title: string; body: string; icon: "mic" | "dictionary" | "settings" | "insights" }[] = [
  { page: "home", eyebrow: "01 / Speak anywhere", title: "Start with one hold.", body: "Hold Fn, talk naturally, and release when you are done. WhimprFlow transcribes and places the result at the active cursor.", icon: "mic" },
  { page: "dictionary", eyebrow: "02 / Make it yours", title: "Teach it the words that matter.", body: "Use Dictionary for names, acronyms, and domain terms. Snippets give repeat phrases a fast spoken shortcut.", icon: "dictionary" },
  { page: "settings", eyebrow: "03 / Stay in control", title: "Choose how text is cleaned.", body: "Pick raw, local, or cloud cleanup, tune the editing level, and enable Safe Mode when you want curse words redacted.", icon: "settings" },
  { page: "insights", eyebrow: "04 / Watch your momentum", title: "See your voice at work.", body: "Insights turns local activity into pace, consistency, time-saved, and speaking trend views.", icon: "insights" },
];

function completeWalkthrough(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // The tutorial still closes for the current session when storage is blocked.
  }
}

export function shouldShowWalkthrough(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

export function Walkthrough({ setPage, onComplete }: { setPage: (page: Page) => void; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const finalStep = step === STEPS.length - 1;

  useEffect(() => {
    setPage(current.page);
  }, [current.page, setPage]);

  const finish = () => {
    completeWalkthrough();
    onComplete();
  };

  const next = () => {
    if (finalStep) finish();
    else setStep((value) => value + 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="WhimprFlow quick tour"
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 24, background: "rgba(9, 14, 18, 0.56)", backdropFilter: "blur(9px)" }}
    >
      <section style={{ width: "min(100%, 500px)", borderRadius: 24, padding: 28, color: theme.textBody, background: theme.cardBg, border: `1px solid ${theme.borderStrong}`, boxShadow: "0 28px 90px rgba(0,0,0,0.30)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: theme.accentDeep, textTransform: "uppercase" }}>{current.eyebrow}</span>
          <button onClick={finish} style={{ border: "none", background: "transparent", color: theme.textMuted, fontFamily: font.ui, fontSize: 13, cursor: "pointer", padding: 4 }}>Skip tour</button>
        </div>
        <div style={{ width: 52, height: 52, borderRadius: 16, display: "grid", placeItems: "center", marginTop: 22, color: theme.accentDeep, background: theme.accentSoft, border: `1px solid ${theme.accentSoftBorder}` }}>
          <Icon name={current.icon} size={24} strokeWidth={1.7} />
        </div>
        <h2 style={{ margin: "20px 0 8px", fontFamily: font.serif, color: theme.textStrong, fontWeight: 600, fontSize: 30, letterSpacing: -0.5 }}>{current.title}</h2>
        <p style={{ margin: 0, color: theme.textMuted, lineHeight: 1.58, fontSize: 15 }}>{current.body}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 28 }}>
          <div aria-label={`Step ${step + 1} of ${STEPS.length}`} style={{ display: "flex", gap: 6 }}>
            {STEPS.map((item, index) => <span key={item.page} style={{ width: index === step ? 22 : 7, height: 7, borderRadius: 999, background: index === step ? theme.accentDeep : theme.track, transition: "width 180ms ease" }} />)}
          </div>
          <button onClick={next} style={{ border: "none", borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontFamily: font.ui, fontSize: 13.5, fontWeight: 700, color: "#fff", background: theme.accentDeep }}>
            {finalStep ? "Start dictating" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}
