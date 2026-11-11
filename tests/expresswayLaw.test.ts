import { describe, expect, it } from "vitest";
import {
  brakeNeeded,
  EXIT_PREPARE_M,
  ExpresswayLaw,
  judgeExit,
  judgeMerge,
  type XwSample,
} from "../src/game/expresswayLaw";
import { speedViolation, VIOLATIONS } from "../src/game/traffic";

/** A car driving along lane 0 of a two-lane main line at 60 km/h. */
const base = (over: Partial<XwSample> = {}, road: Partial<NonNullable<XwSample["road"]>> = {}): XwSample => ({
  now: 0,
  road: { id: "24402611", kind: "main", lanes: 2, lane: 0, shoulderL: 1.25, shoulderR: 0.75, ...road },
  along: 60 / 3.6,
  facing: 1,
  kmh: 60,
  hazard: false,
  queueAhead: false,
  sinceCrashS: Infinity,
  mustStop: false,
  accident: false,
  waitingToMerge: false,
  rightExitAhead: false,
  ...over,
});

/** Runs samples 200 ms apart (main.ts looks five times a second) and returns every finding. */
function drive(law: ExpresswayLaw, seconds: number, at: (t: number) => Partial<XwSample>, road = {}) {
  const found: string[] = [];
  for (let t = 0; t <= seconds * 1000; t += 200) {
    for (const f of law.step(base({ now: t, ...at(t) }, road))) found.push(`${f.kind}:${f.detail.key}`);
  }
  return found;
}

describe("第75条の5 本線車道の転回・後退", () => {
  it("books a turn round on the main line as 本線車道横断等禁止違反", () => {
    const law = new ExpresswayLaw();
    const found = drive(law, 8, (t) => (t < 3000 ? {} : { facing: -1, along: -30 / 3.6, kmh: 30 }));
    expect(found).toContain("xwCrossing:violationDetail.xwUturn");
  });

  it("does not book a spin in a crash as a turn round, nor turning to face back while standing", () => {
    const spun = drive(new ExpresswayLaw(), 8, (t) =>
      t < 3000 ? {} : { facing: -1, along: -8, kmh: 30, sinceCrashS: (t - 3000) / 1000 },
    );
    expect(spun.filter((f) => f.endsWith("xwUturn"))).toEqual([]);
    const facedBack = drive(new ExpresswayLaw(), 8, (t) =>
      t < 3000 ? {} : { facing: -1, along: 0.5, kmh: 6 },
    );
    expect(facedBack.filter((f) => f.endsWith("xwUturn"))).toEqual([]);
  });

  it("books backing up on the main line, once while it goes on", () => {
    const law = new ExpresswayLaw();
    const found = drive(law, 6, () => ({ facing: 1, along: -2, kmh: 7 }));
    expect(found.filter((f) => f === "xwCrossing:violationDetail.xwReverse")).toHaveLength(1);
  });

  it("does not book a ramp (a 連結路 is no 本線車道): backing or turning there is not 第75条の5", () => {
    const law = new ExpresswayLaw();
    const back = drive(law, 6, () => ({ facing: 1, along: -2, kmh: 7 }), { kind: "ramp", lanes: 1 });
    expect(back.filter((f) => f.startsWith("xwCrossing"))).toEqual([]);
  });

  it("does not book a moment's roll back under 1 s", () => {
    const law = new ExpresswayLaw();
    const found = drive(law, 0.6, () => ({ facing: 1, along: -1, kmh: 3.6 }));
    expect(found).toEqual([]);
  });
});

describe("逆走（第17条第4項）", () => {
  it("books driving forward against the traffic, on a ramp too", () => {
    const law = new ExpresswayLaw();
    const found = drive(law, 3, () => ({ facing: -1, along: -40 / 3.6, kmh: 40 }), {
      kind: "ramp",
      lanes: 1,
    });
    expect(found).toContain("xwWrongWay:violationDetail.xwWrongWay");
  });
});

