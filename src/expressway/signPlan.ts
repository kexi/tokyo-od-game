import { facilityName, facilityNameEn, routeName, routeSymbolOf } from "../game/roadNames";
import type { BoardContent, SignName } from "../signs/board/content";
import {
  BOARD_BEFORE,
  EXPRESSWAY_LETTER,
  NOSE_AFTER,
  PICTOGRAM_SCALE,
  SIGN_SPACING,
  SPEED_SIGN_SHIFT,
  PHONE_SPACING,
} from "../signs/expresswaySignAssumptions";
import { STATUTORY_SPEED } from "../signs/expresswaySignStandards";
import { PICTOGRAMS } from "../signs/board/expressway";
import type { RunFeatures } from "./compile";
import type { XwChunk, XwEntrance, XwRunSummary, XwSign } from "./format";
import { haversine, planeAt, roundTo } from "./geo";
import type { Network } from "./network";
import { frameAt } from "./profile";
import type { Measure } from "../signs/board/boxes";
import { layoutBoard } from "../signs/board/layout";
import { boardSizeM, deckMount } from "../signs/deckMount";
import { resolveMount } from "../signs/mount";
import { PARAPET_WIDTH } from "./assumptions";
import { carriagewayWidth } from "./section";
import { STATION_STRIDE } from "./format";
import { deckLevelAt, nearestOnChunk } from "./deckLevel";

/**
 * The sign planner of the 都市高速 (G6 = knowledge/road-redesign-plan.md 4.8, sign-signal-plan.md 3
 * 設置規則): from the compiled runs, the OSM junction nodes (出入口・JCT 名, 出口番号), the posted
 * speeds and the emergency phones, where each sign stands (run distance, deck height, side, mount)
 * and what it says. Build time, pure: scripts/expressway.ts writes the result into the chunks
 * (`XwChunk.signs`) and meta.json (`entrances`), the game only reads it (src/world/expresswaySigns.ts).
 *
 * The rules (別表第一 設置場所, distances in BOARD_BEFORE inside the ranges):
 * - Each exit (a ramp leaving a main line): 110-B 100〜600 m before it, 111-B 100〜500 m over the
 *   exit's lane, 112-B within 300 m over the carriageway (hung on the girder of a deck overhead when
 *   there is one), 113-A/B at the nose on the ramp's 壁高欄 facing the main line.
 * - Each JCT (a main line leaving another): 108の2-C within 300 m.
 * - 323 最高速度 where the posted speed changes (postedOf: maxspeed, a missing tag carrying the
 *   value before it, 60 at a run's start, 施行令 第11条第1号); 325 自動車専用 at each entrance ramp.
 * - 116の4 非常電話 at each emergency=phone node beside a deck, 116の6 非常駐車帯 at each
 *   emergency_bay (none in OSM around the test section).
 * Overhead boards never stand under a deck above (that would pierce it), except 112-B on its girder.
 * Two signs of a run are SIGN_SPACING apart at least. A sign that finds no place is reported, not
 * forced (`unplaced`).
 */

export type SignPoint = { id: number; lon: number; lat: number };

export type SignPlanInput = {
  chunks: readonly XwChunk[];
  runs: readonly XwRunSummary[];
  features: Readonly<Record<string, RunFeatures>>;
  net: Pick<Network, "nodes" | "ways">;
  phones: readonly SignPoint[];
  bays: readonly SignPoint[];
};

export type Unplaced = { run: string; id: string; reason: string };

export type SignPlan = {
  /** Signs by chunk id, in run-distance order. */
  signs: Map<string, XwSign[]>;
  entrances: XwEntrance[];
  unplaced: Unplaced[];
  /** The posted speed (km/h) of every chunk: the 323 plates' value and the graph's limit. */
  posted: Map<string, number>;
};

/** A motorway_junction named as an entrance (「…入口」). */
const isEntranceName = (n: string | null) => n !== null && n.endsWith("入口");

/** A phone or bay this far from a deck's centre line at most is beside it (half a deck and a bit). */
const BESIDE_DECK_M = 12;

type Run = { summary: XwRunSummary; chunks: XwChunk[]; length: number };

