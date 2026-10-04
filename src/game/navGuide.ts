import type { Vector3 } from "three";
import { drawJunction } from "./junctionView";
import { laneAdvice, renderLanes } from "./laneView";
import type { LaneUse, TurnRule } from "../world/regulations";
import type { GameClock } from "../world/ruleTime";
import type { RoadGraph, Segment } from "../world/roads";
import {
  laneHints,
  laneIndex,
  planRoute,
  progressOn,
  TURN_WORDS,
  type LaneHint,
  type Maneuver,
  type Route,
  type TravelMode,
  type Turn,
} from "./navigation";

/** Arrow glyph per turn: a path in a 48×48 box pointing up = straight on. */
export const TURN_ARROWS: Record<Turn, string> = {
  straight: "M24 42V10M14 20l10-10 10 10",
  slightLeft: "M30 42V26L16 12M16 24V12h12",
  left: "M32 42V22H12M20 14l-8 8 8 8",
  slightRight: "M18 42V26l14-14M32 24V12H20",
  right: "M16 42V22h20M28 14l8 8-8 8",
  uturn: "M30 42V18a8 8 0 0 0-16 0v12M8 24l6 6 6-6",
};

// Spoken at these distances before a turn, then "まもなく" close to it.
const CALLS = [700, 300, 100];
const SOON = 35;
const OFF_ROUTE = 18; // metres from the route line before replanning
const PLAN_EVERY = 1000; // ms between plans at most

const formatDistance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(10, Math.round(m / 10) * 10)}m`;
const spokenDistance = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)}キロ` : `${Math.max(10, Math.round(m / 10) * 10)}メートル`;

/**
 * Turn-by-turn guidance for the mission target: plans and replans the route, shows the next turn
 * in a HUD panel and speaks it in the style of Japanese car navigation systems.
 */
export class NavGuide {
  route: Route | null = null;
  private graph: RoadGraph | null = null;
  private target: Vector3 | null = null;
  private lastPlan = -Infinity;
  private hint = 0;
  private offSince: number | null = null;

  /** The car has left the route (it will be planned again in a moment). */
  get isOffRoute(): boolean {
    return this.offSince !== null;
  }
  private readonly called = new Set<string>();
  private arrived = false;
  mode: TravelMode = "car";
  private names: Array<{ pos: Vector3; name: string }> = [];
  private lastDraw = 0;
  /** Said before the next turn call: "ルート案内を開始します。" or the replanning notice. */
  private intro: string | null = null;
  /** The car's distance along the route at the last update (for the band on the road). */
  lastAt = 0;
  /** Bumped whenever a new route is planned (the minimap caches its geodetic copy). */
  version = 0;
  /** レーン案内 along the current route. */
  hints: LaneHint[] = [];
  private laneUse: readonly LaneUse[] = [];

  constructor(
    private readonly panel: HTMLElement,
    private readonly isMuted: () => boolean,
  ) {}

  update(opts: {
    now: number;
    graph: RoadGraph | null;
    turnRules: TurnRule[];
    car: Vector3;
    forward: Vector3;
    target: Vector3 | null;
    clock: GameClock;
    /** null while the player can't use guidance (riding a taxi). */
    mode: TravelMode | null;
    junctionNames?: Array<{ pos: Vector3; name: string }>;
    /** 進行方向別通行区分 at junction approaches, for レーン案内. */
    laneUse?: readonly LaneUse[];
  }): void {
    this.names = opts.junctionNames ?? [];
    this.laneUse = opts.laneUse ?? [];
    const { now, graph, car, target } = opts;
    if (!graph || !target || !opts.mode) {
      if (!target) this.stop();
      this.panel.hidden = true;
      return;
    }
    // Switching between driving and walking needs a different route (one-way streets etc.).
    if (opts.mode !== this.mode && this.route) {
      this.mode = opts.mode;
      this.lastPlan = -Infinity;
      this.plan(graph, opts.turnRules, car, opts.forward, target, opts.clock, now);
      this.intro = opts.mode === "walk" ? "徒歩ルートで案内します。" : "車のルートで案内します。";
    }
    this.mode = opts.mode;
    const isNewTarget = !this.target || this.target.distanceTo(target) > 1;
    const isNewGraph = graph !== this.graph;
    let reason: "new" | "off" | null = isNewTarget ? "new" : isNewGraph ? "off" : null;
    if (this.route && !reason) {
      const p = progressOn(this.route, car, this.hint);
      this.hint = p.index;
      this.offSince = p.off > OFF_ROUTE ? (this.offSince ?? now) : null;
      if (this.offSince !== null && now - this.offSince > 1500) reason = "off";
    }
    if (!this.route) reason ??= "new";
    if (reason && now - this.lastPlan > PLAN_EVERY) {
      this.plan(graph, opts.turnRules, car, opts.forward, target, opts.clock, now);
      if (isNewTarget) {
        this.called.clear();
        this.arrived = false;
        this.intro = "ルート案内を開始します。";
      } else if (reason === "off" && !isNewGraph) this.intro = "ルートを外れました。再探索します。";
    }
    this.show(car);
  }