describe("第75条の8 駐停車", () => {
  const standing = { along: 0, kmh: 0 };

  it("books standing on the main line for 10 s with nothing ahead", () => {
    const found = drive(new ExpresswayLaw(), 12, () => standing);
    expect(found).toEqual(["xwStopping:violationDetail.xwStoppingMain"]);
  });

  it("books it on a ramp too (高速自動車国道等 is the whole road, not only 本線車道)", () => {
    const found = drive(new ExpresswayLaw(), 12, () => standing, { kind: "ramp", lanes: 1 });
    expect(found).toEqual(["xwStopping:violationDetail.xwStoppingRamp"]);
  });

  it("does not book a stop shorter than 10 s", () => {
    expect(drive(new ExpresswayLaw(), 9, () => standing)).toEqual([]);
  });

  it("does not book a stop the law or the police call for (a stop line ahead, a patrol's stop), nor one while an accident is dealt with", () => {
    expect(drive(new ExpresswayLaw(), 60, () => ({ ...standing, mustStop: true }))).toEqual([]);
    expect(drive(new ExpresswayLaw(), 300, () => ({ ...standing, accident: true }))).toEqual([]);
    // A minor bump with nothing to deal with: 60 s to move on, then it is 駐停車.
    const bump = drive(new ExpresswayLaw(), 75, (t) => ({ ...standing, sinceCrashS: t / 1000 }));
    expect(bump).toEqual(["xwStopping:violationDetail.xwStoppingMain"]);
  });

  it("does not book standing in a queue (渋滞), after a crash, or waiting for a gap to merge", () => {
    expect(drive(new ExpresswayLaw(), 30, () => ({ ...standing, queueAhead: true }))).toEqual([]);
    expect(drive(new ExpresswayLaw(), 30, () => ({ ...standing, sinceCrashS: 5 }))).toEqual([]);
    const ramp = { kind: "ramp" as const, lanes: 1 };
    expect(drive(new ExpresswayLaw(), 30, () => ({ ...standing, waitingToMerge: true }), ramp)).toEqual([]);
  });

  it("excuses a breakdown on the shoulder only where the shoulder is wide enough for the car (第1項第2号)", () => {
    const onShoulder = () => ({ ...standing, hazard: true });
    // The data's 1.25 m left shoulder (第8条): too narrow, booked.
    const narrow = drive(new ExpresswayLaw(), 12, onShoulder, { lane: -1, shoulderL: 1.25 });
    expect(narrow).toEqual(["xwStopping:violationDetail.xwStoppingMain"]);
    const wide = drive(new ExpresswayLaw(), 12, onShoulder, { lane: -1, shoulderL: 2.5 });
    expect(wide).toEqual([]);
    // Hazard lamps in a lane are no exception.
    expect(drive(new ExpresswayLaw(), 12, onShoulder, { lane: 0, shoulderL: 2.5 })).toHaveLength(1);
  });
});

describe("第75条の4 最低速度は首都高に適用しない", () => {
  it("never books driving slowly on the main line, however slow (only standing still is 駐停車)", () => {
    for (const kmh of [2, 10, 20, 49]) {
      const found = drive(new ExpresswayLaw(), 120, () => ({ kmh, along: kmh / 3.6 }));
      expect(found, `${kmh} km/h`).toEqual([]);
    }
  });

  it("has no 最低速度違反 among the violations it can book", () => {
    const labels = Object.values(VIOLATIONS).map((v) => v.label);
    expect(labels.some((l) => l.includes("最低速度"))).toBe(false);
  });
});

describe("第20条第1項 通行帯（右端の車線）", () => {
  it("books driving along in the right lane of a two-lane main line for 20 s", () => {
    const found = drive(new ExpresswayLaw(), 22, () => ({}), { lane: 1 });
    expect(found).toEqual(["laneUse:violationDetail.xwRightLane"]);
  });

  it("does not book an overtake shorter than 20 s, nor keeping right for an exit on the right", () => {
    expect(drive(new ExpresswayLaw(), 15, () => ({}), { lane: 1 })).toEqual([]);
    expect(drive(new ExpresswayLaw(), 60, () => ({ rightExitAhead: true }), { lane: 1 })).toEqual([]);
  });

  it("does not book the left lane, nor a one-lane main line", () => {
    expect(drive(new ExpresswayLaw(), 60, () => ({}), { lane: 0 })).toEqual([]);
    expect(drive(new ExpresswayLaw(), 60, () => ({}), { lanes: 1, lane: 0 })).toEqual([]);
  });
});