export function planSigns(input: SignPlanInput): SignPlan {
  const runs = new Map<string, Run>();
  for (const summary of input.runs) runs.set(summary.id, { summary, chunks: [], length: summary.lengthM });
  for (const c of input.chunks) runs.get(c.run)?.chunks.push(c);
  for (const r of runs.values()) r.chunks = r.chunks.toSorted((a, b) => a.k - b.k);
  const planner = new Planner(input, runs);
  planner.plan();
  return planner.result();
}

class Planner {
  private readonly placed = new Map<string, XwSign[]>();
  private readonly unplaced: Unplaced[] = [];
  private readonly entrances: XwEntrance[] = [];
  private readonly letter = EXPRESSWAY_LETTER.value;
  private readonly posted = new Map<string, number[]>();
  private readonly routeEnglish = new Map<string, string | null>();

  constructor(
    private readonly input: SignPlanInput,
    private readonly runs: Map<string, Run>,
  ) {}

  result(): SignPlan {
    const signs = new Map<string, XwSign[]>();
    for (const [runId, list] of this.placed) {
      const run = this.runs.get(runId)!;
      for (const sign of list.toSorted((a, b) => a.s - b.s)) {
        const chunk = chunkAt(run, sign.s);
        const out = signs.get(chunk.id) ?? [];
        out.push(sign);
        signs.set(chunk.id, out);
      }
    }
    return { signs, entrances: this.entrances, unplaced: this.unplaced, posted: this.postedByChunk() };
  }

  plan(): void {
    const ids = [...this.runs.keys()].sort();
    for (const id of ids) {
      const run = this.runs.get(id)!;
      const { start } = run.summary;
      const isBranch = start.kind === "junction" && start.parent !== undefined;
      if (isBranch && run.summary.cls === "ramp") this.exit(run);
      if (isBranch && run.summary.cls === "expressway") this.junction(run);
      const isEntrance = run.summary.cls === "ramp" && (start.kind === "ground" || start.kind === "portal");
      if (isEntrance) this.entrance(run);
    }
    // A structure's street (P7: the 臨港道路 on the Rainbow Bridge's lower floor) is no 都市高速:
    // it keeps its own limit (postedOf) and gets none of these boards or plates.
    const isExpressway = (id: string) => this.runs.get(id)!.summary.cls !== "street";
    for (const id of ids) if (isExpressway(id)) this.speeds(this.runs.get(id)!);
    for (const p of this.input.phones) this.beside(p, "116の4", "phone");
    for (const p of this.input.bays) this.beside(p, "116の6", "phone");
  }

  // ------------------------------------------------------------ exits and junctions

  /** The guide boards of an exit: 110-B, 111-B, 112-B on the main line, 113 at the nose. */
  private exit(ramp: Run): void {
    const parent = this.runs.get(ramp.summary.start.parent!);
    const at = ramp.summary.start.parentS ?? 0;
    if (!parent) return;
    const node = this.node(ramp, 0);
    const name = facilityName(node?.junctionName) ?? facilityName(ramp.chunks[0]?.name);
    if (name === null) {
      this.unplaced.push({ run: ramp.summary.id, id: "110-B", reason: "exit_without_name" });
      return;
    }
    const exitName: SignName = {
      ja: name,
      en: facilityNameEn(node?.junctionNameEn) ?? "",
      expressway: false,
    };
    const number = node?.junctionRef ?? null;
    const isLeft = this.branchSide(parent, at, ramp) > 0;
    const angle = isLeft ? 45 : -45;
    const ref = { kind: "exit" as const, node: node?.id ?? null };
    const letter = this.letter;
    this.before(parent, at, "110-B", ref, (d) => ({
      kind: "110-B",
      names: [],
      exitName,
      number,
      distance: d,
      angle,
      letter,
    }));
    this.before(
      parent,
      at,
      "111-B",
      ref,
      (d) => ({ kind: "111-B", names: [exitName], number, distance: d, letter }),
      isLeft ? "left" : "right",
    );
    this.before(parent, at, "112-B", ref, () => ({
      kind: "112-B",
      names: [],
      exitName,
      number,
      distance: null,
      angle,
      letter,
    }));
    this.nose(ramp, parent, isLeft, {
      kind: number ? "113-B" : "113-A",
      names: number ? [exitName] : [],
      exitName: null,
      number,
      distance: null,
      angle,
      letter,
    });
  }

