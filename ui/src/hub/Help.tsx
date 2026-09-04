import { useEffect, useState } from "react";
import { font } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, PageTitle } from "./ui";
import { Icon, type IconName } from "./icons";
import { getBuildInfo, exportHistory, copyToClipboard, type BuildInfo } from "./api";

const TIPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "mic",
    title: "Hold to dictate",
    body: "Press and hold your dictation key (Fn by default), speak naturally, then release. WhimprFlow transcribes on-device — nothing leaves your Mac unless you choose a cloud cleanup engine.",
  },
  {
    icon: "sparkles",
    title: "Cleanup happens where your cursor is",
    body: "Release the key and your cleaned-up text is typed straight into whatever app has focus — email, chat, notes, code. Choose how aggressive the cleanup is under Settings → Auto Cleanup.",
  },
  {
    icon: "book",
    title: "Teach it your vocabulary",
    body: 'Open Dictionary and add names, jargon, or acronyms it keeps mishearing. Add the correct spelling plus any "also heard as" variants and WhimprFlow will fix them automatically.',
  },
  {
    icon: "lock",
    title: "Pick a cleanup engine",
    body: "Under Settings → Cleanup Engine, run fully offline (Local), paste exactly what you said (Raw), or add an OpenAI / Anthropic key for cloud cleanup. Keys are stored in your macOS keychain.",
  },
];

export function Help() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    getBuildInfo().then(setBuild);
  }, []);

  const doExport = async (format: "json" | "txt") => {
    try {
      const data = await exportHistory(format);
      await copyToClipboard(data);
      setExportMsg(`Copied ${format.toUpperCase()} to clipboard`);
      setTimeout(() => setExportMsg(null), 2000);
    } catch {
      setExportMsg("Export failed");
      setTimeout(() => setExportMsg(null), 2000);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <PageTitle sub="Tips, support, and diagnostics.">Help</PageTitle>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: theme.textStrong, marginBottom: 8 }}>
          Help & Support
        </div>
        <div style={{ color: theme.textMuted, fontSize: 13, lineHeight: 1.45, marginBottom: 12 }}>
          Troubleshooting guide:{" "}
          <a
            href="https://github.com/ch1kim0n1/WhimprFlow/blob/main/docs/HELP.md"
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.accentDeep }}
          >
            docs/HELP.md
          </a>
          .
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <a
            href="mailto:support@whimprflow.com"
            style={{
              display: "inline-flex",
              padding: "8px 12px",
              borderRadius: 10,
              background: theme.cardBgSubtle,
              border: `1px solid ${theme.border}`,
              color: theme.textStrong,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            support@whimprflow.com
          </a>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: theme.textStrong, marginBottom: 8 }}>
          Export History
        </div>
        <div style={{ color: theme.textMuted, fontSize: 13, lineHeight: 1.45, marginBottom: 12 }}>
          Copy your full dictation history to the clipboard.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="ghost" size="sm" onClick={() => void doExport("json")}>
            Copy as JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void doExport("txt")}>
            Copy as text
          </Button>
          {exportMsg && (
            <span style={{ fontSize: 12, color: theme.accentDeep, fontWeight: 600 }}>{exportMsg}</span>
          )}
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {TIPS.map((t) => (
          <Card key={t.title}>
            <div style={{ display: "flex", gap: 14 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: theme.accentSoft,
                  border: `1px solid ${theme.accentSoftBorder}`,
                  color: theme.accentDeep,
                  flex: "0 0 auto",
                }}
              >
                <Icon name={t.icon} size={18} strokeWidth={1.7} />
              </div>
              <div>
                <div
                  style={{
                    fontFamily: font.ui,
                    fontSize: 15,
                    fontWeight: 600,
                    color: theme.textStrong,
                    marginBottom: 4,
                  }}
                >
                  {t.title}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: theme.textMuted }}>{t.body}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {build && (
        <div style={{ marginTop: 20, fontSize: 12, color: theme.textFaint, textAlign: "center" }}>
          WhimprFlow v{build.version} ({build.git_hash})
        </div>
      )}
    </div>
  );
}
