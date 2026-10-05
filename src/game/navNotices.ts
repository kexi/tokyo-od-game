import { t } from "../i18n";
import { formatDistance } from "../i18n/format";
import { CLOSURE, type ClosureKind } from "../world/closures";
import { speedLimit, type Segment } from "../world/roads";
import {
  inForce,
  timeNote,
  type GameClock,
  type RuleTime,
  type Window as TimeWindow,
} from "../world/ruleTime";
import { distanceOn, travelOf, type AheadStep } from "./navAhead";
import type { ApproachLike } from "./navStraight";

/**
 * 安全運転支援 notices on the way ahead, as Japanese car navigation gives them: a closed street
 * (通学路の時間規制 and other 通行禁止 in force), a 速度取締機 within 500 m, a lower posted limit,
 * and 一時停止. The panel shows the most important one; NoticeVoice decides which to speak, never
 * over a turn call and not too often.
 *
 * Why the 速度取締機 is announced: car navigation and radar units sold in Japan announce fixed
 * speed cameras (「この先、速度取締機があります」), which is lawful, and the call here ends with the
 * limit in force, so it reminds the player of the law rather than of the camera.
 */
/**
 * "police": 緊急車両 approaching (the pursuit, pursuitDirector.ts), as the 緊急車両存在通知 of
 * connected cars says it — with the 第40条 advice to keep left and give way.
 */
export type NoticeKind = "closure" | "school" | "orbis" | "limit" | "stop" | "police";

export type Notice = {
  kind: NoticeKind;
  /** Same thing, same key (spoken once while it stays the same). */
  key: string;
  /** Metres ahead. */
  distance: number;
  /** The panel's line. */
  text: string;
  /** Said once, between voiceMin and voiceWithin metres ahead; null: shown only. */
  voice: string | null;
  voiceWithin: number;
  voiceMin: number;
  /** Not said below this speed (a stop line crept up to needs no call). */
  minSpeed: number;
  /** A key said this long ago may be said again (driving round the block). */
  repeatAfter: number;
  priority: number;
};

/** The parts of an OrbisSite the notices read. */
export type OrbisLike = { seg: Segment; s: number; dir: 1 | -1; entry: { id: number }; limit: number };

const ORBIS_RANGE = 500;
const LIMIT_RANGE = 200;
const CLOSURE_RANGE = 300;
const STOP_RANGE = 120;
const MIN_LIMIT_STRETCH = 25; // m: a shorter piece with another limit is a data gap, not a change

const isMorning = ([start, end]: TimeWindow) => start >= 360 && end <= 570 && start < end;
const isAfternoon = ([start, end]: TimeWindow) => start >= 840 && end <= 1080 && start < end;

/**
 * Whether a 歩行者用道路 closure is a school run: in force only in the morning (6:00–9:30) and
 * perhaps the afternoon (14:00–18:00). JARTIC does not say 通学路; the hours tell it from the
 * lunchtime and night 歩行者用道路 of the shopping streets (丸の内仲通り 12–13, 新宿 17–5).
 */
export function isSchoolRun(kind: ClosureKind, time: RuleTime): boolean {
  if (kind !== CLOSURE.pedestrianRoad) return false;
  return time.on.some(isMorning) && time.on.every((w) => isMorning(w) || isAfternoon(w));
}

/** The kinds of 通行禁止 in words (src/world/closures.ts CLOSURE_WORDS, in the language in force). */
const CLOSURE_KEY = {
  [CLOSURE.pedestrianRoad]: "closure.pedestrianRoad",
  [CLOSURE.all]: "closure.all",
  [CLOSURE.vehicles]: "closure.vehicles",
  [CLOSURE.motor]: "closure.motor",
} as const satisfies Record<ClosureKind, string>;

/** A closure's kind in words: 車両通行止め / No vehicles / 车辆禁止通行. */
export const closureWord = (kind: ClosureKind): string => t(CLOSURE_KEY[kind]);