  /** 108の2-C before a JCT: the branch's arm and the main line's straight on. */
  private junction(branch: Run): void {
    const parent = this.runs.get(branch.summary.start.parent!);
    const at = branch.summary.start.parentS ?? 0;
    if (!parent) return;
    const node = this.node(branch, 0);
    const isLeft = this.branchSide(parent, at, branch) > 0;
    const arm = (run: Run, angle: number) => {
      const way = this.wayAt(run, run === branch ? 1 : at);
      const ja = routeName(way?.name ?? run.chunks[0]?.name ?? null);
      const symbol = routeSymbolOf(run.summary.ref ?? way?.ref, ja);
      return {
        angle,
        names: ja ? [{ ja, en: this.routeEn(ja) ?? "", expressway: false }] : [],
        shields: symbol ? [{ kind: "route" as const, number: symbol }] : [],
        street: null,
      };
    };
    const branchArm = arm(branch, isLeft ? 45 : -45);
    const mainArm = arm(parent, 0);
    const hasNames = branchArm.names.length > 0 && mainArm.names.length > 0;
    if (!hasNames) {
      this.unplaced.push({ run: parent.summary.id, id: "108の2-C", reason: "route_without_name" });
      return;
    }
    // Left to right as the arrows point (図 019: the branch to its side, straight on up).
    const arms = isLeft ? [branchArm, mainArm] : [mainArm, branchArm];
    const letter = this.letter;
    this.before(parent, at, "108の2-C", { kind: "jct", node: node?.id ?? null }, (d) => ({
      kind: "108の2-C",
      arms,
      distance: d,
      letter,
    }));
  }

  /**
   * One board before `at` on `run`: the first BOARD_BEFORE distance that lies on the run, keeps
   * SIGN_SPACING from the run's other signs and has no deck overhead (112-B may hang on that deck's
   * girder instead).
   */
  private before(
    run: Run,
    at: number,
    id: keyof typeof BOARD_BEFORE.value,
    ref: { kind: "exit" | "jct"; node: number | null },
    board: (distance: number) => BoardContent,
    lane?: "left" | "right",
  ): void {
    for (const d of BOARD_BEFORE.value[id]) {
      const s = at - d;
      const isOnRun = s >= 0 && s <= run.length;
      if (!isOnRun || !this.isFree(run, s)) continue;
      const above = this.deckAbove(run, s);
      const content = board(d);
      const f = this.surface(run, s);
      const sign: XwSign = {
        id,
        s: roundTo(s, 2),
        z: roundTo(f.z, 3),
        level: this.levelAt(run, s),
        side: "over",
        mount: above ? "girder-mount" : "gantry",
        board: content,
        ref: { ...ref, beforeM: d },
      };
      if (above) sign.girder = above;
      if (lane) sign.lane = lane;
      const divider = above ? null : this.dividerAt(run, s);
      if (divider !== null) sign.divider = divider;
      // Under a deck only a 112-B hangs on its girder, and only when the board then clears 4.7 m
      // (resolveMount on the board's size: the height of a layout does not depend on the font).
      const fits =
        resolveMount(
          deckMount(chunkAt(run, s), sign, [boardSizeM(layoutBoard(content, BLOCK_MEASURE))]).placement,
        ).dropped === 0;
      const canStand = above === null || (id === "112-B" && fits);
      if (!canStand) continue;
      this.add(run, sign);
      return;
    }
    this.unplaced.push({ run: run.summary.id, id, reason: "no_free_distance" });
  }

