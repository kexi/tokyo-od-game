import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n";
import { SocialFeed, stopPostChance } from "../src/game/social";
import { REPLIES } from "../src/game/socialTexts";
import { lawRef, violationName } from "../src/i18n/law";
import { PANEL_MS, storyPanels, StoryPlayer, type StoryFacts } from "../src/game/arrestStory";
import {
  calloutKey,
  ESCAPE_HOLD_S,
  GRACE_S,
  isCaught,
  isEnforcing,
  isFleeing,
  PursuitEscalation,
  STAGE_AT,
  stageAt,
  stopKind,
  type PursuitEvent,
  type PursuitInput,
} from "../src/game/pursuitEscalation";
import {
  ChaseConduct,
  chaseInjuryCharge,
  dangerousSpeedOver,
  decideDisposal,
  fledRecords,
  isDeliberateRam,
  isDrivingAtOfficer,
  laterDisposal,
  RECKLESS_SECONDS,
} from "../src/game/pursuitLaw";
import {
  afterChoice,
  arrivalPhase,
  dialogueSteps,
  guideSteps,
  judgePullOver,
  politeAtWindow,
  pullOverRemark,
  SHOT_PATROL_S,
  type StopSite,
} from "../src/game/trafficStop";
import {
  dangerousInjuryViolation,
  speedViolation,
  TrafficLaw,
  VIOLATIONS,
  type Violation,
  type ViolationRecord,
} from "../src/game/traffic";

const record = (v: Violation, at = 0): ViolationRecord => ({ ...v, at, status: "uncaught" });
const SAFE: StopSite = {
  junction: false,
  crossing: false,
  noStopping: false,
  kerbGap: 0.4,
  rightLane: false,
};

afterEach(() => setLocale("ja"));

describe("pull-over judgement (trafficStop.ts)", () => {
  it("calls a prompt, signalled stop at the kerb with hazards safe and fully courteous", () => {
    const v = judgePullOver({
      site: SAFE,
      signalled: true,
      hazards: true,
      secondsToStop: 9,
      end: "pulledOver",
      assist: "real",
    });
    expect(v).toMatchObject({ safe: true, issues: [], prompt: true, courtesy: 3 });
    expect(pullOverRemark(v, false)).toBe("stop.remark.perfect");
    expect(politeAtWindow(v, true, false)).toBe(true);
    expect(politeAtWindow(v, false, false)).toBe(false);
  });

  it("names the place the law forbids stopping in (第44条) before anything else", () => {
    const base = {
      signalled: true,
      hazards: true,
      secondsToStop: 5,
      end: "pulledOver" as const,
      assist: "easy" as const,
    };
    const junction = judgePullOver({ ...base, site: { ...SAFE, junction: true } });
    expect(junction.safe).toBe(false);
    expect(pullOverRemark(junction, false)).toBe("stop.remark.junction");
    const crossing = judgePullOver({ ...base, site: { ...SAFE, crossing: true, kerbGap: 3 } });
    expect(crossing.issues).toEqual(["crossing", "notAtKerb"]);
    expect(pullOverRemark(crossing, false)).toBe("stop.remark.crossing");
    const posted = judgePullOver({ ...base, site: { ...SAFE, noStopping: true } });
    expect(pullOverRemark(posted, false)).toBe("stop.remark.noStopping");
    const right = judgePullOver({ ...base, site: { ...SAFE, kerbGap: 4, rightLane: true } });
    expect(right.issues).toEqual(["rightLane"]);
  });

  it("asks for the kerb and the signal kindly when those are missing", () => {
    const wide = judgePullOver({
      site: { ...SAFE, kerbGap: 2.5 },
      signalled: true,
      hazards: false,
      secondsToStop: 8,
      end: "pulledOver",
      assist: "real",
    });
    expect(pullOverRemark(wide, false)).toBe("stop.remark.notAtKerb");
    const unsignalled = judgePullOver({
      site: SAFE,
      signalled: false,
      hazards: true,
      secondsToStop: 8,
      end: "pulledOver",
      assist: "real",
    });
    expect(pullOverRemark(unsignalled, false)).toBe("stop.remark.noSignal");
  });

  it("is never prompt, nor polite, after fleeing, and the officer says so", () => {
    const v = judgePullOver({
      site: SAFE,
      signalled: true,
      hazards: true,
      secondsToStop: 40,
      end: "gaveUp",
      assist: "real",
    });
    expect(v.prompt).toBe(false);
    expect(pullOverRemark(v, true)).toBe("stop.remark.fled");
    expect(politeAtWindow(v, true, true)).toBe(false);
  });

  it("lets 簡単操作 do the signal and the hazards (and says so on the guide)", () => {
    const easy = guideSteps({
      assist: "easy",
      signalling: false,
      atKerb: false,
      safePlace: true,
      stopped: false,
      hazards: false,
    });
    expect(easy.filter((s) => s.auto).map((s) => s.key)).toEqual(["stop.guide.signal", "stop.guide.hazards"]);
    const real = guideSteps({
      assist: "real",
      signalling: true,
      atKerb: true,
      safePlace: true,
      stopped: true,
      hazards: true,
    });
    expect(real.every((s) => s.done && !s.auto)).toBe(true);
  });
});