/** The panel's line: what, its hours if any (「（7:30-8:30）」), and how far. */
const noticeLine = (label: string, hours: string, distance: number) =>
  hours
    ? t("notice.withHours", { label, hours, dist: formatDistance(distance) })
    : t("notice.plain", { label, dist: formatDistance(distance) });

/**
 * Notices along the way ahead. `limit` is the limit where the player is (null when unknown);
 * changes are only taken from posted limits (JARTIC 規制速度・区域), since the statutory one is an
 * estimate from the GSI width that flips along a street.
 */
export function collectNotices(
  steps: readonly AheadStep[],
  ctx: {
    limit: number | null;
    approaches: readonly ApproachLike[];
    orbis: readonly OrbisLike[];
    /** The moment the closures are judged at (seg.closed follows RoadGraph.setClock). */
    clock?: GameClock;
  },
): Notice[] {
  const notices: Notice[] = [];
  const bySeg = new Map<number, AheadStep[]>();
  for (const st of steps) bySeg.set(st.seg.id, [...(bySeg.get(st.seg.id) ?? []), st]);
  const ahead = (seg: Segment, dir: 1 | -1, x: number): number | null => {
    for (const st of bySeg.get(seg.id) ?? []) {
      if (st.dir !== dir) continue;
      const d = distanceOn(st, x);
      if (d !== null && d > 0) return d;
    }
    return null;
  };

  // A closed street on the way: the route was planned before the closure began, or no route.
  const closed = steps.find((st) => st.seg.closed && st.start > 0 && st.start <= CLOSURE_RANGE);
  const clock = ctx.clock;
  const closure = closed?.seg.closures.find((c) => !clock || inForce(c.time, clock));
  if (closed && closure) {
    const hours =
      timeNote(closure.time)
        ?.split("\n")
        .find((line) => /\d/.test(line)) ?? "";
    const isSchool = isSchoolRun(closure.kind, closure.time);
    const isPedestrian = closure.kind === CLOSURE.pedestrianRoad;
    const what = closureWord(closure.kind);
    const label = isSchool
      ? t("notice.school")
      : isPedestrian
        ? t("notice.pedestrianRoad")
        : t("notice.closedAhead", { what });
    notices.push({
      kind: isSchool ? "school" : "closure",
      key: `closure:${closed.seg.id}`,
      distance: closed.start,
      text: noticeLine(label, hours, closed.start),
      voice: isSchool
        ? t("notice.schoolSay")
        : isPedestrian
          ? t("notice.pedestrianSay")
          : t("notice.closedSay", { what }),
      voiceWithin: CLOSURE_RANGE,
      voiceMin: 20,
      minSpeed: 0,
      repeatAfter: 120_000,
      priority: 5,
    });
  }

  for (const site of ctx.orbis) {
    const d = ahead(site.seg, site.dir, travelOf(site.seg, site.dir, site.s));
    if (d === null || d > ORBIS_RANGE) continue;
    notices.push({
      kind: "orbis",
      key: `orbis:${site.entry.id}:${site.dir}`,
      distance: d,
      text: t("notice.orbis", { dist: formatDistance(d) }),
      voice: t("notice.orbisSay", { limit: site.limit }),
      voiceWithin: ORBIS_RANGE,
      voiceMin: 50,
      minSpeed: 0,
      repeatAfter: 300_000,
      priority: 4,
    });
  }

  // The first stretch further on with another posted limit.
  const change = steps.find((st) => {
    const isAhead = st.start > 0 && st.start <= LIMIT_RANGE;
    const isPosted = st.seg.limitKind !== "statutory" && st.seg.limit !== null;
    return isAhead && isPosted && st.seg.length >= MIN_LIMIT_STRETCH && speedLimit(st.seg) !== ctx.limit;
  });
  if (change && ctx.limit !== null) {
    const value = speedLimit(change.seg);
    const isLower = value < ctx.limit;
    const isZone = change.seg.limitKind === "zone";
    notices.push({
      kind: "limit",
      key: `limit:${value}`,
      distance: change.start,
      text: t(isZone ? "notice.zone" : "notice.section", {
        limit: value,
        dist: formatDistance(change.start),
      }),
      voice: isLower ? t(isZone ? "notice.zoneSay" : "notice.sectionSay", { limit: value }) : null,
      voiceWithin: 150,
      voiceMin: 10,
      minSpeed: 0,
      repeatAfter: 90_000,
      priority: isLower ? 3 : 1,
    });
  }

  let stop: Notice | null = null;
  for (const ap of ctx.approaches) {
    if (ap.kind !== "stop") continue;
    const d = ahead(ap.seg, ap.dir, ap.at);
    if (d === null || d > STOP_RANGE || (stop && d >= stop.distance)) continue;
    stop = {
      kind: "stop",
      key: `stop:${ap.seg.id}:${ap.dir}`,
      distance: d,
      text: t("notice.stop", { dist: formatDistance(d) }),
      voice: t("notice.stopSay"),
      voiceWithin: 80,
      voiceMin: 15,
      minSpeed: 15,
      repeatAfter: 60_000,
      priority: 2,
    };
  }
  if (stop) notices.push(stop);
  return notices;
}