  /**
   * 113 at the nose: NOSE_AFTER past where the ramp's deck stops sharing the main line's surface,
   * on the ramp's 壁高欄 on the main line's side, facing the traffic coming off the main line.
   */
  private nose(ramp: Run, parent: Run, isLeft: boolean, board: BoardContent): void {
    let shared = 0;
    for (const c of ramp.chunks)
      for (const d of c.decks)
        if (d.with === parent.summary.id && d.relation === "same") shared = Math.max(shared, d.s1);
    const s = Math.min(ramp.length - 1, shared + NOSE_AFTER.value);
    const isClear = this.isFree(ramp, s);
    if (!isClear) {
      this.unplaced.push({ run: ramp.summary.id, id: board.kind, reason: "no_free_distance" });
      return;
    }
    const f = this.surface(ramp, s);
    this.add(ramp, {
      id: board.kind,
      s: roundTo(s, 2),
      z: roundTo(f.z, 3),
      level: this.levelAt(ramp, s),
      // A left exit: the main line is on the ramp's right.
      side: isLeft ? "right" : "left",
      mount: "barrier-mount",
      board,
      ref: { kind: "exit", node: this.node(ramp, 0)?.id ?? null, beforeM: -roundTo(s, 2) },
    });
  }

  // ------------------------------------------------------------ regulations

  /** 325 自動車専用 at an entrance ramp's start (and the entrance in meta.json for 103・104). */
  private entrance(ramp: Run): void {
    const first = ramp.chunks[0];
    if (!first) return;
    const s = Math.min(15, ramp.length / 2);
    const f = this.surface(ramp, s);
    this.add(ramp, {
      id: "325",
      s: roundTo(s, 2),
      z: roundTo(f.z, 3),
      level: this.levelAt(ramp, s),
      side: "left",
      mount: "barrier-mount",
      plate: { id: "325", value: null },
      ref: { kind: "entrance", node: null, beforeM: 0 },
    });
    const parent = this.runs.get(ramp.summary.end.parent ?? "");
    const parentWay = parent ? this.wayAt(parent, ramp.summary.end.parentS ?? 0) : null;
    const named = this.entranceNode(ramp, first);
    this.entrances.push({
      run: ramp.summary.id,
      lon: first.st[1],
      lat: first.st[2],
      heading: first.h0,
      name: facilityName(named?.junctionName) ?? facilityName(first.name),
      nameEn: facilityNameEn(named?.junctionNameEn),
      route: parent ? routeSymbolOf(parent.summary.ref, parentWay?.name) : null,
      routeName: parentWay?.name ?? null,
      routeNameEn: parentWay?.name ? this.routeEn(parentWay.name) : null,
    });
  }

  /** The motorway_junction named 「…入口」 on the ramp, or the nearest such within 300 m of its start. */
  private entranceNode(ramp: Run, first: XwChunk) {
    for (const f of this.input.features[ramp.summary.id]?.nodes ?? []) {
      const node = this.input.net.nodes.get(f.id);
      if (node && isEntranceName(node.junctionName)) return node;
    }
    let best: { d: number; node: ReturnType<Network["nodes"]["get"]> } | null = null;
    for (const node of this.input.net.nodes.values()) {
      if (!isEntranceName(node.junctionName)) continue;
      const d = haversine(node.lon, node.lat, first.st[1], first.st[2]);
      const isNearer = d < 300 && (!best || d < best.d);
      if (isNearer) best = { d, node };
    }
    return best?.node ?? null;
  }

