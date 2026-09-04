import { theme } from "./theme";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "28px 22px",
        borderRadius: 14,
        border: `1px dashed ${theme.border}`,
        background: theme.cardBgSubtle,
        textAlign: "left",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 650, color: theme.textStrong, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.45, maxWidth: 520 }}>
        {body}
      </div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
