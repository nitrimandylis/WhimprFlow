import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getStats, type StatsSummary, EMPTY_STATS } from "./api";

// Small primitives shared by every pane. Styling lives in hub.css.

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="pane-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <div className="group-title">{children}</div>;
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="group">{children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="group-note">{children}</div>;
}

/// A settings row: label and optional hint on the left, control on the right.
export function Row({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`row${className ? ` ${className}` : ""}`}>
      <div className="row-text">
        <div className="row-label">{label}</div>
        {hint && <div className="row-hint">{hint}</div>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  );
}

/// Native macOS toggle (WebKit renders <input type=checkbox switch> as one).
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const native = { switch: "" } as Record<string, string>;
  return (
    <input
      type="checkbox"
      {...native}
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  size,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "plain";
  size?: "lg";
  disabled?: boolean;
  title?: string;
}) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={`status ${ok ? "status-ok" : "status-bad"}`}>{children}</span>;
}

export function Empty({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {body}
    </div>
  );
}

/// Live stats, polled so the numbers move while you dictate.
export function useStats(): StatsSummary {
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS);
  useEffect(() => {
    let alive = true;
    const load = () => getStats().then((s) => alive && setStats(s));
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return stats;
}