/** Feeds the escalation `seconds` of the same frame, 10 per second; returns every event. */
function run(esc: PursuitEscalation, seconds: number, frame: Partial<PursuitInput>): PursuitEvent[] {
  const events: PursuitEvent[] = [];
  const input: PursuitInput = {
    dt: 0.1,
    speedKmh: 40,
    throttle: 0.6,
    nearestUnit: 40,
    unitsClose: 0,
    heliSees: false,
    atCheckpoint: false,
    sinceCrash: Infinity,
    ...frame,
  };
  for (let i = 0; i < Math.round(seconds * 10); i++) events.push(...esc.update(input));
  return events;
}

describe("escalation timing (pursuitEscalation.ts)", () => {
  it("counts going on after the grace as fleeing, and slowing down as pulling over", () => {
    expect(isFleeing(GRACE_S - 1, 60, 30)).toBe(false);
    expect(isFleeing(GRACE_S, 40, 30)).toBe(true);
    expect(isFleeing(GRACE_S, 15, 30)).toBe(false);
    expect(isFleeing(GRACE_S * 2, 10, 30)).toBe(true);
    expect(isFleeing(3, 20, 130)).toBe(true);
  });

  it("brings 緊急配備 at 30 s and the helicopter and 検問 at 60 s of not stopping", () => {
    const esc = new PursuitEscalation();
    const events = run(esc, 65, {});
    const order = events.map((e) => (e.type === "stage" ? `stage${e.stage}` : e.type));
    expect(order).toEqual(["fleeing", "stage2", "stage3"]);
    expect(stageAt(STAGE_AT[2] - 0.1)).toBe(1);
    expect(stageAt(STAGE_AT[2])).toBe(2);
    expect(stageAt(STAGE_AT[3])).toBe(3);
  });

  it("never escalates a driver who is pulling over", () => {
    const esc = new PursuitEscalation();
    const events = run(esc, 10, { speedKmh: 12, nearestUnit: 30 });
    expect(events).toEqual([]);
    expect(esc.stage).toBe(1);
  });

  it("ends as pulled over once the car stands near the unit long enough, before fleeing", () => {
    const esc = new PursuitEscalation();
    run(esc, 4, { speedKmh: 20 });
    const events = run(esc, 3, { speedKmh: 0, nearestUnit: 10, throttle: 0 });
    expect(events).toContainEqual({ type: "end", end: "pulledOver" });
    expect(esc.fleeing).toBe(false);
  });

  it("tells giving up, being boxed in, a crash and the 検問 apart", () => {
    const base = { fleeing: true, atCheckpoint: false, sinceCrash: Infinity, pushed: false, unitsClose: 2 };
    expect(stopKind(base)).toBe("gaveUp");
    expect(stopKind({ ...base, pushed: true })).toBe("boxedIn");
    expect(stopKind({ ...base, sinceCrash: 2 })).toBe("crashed");
    expect(stopKind({ ...base, atCheckpoint: true })).toBe("checkpoint");
    expect(stopKind({ ...base, fleeing: false, pushed: true })).toBe("pulledOver");
    expect(["boxedIn", "crashed", "checkpoint"].every((e) => isCaught(e as never))).toBe(true);
    expect(isCaught("gaveUp")).toBe(false);
  });

  it("sees the accelerator pressed against the units as boxed in", () => {
    const esc = new PursuitEscalation();
    run(esc, 15, {});
    const events = run(esc, 3, { speedKmh: 0, nearestUnit: 6, unitsClose: 2, throttle: 1 });
    expect(events).toContainEqual({ type: "end", end: "boxedIn" });
  });

  it("lets one car lose the driver at once, but holds the area for a while from stage 2", () => {
    const one = new PursuitEscalation();
    expect(run(one, 0.1, { nearestUnit: 500 })).toContainEqual({ type: "end", end: "escaped" });
    const covered = new PursuitEscalation();
    run(covered, 31, {});
    expect(covered.stage).toBe(2);
    expect(run(covered, ESCAPE_HOLD_S[2] - 1, { nearestUnit: 600 })).not.toContainEqual({
      type: "end",
      end: "escaped",
    });
    expect(run(covered, 2, { nearestUnit: 600 })).toContainEqual({ type: "end", end: "escaped" });
  });

  it("keeps the car while the helicopter sees it, however far the cars are", () => {
    const esc = new PursuitEscalation();
    run(esc, 61, {});
    expect(esc.stage).toBe(3);
    expect(run(esc, 120, { nearestUnit: 900, heliSees: true })).toEqual([]);
  });

  it("calls politely, then firmly, then to the other traffic", () => {
    expect(calloutKey(0, false, 1)).toBe("police.callStop");
    expect(calloutKey(1, false, 1)).toBe("police.callStopShort");
    expect(calloutKey(2, true, 1)).toBe("police.callStopFirm");
    expect(calloutKey(3, true, 2)).toBe("police.callTraffic");
    expect(calloutKey(4, true, 3)).toBe("police.callStopDanger");
  });
});

