import { Vector3 } from "three";
import type { XwEntrance } from "../expressway/format";
import { routeSymbol } from "../game/roadNames";
import type { LocalFrame } from "../geo/frame";
import type { EntranceContent, SignName } from "../signs/board/content";
import { letterHeight } from "../signs/board/letters";
import { ENTRANCE_BEFORE } from "../signs/expresswaySignAssumptions";
import { GUIDE_POLE_KERB } from "../signs/mountAssumptions";
import { log, warn } from "../log";
import { isExpressway } from "./roadClass";
import { lanesFor, type GuidePlan } from "./guidePlan";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";

/**
 * 103-A 入口の方向 and 104 入口の予告 on the street before each 都市高速 entrance (G6): from the
 * entrances in meta.json (src/expressway/signPlan.ts: where each entrance ramp leaves the street,
 * its real name and the route it joins) and the street graph. Both stand on the left of the street
 * (別表第一「左側の路端」), on the road administrator's two posts (路側式); 103 at the ramp's mouth,
 * 104 ENTRANCE_BEFORE before it on the same street (別表第一 gives no distance: an assumption).
 * Where the ramp leaves across the street (its mouth on a street it meets square, S6 PR 7c: a ramp's
 * foot cut at the street's edge), they stand on the side that turns left into it, the 103-A's arrow
 * turned by the ramp's angle to that travel (S2 of the design's feet answer).
 *
 * The operator on the upper band is the fictional 「都市高速」 by its i18n key (the board schema
 * allows nothing else); the entrance's and the route's names are the real ones.
 */

const isStreet = (seg: Segment) => !isExpressway(seg.line);

/** The street the ramp leaves from must pass this close to its ground end. */
const STREET_REACH_M = 40;
/** m: a board this close to another post or a crossing is moved on (to the next distance). */
const CLEAR_OF_M = 6;
/**
 * A post this far before the board (along the travel, m) and this close across it hides the board
 * from the drivers coming (the plates on it stand between): the board moves on.
 */
const SIGHT_BEFORE_M = 25;
const SIGHT_ACROSS_M = 2.5;
/** The ramp's direction and the street's agree within this (cos): the traffic that turns in, not across. */
const ALIGNED = 0.3;
/** The 103-A's arrow at most this far off straight on (deg, content.ts ArrowAngle). */
const ARROW_MAX_DEG = 135;

/**
 * The 103-A's arrow for traffic heading `travel` into a ramp heading `up` (deg, + to the left as
 * junction.ts armVector draws it), rounded to 5°; 0 when the ramp goes straight on.
 */
export function entranceArrowDeg(travel: Vector3, up: Vector3): number {
  const left = leftOf(travel, 1);
  const deg = (Math.atan2(left.dot(up), travel.dot(up)) * 180) / Math.PI;
  const clamped = Math.max(-ARROW_MAX_DEG, Math.min(ARROW_MAX_DEG, deg));
  return Math.round(clamped / 5) * 5;
}