/** The emergency-vehicle notice: always first, said again every half minute while it lasts. */
export function emergencyNotice(alert: { text: string; voice: string }): Notice {
  return {
    kind: "police",
    key: "police:emergency",
    distance: 0,
    text: alert.text,
    voice: alert.voice,
    voiceWithin: 1,
    voiceMin: 0,
    minSpeed: 0,
    repeatAfter: 30_000,
    priority: 9,
  };
}

/** The notice the panel shows: the most important, then the nearest. */
export function shownNotice(notices: readonly Notice[]): Notice | null {
  let best: Notice | null = null;
  for (const n of notices) {
    const isBetter =
      !best || n.priority > best.priority || (n.priority === best.priority && n.distance < best.distance);
    if (isBetter) best = n;
  }
  return best;
}

/**
 * Which notice to say, and when. A notice is said once (again only after its repeatAfter), within
 * its distances, and only when the voice is free: nothing is being said, no turn call was made in
 * the last 5 s or is about to be made, and no other notice was said in the last 8 s.
 */
export class NoticeVoice {
  /** Key → when it was said and when it may be said again. */
  private readonly said = new Map<string, { at: number; repeat: number }>();
  private lastAt = -Infinity;

  constructor(
    private readonly gapMs = 8000,
    private readonly afterGuidanceMs = 5000,
  ) {}

  pick(
    notices: readonly Notice[],
    o: { now: number; speaking: boolean; lastGuidanceAt: number; guidanceDue: boolean; speedKmh: number },
  ): Notice | null {
    for (const [key, s] of this.said) if (o.now - s.at > s.repeat) this.said.delete(key);
    const isBusy =
      o.speaking ||
      o.guidanceDue ||
      o.now - o.lastGuidanceAt < this.afterGuidanceMs ||
      o.now - this.lastAt < this.gapMs;
    if (isBusy) return null;
    let best: Notice | null = null;
    for (const n of notices) {
      const isDue =
        n.voice !== null &&
        !this.said.has(n.key) &&
        n.distance <= n.voiceWithin &&
        n.distance >= n.voiceMin &&
        o.speedKmh >= n.minSpeed;
      if (!isDue) continue;
      const isBetter =
        !best || n.priority > best.priority || (n.priority === best.priority && n.distance < best.distance);
      if (isBetter) best = n;
    }
    if (!best) return null;
    this.said.set(best.key, { at: o.now, repeat: best.repeatAfter });
    this.lastAt = o.now;
    return best;
  }

  /** A new target or route: everything may be said again. */
  reset(): void {
    this.said.clear();
  }
}
