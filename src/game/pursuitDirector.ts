import { Quaternion, Vector3, type Object3D } from "three";
import * as i18n from "../i18n";
import { formatDistance } from "../i18n/format";
import { lawRef, violationName } from "../i18n/law";
import { inJapanese } from "../i18n/reverse";
import { log, newSpan, type Span } from "../log";
import type { RoadGraph } from "../world/roads";
import { leftOf } from "../world/roads";
import { storyPanels, StoryPlayer, type StoryFacts, type StoryKind } from "./arrestStory";
import type { DriveWorld } from "./autoDriver";
import type { Assist } from "./carControls";
import type { NoticeKind } from "./noticeLog";
import type { PatrolKind, PolicePatrol } from "./policePatrol";
import {
  BOXED_RANGE_M,
  calloutKey,
  isCaught,
  LOST_M,
  PursuitEscalation,
  type PursuitEnd,
  type PursuitStage,
} from "./pursuitEscalation";
import {
  ChaseConduct,
  chaseInjuryCharge,
  decideDisposal,
  FLED_PROCEDURE,
  fledRecords,
  isDeliberateRam,
  isDrivingAtOfficer,
  laterDisposal,
  UNLICENSED_PROCEDURE,
  type Disposal,
  type UnitImpact,
} from "./pursuitLaw";
import type { PursuitScene } from "./pursuitScene";
import type { Sanction } from "./sanctions";
import type { StopPhase } from "./socialTexts";
import type { ArtWords } from "./storyArt";
import {
  afterChoice,
  arrivalPhase,
  dialogueSteps,
  guideSteps,
  judgePullOver,
  politeAtWindow,
  pullOverRemark,
  toneOf,
  type ChoiceId,
  type DialogueStep,
  type PullOverVerdict,
  type StopSite,
} from "./trafficStop";
import {
  dangerousInjuryViolation,
  VIOLATIONS,
  type TrafficLaw,
  type Violation,
  type ViolationRecord,
  violationSpan,
} from "./traffic";

/**
 * Runs the pursuit and what follows it, between the world (main.ts, through PursuitHost) and the
 * scene (pursuitScene.ts): the escalation (pursuitEscalation.ts), the law (pursuitLaw.ts), the
 * roadside stop (trafficStop.ts) and the story panels (arrestStory.ts).
 *
 * Everything advances with the frame's dt from update(), which main.ts calls only in play: the
 * 設定 pause and a replay (including the clip shown at the window) hold it where it is, and
 * isEnforcing() keeps 移動, 復帰 and the like from cutting it short.
 */
export type PursuitHost = {
  scene: PursuitScene;
  player(): {
    position: Vector3;
    quat: Quaternion;
    yaw: number;
    forward: Vector3;
    speedKmh: number;
    throttle: number;
  };
  limit(): number | null;
  /** Traffic and people within `radius` m of `p`. */
  othersNear(p: Vector3, radius: number): number;
  groundAt(x: number, z: number): number | null;
  /** Nothing fixed (buildings, ground) between the two points. */
  sight(from: Vector3, to: Vector3): boolean;
  night(): boolean;
  /** 1–12 (the officers' summer dress). */
  month(): number;
  /** Where the player is, as the records write it (「千代田区 丸の内二丁目」). */
  place(): string;
  graph(): RoadGraph | null;
  driveWorld(): DriveWorld | null;
  units(): readonly PolicePatrol[];
  /** A unit of `kind` put on a street 200–450 m from `near` (null when none could be). */
  spawnUnit(kind: PatrolKind, near: Vector3): PolicePatrol | null;
  /**
   * Nothing within `radius` m of `p` that a car put there would land on: the other police units
   * (not `except`), the traffic, the player's car.
   */
  isClear(p: Vector3, radius: number, except?: PolicePatrol): boolean;
  /** Someone going past posts the roadside stop on Y (main's witnesses and the phones). */
  stopPost(phase: StopPhase): boolean;
  assist(): Assist;
  /** ms since the left indicator last blinked. */
  leftSignalAgo(): number;
  hazards(): boolean;
  setSignalLeft(): void;
  setHazards(on: boolean): void;
  stopSite(): StopSite;
  law: TrafficLaw;
  /** Commits a violation the police see (main's book): the units' seen lists, the notice, Y. */
  book(v: Violation, detail?: string): ViolationRecord | null;
  notify(kind: NoticeKind, text: () => string): void;
  toast(text: string, color?: string): void;
  stamp(title: string, text: string, big?: boolean): void;
  /** An officer's line from `from` (the loudspeaker or their own voice), in the player's language. */
  say(
    key: i18n.MessageKey,
    params: i18n.Params | undefined,
    from: Object3D | null,
    style: "loudspeaker" | "voice",
  ): void;
  /** The police radio's line (heard as the game's narration). */
  radioVoice(key: i18n.MessageKey, params?: i18n.Params): void;
  rotor(on: boolean, anchor: Object3D): void;
  /** Y: something to note, a post about the chase, the driver identified. */
  social(
    event: "manhunt" | "heli" | "checkpoint" | "chasePost" | "identified",
    stage?: PursuitStage,
  ): boolean;
  /** The posts about it (the Y panel of the story), newest first. */
  posts(): ArtWords["posts"];
  tv(breaking: { text: string; speech: string } | null): void;
  navAlert(alert: { text: string; voice: string } | null): void;
  chip(on: boolean): void;
  /** The ticket dialog for `records`; `onAccept` when the driver takes it. */
  openTicket(records: ViolationRecord[], onAccept: () => void): void;
  /** The moment's replay clip; false when there is none. `onDone` when it closes. */
  showClip(record: ViolationRecord, onDone: () => void): boolean;
  /** A ひき逃げ from the accident response was still being chased: settle it here. */
  hitAndRunPending(): boolean;
  endHitAndRunChase(): void;
  endDay(): void;
  arrestScreen(why: "hitAndRun" | "hitAndRunLater"): void;
  /** The 行政処分 the points would bring (with the driver's 前歴). */
  decideSanction(points: number): Sanction;
  keyOf(action: "indicatorLeft" | "hazard"): string;
};

