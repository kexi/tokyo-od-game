import type { Vector3 } from "three";
import type { TurnRule } from "../world/regulations";
import type { RoadGraph, Segment } from "../world/roads";
import { planRoute, progressOn, TURN_WORDS, type Maneuver, type Route, type Turn } from "./navigation";

/** Arrow glyph per turn: a path in a 48×48 box pointing up = straight on. */
const ARROWS: Record<Turn, string> = {
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
  private readonly called = new Set<string>();
  private arrived = false;
  /** Said before the next turn call: "ルート案内を開始します。" or the replanning notice. */
  private intro: string | null = null;
  /** Bumped whenever a new route is planned (the minimap caches its geodetic copy). */
  version = 0;

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
    minutes: number;
    driving: boolean;
  }): void {
    const { now, graph, car, target } = opts;
    if (!graph || !target || !opts.driving) {
      if (!target) this.stop();
      this.panel.hidden = true;
      return;
    }
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
      this.plan(graph, opts.turnRules, car, opts.forward, target, opts.minutes, now);
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
    minutes: number,
    now: number,
  ): void {
    this.lastPlan = now;
    this.graph = graph;
    this.target = target.clone();
    this.offSince = null;
    this.hint = 0;
    const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
    const hit = graph.nearest(car, 30, isDrivable);
    if (!hit) {
      this.route = null;
      return;
    }
    const dir: 1 | -1 = hit.dir.dot(forward) >= 0 ? 1 : -1;
    this.route = planRoute(graph, { seg: hit.seg, s: hit.s, dir }, target, minutes, turnRules);
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
    const next: Maneuver | undefined = route.maneuvers.find((m) => m.at > p.at + 2);
    const toEnd = route.length - p.at;
    this.panel.hidden = false;
    const arrow = this.panel.querySelector<SVGPathElement>(".nav-arrow path");
    const dist = this.panel.querySelector<HTMLElement>(".nav-dist");
    const word = this.panel.querySelector<HTMLElement>(".nav-turn");
    const sub = this.panel.querySelector<HTMLElement>(".nav-sub");
    if (!arrow || !dist || !word || !sub) return;
    sub.textContent = route.reachesTarget
      ? `目的地まで ${formatDistance(toEnd)}`
      : "目的地方面へ（地図の外）";

    if (next) {
      const d = next.at - p.at;
      arrow.setAttribute("d", ARROWS[next.turn]);
      dist.textContent = formatDistance(d);
      word.textContent = TURN_WORDS[next.turn];
      const key = `${Math.round(next.pos.x)},${Math.round(next.pos.z)}`;
      const words = TURN_WORDS[next.turn];
      // After (re)planning, call the next turn at once from wherever the car is.
      const call = this.intro
        ? CALLS.find((c) => d <= c)
        : CALLS.find((c) => d <= c && d > c - 60 && !this.called.has(`${key}:${c}`));
      if (d < SOON + 15 && !this.called.has(`${key}:soon`)) {
        this.called.add(`${key}:soon`);
        for (const c of CALLS) this.called.add(`${key}:${c}`);
        this.say(`${this.intro ?? ""}まもなく、${words}です。`);
      } else if (call !== undefined) {
        for (const c of CALLS) if (c >= call) this.called.add(`${key}:${c}`);
        const spoken = d < call - 20 ? d : call;
        this.say(`${this.intro ?? ""}およそ${spokenDistance(spoken)}先、${words}です。`);
      } else if (this.intro) this.say(this.intro);
      this.intro = null;
      return;
    }
    arrow.setAttribute("d", ARROWS.straight);
    dist.textContent = formatDistance(toEnd);
    word.textContent = route.reachesTarget ? "道なり・目的地" : "道なり";
    if (route.reachesTarget && toEnd < 40 && !this.arrived) {
      this.arrived = true;
      this.say("目的地周辺です。音声案内を終了します。");
    } else if (this.intro) this.say(`${this.intro}しばらく道なりです。`);
    this.intro = null;
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
