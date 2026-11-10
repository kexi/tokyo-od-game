import { timeNote, type RuleTime } from "../time/ruleTime";

/**
 * Which 補助標識 hang under a regulation's plate, from what JARTIC tells about the regulation.
 * The one place this is decided: src/world/regulations.ts placeSigns asks it for the plates of a
 * placed sign, and src/signs/defs/auxiliary.ts asks it for every regulation in public/data/regs
 * to know which faces to draw ahead of time (registry.json `aux`).
 *
 * The tiles carry a regulation's hours and days (規制時間・曜日, 除外 days) but not the vehicles it
 * leaves out (車種), so the only plate today is 502 日・時間. Its lines are the wording of
 * ruleTime.ts timeNote (曜日, then hours, then 「…を除く」), which the navigation and the HUD show
 * too, so a plate and the text beside it never disagree. Two things differ: a rule whose windows
 * fall on different day groups (every day 7:30–9 and 日・休日 8–11) gets one plate per group, since
 * timeNote puts all the days on one line and all the hours on the next, which reads as if every
 * window were on 日・休日 (G2 review I5); and a line too long for the plate is broken between its
 * windows. A rule in force round the clock every day gets none.
 *
 * Why not import this module's numbers from the definitions: it runs in the game, which must not
 * bundle the definitions (review I9); the registry checks that the number is a drawn 補助標識.
 */

/** 502 日・時間: 「8-20」「日曜・休日を除く」 (別表第二 図 202). */
export const HOURS_PLATE = "502";

/** A 補助標識 as the game hangs it: the number and the lines of lettering, top to bottom. */
export type AuxPlate = { sign: string; lines: string[] };

/** What a regulation says about itself that a 補助標識 can show. */
export type AuxSubject = { time: RuleTime };

export function auxPlatesFor(rule: AuxSubject): AuxPlate[] {
  return dayGroups(rule.time).flatMap((time) => {
    const note = timeNote(time);
    if (note === null) return [];
    // A day code timeNote has no word for (99 その他) leaves an empty line; a plate shows no blank row.
    const lines = note.split("\n").filter((line) => line !== "");
    if (lines.length === 0) return [];
    return [{ sign: HOURS_PLATE, lines: wrapped(lines) }];
  });
}

/** The day group of a 曜日コード: 1–6 name days (土日, 日休 …); 0 and the codes with no word (99) are every day. */
const groupOf = (day: number) => (day >= 1 && day <= 6 ? day : 0);

/**
 * The rule split by the day groups of its windows, in order of first appearance. The days left
 * out (`off`, 「土・日・休日を除く」) go with the every-day group, which is what they qualify;
 * with no every-day group they go with each.
 */
function dayGroups(t: RuleTime): RuleTime[] {
  const groups = [...new Set(t.on.map(([, , d]) => groupOf(d)))];
  if (groups.length <= 1) return [t];
  const hasEveryDay = groups.includes(0);
  return groups.map((g) => {
    const keepsOff = !hasEveryDay || g === 0;
    return { on: t.on.filter(([, , d]) => groupOf(d) === g), off: keepsOff ? t.off : [] };
  });
}

/**
 * Characters a line of the 60 cm plate holds (12 cm letters within 5 cm margins) before the
 * painter has to squeeze it; 「7:30-9・13-15」 is the longest that still reads.
 */
const LINE_CHARS = 12;
/** The tallest 補助標識 plate is 44 cm, three lines (交通規制基準). */
const MAX_LINES = 3;

/**
 * Long lines broken where their windows meet (at 「・」), so 「8-9:30・11:30-13:30・17-19:30」 takes
 * three lines instead of being squeezed to half its width (G2 review, round 1). Kept as they were
 * when the breaks would need more than three lines: the plate is then squeezed, not cut.
 */
function wrapped(lines: readonly string[]): string[] {
  const out = lines.flatMap(wrapAtDots);
  const fits = out.length <= MAX_LINES;
  return fits ? out : [...lines];
}

function wrapAtDots(line: string): string[] {
  if (line.length <= LINE_CHARS) return [line];
  const out: string[] = [];
  for (const part of line.split("・")) {
    const last = out.at(-1);
    const joined = last === undefined ? part : `${last}・${part}`;
    const isRoomy = last !== undefined && joined.length <= LINE_CHARS;
    if (isRoomy) out[out.length - 1] = joined;
    else out.push(part);
  }
  return out;
}

/** The key of a plate's face in assets/signs/game.json `aux` (number and lines). */
export const auxKey = (p: AuxPlate): string => `${p.sign}:${p.lines.join("/")}`;
