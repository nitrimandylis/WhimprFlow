import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { theme } from "./theme";
import { font } from "../tokens/values";

type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  msg: string;
};

type ToastApi = {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let idSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, msg: string) => {
    const id = idSeq++;
    setItems((prev) => [...prev, { id, kind, msg }].slice(-5));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
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
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 2000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
          pointerEvents: "none",
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              pointerEvents: "auto",
              padding: "11px 14px",
              borderRadius: 12,
              border: `1px solid ${
                t.kind === "error"
                  ? "rgba(180, 35, 24, 0.35)"
                  : t.kind === "success"
                    ? "rgba(61, 170, 109, 0.4)"
                    : theme.border
              }`,
              background:
                t.kind === "error"
                  ? "rgba(180, 35, 24, 0.1)"
                  : t.kind === "success"
                    ? "rgba(61, 170, 109, 0.12)"
                    : theme.cardBg,
              color: theme.textStrong,
              fontFamily: font.ui,
              fontSize: 13.5,
              lineHeight: 1.4,
              boxShadow: theme.shadowSoft,
            }}
          >
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
  success: (msg: string) => {
    window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "success", msg } }));
  },
  error: (msg: string) => {
    window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "error", msg } }));
  },
  info: (msg: string) => {
    window.dispatchEvent(new CustomEvent("whimpr:toast", { detail: { kind: "info", msg } }));
  },
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