type Chase = {
  lead: PolicePatrol;
  units: Set<PolicePatrol>;
  esc: PursuitEscalation;
  conduct: ChaseConduct;
  calls: number;
  /** The car's last known position (all units head there). */
  lastSeen: Vector3;
  heliSees: boolean;
  heliCheckAt: number;
  /** A unit is within LOST_M or the helicopter sees the car: what the car does now is seen. */
  inSight: boolean;
  /** A 第67条 stop: the unit saw the car driven while the licence is suspended. */
  article67: boolean;
  ignoredBooked: boolean;
  lastRedAt: number | null;
  lastSpeedingAt: number | null;
  hits: number[];
  officerCharged: boolean;
  radio: Array<{ key: i18n.MessageKey; params?: i18n.Params }>;
  radioAt: number;
  navAt: number;
  posted: boolean;
  startedAt: number;
  /** Logs: `pursuit-<n>`, caused by the violation the lead unit saw last. */
  span: Span;
};

type Stop = {
  unit: PolicePatrol;
  rider: boolean;
  end: PursuitEnd;
  fled: boolean;
  stage: PursuitStage | 0;
  records: ViolationRecord[];
  disposal: Disposal;
  verdict: PullOverVerdict;
  t: number;
  steps: DialogueStep[];
  at: number;
  windowOpened: boolean;
  /** Waiting for the ticket dialog or the replay clip. */
  waiting: boolean;
  started: boolean;
  farewell: boolean;
  farewellT: number;
  /** s.t when the farewell line was said (its answer is taken as given after FAREWELL_WAIT_S). */
  farewellAskedT: number | null;
  posted: boolean;
  /** Logs: `stop-<n>`, caused by the pursuit. */
  span: Span;
};

type Story = {
  player: StoryPlayer;
  kind: StoryKind;
  words: ArtWords;
  /** The points the case comes to (the last panel). */
  points: number;
  onDone: () => void;
  span: Span;
};

/** `span`: the pursuit's, which the identification closes. */
type Identify = {
  left: number;
  records: ViolationRecord[];
  posted: boolean;
  stage: PursuitStage;
  span: Span;
};

const idsOf = (records: readonly ViolationRecord[]): string[] => records.flatMap((r) => (r.id ? [r.id] : []));

/** The police radio speaks at most once in this many seconds. */
const RADIO_GAP_S = 4.5;
/** After a getaway, the plate, the cameras and Y's videos identify the driver in this long (s of play). */
export const IDENTIFY_S = { posted: 60, plain: 120 } as const;
/** How far ahead (m) the 検問 is set up on the way the car is going. */
const CHECKPOINT_AHEAD = { min: 220, max: 420 } as const;
/**
 * Behind the stopped car (m) where the patrol car stops: the first of these that is clear (another
 * unit or a car may already stand at the nearest).
 */
export const BEHIND_M = [7.5, 10, 13, 16.5, 20] as const;
/** Clearance (m) around a spot a car is put at. */
export const SPOT_CLEAR_M = 4.5;
/** The farewell's 「ありがとうございました」 is taken as said after this long (s). */
const FAREWELL_WAIT_S = 10;
/** The officer at the patrol car's driver door, in its frame (right-hand drive: −X). */
const DOOR = { car: new Vector3(-1.3, 0, 0.3), bike: new Vector3(-0.9, 0, 0) } as const;
const BACKUP_KINDS: PatrolKind[] = ["shirobai", "patrol", "unmarked"];
/** debug flee(): seconds the stop check waits, so the stages show even with the car standing. */
const DEBUG_HOLD_S = 12;

export class PursuitDirector {
  chase: Chase | null = null;
  stop: Stop | null = null;
  story: Story | null = null;
  identify: Identify | null = null;
  /** performance.now() of the player's last accident. */
  private lastCrashAt = -Infinity;
  private tvClearAt = 0;

  constructor(private readonly host: PursuitHost) {}

  // ---------- what main.ts asks ----------

  /** A pursuit, a stop, a story or an identification is going on (no 移動, 復帰, getting out…). */
  get busy(): boolean {
    return this.chase !== null || this.stop !== null || this.story !== null || this.identify !== null;
  }

  /** The car is held where it stopped (the stop and the story). */
  get holdCar(): boolean {
    return this.stop !== null || this.story !== null;
  }

  /** The cinematic camera of the stop owns the view. */
  get filming(): boolean {
    return this.host.scene.shot !== null;
  }

  // ---------- the pursuit ----------

  /** A unit lit up for a violation it saw: the pursuit begins (or the unit joins the one on). */
  begin(unit: PolicePatrol): void {
    if (this.stop || this.story) return;
    if (this.chase) {
      this.chase.units.add(unit);
      unit.managed = true;
      return;
    }
    const p = this.host.player();
    unit.managed = true;
    unit.target = p.position.clone();
    this.host.scene.officer.clear();
    this.chase = {
      lead: unit,
      units: new Set([unit]),
      esc: new PursuitEscalation(),
      conduct: new ChaseConduct(),
      // main's startPursuit has made the first call.
      calls: 1,
      lastSeen: p.position.clone(),
      heliSees: false,
      heliCheckAt: 0,
      inSight: true,
      article67: unit.seen.some((r) => r.kind === "unlicensed"),
      ignoredBooked: false,
      lastRedAt: null,
      lastSpeedingAt: null,
      hits: [],
      officerCharged: false,
      radio: [],
      radioAt: -Infinity,
      navAt: -Infinity,
      posted: false,
      startedAt: performance.now(),
      span: newSpan("pursuit", violationSpan(unit.seen.at(-1) ?? {})),
    };
    this.host.chip(true);
    // 簡単操作 does the driver's part it can: the left indicator now, the hazards once stopped.
    if (this.host.assist() === "easy") this.host.setSignalLeft();
    if (this.chase.article67) this.host.notify("police", () => i18n.t("notify.article67"));
    log(
      "pursuit_begin",
      { unitKind: unit.kind, article67: this.chase.article67, violationIds: idsOf(unit.seen) },
      this.chase.span,
    );
  }

  /** The lead unit's loudspeaker is due: polite, then firmer, then a word to the other traffic. */
  callout(unit: PolicePatrol): void {
    const c = this.chase;
    if (!c || unit !== c.lead) return;
    const key = calloutKey(c.calls, c.esc.fleeing, c.esc.stage);
    c.calls++;
    this.host.say(key, undefined, unit.car.object, "loudspeaker");
  }

