import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auxKey, auxPlatesFor, HOURS_PLATE } from "../src/signs/auxPlates";
import type { GameTable } from "../src/signs/game";
import { ALWAYS, timeNote, type RuleTime } from "../src/time/ruleTime";
import { signedRegulations } from "../scripts/signInputs";

/**
 * The rule choosing the 補助標識 under a regulation's plate (src/signs/auxPlates.ts) says what the
 * Canvas note plate said before G2 (ruleTime.ts timeNote, drawn line by line), now as the 502
 * 日・時間 face (one per day group), and every regulation of public/data/regs has a face in the
 * committed assets/signs/game.json.
 */

const root = join(import.meta.dirname, "..");
const regulations = signedRegulations(root);
/** The day groups of a rule's windows (曜日コード 1–6; 0 and words timeNote lacks are every day). */
const dayGroupCount = (t: RuleTime) => new Set(t.on.map(([, , d]) => (d >= 1 && d <= 6 ? d : 0))).size;

describe("the 補助標識 of a regulation (auxPlatesFor)", () => {
  it("is none for a rule in force round the clock every day", () => {
    expect(auxPlatesFor({ time: ALWAYS })).toEqual([]);
  });

  it("is 502 日・時間 with the days, the hours and the days left out, one per line", () => {
    const schoolRun: RuleTime = {
      on: [
        [450, 540, 0],
        [780, 900, 0],
      ],
      off: [[0, 1440, 2]],
    };
    expect(auxPlatesFor({ time: schoolRun })).toEqual([
      { sign: HOURS_PLATE, lines: ["7:30-9・13-15", "土・日・休日を除く"] },
    ]);
    const sundays: RuleTime = { on: [[600, 1020, 3]], off: [] };
    expect(auxPlatesFor({ time: sundays })).toEqual([{ sign: "502", lines: ["日・休日", "10-17"] }]);
  });

  it("says, for every 通行禁止 of public/data/regs on one day group, what the note plate said (blank lines and breaks at 「・」 aside)", () => {
    expect(regulations.length).toBeGreaterThan(1000);
    // Joining every line with 「・」 undoes a break between windows and nothing else.
    const differing = regulations.flatMap(({ time }) => {
      if (dayGroupCount(time) > 1) return [];
      const note = timeNote(time);
      const before = note === null ? [] : note.split("\n").filter((l) => l !== "");
      const now = auxPlatesFor({ time }).flatMap((p) => p.lines);
      return now.join("・") === before.join("・") ? [] : [`${note} → ${now.join("/")}`];
    });
    expect(differing).toEqual([]);
  });

  it("breaks a line too long for the plate between its windows, up to three lines", () => {
    const three: RuleTime = {
      on: [
        [480, 570, 0],
        [690, 810, 0],
        [1020, 1170, 0],
      ],
      off: [],
    };
    expect(timeNote(three)).toBe("8-9:30・11:30-13:30・17-19:30");
    expect(auxPlatesFor({ time: three })[0].lines).toEqual(["8-9:30", "11:30-13:30", "17-19:30"]);
    // Would need four lines: kept on one line, squeezed by the painter rather than cut.
    const crowded: RuleTime = { ...three, off: [[0, 1440, 2]] };
    expect(auxPlatesFor({ time: crowded })[0].lines).toEqual([
      "8-9:30・11:30-13:30・17-19:30",
      "土・日・休日を除く",
    ]);
    const short: RuleTime = {
      on: [
        [450, 540, 0],
        [780, 900, 0],
      ],
      off: [],
    };
    expect(auxPlatesFor({ time: short })[0].lines).toEqual(["7:30-9・13-15"]);
  });

  it("puts at most three lines on a plate, a piece of a broken line no longer than 12 characters", () => {
    for (const { time } of regulations) {
      const noteLines = new Set((timeNote(time) ?? "").split("\n"));
      for (const p of auxPlatesFor({ time })) {
        expect(p.lines.length).toBeLessThanOrEqual(3);
        const pieces = p.lines.filter((line) => !noteLines.has(line));
        expect(pieces.filter((line) => line.length > 12)).toEqual([]);
      }
    }
  });

  it("gives windows on different day groups a plate each, the days left out with the every-day group", () => {
    // timeNote reads 「日・休日／7:30-9・13-16・8-11／土・日・休日を除く」, as if every window were on 日・休日.
    const mixed: RuleTime = {
      on: [
        [450, 540, 0],
        [780, 960, 0],
        [480, 660, 3],
      ],
      off: [[0, 1440, 2]],
    };
    expect(auxPlatesFor({ time: mixed }).map((p) => p.lines)).toEqual([
      ["7:30-9・13-16", "土・日・休日を除く"],
      ["日・休日", "8-11"],
    ]);
    const weekends: RuleTime = {
      on: [
        [600, 1020, 1],
        [600, 720, 6],
      ],
      off: [[0, 1440, 4]],
    };
    expect(auxPlatesFor({ time: weekends }).map((p) => p.lines)).toEqual([
      ["土・日", "10-17", "土を除く"],
      ["休日", "10-12", "土を除く"],
    ]);
  });

  it("keeps every window of a rule split by day groups, each on the plate of its group", () => {
    const split = regulations.filter(({ time }) => dayGroupCount(time) > 1);
    expect(split.length).toBeGreaterThan(0);
    for (const { time } of split) expect(auxPlatesFor({ time }).length).toBe(dayGroupCount(time));
  });

  it("leaves out a blank line, where a day code has no word (99 その他)", () => {
    const other: RuleTime = { on: [[600, 1020, 99]], off: [] };
    expect(timeNote(other)).toBe("\n10-17");
    expect(auxPlatesFor({ time: other })).toEqual([{ sign: "502", lines: ["10-17"] }]);
  });

  it("has a face in the committed game.json for every 通行禁止 of the data (just rebuild-sign-assets after a fetch)", () => {
    const game = JSON.parse(readFileSync(join(root, "assets/signs/game.json"), "utf8")) as GameTable;
    const drawn = new Set(Object.keys(game.aux));
    const missing = regulations.flatMap(({ time }) =>
      auxPlatesFor({ time }).filter((p) => !drawn.has(auxKey(p))),
    );
    expect(missing.map(auxKey)).toEqual([]);
  });
});