describe("outcome by offence (pursuitLaw.ts)", () => {
  const signal = record(VIOLATIONS.signal);
  const belt = record(VIOLATIONS.seatBelt);
  const fast = record(speedViolation(35) ?? VIOLATIONS.signal);

  it("gives a blue ticket for 反則行為 stopped for, a red one outside the 反則 system or after fleeing", () => {
    expect(decideDisposal({ records: [signal, belt], fled: false, caught: false })).toBe("blue");
    expect(decideDisposal({ records: [fast], fled: false, caught: false })).toBe("red");
    expect(decideDisposal({ records: [signal], fled: true, caught: false })).toBe("red");
  });

  it("never makes points-only records (座席ベルト) criminal, fled or not", () => {
    expect(decideDisposal({ records: [belt], fled: true, caught: true })).toBe("blue");
  });

  it("takes a suspended driver to the station, and arrests for the grave charges and a caught fleer", () => {
    expect(decideDisposal({ records: [record(VIOLATIONS.unlicensed)], fled: false, caught: false })).toBe(
      "voluntary",
    );
    for (const v of [
      VIOLATIONS.hitAndRun,
      VIOLATIONS.obstruction,
      VIOLATIONS.ignoredStop,
      VIOLATIONS.dangerousInjury,
    ])
      expect(decideDisposal({ records: [record(v)], fled: false, caught: false }), v.kind).toBe("arrest");
    expect(decideDisposal({ records: [signal], fled: true, caught: true })).toBe("arrest");
  });

  it("after a getaway: a warrant for the grave cases, a request to appear for the rest", () => {
    expect(laterDisposal([signal, fast])).toBe("laterVisit");
    expect(laterDisposal([record(VIOLATIONS.unlicensed)])).toBe("laterArrest");
    expect(laterDisposal([record(VIOLATIONS.obstruction)])).toBe("laterArrest");
  });

  it("takes the 反則金 off the fled 反則行為 only (第126条第1項第2号・第130条第1号)", () => {
    expect(fledRecords([signal, belt, fast])).toEqual([signal]);
    const law = new TrafficLaw();
    const r = law.commit(VIOLATIONS.signal, 0);
    if (!r) throw new Error("no record");
    law.cite(r, "patrol");
    expect(law.state.fines).toBe(9000);
    expect(law.toCriminal(r, "procedure.fled")).toBe(true);
    expect(r.fine).toBeNull();
    expect(law.state.fines).toBe(0);
    expect(law.state.points).toBe(2);
    expect(law.toCriminal(r, "procedure.fled")).toBe(false);
  });

  it("judges injuries in a chase by 自動車運転死傷処罰法: 第4条's numbers, a red run 殊更に, else 第5条", () => {
    expect(dangerousSpeedOver(40)).toBe(50);
    expect(dangerousSpeedOver(60)).toBe(50);
    expect(dangerousSpeedOver(80)).toBe(60);
    expect(chaseInjuryCharge({ fleeing: true, kmh: 90, limit: 40, redRunAgoMs: null })).toEqual({
      kind: "dangerous",
      item: 4,
    });
    expect(chaseInjuryCharge({ fleeing: true, kmh: 89, limit: 40, redRunAgoMs: null })).toEqual({
      kind: "negligent",
    });
    expect(chaseInjuryCharge({ fleeing: true, kmh: 139, limit: 80, redRunAgoMs: null }).kind).toBe(
      "negligent",
    );
    expect(chaseInjuryCharge({ fleeing: true, kmh: 25, limit: 40, redRunAgoMs: 3000 })).toEqual({
      kind: "dangerous",
      item: 10,
    });
    // Not fleeing, too slow, or the red was long before: not the 殊更に of 第10号.
    expect(chaseInjuryCharge({ fleeing: false, kmh: 25, limit: 40, redRunAgoMs: 3000 }).kind).toBe(
      "negligent",
    );
    expect(chaseInjuryCharge({ fleeing: true, kmh: 15, limit: 40, redRunAgoMs: 3000 }).kind).toBe(
      "negligent",
    );
    expect(chaseInjuryCharge({ fleeing: true, kmh: 25, limit: 40, redRunAgoMs: 9000 }).kind).toBe(
      "negligent",
    );
  });

  it("scores 危険運転致傷 with the 特定違反行為 points and takes the accident's into it", () => {
    expect(dangerousInjuryViolation(4, 3).points).toBe(45);
    expect(dangerousInjuryViolation(10, 6).points).toBe(48);
    expect(dangerousInjuryViolation(4, 9).points).toBe(51);
    expect(dangerousInjuryViolation(4, 13)).toMatchObject({
      points: 55,
      article: "自動車運転死傷処罰法 第2条第4号",
    });
    const law = new TrafficLaw();
    const careless = law.book(VIOLATIONS.safeDriving, 0);
    const injury = law.book(VIOLATIONS.injury, 0);
    const danger = law.commit(dangerousInjuryViolation(10, 3), 0);
    if (!careless || !injury || !danger) throw new Error("no record");
    expect(law.state.points).toBe(5);
    law.absorb([careless, injury], danger);
    law.cite(danger, "patrol");
    expect(law.state.points).toBe(45);
    expect(careless.absorbedBy).toBe(danger.id);
  });

  it("charges ramming a unit only when it was plainly on purpose", () => {
    const at = { engaged: true, playerKmh: 35, unitKmh: 0, angleDeg: 10, throttle: 0.9, earlierHits: 0 };
    expect(isDeliberateRam(at)).toBe(true);
    expect(isDeliberateRam({ ...at, engaged: false })).toBe(false);
    expect(isDeliberateRam({ ...at, throttle: 0.1 })).toBe(false);
    expect(isDeliberateRam({ ...at, angleDeg: 60 })).toBe(false);
    // The unit ran into the player: closing slower than it.
    expect(isDeliberateRam({ ...at, unitKmh: 40 })).toBe(false);
    expect(isDeliberateRam({ ...at, playerKmh: 12, throttle: 0.4, angleDeg: 40, earlierHits: 1 })).toBe(true);
    expect(isDrivingAtOfficer({ engaged: true, kmh: 40, headingDot: 0.97, distance: 2 })).toBe(true);
    expect(isDrivingAtOfficer({ engaged: true, kmh: 40, headingDot: 0.6, distance: 2 })).toBe(false);
    expect(isDrivingAtOfficer({ engaged: true, kmh: 15, headingDot: 0.99, distance: 1 })).toBe(false);
  });

  it("adds 安全運転義務違反 once for sustained reckless driving or dangerous violations one after another", () => {
    const speeding = new ChaseConduct();
    for (let i = 0; i < RECKLESS_SECONDS * 10 - 1; i++)
      speeding.observe(0.1, { fleeing: true, kmh: 75, limit: 40, othersNear: 2 });
    expect(speeding.take()).toBe(false);
    speeding.observe(0.2, { fleeing: true, kmh: 75, limit: 40, othersNear: 2 });
    expect(speeding.take()).toBe(true);
    expect(speeding.take()).toBe(false);
    const alone = new ChaseConduct();
    for (let i = 0; i < 200; i++) alone.observe(0.1, { fleeing: true, kmh: 75, limit: 40, othersNear: 0 });
    expect(alone.take()).toBe(false);
    for (const k of ["signal", "keepLeft", "noEntry"] as const) alone.onViolation(k, true);
    expect(alone.take()).toBe(true);
  });
});