  /**
   * A violation booked while the police are on the car: it joins the case (the lead unit's list,
   * or the stop's). False when nobody of the pursuit can see it (the car is out of sight).
   */
  witness(record: ViolationRecord): boolean {
    if (this.story) return true;
    const s = this.stop;
    if (s) {
      if (!s.records.includes(record)) s.records.push(record);
      return true;
    }
    const c = this.chase;
    if (!c || !c.inSight) return false;
    if (!c.lead.seen.includes(record)) c.lead.seen.push(record);
    return true;
  }

  /** Every violation booked (main's book): the chase's conduct and what the injury charge reads. */
  onViolation(record: ViolationRecord): void {
    const c = this.chase;
    if (!c) return;
    const now = performance.now();
    if (record.kind === "signal") c.lastRedAt = now;
    if (record.kind === "speed") c.lastSpeedingAt = now;
    c.conduct.onViolation(record.kind, c.esc.fleeing);
  }

  /**
   * A pedestrian hurt by the car (main's onAccident, after the accident's own records): in a
   * chase, 過失運転致傷 or 危険運転致傷 (自動車運転死傷処罰法 第5条 / 第2条).
   */
  onInjury(kmh: number, injury: ViolationRecord | null, accident: ViolationRecord[]): void {
    this.lastCrashAt = performance.now();
    const c = this.chase;
    if (!c) return;
    const now = performance.now();
    const charge = chaseInjuryCharge({
      fleeing: c.esc.fleeing,
      kmh,
      limit: this.host.limit(),
      redRunAgoMs: c.lastRedAt === null ? null : now - c.lastRedAt,
    });
    const kmhText = Math.round(kmh);
    if (charge.kind === "negligent") {
      this.host.book(VIOLATIONS.negligentInjury, inJapanese("violationDetail.chaseInjury", { kmh: kmhText }));
      return;
    }
    const v = dangerousInjuryViolation(charge.item, injury?.points ?? 3);
    const limit = this.host.limit() ?? 0;
    const detail =
      charge.item === 4
        ? inJapanese("violationDetail.dangerousSpeed", { kmh: kmhText, limit })
        : inJapanese("violationDetail.dangerousRed", { kmh: kmhText });
    const record = this.host.book(v, detail);
    if (!record) return;
    // The 特定違反行為 points stand for the accident's (and the red run or the speed it came from).
    const means = this.host.law.state.log.filter((r) => {
      const isRecent = now - r.at < 20000;
      const isMeans = charge.item === 10 ? r.kind === "signal" : r.kind === "speed";
      return isRecent && isMeans;
    });
    this.host.law.absorb([...accident, ...means], record);
    for (const r of [...accident, ...means]) r.procedure = inJapanese("procedure.absorbed");
    log(
      "pursuit_dangerous_injury",
      { item: charge.item, points: record.points, violationId: record.id ?? "" },
      c.span,
    );
  }

  /** Any accident (for telling a crash stop from a stop). */
  onCrash(): void {
    this.lastCrashAt = performance.now();
  }

  /**
   * The player's car hit a police unit: on purpose (judged conservatively, pursuitLaw.ts) it is
   * 公務執行妨害 (刑法 第95条第1項) and 器物損壊 (第261条).
   */
  onUnitHit(unit: PolicePatrol, impact: Omit<UnitImpact, "engaged" | "earlierHits">): void {
    const c = this.chase;
    const engaged = c !== null || (this.stop !== null && this.stop.unit === unit);
    const now = performance.now();
    const earlier = c ? c.hits.filter((t) => now - t < 60000).length : 0;
    c?.hits.push(now);
    const deliberate = isDeliberateRam({ ...impact, engaged, earlierHits: earlier });
    log(
      "pursuit_unit_hit",
      { unitKind: unit.kind, deliberate, speedKmh: Math.round(impact.playerKmh) },
      c?.span ?? this.stop?.span,
    );
    if (!deliberate) return;
    this.host.book(VIOLATIONS.obstruction, inJapanese("violationDetail.rammed"));
    this.host.book(VIOLATIONS.propertyDamage, inJapanese("violationDetail.rammed"));
    this.host.toast(i18n.t("toast.rammed"), "#ff6b6b");
  }

  // ---------- each frame ----------

  update(dt: number, now: number): void {
    const night = this.host.night();
    // One at a time: a chase never runs beside a stop or a story (finish() ends it before either).
    const isOverlapping = this.chase !== null && (this.stop !== null || this.story !== null);
    if (isOverlapping) {
      log("pursuit_overlap", { stop: this.stop !== null, story: this.story !== null }, this.chase?.span);
      this.chase = null;
    }
    // The stop's officer is only in the world during a stop.
    if (!this.stop && this.host.scene.officer.model) this.host.scene.officer.clear();
    const heading = this.host.player().forward;
    this.host.scene.heli.update(
      dt,
      now,
      this.chase ? { position: this.chase.lastSeen, forward: heading } : null,
      (x, z) => this.host.groundAt(x, z),
      night,
    );
    this.host.scene.checkpoint.update(dt, now, night);
    if (this.host.scene.heli.active) this.host.rotor(true, this.host.scene.heli.root);
    else this.host.rotor(false, this.host.scene.heli.root);
    if (this.tvClearAt && now > this.tvClearAt) {
      this.tvClearAt = 0;
      this.host.tv(null);
    }
    if (this.story) {
      this.updateStory(dt);
      return;
    }
    if (this.stop) this.updateStop(dt);
    else if (this.chase) this.updateChase(dt, now);
    this.updateIdentify(dt);
  }

