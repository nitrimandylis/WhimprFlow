import { useEffect, useRef, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Card, PageTitle, Segmented } from "./ui";
import {
  getScratchpad,
  getScratchpadCapture,
  setScratchpad,
  setScratchpadCapture,
} from "./api";

// A long-form dictation surface. With capture on, finished dictations are
// appended here instead of being pasted into whatever app is frontmost — so you
// can think out loud without first finding a text field to aim at.

async function listenAppend(cb: (text: string) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<string>("whimpr://scratchpad/append", (e) => cb(e.payload));
  } catch {
    return () => {};
  }
}

export function ScratchpadPane() {
  const [text, setText] = useState("");
  const [capture, setCapture] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Held in a ref so the event listener, registered once, always appends to the
  // latest text rather than to the value captured when it was registered.
  const textRef = useRef("");
  textRef.current = text;

  useEffect(() => {
    void getScratchpad().then((t) => {
      setText(t);
      setLoaded(true);
    });
    void getScratchpadCapture().then(setCapture);

    let un: (() => void) | undefined;
    void listenAppend((incoming) => {
      const base = textRef.current;
      const sep = base.length === 0 || base.endsWith("\n") ? "" : "\n\n";
      setText(base + sep + incoming);
    }).then((u) => (un = u));
    return () => un?.();
  }, []);

  // Debounced persistence — the pad survives a restart without writing the file
  // on every keystroke.
  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => void setScratchpad(text), 500);
    return () => window.clearTimeout(id);
  }, [text, loaded]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle>Scratchpad</PageTitle>

      <Card style={{ marginBottom: 16 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
            Send dictation here
            <div style={{ fontSize: 12, fontWeight: 400, color: theme.textMuted, marginTop: 2 }}>
              While this is on, your dictations are appended below instead of being typed into
              other apps. Remember to switch it off when you want to dictate normally again.
            </div>
          </div>
          <Segmented
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            value={capture ? "on" : "off"}
            onChange={(v) => {
              const on = v === "on";
              setCapture(on);
              void setScratchpadCapture(on);
            }}
          />
        </div>
      </Card>

      <Card>
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={
            capture
              ? "Hold your dictation key and start talking — it lands here."
              : "Type here, or switch on “Send dictation here” above."
          }
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: 320,
            resize: "vertical",
            fontFamily: font.ui,
            fontSize: 14,
            lineHeight: 1.6,
            color: theme.textBody,
            background: "transparent",
            border: "none",
            outline: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${theme.border}`,
            paddingTop: 10,
            marginTop: 6,
            fontSize: 12,
            color: theme.textFaint,
          }}
        >
          <span>
            {words} {words === 1 ? "word" : "words"} · saved automatically
          </span>
          <button
            onClick={() => setText("")}
            style={{
              cursor: "pointer",
              border: `1px solid ${theme.border}`,
              background: "transparent",
              color: theme.textFaint,
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
            }}
          >
            Clear
          </button>
        </div>
      </Card>
    </div>
  );
}