  /**
   * The posted speed of each chunk of a run (km/h): the maxspeed of the way at the chunk's start, a
   * way without the tag carrying the run's value before it, and a run that starts without one 60
   * (施行令 第11条第1号: the 都市高速 is not a 高速自動車国道). A branch's value is compared with its
   * parent's at the branch. The same numbers are the 323 plates and the graph's limit (the game's
   * speed checks read `XwChunk.posted`), so what a driver is told and what is enforced never differ.
   */
  private postedOf(run: Run): number[] {
    const cached = this.posted.get(run.summary.id);
    if (cached) return cached;
    // A structure's street keeps the limit the compiler gave it (its OSM maxspeed, else the street
    // default): the carry rules below are for the 都市高速's ramps and main lines. Why not the
    // statute's 60 like an untagged expressway way: the street had 40 before this planner existed.
    const isStreet = run.summary.cls === "street";
    if (isStreet) {
      const own = run.chunks.map(() => run.summary.tagV);
      this.posted.set(run.summary.id, own);
      return own;
    }
    // Guard against a cycle of branches (none in the data): the statute until the value is known.
    this.posted.set(
      run.summary.id,
      run.chunks.map(() => STATUTORY_SPEED.value.ordinary),
    );
    const ways = this.input.features[run.summary.id]?.ways ?? [];
    let carried: number | null = this.carriedInto(run);
    const byWay = new Map<number, number>();
    for (const w of ways) {
      const tagged = this.input.net.ways.get(w.id)?.maxspeedTag ?? null;
      carried = tagged ?? carried ?? STATUTORY_SPEED.value.ordinary;
      byWay.set(w.id, carried);
    }
    const out = run.chunks.map((c) => {
      const id = this.wayIdAt(run, c.st[0] + 0.5);
      return (id === null ? null : byWay.get(id)) ?? STATUTORY_SPEED.value.ordinary;
    });
    this.posted.set(run.summary.id, out);
    return out;
  }

  /**
   * The value an untagged start of a run takes (POSTED_SPEED_CARRY): a branch carries its parent's
   * at the branch (no plate has told its drivers otherwise); a ramp from the street that merges into
   * a line takes the lower of the statute's 60 and that line's value at the merge (an entrance ramp
   * posted faster than the line it joins would be enforced faster on their shared deck); else null
   * (the statute).
   */
  private carriedInto(run: Run): number | null {
    const { start, end } = run.summary;
    const parentAt = (id: string | undefined, s: number | undefined) => {
      const parent = this.runs.get(id ?? "");
      if (!parent) return null;
      return this.postedOf(parent)[parent.chunks.indexOf(chunkAt(parent, s ?? 0))] ?? null;
    };
    if (start.kind === "junction") return parentAt(start.parent, start.parentS);
    const joins = end.kind === "junction" ? parentAt(end.parent, end.parentS) : null;
    return joins === null ? null : Math.min(STATUTORY_SPEED.value.ordinary, joins);
  }

  /**
   * 323 where the posted speed changes: at a run's first chunk (a ground start always; a branch
   * when its value differs from its parent's at the branch, past the separation) and at the start of
   * each chunk whose value differs from the chunk before. A plate that finds no free place within
   * SPEED_SIGN_SHIFT of the change is reported (`unplaced`), never dropped silently.
   */
  private speeds(run: Run): void {
    const posted = this.postedOf(run);
    const { start } = run.summary;
    const parent = start.kind === "junction" ? this.runs.get(start.parent ?? "") : undefined;
    const parentValue = parent
      ? this.postedOf(parent)[parent.chunks.indexOf(chunkAt(parent, start.parentS ?? 0))]
      : null;
    posted.forEach((v, k) => {
      const before = k === 0 ? parentValue : posted[k - 1];
      const isChange = before !== v;
      if (!isChange) return;
      const c = run.chunks[k];
      const isBranchStart = k === 0 && parent !== undefined;
      const at = isBranchStart
        ? this.separation(run, parent) + SPEED_SIGN_SHIFT.value.afterSeparation
        : c.st[0] + SPEED_SIGN_SHIFT.value.afterChange;
      this.speedSign(run, at, v, k === 0 ? "run_start" : "posted_change");
    });
  }

  /** Where a branch's deck stops sharing its parent's surface (the end of their `same` stretch). */
  private separation(run: Run, parent: Run): number {
    let shared = 0;
    for (const c of run.chunks)
      for (const d of c.decks)
        if (d.with === parent.summary.id && d.relation === "same") shared = Math.max(shared, d.s1);
    return shared;
  }

