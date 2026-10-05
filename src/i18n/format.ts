import { bcp47, getLocale, t } from "./index";

/**
 * Numbers, distances, times and dates in the language in force. Japanese keeps the exact forms
 * the game always showed ("300m", "1.2km", "1.0キロ", "10/5(月・祝)"); English and Chinese follow
 * their own conventions through Intl and the `unit.*` / `clock.*` templates.
 */

// Formatters are costly to build and these run every frame (HUD, panel): one per tag and option.
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(digits: number | undefined): Intl.NumberFormat {
  const key = `n|${bcp47()}|${digits ?? ""}`;
  const cached = formatters.get(key);
  if (cached instanceof Intl.NumberFormat) return cached;
  const options =
    digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  const made = new Intl.NumberFormat(bcp47(), options);
  formatters.set(key, made);
  return made;
}

function dateFormat(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${bcp47()}|${name}`;
  const cached = formatters.get(key);
  if (cached instanceof Intl.DateTimeFormat) return cached;
  // UTC throughout: the game's clock is already Tokyo time, given as plain numbers.
  const made = new Intl.DateTimeFormat(bcp47(), { ...options, timeZone: "UTC" });
  formatters.set(key, made);
  return made;
}

/** 12,345 (grouped as the locale groups); `digits` fixes the decimals. */
export function formatNumber(n: number, digits?: number): string {
  return numberFormat(digits).format(n);
}

/** Yen: "1,000 円" / "¥1,000" / "1,000 日元". */
export function formatYen(n: number): string {
  return t("unit.yen", { n: formatNumber(n) });
}

/**
 * A distance on screen, to 10 m and from 1 km to 0.1 km: "300m" "1.2km" / "300 m" "1.2 km" /
 * "300米" "1.2公里".
 */
export function formatDistance(m: number): string {
  const tens = Math.round(m / 10) * 10;
  if (tens >= 1000) return t("unit.km", { n: (m / 1000).toFixed(1) });
  return t("unit.m", { n: Math.max(10, tens) });
}

/**
 * A distance read aloud: "300メートル" "1.2キロ" / "300 meters" "1.5 kilometers" "1 kilometer" /
 * "300米" "1.5公里". Japanese keeps "1.0キロ" as navigation voices say it; the others drop ".0".
 */
export function spokenDistance(m: number): string {
  if (m < 1000) return t("unit.spokenM", { n: Math.max(10, Math.round(m / 10) * 10) });
  const fixed = (m / 1000).toFixed(1);
  const isJapanese = getLocale() === "ja";
  const n = isJapanese ? fixed : String(Number(fixed));
  return t(n === "1" ? "unit.spokenKmOne" : "unit.spokenKm", { n });
}

/** "14:05": 24-hour in every language (the regulations' hours are written that way too). */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return dateFormat("hm", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    Date.UTC(2000, 0, 1, h, m),
  );
}

/** The weekday's short name (0 = Sunday): 月 / Mon / 周一. */
export function formatWeekday(weekday: number): string {
  // 4 January 1970 was a Sunday.
  return dateFormat("wd", { weekday: "short" }).format(Date.UTC(1970, 0, 4 + weekday));
}

/**
 * The in-game calendar day as each language writes it: "10/5(月・祝)" / "Mon, 10/5 (holiday)" /
 * "10/5 周一（节假日）". `holiday` is a 祝日 (or 振替休日・国民の休日).
 */
export function formatDay(date: { m: number; d: number }, weekday: number, holiday: boolean): string {
  const md = dateFormat("md", { month: "numeric", day: "numeric" }).format(
    Date.UTC(2001, date.m - 1, date.d),
  );
  return t(holiday ? "clock.dayHoliday" : "clock.day", { md, wd: formatWeekday(weekday) });
}