  private updateChase(dt: number, now: number): void {
    const c = this.chase;
    if (!c) return;
    const p = this.host.player();
    // Units that dropped out (taken off duty) leave the set.
    // Deleting the entry being visited is safe while iterating a Set.
    for (const u of c.units) if (!this.host.units().includes(u)) c.units.delete(u);
    if (!this.host.units().includes(c.lead)) {
      const next = [...c.units][0];
      if (!next) {
        this.finish("escaped");
        return;
      }
      c.lead = next;
    }
    const units = [...c.units];
    const distances = units.map((u) => u.position.distanceTo(p.position));
    const nearest = distances.length ? Math.min(...distances) : Infinity;
    const close = distances.filter((d) => d < BOXED_RANGE_M).length;
    // The helicopter keeps the car in sight unless buildings or a deck come between (checked twice a second).
    if (now - c.heliCheckAt > 500) {
      c.heliCheckAt = now;
      const heli = this.host.scene.heli;
      c.heliSees = heli.state === "orbit" && this.host.sight(heli.root.position, p.position);
    }
    const isSeen = nearest < LOST_M || c.heliSees;
    c.inSight = isSeen;
    if (isSeen) c.lastSeen.copy(p.position);
    for (const u of units) u.target = c.lastSeen;
    const events = c.esc.update({
      dt,
      speedKmh: p.speedKmh,
      throttle: p.throttle,
      nearestUnit: nearest,
      unitsClose: close,
      heliSees: c.heliSees,
      atCheckpoint: this.host.scene.checkpoint.contains(p.position),
      sinceCrash: (now - this.lastCrashAt) / 1000,
    });
    c.conduct.observe(dt, {
      fleeing: c.esc.fleeing,
      kmh: p.speedKmh,
      limit: this.host.limit(),
      othersNear: this.host.othersNear(p.position, 30),
    });
    if (c.conduct.take()) this.host.book(VIOLATIONS.safeDriving, inJapanese("violationDetail.chaseReckless"));
    this.checkOfficer(c, p);
    for (const e of events) {
      if (e.type === "fleeing") this.onFleeing(c);
      else if (e.type === "stage") this.onStage(c, e.stage);
      else if (e.type === "end") {
        this.finish(e.end);
        return;
      }
    }
    this.updateGuide(p.speedKmh);
    this.updateRadio(c, now);
    if (now - c.navAt > 1000) {
      c.navAt = now;
      const isNear = Number.isFinite(nearest);
      this.host.navAlert(
        isNear
          ? {
              text: i18n.t("notice.emergency", { dist: formatDistance(Math.round(nearest / 10) * 10) }),
              voice: i18n.t("notice.emergencySay"),
            }
          : null,
      );
    }
  }

  /** Driving at the 検問's officer (pursuitLaw.isDrivingAtOfficer): 公務執行妨害, once. */
  private checkOfficer(c: Chase, p: ReturnType<PursuitHost["player"]>): void {
    const officer = this.host.scene.checkpoint.officerPosition();
    if (!officer || c.officerCharged) return;
    const to = officer.clone().sub(p.position).setY(0);
    const distance = to.length();
    const headingDot = distance > 0 ? to.normalize().dot(p.forward) : 1;
    const isAt = isDrivingAtOfficer({ engaged: true, kmh: p.speedKmh, headingDot, distance });
    if (!isAt) return;
    c.officerCharged = true;
    this.host.book(VIOLATIONS.obstruction, inJapanese("violationDetail.droveAtOfficer"));
  }

  /** The driver is not stopping: the 反則 protection goes (shown now), a 第67条 stop is disobeyed. */
  private onFleeing(c: Chase): void {
    this.host.notify("police", () => i18n.t("notify.fledProcedure"));
    if (c.article67 && !c.ignoredBooked) {
      c.ignoredBooked = true;
      this.host.book(VIOLATIONS.ignoredStop, inJapanese("violationDetail.fled"));
    }
    log("pursuit_fleeing", {}, c.span);
  }

  /** 緊急配備 (more units, the radio, the navi), then the helicopter and the 検問. */
  private onStage(c: Chase, stage: PursuitStage): void {
    const p = this.host.player();
    const place = this.host.place();
    if (stage === 2) {
      for (const kind of BACKUP_KINDS.slice(0, 2)) {
        const u = this.host.spawnUnit(kind, p.position);
        if (!u) continue;
        u.seen.push(...c.lead.seen);
        u.join(c.lastSeen);
        c.units.add(u);
      }
      c.radio.push(
        { key: "radio.dispatch", params: { place } },
        { key: "radio.ack", params: { n: 12 } },
        { key: "radio.ack", params: { n: 7 } },
      );
      this.host.notify("police", () => i18n.t("notify.manhunt"));
      this.host.social("manhunt");
      c.posted = this.host.social("chasePost", 2) || c.posted;
    } else if (stage === 3) {
      const ground = this.host.groundAt(p.position.x, p.position.z) ?? p.position.y;
      this.host.scene.heli.enter(p.position, p.forward, ground);
      const isSet = this.setCheckpoint(p.position, p.forward);
      c.radio.push({ key: "radio.heli" });
      if (isSet) c.radio.push({ key: "radio.checkpoint" });
      this.host.notify("police", () => i18n.t("notify.heli"));
      if (isSet) this.host.notify("police", () => i18n.t("notify.checkpoint"));
      this.host.social("heli");
      if (isSet) this.host.social("checkpoint");
      c.posted = this.host.social("chasePost", 3) || c.posted;
      const ward = place.split(" ")[0] ?? "";
      this.host.tv({
        text: i18n.t("tv.breaking.chase", { ward }),
        speech: i18n.t("tv.breaking.chase", { ward }),
      });
    }
    log("pursuit_stage", { stage }, c.span);
  }

