import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; msg: string };
type ToastApi = { success: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void };

const ToastContext = createContext<ToastApi | null>(null);
let idSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, msg: string) => {
    const id = idSeq++;
    setItems((prev) => [...prev, { id, kind, msg }].slice(-5));
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (msg) => push("success", msg),
      error: (msg) => push("error", msg),
      info: (msg) => push("info", msg),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className={`toast${t.kind === "error" ? " toast-error" : ""}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      success: (msg) => console.info("[toast]", msg),
      error: (msg) => console.error("[toast]", msg),
      info: (msg) => console.info("[toast]", msg),
    };
  }
  return ctx;
}

/** Imperative helpers for non-React call sites. */
export const toast = {
  success: (msg: string) => window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "success", msg } })),
  error: (msg: string) => window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "error", msg } })),
  info: (msg: string) => window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "info", msg } })),
};

export function ToastEventBridge() {
  const t = useToast();
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: ToastKind; msg: string }>).detail;
      if (!detail?.msg) return;
      if (detail.kind === "success") t.success(detail.msg);
      else if (detail.kind === "error") t.error(detail.msg);
      else t.info(detail.msg);
    };
    window.addEventListener("whimpr:toast", onToast);
    return () => window.removeEventListener("whimpr:toast", onToast);
  }, [t]);
  return null;
}
