import { font } from "../tokens/values";
import { theme } from "./theme";
import { Icon, type IconName } from "./icons";
import brandIcon from "../assets/whimprflow-icon.png";

export type Page =
  | "home"
  | "insights"
  | "dictionary"
  | "snippets"
  | "style"
  | "transforms"
  | "scratchpad"
  | "shortcuts"
  | "settings"
  | "help";

type NavDef = { key: Page; label: string; icon: IconName };

const MAIN: NavDef[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "insights", label: "Insights", icon: "insights" },
  { key: "dictionary", label: "Dictionary", icon: "dictionary" },
  { key: "snippets", label: "Snippets", icon: "snippets" },
  { key: "style", label: "Style", icon: "style" },
  { key: "transforms", label: "Transforms", icon: "transforms" },
  { key: "scratchpad", label: "Scratchpad", icon: "scratchpad" },
];

const BOTTOM: NavDef[] = [
  { key: "shortcuts", label: "Shortcuts", icon: "shortcuts" },
  { key: "settings", label: "Settings", icon: "settings" },
  { key: "help", label: "Help", icon: "help" },
];

const NAV_CSS = `
  .nav-item { position: relative; }
  .nav-item:hover:not(.nav-active) { background: ${theme.hover}; }
  .nav-item .nav-ico { transition: transform 200ms cubic-bezier(.16,1,.3,1); }
  .nav-item:hover .nav-ico { transform: translateX(2px); }
`;

function NavItem({
  item,
  active,
  onClick,
  collapsed,
}: {
  item: NavDef;
  active: boolean;
  onClick: () => void;
  collapsed: boolean;
}) {
  return (
    <button
      data-page={item.key}
      onClick={onClick}
      className={`nav-item${active ? " nav-active" : ""}`}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        padding: collapsed ? "10px" : "9px 11px",
        borderRadius: 10,
        fontSize: 13.5,
        fontFamily: font.ui,
        fontWeight: active ? 600 : 500,
        color: active ? theme.accentDeep : theme.textBody,
        background: active ? theme.accentSoft : "transparent",
        border: active ? `1px solid ${theme.accentSoftBorder}` : "1px solid transparent",
        justifyContent: collapsed ? "center" : "flex-start",
        transition: "color 180ms ease, background 140ms ease, padding 180ms ease",
      }}
    >
      <span className="nav-ico" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={item.icon} size={18} style={{ color: active ? theme.accentDeep : theme.textMuted }} />
      </span>
      {!collapsed && item.label}
    </button>
  );
}

export function Sidebar({
  page,
  setPage,
  collapsed,
  onCollapsedChange,
}: {
  page: Page;
  setPage: (p: Page) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <aside
      style={{
        position: "relative",
        width: collapsed ? 74 : 230,
        flex: `0 0 ${collapsed ? 74 : 230}px`,
        minWidth: collapsed ? 74 : 230,
        overflowY: "auto",
        overflowX: "hidden",
        borderRight: `1px solid ${theme.border}`,
        background: theme.sidebarBg,
        backgroundImage: theme.sidebarGradient,
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "20px 10px 16px" : "20px 14px 16px",
        // A width transition continuously reflows graph-heavy pages; switching
        // modes atomically keeps the app responsive and the content aligned.
        transition: "padding 120ms ease-out",
      }}
    >
      <style>{NAV_CSS}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 9,
          padding: collapsed ? "0 0 20px" : "0 8px 20px",
        }}
      >
        <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 9 }}>
          <img
            src={brandIcon}
            alt=""
            width={26}
            height={26}
            style={{ borderRadius: 7, display: "block", boxShadow: theme.shadowSoft }}
          />
          {!collapsed && (
            <span
              style={{
                fontFamily: font.serif,
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: -0.3,
                color: theme.textStrong,
                whiteSpace: "nowrap",
              }}
            >
              WhimprFlow
            </span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => onCollapsedChange(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            style={{
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              color: theme.textMuted,
              background: "transparent",
              border: `1px solid ${theme.border}`,
            }}
          >
            <Icon name="panelLeft" size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => onCollapsedChange(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          style={{
            width: "100%",
            height: 30,
            marginBottom: 10,
            padding: 0,
            borderRadius: 9,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            color: theme.textMuted,
            background: "rgba(255,255,255,0.20)",
            border: `1px solid ${theme.border}`,
          }}
        >
          <Icon name="panelRight" size={15} strokeWidth={1.8} />
        </button>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 3, position: "relative", zIndex: 1 }}>
        {MAIN.map((n) => (
          <NavItem key={n.key} item={n} active={page === n.key} onClick={() => setPage(n.key)} collapsed={collapsed} />
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          paddingTop: 12,
          borderTop: `1px solid ${theme.border}`,
          position: "relative",
          zIndex: 1,
        }}
      >
        {BOTTOM.map((n) => (
          <NavItem key={n.key} item={n} active={page === n.key} onClick={() => setPage(n.key)} collapsed={collapsed} />
        ))}
      </nav>
    </aside>
  );
}