const facts = (more: Partial<StoryFacts> = {}): StoryFacts => ({
  grave: false,
  stage: 0,
  hitAndRun: false,
  posted: false,
  sanction: { kind: "none" },
  ...more,
});

describe("story panels (arrestStory.ts)", () => {
  it("tells a red ticket as the patrol car, the ticket, the court, the fine and the points", () => {
    expect(storyPanels("redSummons", facts()).map((p) => p.art)).toEqual([
      "patrolSeat",
      "redTicket",
      "court",
      "fine",
      "licence",
    ]);
  });

  it("keeps a grave arrest in custody and a lighter one released, the news only for a real case", () => {
    const grave = storyPanels("arrest", facts({ grave: true, stage: 3, posted: true }));
    expect(grave.map((p) => p.art)).toEqual([
      "arrested",
      "patrolSeat",
      "station",
      "interview",
      "transfer",
      "detention",
      "tvNews",
      "yFeed",
      "licence",
    ]);
    const light = storyPanels("arrest", facts({ stage: 1 })).map((p) => p.art);
    expect(light).toContain("release");
    expect(light).not.toContain("detention");
    expect(light).not.toContain("tvNews");
  });

  it("follows a getaway with the identification, and the trend only when it was posted", () => {
    expect(storyPanels("laterVisit", facts({ posted: true })).map((p) => p.caption)).toContain(
      "story.later.trend",
    );
    expect(storyPanels("laterVisit", facts()).map((p) => p.caption)).not.toContain("story.later.trend");
    expect(
      storyPanels("laterArrest", facts({ grave: true }))
        .map((p) => p.art)
        .slice(0, 3),
    ).toEqual(["plate", "warrant", "home"]);
  });

  it("ends every story on what the points come to", () => {
    for (const kind of ["redSummons", "voluntary", "arrest", "laterVisit", "laterArrest"] as const) {
      const last = storyPanels(kind, facts({ sanction: { kind: "revocation", years: 1 } })).at(-1);
      expect(last?.caption, kind).toBe("story.end.revocation");
    }
  });

  it("steps through the panels with dt, so a frame that does not run (pause, replay) holds it", () => {
    const player = new StoryPlayer(storyPanels("redSummons", facts()));
    expect(player.update(0)).toBeNull();
    expect(player.update(PANEL_MS / 1000 - 0.01)).toBeNull();
    expect(player.index).toBe(0);
    expect(player.update(0.02)).toBe("panel");
    expect(player.index).toBe(1);
    expect(player.next()).toBe("panel");
    expect(player.index).toBe(2);
  });

  it("skips to the end once, and reports done once", () => {
    const player = new StoryPlayer(storyPanels("arrest", facts()));
    expect(player.skip()).toBe("done");
    expect(player.done).toBe(true);
    expect(player.skip()).toBeNull();
    expect(player.next()).toBeNull();
    expect(player.update(100)).toBeNull();
    const short = new StoryPlayer(storyPanels("redSummons", facts()));
    const events: string[] = [];
    for (let i = 0; i < 100; i++) {
      const e = short.update(1);
      if (e) events.push(e);
    }
    expect(events.filter((e) => e === "done")).toHaveLength(1);
  });
});