  private speedSign(run: Run, s: number, value: number, why: string): void {
    const isStart = why === "run_start";
    const shifts = isStart ? SPEED_SIGN_SHIFT.value.startTries : SPEED_SIGN_SHIFT.value.tries;
    const at = shifts.map((d) => s + d).find((x) => x >= 0 && x <= run.length - 1 && this.isFree(run, x));
    if (at === undefined) {
      this.unplaced.push({ run: run.summary.id, id: "323", reason: `no_free_distance:${why}:${value}` });
      return;
    }
    const f = this.surface(run, at);
    this.add(run, {
      id: "323",
      s: roundTo(at, 2),
      z: roundTo(f.z, 3),
      level: this.levelAt(run, at),
      side: "left",
      mount: "barrier-mount",
      plate: { id: "323", value },
      ref: { kind: "run", node: null, beforeM: 0 },
    });
  }

  /** The posted speed of every chunk (written into the tiles as `XwChunk.posted`). */
  postedByChunk(): Map<string, number> {
    const out = new Map<string, number>();
    for (const run of this.runs.values()) {
      const posted = this.postedOf(run);
      run.chunks.forEach((c, k) => out.set(c.id, posted[k]));
    }
    return out;
  }

  // ------------------------------------------------------------ 116の4・116の6

  /** A phone (or bay) beside a deck: on the left 壁高欄 (別表第一「左側の路端」) at its run distance. */
  private beside(p: SignPoint, id: "116の4" | "116の6", kind: "phone"): void {
    let best: { run: Run; s: number; lateral: number } | null = null;
    for (const run of this.runs.values()) {
      if (run.summary.cls === "street") continue;
      for (const c of run.chunks) {
        const near = nearestOnChunk(c, p.lon, p.lat);
        const isCloser =
          near !== null &&
          Math.abs(near.lateral) <= BESIDE_DECK_M &&
          (!best || Math.abs(near.lateral) < Math.abs(best.lateral));
        if (isCloser) best = { run, s: near.s, lateral: near.lateral };
      }
    }
    if (!best) return;
    const s = best.s;
    if (!this.isFree(best.run, s, PHONE_SPACING.value)) {
      this.unplaced.push({ run: best.run.summary.id, id, reason: "no_free_distance" });
      return;
    }
    const f = this.surface(best.run, s);
    const scale = PICTOGRAM_SCALE.value;
    this.add(best.run, {
      id,
      s: roundTo(s, 2),
      z: roundTo(f.z, 3),
      level: this.levelAt(best.run, s),
      // 別表第一: 116の4 is on the left 路端 (116の6 also in the median, which a one-way deck has not), even for a
      // phone OSM maps by the right 壁高欄: the board tells where to stop, at the phone's run distance.
      side: "left",
      mount: "barrier-mount",
      board: { kind: id, letter: PICTOGRAMS[id].caption * scale },
      ref: { kind, node: p.id, beforeM: 0 },
    });
  }

