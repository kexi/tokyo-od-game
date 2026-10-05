import { describe, expect, it } from "vitest";
import {
  gameClock,
  tokyoDate,
  inForce,
  japaneseHolidays,
  readTime,
  writeTime,
  type RuleTime,
} from "../src/world/ruleTime";

describe("Tokyo calendar dates", () => {
  it("crosses midnight, year-end and leap day in Japan independently of the host timezone", () => {
    expect(tokyoDate(new Date("2025-12-31T14:59:59Z"))).toEqual({ y: 2025, m: 12, d: 31 });
    expect(tokyoDate(new Date("2025-12-31T15:00:00Z"))).toEqual({ y: 2026, m: 1, d: 1 });
    expect(tokyoDate(new Date("2024-02-28T15:00:00Z"))).toEqual({ y: 2024, m: 2, d: 29 });
    expect(tokyoDate(new Date("2024-02-29T15:00:00Z"))).toEqual({ y: 2024, m: 3, d: 1 });
    // Replays can jump backwards after the formatter has seen a later day.
    expect(tokyoDate(new Date("2024-02-28T14:59:59Z"))).toEqual({ y: 2024, m: 2, d: 28 });
  });
});

describe("JARTIC rule times", () => {
  // 歩行者用道路 7:00–8:30 and 15:00–17:00, 土曜・日曜・休日を除く (the spec's own example).
  const schoolRoad: RuleTime = {
    on: [
      [420, 510, 0],
      [900, 1020, 0],
    ],
    off: [[0, 1440, 2]],
  };

  it("round-trips through the numeric TIME block", () => {
    const block = writeTime(schoolRoad);
    expect(readTime([9, ...block, 42], 1)).toEqual({ time: schoolRoad, next: 1 + block.length });
  });

  it("applies on weekdays inside either window only", () => {
    const thu = gameClock(2026, 10, 1, 8 * 60); // Thursday 08:00
    expect(inForce(schoolRoad, thu)).toBe(true);
    expect(inForce(schoolRoad, gameClock(2026, 10, 1, 12 * 60))).toBe(false);
    expect(inForce(schoolRoad, gameClock(2026, 10, 1, 16 * 60))).toBe(true);
  });

  it("is lifted on Saturdays, Sundays and holidays", () => {
    expect(inForce(schoolRoad, gameClock(2026, 10, 4, 8 * 60))).toBe(false); // Sunday
    expect(inForce(schoolRoad, gameClock(2026, 10, 12, 8 * 60))).toBe(false); // スポーツの日 (Mon)
  });

  it("gives a window across midnight to the day it starts on", () => {
    // Saturday 23:00 – 5:00 (曜日コード 4 = 土曜日).
    const night: RuleTime = { on: [[1380, 300, 4]], off: [] };
    expect(inForce(night, gameClock(2026, 10, 3, 23 * 60 + 30))).toBe(true); // Sat 23:30
    expect(inForce(night, gameClock(2026, 10, 4, 3 * 60))).toBe(true); // Sun 03:00, started Sat
    expect(inForce(night, gameClock(2026, 10, 5, 3 * 60))).toBe(false); // Mon 03:00, started Sun
  });
});

describe("Japanese public holidays", () => {
  it("lists 2026 including 振替休日 and 国民の休日", () => {
    const h = japaneseHolidays(2026);
    for (const day of [
      "1-1",
      "1-12",
      "2-11",
      "2-23",
      "3-20",
      "4-29",
      "5-3",
      "5-4",
      "5-5",
      "5-6",
      "7-20",
      "8-11",
      "9-21",
      "9-22",
      "9-23",
      "10-12",
      "11-3",
      "11-23",
    ]) {
      expect(h.has(day), day).toBe(true);
    }
    expect(h.has("5-7")).toBe(false);
    expect(h.size).toBe(18);
  });
});

describe("補助標識 wording", () => {
  it("states the hours and the days excluded", async () => {
    const { timeNote } = await import("../src/world/ruleTime");
    expect(
      timeNote({
        on: [
          [420, 510, 0],
          [900, 1020, 0],
        ],
        off: [[0, 1440, 2]],
      }),
    ).toBe("7-8:30・15-17\n土・日・休日を除く");
    expect(timeNote({ on: [[720, 1020, 3]], off: [] })).toBe("日・休日\n12-17");
    expect(timeNote({ on: [[0, 1440, 0]], off: [] })).toBeNull();
  });
});