describe("the roadside conversation (trafficStop.ts)", () => {
  it("asks a blue-ticket driver to confirm and sends them off; an arrest has nothing to argue", () => {
    const blue = dialogueSteps({ disposal: "blue", hasClip: true, unlicensed: false }).map((s) => s.id);
    expect(blue).toEqual(["knock", "licence", "offence", "confirm", "dispose", "farewell"]);
    const arrest = dialogueSteps({ disposal: "arrest", hasClip: false, unlicensed: false });
    expect(arrest.map((s) => s.id)).toEqual(["knock", "licence", "offence", "dispose"]);
    expect(arrest[2]?.choices).toEqual(["seen"]);
    expect(dialogueSteps({ disposal: "voluntary", hasClip: false, unlicensed: true })[2]?.line).toBe(
      "stop.line.offenceUnlicensed",
    );
  });

  it("offers the moment's replay when there is one", () => {
    expect(dialogueSteps({ disposal: "red", hasClip: true, unlicensed: false })[2]?.choices).toEqual([
      "watch",
      "seen",
    ]);
  });

  it("hears an objection once, then goes on", () => {
    const steps = dialogueSteps({ disposal: "blue", hasClip: false, unlicensed: false });
    const confirm = steps.findIndex((s) => s.id === "confirm");
    const first = afterChoice(steps, confirm, "disagree");
    expect(first.steps[first.at]?.id).toBe("objection");
    const again = afterChoice(first.steps, first.at, "understood");
    expect(again.steps[again.at]?.id).toBe("dispose");
    expect(
      afterChoice(again.steps, confirm, "disagree").steps.filter((s) => s.id === "objection"),
    ).toHaveLength(1);
  });

  it("shows the patrol car first, then the officer walking up", () => {
    expect(arrivalPhase(0)).toBe("patrolShot");
    expect(arrivalPhase(SHOT_PATROL_S + 0.5)).toBe("walk");
    expect(arrivalPhase(60)).toBe("window");
  });
});