  /**
   * The 検問 on the likely route: walk the road graph forward from the car along the way it is
   * going, keeping as straight as the streets allow, and set it up 220–420 m ahead.
   */
  private setCheckpoint(from: Vector3, forward: Vector3): boolean {
    const graph = this.host.graph();
    if (!graph) return false;
    const hit = graph.nearest(from, 40, (s) => s.line.kind !== "highway");
    if (!hit) return false;
    let seg = hit.seg;
    let dir: 1 | -1 = hit.dir.dot(forward) >= 0 ? 1 : -1;
    let travelled = dir === 1 ? seg.length - hit.s : hit.s;
    for (let guard = 0; guard < 30; guard++) {
      const node = dir === 1 ? seg.to : seg.from;
      const into = graph.sample(seg, dir === 1 ? seg.length : 0).dir.multiplyScalar(dir);
      const exits = graph
        .exits(node, seg.id)
        .filter((x) => x.line.kind !== "highway" && x.line.width >= 4 && !x.closed);
      if (exits.length === 0) return false;
      // The straightest way on.
      const scored = exits.map((x) => {
        const out = x.from === node ? 1 : -1;
        const d = graph.sample(x, out === 1 ? 0 : x.length).dir.multiplyScalar(out);
        return { x, out: out as 1 | -1, score: d.dot(into) };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) return false;
      seg = best.x;
      dir = best.out;
      const isFar = travelled + seg.length >= CHECKPOINT_AHEAD.min;
      if (isFar) {
        const want = Math.min(seg.length - 8, Math.max(8, CHECKPOINT_AHEAD.min - travelled + 20));
        const s = dir === 1 ? want : seg.length - want;
        const sample = graph.sample(seg, s);
        const along = sample.dir.clone().multiplyScalar(dir);
        // The half the car drives in: from the centreline to the left kerb on a two-way street,
        // the whole width (from its right edge) on a one-way one.
        const isOneWay = seg.oneway !== 0;
        const travelHalf = isOneWay ? seg.line.width : seg.line.width / 2;
        const centre = isOneWay
          ? sample.pos.clone().add(leftOf(along, -seg.line.width / 2))
          : sample.pos.clone();
        this.host.scene.checkpoint.place(
          centre,
          along,
          Math.max(2.5, travelHalf),
          this.host.month(),
          (x, z) => this.host.groundAt(x, z),
        );
        // The patrol car across the lane is a real unit (it can be hit; it holds with its lights on).
        const spot = this.host.scene.checkpoint.carSpot();
        const isFree = this.host.isClear(spot.at, SPOT_CLEAR_M);
        const u = isFree ? this.host.spawnUnit("patrol", spot.at) : null;
        if (u) {
          u.placeAt(spot.at, spot.yaw);
          u.managed = true;
          this.chase?.units.add(u);
        }
        log("pursuit_checkpoint", { aheadM: Math.round(travelled + want) }, this.chase?.span);
        return true;
      }
      travelled += seg.length;
      if (travelled > CHECKPOINT_AHEAD.max) return false;
    }
    return false;
  }

  private updateGuide(kmh: number): void {
    const site = this.host.stopSite();
    const signalling = this.host.leftSignalAgo() < 1500;
    const steps = guideSteps({
      assist: this.host.assist(),
      signalling,
      atKerb: site.kerbGap <= 1.2,
      safePlace: !site.junction && !site.crossing && !site.noStopping,
      stopped: Math.abs(kmh) < 1,
      hazards: this.host.hazards(),
    });
    const isEasy = this.host.assist() === "easy";
    if (isEasy && Math.abs(kmh) < 1 && !this.host.hazards()) this.host.setHazards(true);
    this.host.scene.showGuide(
      steps.map((s) => ({
        ...s,
        hint:
          !s.auto && s.key === "stop.guide.signal"
            ? this.host.keyOf("indicatorLeft")
            : !s.auto && s.key === "stop.guide.hazards"
              ? this.host.keyOf("hazard")
              : undefined,
      })),
    );
  }

  private updateRadio(c: Chase, now: number): void {
    const next = c.radio[0];
    if (!next || now - c.radioAt < RADIO_GAP_S * 1000) return;
    c.radio.shift();
    c.radioAt = now;
    this.host.scene.radio(i18n.t(next.key, next.params));
    this.host.radioVoice(next.key, next.params);
  }

  /** The pursuit is over: stopped (→ the roadside) or got away (→ identification later). */
  private finish(end: PursuitEnd): void {
    const c = this.chase;
    if (!c) return;
    this.chase = null;
    const fled = c.esc.fleeing;
    const records = this.caseRecords(c);
    this.host.chip(false);
    this.host.navAlert(null);
    this.host.scene.showGuide(null);
    this.host.scene.heli.leave();
    this.tvClearAt = performance.now() + 60000;
    log(
      "pursuit_end",
      { end, fled, stage: c.esc.stage, records: records.length, violationIds: idsOf(records) },
      c.span,
    );
    if (fled) this.toCriminal(records, FLED_PROCEDURE, c.span);
    if (end === "escaped") {
      this.escaped(c, records);
      return;
    }
    c.radio.length = 0;
    this.host.scene.radio(i18n.t("radio.caught"));
    this.host.radioVoice("radio.caught");
    setTimeout(() => this.host.scene.radio(null), 6000);
    this.beginStop(c, end, fled, records);
  }

  /** Everything the units saw (once each), in the order it happened. */
  private caseRecords(c: Chase): ViolationRecord[] {
    const all = new Set<ViolationRecord>();
    for (const u of c.units) for (const r of u.seen) all.add(r);
    for (const r of c.lead.seen) all.add(r);
    return [...all].toSorted((a, b) => a.at - b.at);
  }

  private toCriminal(records: readonly ViolationRecord[], why: string, span: Span): void {
    const changed = fledRecords(records).filter((r) =>
      this.host.law.toCriminal(r, inJapanese(why as i18n.MessageKey)),
    );
    if (changed.length === 0) return;
    log("pursuit_criminal", { why, kinds: changed.map((r) => r.kind), violationIds: idsOf(changed) }, span);
  }

  /** Got away: the offences become notices (the plate was read) and the identification starts. */
  private escaped(c: Chase, records: ViolationRecord[]): void {
    for (const r of records) this.host.law.notice(r, "patrol");
    for (const u of c.units) u.giveUp(this.host.driveWorld(), this.host.player().position);
    this.host.scene.checkpoint.clear();
    this.host.scene.radio(i18n.t("radio.lost"));
    this.host.radioVoice("radio.lost");
    setTimeout(() => this.host.scene.radio(null), 8000);
    const escaped = ESCAPED_KEY[c.lead.kind];
    this.host.notify("police", () => i18n.t(escaped));
    const posted = c.posted;
    this.identify = {
      left: posted ? IDENTIFY_S.posted : IDENTIFY_S.plain,
      records,
      posted,
      stage: c.esc.stage,
      span: c.span,
    };
  }

  // ---------- the roadside stop ----------

  private beginStop(c: Chase, end: PursuitEnd, fled: boolean, records: ViolationRecord[]): void {
    const p = this.host.player();
    // The unit nearest the car is the one that comes to the window; it stops just behind.
    const units = [...c.units].toSorted(
      (a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position),
    );
    const unit = units[0] ?? c.lead;
    // Behind the car on the first clear spot; none clear: it stops where it is.
    const spot = BEHIND_M.map((d) => p.position.clone().addScaledVector(p.forward, -d)).find((at) =>
      this.host.isClear(at, SPOT_CLEAR_M, unit),
    );
    if (spot) unit.placeAt(spot, p.yaw);
    else unit.hold();
    for (const u of units) if (u !== unit) u.hold();
    if (this.host.hitAndRunPending()) {
      const hit = this.host.law.book(VIOLATIONS.hitAndRun, performance.now(), 0, undefined, "patrol");
      if (hit) records.push(hit);
      this.host.endHitAndRunChase();
    }
    if (this.host.assist() === "easy") this.host.setHazards(true);
    const span = newSpan("stop", c.span);
    const isUnlicensed = records.some((r) => r.kind === "unlicensed");
    if (isUnlicensed) this.toCriminal(records, UNLICENSED_PROCEDURE, span);
    const disposal = decideDisposal({ records, fled, caught: isCaught(end) });
    const verdict = judgePullOver({
      site: this.host.stopSite(),
      signalled: this.host.leftSignalAgo() < 12000,
      hazards: this.host.hazards(),
      secondsToStop: c.esc.elapsed,
      end,
      assist: this.host.assist(),
    });
    const hasClip = records.some((r) => r.replay || r.context?.snapshot);
    this.stop = {
      unit,
      rider: unit.kind === "shirobai",
      end,
      fled,
      stage: c.esc.stage,
      records,
      disposal,
      verdict,
      t: 0,
      steps: dialogueSteps({ disposal, hasClip, unlicensed: isUnlicensed }),
      at: 0,
      windowOpened: false,
      waiting: false,
      started: false,
      farewell: false,
      farewellT: 0,
      farewellAskedT: null,
      posted: c.posted,
      span,
    };
    this.host.scene.officer.clear();
    this.host.scene.setShot("patrol");
    this.host.say(
      fled ? "police.callStayFled" : "police.callStay",
      undefined,
      unit.car.object,
      "loudspeaker",
    );
    log(
      "stop_begin",
      { end, disposal, safe: verdict.safe, issues: verdict.issues, violationIds: idsOf(records) },
      span,
    );
  }

  private updateStop(dt: number): void {
    const s = this.stop;
    if (!s) return;
    const p = this.host.player();
    const scene = this.host.scene;
    s.t += dt;
    if (s.farewell) {
      s.farewellT += dt;
      scene.officer.update(dt, (x, z) => this.host.groundAt(x, z), false);
      if (s.farewellT > 1.2) scene.setShot(null);
      // Back in the patrol car (the officer is gone at its door), or it has taken too long.
      if (scene.officer.state === "gone" || s.farewellT > 9) this.endStop();
      return;
    }
    const isFarewellDue = s.farewellAskedT !== null && s.t - s.farewellAskedT > FAREWELL_WAIT_S && !s.waiting;
    if (isFarewellDue) {
      this.leaveStop(s);
      return;
    }
    const phase = arrivalPhase(s.t);
    if (phase === "walk" && scene.officer.state === "gone" && !s.started) {
      s.started = true;
      const q = p.quat;
      const door = this.doorOf(s);
      const window = p.position.clone().add(new Vector3(-1.55, 0, 0.35).applyQuaternion(q));
      window.y = this.host.groundAt(window.x, window.z) ?? window.y;
      scene.officer.start(s.rider ? "rider" : "foot", this.host.month(), door, window, p.yaw + Math.PI / 2);
      s.unit.setOfficerOut(true);
      scene.setShot("walk");
      // People going past see the car pulled over (after a chase: the chase's end).
      const phaseOfPost: StopPhase = s.fled ? "fledCaught" : s.rider ? "stoppedBike" : "stopped";
      if (this.host.stopPost(phaseOfPost)) s.posted = true;
    }
    const writing = s.steps[s.at]?.id === "dispose";
    scene.officer.update(dt, (x, z) => this.host.groundAt(x, z), writing);
    const isAtWindow =
      scene.officer.state === "stand" || (phase === "window" && scene.officer.model === null);
    if (!isAtWindow) return;
    if (scene.shot !== "window") {
      scene.setShot("window");
      this.showStep();
    }
  }

  /** The officer's line for the current step and its choices. */
  private showStep(): void {
    const s = this.stop;
    if (!s) return;
    const step = s.steps[s.at];
    if (!step) return;
    const officer = this.host.scene.officer.model?.root ?? s.unit.car.object;
    const params = this.lineParams(s, step);
    const polite = politeAtWindow(s.verdict, s.windowOpened, s.fled);
    const remarkKey = pullOverRemark(s.verdict, s.fled);
    const isLicence = step.id === "licence";
    const isKindFarewell = step.id === "farewell" && polite;
    const isRedFled = step.id === "dispose" && s.disposal === "red" && s.fled;
    const isKnockFled = step.id === "knock" && s.fled;
    const lineKey: i18n.MessageKey = isKindFarewell
      ? "stop.line.farewellKind"
      : isRedFled
        ? "stop.line.redFled"
        : isKnockFled
          ? "stop.line.knockFled"
          : step.line;
    if (step.id === "farewell") s.farewellAskedT = s.t;
    const text = isLicence ? `${i18n.t(remarkKey)} ${i18n.t(lineKey, params)}` : i18n.t(lineKey, params);
    if (isLicence) this.host.say(remarkKey, undefined, officer, "voice");
    this.host.say(lineKey, params, officer, "voice");
    const snapshot =
      step.id === "offence" ? s.records.find((r) => r.context?.snapshot)?.context?.snapshot : undefined;
    this.host.scene.showDialogue(
      {
        speaker: i18n.t(s.rider ? "stop.speaker.rider" : "stop.speaker.officer"),
        line: text,
        tone: toneOf(s.fled, polite),
        snapshot,
        choices: step.choices.map((id) => ({ id, label: i18n.t(CHOICE_KEY[id]) })),
      },
      (id) => this.choose(id),
    );
  }

  private lineParams(s: Stop, step: DialogueStep): i18n.Params {
    const list = s.records
      .filter((r) => !r.absorbedBy)
      .map((r) => i18n.t("stop.offenceItem", { label: violationName(r.label), article: lawRef(r.article) }));
    const items = list.slice(0, 4).join(i18n.getLocale() === "en" ? "; " : "、");
    const place = s.records[0]?.context?.place?.split("（")[0]?.trim() ?? this.host.place();
    const charges = s.records
      .filter((r) => r.fine === null && !r.absorbedBy)
      .map((r) => violationName(r.label))
      .slice(0, 3)
      .join(i18n.getLocale() === "en" ? ", " : "・");
    void step;
    return { list: items || "—", place, charges: charges || items };
  }

  private choose(id: ChoiceId): void {
    const s = this.stop;
    if (!s) return;
    if (id === "openWindow") s.windowOpened = true;
    if (id === "watch") {
      const r = s.records.find((x) => x.replay || x.context?.snapshot) ?? s.records[0];
      s.waiting = true;
      this.host.scene.showDialogue(null);
      // The officer is not in what is replayed (the moment was seconds or minutes ago).
      this.host.scene.officer.setVisible(false);
      const isShown = r ? this.host.showClip(r, () => this.resume()) : false;
      if (!isShown) this.resume();
      return;
    }
    const step = s.steps[s.at];
    if (step?.id === "dispose") {
      this.dispose(s);
      return;
    }
    if (step?.id === "farewell") {
      this.leaveStop(s);
      return;
    }
    const moved = afterChoice(s.steps, s.at, id);
    s.steps = moved.steps;
    s.at = moved.at;
    this.showStep();
  }

  /** Back from the clip at the window: on to the next step. */
  private resume(): void {
    const s = this.stop;
    if (!s) return;
    this.host.scene.officer.setVisible(true);
    s.waiting = false;
    s.at++;
    this.showStep();
  }

  /** The ticket, or what follows it. */
  private dispose(s: Stop): void {
    this.host.scene.showDialogue(null);
    // Passers-by: a ticket being written, the driver taken into the patrol car, an arrest.
    const phase: StopPhase = s.disposal === "blue" ? "ticket" : s.disposal === "arrest" ? "arrest" : "red";
    if (this.host.stopPost(phase)) s.posted = true;
    // An arrest draws more people: a second one may post it too.
    if (s.disposal === "arrest" && this.host.stopPost(phase)) s.posted = true;
    const cite = () => {
      for (const r of s.records) {
        if (r.status === "caught") continue;
        // Stamped already when committed (main.ts book): not again at the ticket.
        this.host.law.cite(r, "patrol");
      }
      log(
        "stop_ticket",
        {
          disposal: s.disposal,
          kinds: s.records.map((r) => r.kind),
          violationIds: idsOf(s.records),
          totalPoints: this.host.law.state.points,
        },
        s.span,
      );
    };
    if (s.disposal === "blue") {
      s.waiting = true;
      this.host.openTicket(s.records, () => {
        cite();
        s.waiting = false;
        s.at++;
        this.showStep();
      });
      return;
    }
    if (s.disposal === "red") {
      s.waiting = true;
      this.host.openTicket(s.records, () => {
        cite();
        s.waiting = false;
        this.storyFor("redSummons", s.records, s.stage, s.posted, () => this.endStop(), s.span);
      });
      return;
    }
    cite();
    const kind: StoryKind = s.disposal === "voluntary" ? "voluntary" : "arrest";
    const isHitAndRun = s.records.some((r) => r.kind === "hitAndRun");
    this.storyFor(
      kind,
      s.records,
      s.stage,
      s.posted,
      () => {
        this.endStop();
        if (isHitAndRun) this.host.arrestScreen("hitAndRun");
        else if (kind === "arrest") this.host.endDay();
      },
      s.span,
    );
  }

  /** The patrol car's driver door (the 白バイ's side), on the ground: where the officer gets out and in. */
  private doorOf(s: Stop): Vector3 {
    const yaw = s.unit.car.yaw();
    const local = s.rider ? DOOR.bike : DOOR.car;
    const door = s.unit.position.clone().add(local.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw));
    door.y = this.host.groundAt(door.x, door.z) ?? door.y;
    return door;
  }

