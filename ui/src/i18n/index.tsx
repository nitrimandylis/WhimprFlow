import { createContext, useContext, useMemo, type ReactNode } from "react";
import { en } from "./en";
import { es } from "./es";

// Minimal, dependency-free i18n: two static dictionaries plus `{token}`
// interpolation. No plural-rule engine: source strings are phrased so a
// count reads fine either way (e.g. "{count} words").

export type Locale = "en" | "es";

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, es };

/** Settings["ui_language"] ("system" | "en" | "es" | anything else) -> the
 *  locale to actually render. "system" reads `navigator.language`; anything
 *  unrecognized falls back to English. */
export function resolveLocale(uiLanguage: string): Locale {
  if (uiLanguage === "es" || uiLanguage === "en") return uiLanguage;
  if (uiLanguage === "system") {
    try {
      const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
      if (nav && nav.toLowerCase().startsWith("es")) return "es";
    } catch {
      /* non-browser/test environment: fall through to English */
    }
    return "en";
  }
  return "en";
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

function makeT(locale: Locale): T {
  const dict = DICTIONARIES[locale];
  const fallback = DICTIONARIES.en;
  return (key, vars) => interpolate(dict[key] ?? fallback[key] ?? key, vars);
}

// Safe no-op default so a component rendered outside the provider (e.g. during
// incremental rollout or a stray test) shows the raw key instead of crashing.
const noopT: T = (key) => key;

const I18nContext = createContext<{ locale: Locale; t: T }>({ locale: "en", t: noopT });

export function I18nProvider({ uiLanguage, children }: { uiLanguage: string; children: ReactNode }) {
  const locale = resolveLocale(uiLanguage);
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): T {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