describe("while the police deal with the player (isEnforcing)", () => {
  const idle = {
    unitEngaged: false,
    pursuitBusy: false,
    ticketOpen: false,
    arrestShown: false,
    hitAndRunChase: false,
  };

  it("blocks 移動, 復帰 and the rest for every phase, and nothing otherwise", () => {
    expect(isEnforcing(idle)).toBe(false);
    for (const key of Object.keys(idle) as Array<keyof typeof idle>)
      expect(isEnforcing({ ...idle, [key]: true }), key).toBe(true);
  });
});

describe("the charges in other languages", () => {
  it("translates the new charges and their articles without leaving Japanese", () => {
    const kana = /[\p{sc=Hiragana}\p{sc=Katakana}]/u;
    for (const locale of ["en", "zh"] as const) {
      setLocale(locale);
      for (const v of [
        VIOLATIONS.negligentInjury,
        VIOLATIONS.obstruction,
        VIOLATIONS.propertyDamage,
        dangerousInjuryViolation(10, 9),
      ]) {
        expect(violationName(v.label), `${locale} ${v.label}`).not.toBe(v.label);
        expect(lawRef(v.article), `${locale} ${v.article}`).not.toMatch(kana);
      }
    }
    setLocale("en");
    expect(lawRef("刑法 第95条第1項")).toBe("Penal Code Art. 95(1)");
    expect(lawRef(VIOLATIONS.ignoredStop.article)).toBe("Road Traffic Act Art. 67(1), Art. 119(1)(xiii)");
  });
});

/** A moment of a roadside stop (where and when), as main makes it for Y. */
const moment = (): ViolationRecord => ({
  ...VIOLATIONS.ignoredStop,
  label: "警察官に止められている",
  at: 0,
  status: "caught",
  context: {
    clock: "10/5(月) 11:30",
    place: "千代田区 丸の内二丁目",
    lat: 35.68,
    lon: 139.76,
    kmh: 0,
    limit: 40,
    limitKind: "sign",
  },
});

describe("Y while the police deal with the car at the roadside (SocialFeed.postStop)", () => {
  it("posts an arrest more readily than a ticket, half as readily at night, never with nobody about", () => {
    expect(stopPostChance("arrest", 8, false)).toBeGreaterThan(stopPostChance("red", 8, false));
    expect(stopPostChance("red", 8, false)).toBeGreaterThan(stopPostChance("ticket", 8, false));
    expect(stopPostChance("ticket", 8, true)).toBeCloseTo(stopPostChance("ticket", 8, false) / 2);
    expect(stopPostChance("arrest", 1, false)).toBeLessThan(stopPostChance("arrest", 4, false));
    expect(stopPostChance("arrest", 0, false)).toBe(0);
  });

  it("writes every moment with its slots filled, and the replies about a stop, not a violation", () => {
    const feed = new SocialFeed();
    const t0 = Date.UTC(2026, 9, 5, 2);
    for (const phase of ["stopped", "stoppedBike", "ticket", "red", "arrest", "fledCaught"] as const)
      for (let i = 0; i < 30; i++) feed.postStop(phase, moment(), 10, t0, false);
    expect(feed.posts.length).toBeGreaterThan(30);
    feed.update(t0 + 400 * 60_000);
    const replies = new Set(
      [...REPLIES.pulledOver, ...REPLIES.common].map((l) => (typeof l === "string" ? l : l.text)),
    );
    for (const p of feed.posts) {
      expect(p.topic).toBe("stop");
      expect(p.text).not.toMatch(/\{\w+\}/);
      for (const r of p.replies)
        if (r.replyTo === undefined) expect(replies.has(r.phrase.parts[0] ?? "")).toBe(true);
    }
  });
});
