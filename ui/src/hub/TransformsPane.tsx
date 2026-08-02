import { useEffect, useState } from "react";
import { theme } from "./theme";
import { Card, PageTitle, Segmented } from "./ui";
import { getTransforms, setTransformEnabled, type Transform } from "./api";

// Transforms reshape a dictation instead of just tidying it. They are triggered
// by saying the phrase at the START of the utterance — mid-sentence matching
// would fire whenever you merely talked *about* writing an email.

export function TransformsPane() {
  const [items, setItems] = useState<Transform[]>([]);

  useEffect(() => {
    void getTransforms().then(setItems);
  }, []);

  async function toggle(id: string, enabled: boolean) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
    await setTransformEnabled(id, enabled);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle>Transforms</PageTitle>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, color: theme.textBody, lineHeight: 1.6 }}>
          Start a dictation with one of these phrases and the rest of what you say is rewritten
          accordingly. For example:
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              borderRadius: 9,
              fontSize: 13,
              color: theme.textMuted,
            }}
          >
            “<b style={{ color: theme.textStrong }}>Make this an email</b>, tell Sam the build is
            green and we ship Friday.”
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: theme.textMuted }}>
            Transforms skip the anti-over-editing gates on purpose — those exist to stop the
            cleanup model rewriting when it shouldn’t, and a transform is asked to rewrite.
            Names, numbers, dates and quotes are still protected by the prompt.
          </div>
        </div>
      </Card>

      <Card pad={0}>
        {items.length === 0 ? (
          <div style={{ padding: 26, textAlign: "center", color: theme.textMuted, fontSize: 13.5 }}>
            No transforms available.
          </div>
        ) : (
          <div style={{ padding: "4px 18px 12px" }}>
            {items.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  padding: "13px 0",
                  borderBottom: `1px solid ${theme.border}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>
                    {t.name}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: theme.textMuted,
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    Say: {t.triggers.map((x) => `“${x}”`).join(" · ")}
                  </div>
                </div>
                <Segmented
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  value={t.enabled ? "on" : "off"}
                  onChange={(v) => void toggle(t.id, v === "on")}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