  /** The farewell: the officer walks back to the patrol car's door and gets in; then the units drive on. */
  private leaveStop(s: Stop): void {
    if (s.farewell) return;
    this.host.scene.showDialogue(null);
    s.farewell = true;
    s.farewellT = 0;
    this.host.scene.officer.back(this.doorOf(s));
  }

  private endStop(): void {
    const s = this.stop;
    if (!s) return;
    this.stop = null;
    log("stop_end", { disposal: s.disposal }, s.span);
    s.unit.setOfficerOut(false);
    // Whatever path the stop ended by, nobody of it stays standing in the street.
    this.host.scene.officer.clear();
    this.host.scene.setShot(null);
    this.host.scene.showDialogue(null);
    this.host.scene.checkpoint.clear();
    const world = this.host.driveWorld();
    const near = this.host.player().position;
    for (const u of this.host.units()) {
      const isOurs = u.managed || u === s.unit;
      if (!isOurs) continue;
      if (world) u.release(world, near);
      else u.giveUp(null, near);
    }
    this.host.setHazards(false);
  }

  // ---------- the story ----------

  private storyFor(
    kind: StoryKind,
    records: ViolationRecord[],
    stage: PursuitStage | 0,
    posted: boolean,
    onDone: () => void,
    /** The stop or the pursuit the story is the end of (none: a debug story). */
    parent?: Span,
  ): void {
    this.host.scene.setShot(null);
    this.host.scene.officer.clear();
    const grave = records.some((r) =>
      ["hitAndRun", "obstruction", "propertyDamage", "dangerousInjury", "ignoredStop"].includes(r.kind),
    );
    // The points the case comes to: those counted, and the notices the post will bring.
    const pending = records.filter((r) => r.status === "notice").reduce((a, r) => a + r.points, 0);
    const points = this.host.law.state.points + pending;
    const facts: StoryFacts = {
      grave,
      stage,
      hitAndRun: records.some((r) => r.kind === "hitAndRun"),
      posted,
      sanction: this.host.decideSanction(points),
    };
    const words: ArtWords = {
      charges: records
        .filter((r) => !r.absorbedBy)
        .map((r) => `${violationName(r.label)}（${lawRef(r.article)}）`),
      place: this.host.place(),
      posts: this.host.posts(),
      ...stampOf(facts.sanction, points),
    };
    const player = new StoryPlayer(storyPanels(kind, facts));
    const span = newSpan("story", parent);
    this.story = { player, kind, words, points, onDone, span };
    this.host.scene.onStoryNext = () => this.storyNext();
    this.host.scene.onStorySkip = () => this.storySkip();
    this.showPanel();
    log("story_begin", { kind, panels: player.panels.length }, span);
  }