describe("第75条の6 合流での進行妨害", () => {
  const v = 60 / 3.6;

  it("books a merge that makes the car behind brake 3 m/s² or more", () => {
    // 20 m behind at 80 km/h against our 40: closing 11.1 m/s with 20 − 16.7 m of room.
    const found = judgeMerge({ speed: 40 / 3.6, followers: [{ gapM: 20, speed: 80 / 3.6 }], rampGapM: 0 });
    expect(found.map((f) => f.kind)).toEqual(["xwMergeObstruct"]);
  });

  it("books cutting in inside the follower's reaction distance even at its speed", () => {
    expect(brakeNeeded(v, { gapM: 8, speed: v })).toBe(Infinity);
    expect(judgeMerge({ speed: v, followers: [{ gapM: 8, speed: v }], rampGapM: 0 })).toHaveLength(1);
  });

  it("does not book a merge into a gap the follower closes gently, nor ahead of a slower car", () => {
    // 60 m behind at 70 km/h against our 60: 2.8 m/s closing over 45 m of room is 0.09 m/s².
    expect(judgeMerge({ speed: v, followers: [{ gapM: 60, speed: 70 / 3.6 }], rampGapM: 0 })).toEqual([]);
    expect(judgeMerge({ speed: v, followers: [{ gapM: 15, speed: 30 / 3.6 }], rampGapM: 0 })).toEqual([]);
    expect(judgeMerge({ speed: v, followers: [], rampGapM: 0 })).toEqual([]);
  });
});

describe("第75条の7 本線車道の出入の方法", () => {
  it("books coming in over the 導流帯 instead of along the 加速車線", () => {
    const found = judgeMerge({ speed: 50 / 3.6, followers: [], rampGapM: 3 });
    expect(found.map((f) => f.kind)).toEqual(["xwRampMethod"]);
  });

  it("does not book a merge where the ramp's lane already runs beside the main line's", () => {
    expect(judgeMerge({ speed: 50 / 3.6, followers: [], rampGapM: 0.2 })).toEqual([]);
  });

  it(`books leaving from the far lane (not in the exit lane ${EXIT_PREPARE_M} m before)`, () => {
    expect(judgeExit({ lanes: 2, laneBefore: 1, side: "left" })?.kind).toBe("xwRampMethod");
    expect(judgeExit({ lanes: 3, laneBefore: 0, side: "right" })?.detail.params?.lanes).toBe(2);
  });

  it("does not book leaving from the exit lane, nor from a one-lane main line", () => {
    expect(judgeExit({ lanes: 2, laneBefore: 0, side: "left" })).toBeNull();
    expect(judgeExit({ lanes: 2, laneBefore: -1, side: "left" })).toBeNull();
    expect(judgeExit({ lanes: 2, laneBefore: 1, side: "right" })).toBeNull();
    expect(judgeExit({ lanes: 1, laneBefore: 0, side: "left" })).toBeNull();
  });
});

describe("速度超過の帯（高速自動車国道等）", () => {
  it("keeps 30–40 km/h over a 反則行為 on the expressway (3 点、25,000 円・35,000 円)", () => {
    expect(speedViolation(32, true)).toMatchObject({ points: 3, fine: 25000 });
    expect(speedViolation(37, true)).toMatchObject({ points: 3, fine: 35000 });
    expect(speedViolation(42, true)).toMatchObject({ points: 6, fine: null });
    expect(speedViolation(55, true)).toMatchObject({ points: 12, fine: null });
  });

  it("leaves the street bands as they were (30 over is 非反則 6 点) and the lower bands the same on both", () => {
    expect(speedViolation(32)).toMatchObject({ points: 6, fine: null });
    for (const over of [5, 17, 22, 27]) expect(speedViolation(over, true)).toEqual(speedViolation(over));
  });
});

describe("違反の記録（条文・点数・反則金）", () => {
  it("registers the expressway kinds with the article, points and 普通車 fine of 施行令 別表第二・第六", () => {
    expect(VIOLATIONS.xwCrossing).toMatchObject({ article: "道路交通法 第75条の5", points: 2, fine: 9000 });
    expect(VIOLATIONS.xwMergeObstruct).toMatchObject({
      article: "道路交通法 第75条の6第1項",
      points: 1,
      fine: 6000,
    });
    expect(VIOLATIONS.xwRampMethod).toMatchObject({ article: "道路交通法 第75条の7", points: 1, fine: 4000 });
    expect(VIOLATIONS.xwStopping).toMatchObject({
      article: "道路交通法 第75条の8第1項",
      points: 2,
      fine: 12000,
    });
    expect(VIOLATIONS.xwWrongWay).toMatchObject({ article: "道路交通法 第17条第4項", points: 2, fine: 9000 });
  });
});