  stop(): void {
    this.route = null;
    this.target = null;
    this.graph = null;
    this.offSince = null;
    this.called.clear();
    this.panel.hidden = true;
  }

  private plan(
    graph: RoadGraph,
    turnRules: TurnRule[],
    car: Vector3,
    forward: Vector3,
    target: Vector3,
    clock: GameClock,
    now: number,
  ): void {
    this.lastPlan = now;
    this.graph = graph;
    this.target = target.clone();
    this.offSince = null;
    this.hint = 0;
    const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
    const isUsable = this.mode === "walk" ? (seg: Segment) => seg.line.kind !== "highway" : isDrivable;
    const hit = graph.nearest(car, 30, isUsable);
    if (!hit) {
      this.route = null;
      return;
    }
    const dir: 1 | -1 = hit.dir.dot(forward) >= 0 ? 1 : -1;
    this.route = planRoute(graph, { seg: hit.seg, s: hit.s, dir }, target, clock, turnRules, this.mode);
    this.hints = this.route && this.mode === "car" ? laneHints(this.route, this.laneUse) : [];
    this.version++;
  }

  private show(car: Vector3): void {
    const route = this.route;
    if (!route) {
      this.panel.hidden = true;
      return;
    }
    const p = progressOn(route, car, this.hint);
    this.hint = p.index;
    this.lastAt = p.at;
    const next: Maneuver | undefined = route.maneuvers.find((m) => m.at > p.at + 2);
    const toEnd = route.length - p.at;
    this.panel.hidden = false;
    const arrow = this.panel.querySelector<SVGPathElement>(".nav-arrow path");
    const dist = this.panel.querySelector<HTMLElement>(".nav-dist");
    const word = this.panel.querySelector<HTMLElement>(".nav-turn");
    const sub = this.panel.querySelector<HTMLElement>(".nav-sub");
    if (!arrow || !dist || !word || !sub) return;
    // On foot: the time at 80 m a minute, the walking pace Japanese property listings use.
    const walkMinutes = Math.max(1, Math.ceil(toEnd / 80));
    sub.textContent = route.reachesTarget
      ? this.mode === "walk"
        ? `徒歩 ${walkMinutes} 分・${formatDistance(toEnd)}`
        : `目的地まで ${formatDistance(toEnd)}`
      : "目的地方面へ（地図の外）";
    this.panel.classList.toggle("walk", this.mode === "walk");

    const view = this.panel.querySelector<HTMLCanvasElement>(".nav-junction");
    // レーン案内 for the next designated junction within 300 m.
    const lanesEl = this.panel.querySelector<HTMLElement>(".nav-lanes");
    const lane = this.hints.find((h) => h.at > p.at - 3 && h.at - p.at < 300) ?? null;
    const step = route.steps[route.stepOf[Math.min(p.index, route.stepOf.length - 1)] ?? 0];
    const isOnApproach = lane !== null && step?.seg === lane.seg && step.dir === lane.dir && this.graph;
    const current =
      isOnApproach && this.graph ? laneIndex(this.graph, lane.seg, lane.dir, lane.lanes.length, car) : null;
    if (lanesEl) renderLanes(lanesEl, lane?.lanes ?? null, lane?.ok ?? [], current);
    const advice = lane ? laneAdvice(lane.ok) : null;
    const isWrongLane = lane !== null && current !== null && !lane.ok[current];
    const laneKey = lane ? `lane:${lane.node}:${Math.round(lane.at)}` : "";
    if (next) {
      const d = next.at - p.at;
      const name = this.junctionName(next.pos);
      arrow.setAttribute("d", TURN_ARROWS[next.turn]);
      dist.textContent = formatDistance(d);
      word.textContent = name ? `${name}を${TURN_WORDS[next.turn]}` : TURN_WORDS[next.turn];
      // 交差点拡大図 for the last 300 m, redrawn a few times a second.
      const isClose = d < 300 && this.graph !== null;
      this.panel.classList.toggle("close", isClose);
      if (view) view.hidden = !isClose;
      if (isClose && view && this.graph && performance.now() - this.lastDraw > 120) {
        this.lastDraw = performance.now();
        drawJunction(view, this.graph, route, next, p.at, name);
      }
      const key = `${Math.round(next.pos.x)},${Math.round(next.pos.z)}`;
      // The lanes for this turn go with its call ("…右方向です。右側の車線を走行してください。").
      const isLaneOfTurn = lane !== null && Math.abs(lane.at - next.at) < 30 && advice !== null;
      const laneWords = isLaneOfTurn ? `${advice}を走行してください。` : "";
      if (isLaneOfTurn) this.called.add(laneKey);
      const words = `${name ? `${name}を${TURN_WORDS[next.turn]}` : TURN_WORDS[next.turn]}`;
      // After (re)planning, call the next turn at once from wherever the car is.
      const call = this.intro
        ? CALLS.find((c) => d <= c)
        : CALLS.find((c) => d <= c && d > c - 60 && !this.called.has(`${key}:${c}`));
      if (d < SOON + 15 && !this.called.has(`${key}:soon`)) {
        this.called.add(`${key}:soon`);
        for (const c of CALLS) this.called.add(`${key}:${c}`);
        this.say(`${this.intro ?? ""}まもなく、${words}です。${laneWords}`);
      } else if (call !== undefined) {
        for (const c of CALLS) if (c >= call) this.called.add(`${key}:${c}`);
        const spoken = d < call - 20 ? d : call;
        this.say(`${this.intro ?? ""}およそ${spokenDistance(spoken)}先、${words}です。${laneWords}`);
      } else if (this.intro) this.say(this.intro);
      else if (isWrongLane && advice && !this.called.has(laneKey)) {
        // Going straight on (no turn to call) in a lane that must turn: say which lanes to take.
        this.called.add(laneKey);
        this.say(`この先、${advice}を走行してください。`);
      }
      this.intro = null;
      return;
    }
    this.panel.classList.remove("close");
    if (view) view.hidden = true;
    arrow.setAttribute("d", TURN_ARROWS.straight);
    dist.textContent = formatDistance(toEnd);
    word.textContent = route.reachesTarget ? "道なり・目的地" : "道なり";
    if (route.reachesTarget && toEnd < 40 && !this.arrived) {
      this.arrived = true;
      this.say("目的地周辺です。音声案内を終了します。");
    } else if (this.intro) this.say(`${this.intro}しばらく道なりです。`);
    this.intro = null;
  }

  /**
   * 交差点名 near a turn, if OSM has one ("日比谷" → "日比谷交差点", as car navigation reads it).
   * 60 m: big junctions are boxes of several GSI nodes, and the name sits on its signal node.
   */
  private junctionName(pos: Vector3): string | null {
    let best: string | null = null;
    let bestD = 60;
    for (const n of this.names) {
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = n.name;
      }
    }
    if (!best) return null;
    return best.endsWith("交差点") ? best : `${best}交差点`;
  }

  private lastSaid = { text: "", at: -Infinity };

  private say(text: string): void {
    // A replan that lands on the same turn (e.g. once the regulations arrive) must not repeat it.
    const spoken = text.replace(/^(ルート案内を開始します。|ルートを外れました。再探索します。)/, "");
    const isRepeat = spoken === this.lastSaid.text && performance.now() - this.lastSaid.at < 10_000;
    this.lastSaid = { text: spoken, at: performance.now() };
    if (!text || isRepeat || this.isMuted() || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.05;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === "ja-JP");
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