  private captionOf(story: Story): string {
    const panel = story.player.panel;
    if (!panel) return "";
    const charges = story.words.charges.slice(0, 3).join(i18n.getLocale() === "en" ? "; " : "、");
    return i18n.t(panel.caption, {
      charges,
      place: story.words.place,
      points: story.points,
      stamp: story.words.stamp,
    });
  }

  private showPanel(): void {
    const story = this.story;
    if (!story) return;
    const panel = story.player.panel;
    const caption = this.captionOf(story);
    this.host.scene.showStory(panel, story.player.index, story.player.panels.length, story.words, caption);
    if (panel) this.host.scene.drawStory(0);
  }

  private updateStory(dt: number): void {
    const story = this.story;
    if (!story) return;
    const event = story.player.update(dt);
    if (event === "done") return this.endStory();
    if (event === "panel") this.showPanel();
    this.host.scene.drawStory(story.player.progress);
  }

  /** 次へ (button or Enter). */
  storyNext(): boolean {
    const story = this.story;
    if (!story) return false;
    const event = story.player.next();
    if (event === "done") this.endStory();
    else this.showPanel();
    return true;
  }

  /** スキップ (button or Esc): the consequences still apply. */
  storySkip(): boolean {
    const story = this.story;
    if (!story) return false;
    story.player.skip();
    this.endStory();
    return true;
  }

