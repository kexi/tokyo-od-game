import { warn } from "../log";
import { en } from "./en";
import { ja, type MessageKey, type Messages } from "./ja";
import { zh } from "./zh";

/**
 * 日本語 / English / 中文 for the UI. The language is the stored choice (`tod.lang`), else the
 * first of the browser's languages we have, else English. t() looks a key up with a fallback
 * chain (zh → en → ja → the key itself); static HTML is translated through data-i18n attributes
 * by applyI18n(), and text built in code that must follow a language switch through bindText().
 *
 * Why not an i18n library: the game needs lookups, `{name}` slots and a re-render on switch,
 * about a hundred lines; a library would add plural/ICU machinery and its own loader for that.
 */
export type { MessageKey, Messages };
export type Locale = "ja" | "en" | "zh";
export type Params = Record<string, string | number>;
/** Partial so the fallback chain can be tested with gaps; the real ones are complete. */
export type Dictionaries = Record<Locale, Partial<Messages>>;

export const LOCALES: readonly Locale[] = ["ja", "en", "zh"];
/** Each language named in itself, for the pickers. */
export const LOCALE_NAMES: Record<Locale, string> = { ja: "日本語", en: "English", zh: "中文" };
export const STORE_KEY = "tod.lang";

const DICTIONARIES: Dictionaries = { ja, en, zh };
// Chinese readers fall back to English before Japanese: kana are no help to them.
const FALLBACK: Record<Locale, readonly Locale[]> = { ja: ["ja"], en: ["en", "ja"], zh: ["zh", "en", "ja"] };
// The tag for <html lang>, Intl and speech: zh is Simplified script, whatever the region.
const BCP47: Record<Locale, string> = { ja: "ja", en: "en", zh: "zh-Hans" };
/** data-i18n-<x> → the attribute it fills. */
const ATTRIBUTES = [
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-aria-label", "aria-label"],
] as const;
const SELECTOR = ["data-i18n", "data-i18n-bound", ...ATTRIBUTES.map(([data]) => data)]
  .map((a) => `[${a}]`)
  .join(",");

let current: Locale = "ja";
let started = false;
const listeners = new Set<(locale: Locale) => void>();
/** Text that code builds from the current language, re-rendered on a switch. */
const bound = new WeakMap<Element, () => string>();
/** Missing keys already reported (once each, not every frame). */
const reported = new Set<string>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first of the browser's languages we have, by its primary subtag (ja-JP → ja, zh-TW → zh);
 * English when none is.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return "en";
}

/** A stored choice wins over the browser's languages. */
export function initialLocale(stored: string | null, languages: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  return detectLocale(languages);
}

/** Fill `{name}` slots; an unknown slot stays as written so the gap shows on screen. */
export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => {
    const value = params[name];
    return value === undefined ? slot : String(value);
  });
}

/** A key in `locale`, else down its fallback chain, else the key itself. Pure but for the warning. */
export function translate(dictionaries: Dictionaries, locale: Locale, key: string, params?: Params): string {
  for (const from of FALLBACK[locale]) {
    const text = dictionaries[from][key as MessageKey];
    const isFound = text !== undefined && text !== "";
    if (!isFound) continue;
    if (from !== locale) reportMissing(locale, key);
    return interpolate(text, params);
  }
  reportMissing(locale, key);
  return key;
}

function reportMissing(locale: Locale, key: string): void {
  if (!import.meta.env.DEV) return;
  const id = `${locale}:${key}`;
  if (reported.has(id)) return;
  reported.add(id);
  warn("i18n_missing", { locale, key });
}

export function t(key: MessageKey, params?: Params): string {
  return translate(DICTIONARIES, current, key, params);
}

export function getLocale(): Locale {
  return current;
}

/** The BCP 47 tag of a locale (for <html lang>, Intl formatters and speechSynthesis). */
export function bcp47(locale: Locale = current): string {
  return BCP47[locale];
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate what `root` marks: data-i18n (the text — only on elements without child elements,
 * it replaces them), data-i18n-title / -placeholder / -aria-label (those attributes), and the
 * elements given to bindText.
 */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll(SELECTOR)) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key as MessageKey);
    for (const [data, attribute] of ATTRIBUTES) {
      const attrKey = el.getAttribute(data);
      if (attrKey) el.setAttribute(attribute, t(attrKey as MessageKey));
    }
    const render = bound.get(el);
    if (render) el.textContent = render();
  }
}

/** Text from a key, kept in the current language (sets data-i18n). */
export function setI18nText(el: Element, key: MessageKey): void {
  el.setAttribute("data-i18n", key);
  el.textContent = t(key);
}

/**
 * Text composed in code (params, keys chosen at run time), rendered now and again on every
 * language switch. Replaces any data-i18n the element had, so the two never fight.
 */
export function bindText(el: Element, render: () => string): void {
  el.removeAttribute("data-i18n");
  el.setAttribute("data-i18n-bound", "");
  bound.set(el, render);
  el.textContent = render();
}

/** Switch the language now (no reload) and remember it, even when it is the current one. */
export function setLocale(locale: Locale): void {
  store(locale);
  if (locale === current) return;
  current = locale;
  syncDocument();
  for (const fn of listeners) fn(locale);
}

/** Pick the language and translate the page; once (later calls only return it). */
export function initI18n(): Locale {
  if (started) return current;
  started = true;
  current = initialLocale(readStored(), browserLanguages());
  syncDocument();
  return current;
}

function syncDocument(): void {
  const hasDocument = typeof document !== "undefined";
  if (!hasDocument) return;
  document.documentElement.lang = bcp47();
  applyI18n(document);
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    // Storage blocked (private window, previews): the browser's languages decide.
    return null;
  }
}

function store(locale: Locale): void {
  try {
    localStorage.setItem(STORE_KEY, locale);
  } catch {
    // Not remembered when storage is blocked; the switch still applies now.
  }
}

function browserLanguages(): readonly string[] {
  const hasNavigator = typeof navigator !== "undefined";
  if (!hasNavigator) return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}
