/**
 * When a JARTIC regulation is in force. The CSV (拡張版 K 2.1) gives up to five 対象 conditions —
 * a daily time window (規制時間) and a day code (規制曜日) — and up to five 除外 conditions, e.g.
 * 歩行者用道路 7:00–8:30 and 15:00–17:00 「土曜・日曜・休日を除く」. In the tiles each rule
 * carries a numeric TIME block: [nOn, (start, end, day) × nOn, nOff, (start, end, day) × nOff],
 * minutes of the day and the spec's 曜日コード (0 = every day).
 */
export type Window = [start: number, end: number, day: number];
export type RuleTime = { on: Window[]; off: Window[] };
/** The moment rules are judged at: game time of day, day of week (0 = Sunday), 祝日. */
export type GameClock = {
  minutes: number;
  weekday: number;
  holiday: boolean;
  prevWeekday: number;
  prevHoliday: boolean;
};

export const ALWAYS: RuleTime = { on: [[0, 1440, 0]], off: [] };

/** Reads a TIME block at `i`; returns the time and the index after it. */
export function readTime(a: number[], i: number): { time: RuleTime; next: number } {
  const on: Window[] = [];
  const off: Window[] = [];
  const nOn = a[i++] ?? 0;
  for (let k = 0; k < nOn; k++, i += 3) on.push([a[i], a[i + 1], a[i + 2]]);
  const nOff = a[i++] ?? 0;
  for (let k = 0; k < nOff; k++, i += 3) off.push([a[i], a[i + 1], a[i + 2]]);
  return { time: on.length ? { on, off } : ALWAYS, next: i };
}

export function writeTime(t: RuleTime): number[] {
  return [t.on.length, ...t.on.flat(), t.off.length, ...t.off.flat()];
}

/** 曜日コード: 1 土日, 2 土日休, 3 日休, 4 土, 5 日, 6 休日; 0 (or 99 その他) every day. */
export function dayMatches(code: number, weekday: number, holiday: boolean): boolean {
  const sat = weekday === 6;
  const sun = weekday === 0;
  switch (code) {
    case 1:
      return sat || sun;
    case 2:
      return sat || sun || holiday;
    case 3:
      return sun || holiday;
    case 4:
      return sat;
    case 5:
      return sun;
    case 6:
      return holiday;
    default:
      return true;
  }
}

/** A window across midnight belongs to the day it starts on (spec 3.7: 規制の開始時間における曜日). */
function windowHits([start, end, day]: Window, c: GameClock): boolean {
  if (start <= end) return c.minutes >= start && c.minutes < end && dayMatches(day, c.weekday, c.holiday);
  if (c.minutes >= start) return dayMatches(day, c.weekday, c.holiday);
  if (c.minutes < end) return dayMatches(day, c.prevWeekday, c.prevHoliday);
  return false;
}

export function inForce(t: RuleTime, c: GameClock): boolean {
  return t.on.some((w) => windowHits(w, c)) && !t.off.some((w) => windowHits(w, c));
}

export const isAllDay = (t: RuleTime) =>
  t.off.length === 0 && t.on.some(([s, e, d]) => s === 0 && e === 1440 && d === 0);