  private endStory(): void {
    const story = this.story;
    if (!story) return;
    this.story = null;
    this.host.scene.showStory(null, 0, 0, null, "");
    story.onDone();
  }

  /** Enter at the window or in the story. */
  primary(): boolean {
    if (this.story) return this.storyNext();
    return this.host.scene.choosePrimary();
  }

  /** Esc: skips the story (the window's conversation is not skipped: the officer is waiting). */
  skip(): boolean {
    return this.storySkip();
  }

  // ---------- identification after a getaway ----------

  private updateIdentify(dt: number): void {
    const id = this.identify;
    if (!id || this.chase || this.stop) return;
    id.left -= dt;
    if (id.left > 0) return;
    this.identify = null;
    const kind = laterDisposal(id.records);
    this.host.notify("police", () => i18n.t("notify.identified"));
    if (id.posted) this.host.social("identified");
    log("pursuit_identified", { kind }, id.span);
    const isHitAndRun = id.records.some((r) => r.kind === "hitAndRun");
    if (kind === "laterArrest") for (const r of id.records) this.host.law.cite(r, "patrol");
    this.storyFor(
      kind,
      id.records,
      id.stage,
      id.posted,
      () => {
        if (isHitAndRun) this.host.arrestScreen("hitAndRunLater");
        else if (kind === "laterArrest") this.host.endDay();
      },
      id.span,
    );
  }

  /**
   * A ひき逃げ chased by the accident response caught up (emergency.ts): the arrest story, then the
   * existing arrest screen.
   */
  hitAndRunArrest(later: boolean, record: ViolationRecord | null): void {
    const c = this.chase;
    if (c) {
      this.chase = null;
      for (const u of c.units) u.giveUp(this.host.driveWorld(), this.host.player().position);
      this.host.scene.heli.leave();
      this.host.scene.checkpoint.clear();
      this.host.chip(false);
      this.host.navAlert(null);
      this.host.scene.showGuide(null);
    }
    const records = [...(c ? this.caseRecords(c) : []), ...(record ? [record] : [])];
    this.storyFor(
      later ? "laterArrest" : "arrest",
      records,
      c?.esc.stage ?? 0,
      c?.posted ?? false,
      () => this.host.arrestScreen(later ? "hitAndRunLater" : "hitAndRun"),
      c?.span ?? (record ? violationSpan(record) : undefined),
    );
  }

  /** Re-anchoring: the helicopter, the 検問 and the officer move with the world. */
  transform(offset: (p: Vector3) => Vector3): void {
    this.host.scene.transform(offset);
    if (this.chase) offset(this.chase.lastSeen);
  }

  // ---------- staging for checks (window.__game.debug.pursuit) ----------

  /** Jump the pursuit on: as if the driver had fled this long (to see stage 2 and 3 quickly). */
  debugAdvance(seconds: number): boolean {
    const c = this.chase;
    if (!c) return false;
    const wasFleeing = c.esc.fleeing;
    c.esc.fleeing = true;
    c.esc.elapsed += seconds;
    // A car standing next to the unit would end the chase as 「あきらめて停止」 2.5 s later: give the
    // stages a few seconds on screen first (a stopped car then still ends it, as in play).
    c.esc.holdStop(DEBUG_HOLD_S);
    if (!wasFleeing) this.onFleeing(c);
    return true;
  }

  debugEnd(end: PursuitEnd): boolean {
    if (!this.chase) return false;
    this.finish(end);
    return true;
  }

  debugIdentifyNow(): boolean {
    if (!this.identify) return false;
    this.identify.left = 0;
    return true;
  }

  /** A story on its own, with these records (the arrest screen and the day's end do not follow). */
  debugStory(kind: StoryKind, records: ViolationRecord[]): void {
    this.storyFor(kind, records, 3, true, () => undefined);
  }
}

const CHOICE_KEY: Record<ChoiceId, i18n.MessageKey> = {
  openWindow: "stop.choice.openWindow",
  showLicence: "stop.choice.showLicence",
  watch: "stop.choice.watch",
  seen: "stop.choice.seen",
  agree: "stop.choice.agree",
  disagree: "stop.choice.disagree",
  understood: "stop.choice.understood",
  next: "stop.choice.next",
  thanks: "stop.choice.thanks",
};

const ESCAPED_KEY: Record<PatrolKind, i18n.MessageKey> = {
  patrol: "notify.escaped.patrol",
  unmarked: "notify.escaped.unmarked",
  shirobai: "notify.escaped.shirobai",
};

/** The last panel's stamp: 取消, 停止 n 日, or the points. */
function stampOf(s: Sanction, points: number): { stamp: string; stampSub: string } {
  if (s.kind === "revocation")
    return {
      stamp: i18n.t("story.art.revoked"),
      stampSub: i18n.t("story.art.revokedSub", { points, years: s.years }),
    };
  if (s.kind === "suspension")
    return {
      stamp: i18n.t("story.art.suspended", { days: s.days }),
      stampSub: i18n.t("story.art.suspendedSub", { points }),
    };
  return { stamp: i18n.t("story.art.points", { points }), stampSub: i18n.t("story.art.pointsSub") };
}
