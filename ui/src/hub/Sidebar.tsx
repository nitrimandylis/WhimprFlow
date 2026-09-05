import { Icon, type IconName } from "./icons";

export type Page = "history" | "insights" | "dictionary" | "style" | "settings" | "help";

type NavDef = { key: Page; label: string; icon: IconName };

const MAIN: NavDef[] = [
  { key: "history", label: "History", icon: "history" },
  { key: "insights", label: "Insights", icon: "insights" },
  { key: "dictionary", label: "Dictionary", icon: "dictionary" },
  { key: "style", label: "Style", icon: "style" },
];

const BOTTOM: NavDef[] = [
  { key: "settings", label: "Settings", icon: "settings" },
  { key: "help", label: "Help", icon: "help" },
];

function NavItem({ item, active, onClick }: { item: NavDef; active: boolean; onClick: () => void }) {
  return (
    <button className="nav-item" aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon name={item.icon} size={16} strokeWidth={1.8} />
      {item.label}
    </button>
  );
}

export function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  return (
    <aside className="sidebar">
      {/* The title-bar strip over the sidebar drags the window, like Finder. */}
      <div className="sidebar-drag" data-tauri-drag-region />
      <nav className="nav">
        {MAIN.map((n) => (
          <NavItem key={n.key} item={n} active={page === n.key} onClick={() => setPage(n.key)} />
        ))}
      </nav>
      <div className="nav-spacer" />
      <nav className="nav">
        {BOTTOM.map((n) => (
          <NavItem key={n.key} item={n} active={page === n.key} onClick={() => setPage(n.key)} />
        ))}
      </nav>
    </aside>
  );
}