const DAY_WORDS = ["", "土・日", "土・日・休日", "日・休日", "土", "日", "休日"];
const hhmm = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}:${String(mm).padStart(2, "0")}` : `${h}`;
};

/** 補助標識 wording for a rule's hours and days, or null for round the clock, every day. */
export function timeNote(t: RuleTime): string | null {
  if (isAllDay(t)) return null;
  const lines: string[] = [];
  const timed = t.on.filter(([s, e]) => !(s === 0 && e === 1440));
  const days = [...new Set(t.on.map(([, , d]) => d))].filter((d) => d !== 0);
  if (days.length) lines.push(days.map((d) => DAY_WORDS[d] ?? "").join("・"));
  if (timed.length) lines.push(timed.map(([s, e]) => `${hhmm(s)}-${hhmm(e)}`).join("・"));
  const except = [...new Set(t.off.map(([, , d]) => d))].filter((d) => d !== 0);
  if (except.length) lines.push(`${except.map((d) => DAY_WORDS[d] ?? "").join("・")}を除く`);
  return lines.length ? lines.join("\n") : null;
}

// ---------------------------------------------------------------- 国民の祝日

/** 国民の祝日に関する法律: fixed days, Happy Monday, equinoxes, 振替休日 and 国民の休日. */
export function japaneseHolidays(year: number): Set<string> {
  const days = new Set<string>();
  const key = (m: number, d: number) => `${m}-${d}`;
  const nthMonday = (m: number, n: number) => {
    const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  };
  for (const [m, d] of [
    [1, 1],
    [2, 11],
    [2, 23],
    [4, 29],
    [5, 3],
    [5, 4],
    [5, 5],
    [8, 11],
    [11, 3],
    [11, 23],
  ]) {
    days.add(key(m, d));
  }
  days.add(key(1, nthMonday(1, 2))); // 成人の日
  days.add(key(7, nthMonday(7, 3))); // 海の日
  days.add(key(9, nthMonday(9, 3))); // 敬老の日
  days.add(key(10, nthMonday(10, 2))); // スポーツの日
  // 春分・秋分 (the usual approximation, valid 1980–2099).
  const y = year - 1980;
  days.add(key(3, Math.floor(20.8431 + 0.242194 * y - Math.floor(y / 4))));
  days.add(key(9, Math.floor(23.2488 + 0.242194 * y - Math.floor(y / 4))));
  const isHoliday = (m: number, d: number) => days.has(key(m, d));
  const date = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d));
  const sorted = [...days].map((k) => k.split("-").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [m, d] of sorted) {
    // 振替休日: a holiday on a Sunday moves to the next day that is not a holiday.
    if (date(m, d).getUTCDay() !== 0) continue;
    const next = date(m, d);
    do next.setUTCDate(next.getUTCDate() + 1);
    while (isHoliday(next.getUTCMonth() + 1, next.getUTCDate()));
    days.add(key(next.getUTCMonth() + 1, next.getUTCDate()));
  }
  // 国民の休日: a weekday between two holidays.
  for (let t = Date.UTC(year, 0, 2); t < Date.UTC(year, 11, 31); t += 86_400_000) {
    const d = new Date(t);
    const prev = new Date(t - 86_400_000);
    const next = new Date(t + 86_400_000);
    const isBetween =
      isHoliday(prev.getUTCMonth() + 1, prev.getUTCDate()) &&
      isHoliday(next.getUTCMonth() + 1, next.getUTCDate());
    if (isBetween && d.getUTCDay() !== 0 && !isHoliday(d.getUTCMonth() + 1, d.getUTCDate())) {
      days.add(key(d.getUTCMonth() + 1, d.getUTCDate()));
    }
  }
  return days;
}

const holidayCache = new Map<number, Set<string>>();

/** The game clock for a date in Japan (y, m, d of the calendar day in JST) and minutes of the day. */
export function gameClock(y: number, m: number, d: number, minutes: number): GameClock {
  const isHoliday = (yy: number, mm: number, dd: number) => {
    let set = holidayCache.get(yy);
    if (!set) {
      set = japaneseHolidays(yy);
      holidayCache.set(yy, set);
    }
    return set.has(`${mm}-${dd}`);
  };
  const today = new Date(Date.UTC(y, m - 1, d));
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return {
    minutes,
    weekday: today.getUTCDay(),
    holiday: isHoliday(y, m, d),
    prevWeekday: prev.getUTCDay(),
    prevHoliday: isHoliday(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate()),
  };
}

const tokyoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Japan. The formatter is shared, not the date (replays can go backwards). */
export function tokyoDate(now = new Date()): { y: number; m: number; d: number } {
  const parts = tokyoDateFormatter
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}