export function planEntranceBoards(
  graph: RoadGraph,
  entrances: readonly XwEntrance[],
  frame: LocalFrame,
  /**
   * Posts and crossings standing already: a board is not stood within CLEAR_OF_M of one, nor with
   * one in its drivers' line of sight (SIGHT_BEFORE_M before it, SIGHT_ACROSS_M across).
   */
  avoid: readonly Vector3[] = [],
): Array<GuidePlan<EntranceContent>> {
  const out: Array<GuidePlan<EntranceContent>> = [];
  for (const e of entrances) {
    const mouth = frame.toLocal(e.lat, e.lon, frame.origin.h).setY(0);
    const hit = graph.nearest(mouth, STREET_REACH_M, isStreet);
    if (!hit) {
      warn("entrance_board_unplaced", { run: e.run, kind: "103-A", reason: "no_street" });
      continue;
    }
    // The ramp's heading on the local frame (anticlockwise from east; local z is south).
    const up = new Vector3(Math.cos(e.heading), 0, -Math.sin(e.heading));
    const along = hit.dir.clone().setY(0).normalize();
    const isAligned = Math.abs(along.dot(up)) >= ALIGNED;
    // Across the street: the travel that turns left into the ramp (the left side, kept on in Japan).
    // Why not the right turn too: it crosses the oncoming lanes, and the 103-A stands on the left kerb
    // of the street it guides; a right-turning driver reads the one of the other side (none stands).
    const dirSign = isAligned ? (along.dot(up) >= 0 ? 1 : -1) : leftOf(along, 1).dot(up) >= 0 ? 1 : -1;
    const isAllowed = hit.seg.oneway === 0 || hit.seg.oneway === dirSign;
    if (!isAllowed) {
      warn("entrance_board_unplaced", { run: e.run, kind: "103-A", reason: "one_way" });
      continue;
    }
    const arrowDeg = isAligned ? 0 : entranceArrowDeg(along.clone().multiplyScalar(dirSign), up);
    const letter = letterHeight(Math.max(40, speedLimit(hit.seg)), lanesFor(hit.seg));
    const base = {
      operator: "guide.operator" as const,
      route: routeOf(e),
      entranceName: e.name
        ? ({ ja: e.name, en: e.nameEn ?? "", expressway: false } satisfies SignName)
        : null,
      names: e.routeName ? [{ ja: e.routeName, en: e.routeNameEn ?? "", expressway: false }] : [],
      letter,
    };
    // A board `before` m back from the mouth along the street, through the junctions behind it
    // (straight on: the most aligned street at each).
    const stand = (
      before: number,
      board: EntranceContent,
      keepSight: boolean,
    ): GuidePlan<EntranceContent> | null => {
      const there = walkBack(graph, hit.seg, hit.s, dirSign, before);
      if (!there) return null;
      const sample = graph.sample(there.seg, there.s);
      const heading = sample.dir.clone().setY(0).normalize().multiplyScalar(there.dir);
      const kerb = there.seg.line.width / 2 + GUIDE_POLE_KERB.value;
      const pos = sample.pos.clone().add(leftOf(heading, kerb)).setY(0);
      // In front of another post its plates would hide the board (review W3, round 1).
      const isBlocked = avoid.some((a) => {
        const dx = pos.x - a.x;
        const dz = pos.z - a.z;
        const ahead = dx * heading.x + dz * heading.z;
        const across = Math.abs(dx * heading.z - dz * heading.x);
        const isNear = Math.hypot(dx, dz) < CLEAR_OF_M;
        const isInSight = ahead > 0 && ahead < SIGHT_BEFORE_M && across < SIGHT_ACROSS_M;
        return isNear || (keepSight && isInSight);
      });
      if (isBlocked) return null;
      return {
        board,
        shape: "straight",
        pos,
        travel: heading,
        mount: "roadside",
        before,
        centre: mouth.clone(),
        seg: there.seg,
      };
    };
    // The first distance with the drivers' sight clear; failing all, the first clear of the posts
    // themselves (a street lined with posts: a plate may stand before the board, logged).
    const first = (distances: readonly number[], make: (d: number) => EntranceContent) => {
      for (const keepSight of [true, false])
        for (const d of distances) {
          const plan = stand(d, make(d), keepSight);
          if (!plan) continue;
          log("entrance_board_placed", {
            run: e.run,
            kind: plan.board.kind,
            before: d,
            sightClear: keepSight,
          });
          return plan;
        }
      return null;
    };
    const direction = first(ENTRANCE_BEFORE.value.direction, () => ({
      kind: "103-A",
      ...base,
      angle: arrowDeg,
      distance: null,
    }));
    if (direction) out.push(direction);
    else warn("entrance_board_unplaced", { run: e.run, kind: "103-A", reason: "street_ends" });
    const advance = first(ENTRANCE_BEFORE.value.advance, (d) => ({
      kind: "104",
      ...base,
      angle: null,
      distance: d,
    }));
    if (advance) out.push(advance);
    else
      warn("entrance_board_unplaced", {
        run: e.run,
        kind: "104",
        reason: `street_turns_or_ends: ${lastWalk}`,
      });
  }
  return out;
}

function routeOf(e: XwEntrance): EntranceContent["route"] {
  const symbol = routeSymbol(e.route);
  return symbol ? { kind: "route", number: symbol } : null;
}

/** Why the last walkBack stopped (for entrance_board_unplaced). */
let lastWalk = "";

/** Junctions the walk back crosses at most, and how straight on the street behind must go (cos). */
const WALK_SEGMENTS = 4;
const STRAIGHT_ON = 0.7;

/**
 * The point `distance` m back (against the travel `dir` along `seg`) from `s`: across the
 * junctions behind, each time onto the street that continues most straight, allowed this way.
 * Null when the street turns away or ends first.
 */
export function walkBack(
  graph: RoadGraph,
  seg: Segment,
  s: number,
  dir: 1 | -1,
  distance: number,
): { seg: Segment; s: number; dir: 1 | -1 } | null {
  let cur = { seg, s, dir };
  let left = distance;
  for (let k = 0; k < WALK_SEGMENTS; k++) {
    const room = cur.dir > 0 ? cur.s : cur.seg.length - cur.s;
    const isWithin = left <= room;
    if (isWithin) return { ...cur, s: cur.s - cur.dir * left };
    left -= room;
    const node = cur.dir > 0 ? cur.seg.from : cur.seg.to;
    const travel = graph
      .sample(cur.seg, cur.dir > 0 ? 0 : cur.seg.length)
      .dir.clone()
      .setY(0)
      .normalize()
      .multiplyScalar(cur.dir);
    let best: { seg: Segment; dir: 1 | -1; dot: number } | null = null;
    const dots: string[] = [];
    for (const id of graph.nodes.get(node) ?? []) {
      const next = graph.segments[id];
      if (next === cur.seg) continue;
      if (!isStreet(next)) {
        dots.push("xw");
        continue;
      }
      // Coming into `node` along `next`: forwards when it ends there.
      const nextDir: 1 | -1 = next.to === node ? 1 : -1;
      const isAllowed = next.oneway === 0 || next.oneway === nextDir;
      if (!isAllowed) {
        dots.push("oneway");
        continue;
      }
      const at = graph
        .sample(next, nextDir > 0 ? next.length : 0)
        .dir.clone()
        .setY(0)
        .normalize();
      const dot = at.multiplyScalar(nextDir).dot(travel);
      dots.push(dot.toFixed(2));
      const isBetter = dot >= STRAIGHT_ON && (!best || dot > best.dot);
      if (isBetter) best = { seg: next, dir: nextDir, dot };
    }
    if (!best) {
      lastWalk = `walked ${Math.round(distance - left)} m, ${k + 1} streets; behind: ${dots.join(" ") || "none"}`;
      return null;
    }
    cur = { seg: best.seg, s: best.dir > 0 ? best.seg.length : 0, dir: best.dir };
  }
  return null;
}
