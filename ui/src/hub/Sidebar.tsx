import { Icon, type IconName } from "./icons";
import { useT } from "../i18n";

export type Page = "history" | "insights" | "dictionary" | "style" | "settings" | "help";

type NavDef = { key: Page; labelKey: string; icon: IconName };

const MAIN: NavDef[] = [
  { key: "history", labelKey: "sidebar.nav.history", icon: "history" },
  { key: "insights", labelKey: "sidebar.nav.insights", icon: "insights" },
  { key: "dictionary", labelKey: "sidebar.nav.dictionary", icon: "dictionary" },
  { key: "style", labelKey: "sidebar.nav.style", icon: "style" },
];

const BOTTOM: NavDef[] = [
  { key: "settings", labelKey: "sidebar.nav.settings", icon: "settings" },
  { key: "help", labelKey: "sidebar.nav.help", icon: "help" },
];

function NavItem({ item, active, onClick }: { item: NavDef; active: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button className="nav-item" aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon name={item.icon} size={16} strokeWidth={1.8} />
      {t(item.labelKey)}
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