  /**
   * One English name per route: OSM tags its ways with several ("Circle 1", "Inner Circular
   * Route"), so the most frequent among the ways of the same Japanese name is taken (ties: the
   * first in code-unit order), and every board of the route says the same (G6 review S5).
   */
  private routeEn(ja: string): string | null {
    const cached = this.routeEnglish.get(ja);
    if (cached !== undefined) return cached;
    const counts = new Map<string, number>();
    for (const w of this.input.net.ways.values())
      if (w.name === ja && w.nameEn) counts.set(w.nameEn, (counts.get(w.nameEn) ?? 0) + 1);
    const best = [...counts].toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];
    const en = best ? best[0] : null;
    this.routeEnglish.set(ja, en);
    return en;
  }

  // ------------------------------------------------------------ geometry

  private add(run: Run, sign: XwSign): void {
    const list = this.placed.get(run.summary.id) ?? [];
    list.push(sign);
    this.placed.set(run.summary.id, list);
  }

  private isFree(run: Run, s: number, gap = SIGN_SPACING.value): boolean {
    return (this.placed.get(run.summary.id) ?? []).every((x) => Math.abs(x.s - s) >= gap);
  }

  private surface(run: Run, s: number) {
    return frameAt(chunkAt(run, s).st, s);
  }

  /** The OSM node of the run's k-th vertex. */
  private node(run: Run, k: number) {
    const f = this.input.features[run.summary.id]?.nodes[k];
    return f ? (this.input.net.nodes.get(f.id) ?? null) : null;
  }

  private wayIdAt(run: Run, s: number): number | null {
    const ways = this.input.features[run.summary.id]?.ways ?? [];
    return ways.find((w) => s >= w.s0 && s <= w.s1)?.id ?? ways.at(-1)?.id ?? null;
  }

  private wayAt(run: Run, s: number) {
    const id = this.wayIdAt(run, s);
    return id === null ? null : (this.input.net.ways.get(id) ?? null);
  }

  /** + when the branch leaves to the left of the parent's travel, − to the right. */
  private branchSide(parent: Run, at: number, branch: Run): number {
    const a = this.surface(parent, at);
    const b = this.surface(parent, Math.min(parent.length, at + 5));
    const c = this.surface(branch, Math.min(branch.length, 40));
    const plane = planeAt(a.lon, a.lat);
    const [bx, by] = plane.toXY(b.lon, b.lat);
    const [cx, cy] = plane.toXY(c.lon, c.lat);
    return bx * cy - by * cx;
  }

  /** 1 + the decks this run stands over at s. */
  private levelAt(run: Run, s: number): number {
    return deckLevelAt(chunkAt(run, s), s);
  }

  /**
   * The deck over the run at s, if any, measured: every piece of another run's centre line whose
   * deck (half its width, and the board's half span of ours) reaches over this point, more than
   * OVER_GAP_M above the road here. Its girder's underside and depth in metres above this road
   * (girder-mount). Geometry, not the compiler's `decks`: a deck crossing over at an angle has no
   * `decks` stretch on the run under it (G6 review W5).
   */
  /**
   * Where the dividing wall stands (m from the centre line, + left) when the run shares one slab
   * with an opposite carriageway at s (decks `same`): the middle of the two carriageways' overlap,
   * as expresswayMerge.ts puts the wall (P3.5). Null where there is no such partner.
   */
  private dividerAt(run: Run, s: number): number | null {
    const c = chunkAt(run, s);
    const partners = c.decks
      .filter((d) => d.relation === "same" && s >= d.s0 && s <= d.s1)
      .map((d) => d.with);
    if (partners.length === 0) return null;
    const here = frameAt(c.st, s);
    const plane = planeAt(here.lon, here.lat);
    const ahead = frameAt(c.st, Math.min(s + 2, c.st[c.st.length - STATION_STRIDE]));
    const behind = frameAt(c.st, Math.max(s - 2, c.st[0]));
    const [ax, ay] = plane.toXY(behind.lon, behind.lat);
    const [bx, by] = plane.toXY(ahead.lon, ahead.lat);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return null;
    const fx = (bx - ax) / len;
    const fy = (by - ay) / len;
    const hw = carriagewayWidth({ ...c, median: 0 }) / 2;
    for (const id of [...partners].sort()) {
      const other = this.runs.get(id);
      if (!other) continue;
      let best: { d: number; along: number; side: number; hw: number } | null = null;
      for (const oc of other.chunks)
        for (let i = 0; i + STATION_STRIDE < oc.st.length; i += STATION_STRIDE) {
          const j = i + STATION_STRIDE;
          const [px, py] = plane.toXY(oc.st[i + 1], oc.st[i + 2]);
          const [qx, qy] = plane.toXY(oc.st[j + 1], oc.st[j + 2]);
          const l2 = (qx - px) ** 2 + (qy - py) ** 2;
          const t = l2 > 0 ? Math.min(1, Math.max(0, (-px * (qx - px) - py * (qy - py)) / l2)) : 0;
          const cx = px + (qx - px) * t;
          const cy = py + (qy - py) * t;
          const d = Math.hypot(cx, cy);
          const isCloser = best === null || d < best.d;
          if (!isCloser) continue;
          const l = Math.sqrt(l2) || 1;
          best = {
            d,
            along: ((qx - px) / l) * fx + ((qy - py) / l) * fy,
            side: -fy * cx + fx * cy,
            hw: carriagewayWidth({ ...oc, median: 0 }) / 2,
          };
        }
      const isOpposite = best !== null && best.along < 0;
      if (!isOpposite) continue;
      // As expresswayMerge.ts: the decks' outer faces (parapets included) overlap by a wall's
      // width or more, and the wall is the middle of that overlap.
      const pw = PARAPET_WIDTH.value;
      const far = Math.abs(best!.side);
      const footOverlap = hw + pw - (far - best!.hw - pw);
      const isWide = footOverlap >= pw;
      if (!isWide) continue;
      const middle = (hw + pw + (far - best!.hw - pw)) / 2;
      return roundTo(Math.sign(best!.side) * middle, 3);
    }
    return null;
  }

  private deckAbove(run: Run, s: number): { bottomM: number; depthM: number } | null {
    const c = chunkAt(run, s);
    const here = frameAt(c.st, s);
    const plane = planeAt(here.lon, here.lat);
    const ownHalf = carriagewayWidth({ ...c, median: 0 }) / 2 + PARAPET_WIDTH.value;
    let lowest: { bottomM: number; depthM: number } | null = null;
    for (const piece of this.piecesNear(here.lon, here.lat)) {
      if (piece.chunk.run === run.summary.id) continue;
      const [ax, ay] = plane.toXY(piece.a[0], piece.a[1]);
      const [bx, by] = plane.toXY(piece.b[0], piece.b[1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, (-ax * dx - ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      const reach = carriagewayWidth({ ...piece.chunk, median: 0 }) / 2 + PARAPET_WIDTH.value + ownHalf;
      if (d > reach) continue;
      const z = piece.a[2] + (piece.b[2] - piece.a[2]) * t;
      const isOver = z - here.z > OVER_GAP_M;
      if (!isOver) continue;
      const bottomM = roundTo(z - piece.chunk.girder - here.z, 3);
      if (!lowest || bottomM < lowest.bottomM) lowest = { bottomM, depthM: piece.chunk.girder };
    }
    return lowest;
  }

  /** Centre-line pieces of every chunk by 50 m cell (built once), for deckAbove. */
  private pieceGrid: Map<string, Piece[]> | null = null;

  private piecesNear(lon: number, lat: number): Piece[] {
    if (!this.pieceGrid) {
      const grid = new Map<string, Piece[]>();
      for (const chunk of this.input.chunks)
        for (let i = 0; i + STATION_STRIDE < chunk.st.length; i += STATION_STRIDE) {
          const a: [number, number, number] = [chunk.st[i + 1], chunk.st[i + 2], chunk.st[i + 3]];
          const j = i + STATION_STRIDE;
          const b: [number, number, number] = [chunk.st[j + 1], chunk.st[j + 2], chunk.st[j + 3]];
          const piece = { chunk, a, b };
          for (const key of new Set([cellOf(a[0], a[1]), cellOf(b[0], b[1])])) {
            const list = grid.get(key) ?? [];
            list.push(piece);
            grid.set(key, list);
          }
        }
      this.pieceGrid = grid;
    }
    const [cx, cy] = cellXY(lon, lat);
    const out = new Set<Piece>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const p of this.pieceGrid.get(`${cx + dx},${cy + dy}`) ?? []) out.add(p);
    return [...out];
  }
}

/**
 * A text measure for the build (no canvas): an em per 日本字 and 0.6 em per Latin letter. Only the
 * boards' heights are read from it, and they do not depend on the widths.
 */
const BLOCK_MEASURE: Measure = (font, text) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
  return [...text].length * px * (font.includes("GuideJP") ? 1 : 0.6);
};

/** A deck above must stand this much over the road to count (a level, not the same surface). */
const OVER_GAP_M = 2;
/** Cell of the piece grid, degrees (about 50 m). */
const CELL_DEG = 0.0005;
type Piece = { chunk: XwChunk; a: [number, number, number]; b: [number, number, number] };
const cellXY = (lon: number, lat: number) => [Math.floor(lon / CELL_DEG), Math.floor(lat / CELL_DEG)];
const cellOf = (lon: number, lat: number) => cellXY(lon, lat).join(",");

function chunkAt(run: Run, s: number): XwChunk {
  for (const c of run.chunks) {
    const last = c.st[c.st.length - 7];
    if (s <= last) return c;
  }
  return run.chunks[run.chunks.length - 1];
}
