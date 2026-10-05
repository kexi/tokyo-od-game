import type { Vector3 } from "three";
import { getLocale, t } from "../i18n";
import { localUtterance } from "../i18n/speech";
import { drawJunction } from "./junctionView";
import { laneAdvice, renderLanes } from "./laneView";
import { compassLabel } from "./minimap";
import {
  junctionLabel,
  junctionsAhead,
  roadAhead,
  routeAhead,
  type AheadStep,
  type NamedPoint,
} from "./navAhead";
import { drawRouteMap } from "./navMap";
import {
  collectNotices,
  emergencyNotice,
  NoticeVoice,
  shownNotice,
  type Notice,
  type OrbisLike,
} from "./navNotices";
import { joinSpoken, sayLane, sayStraight, sayTurn, turnPhrase, turnWord } from "./navPhrases";
import {
  CLOSE_RANGE,
  nextGuidance,
  straightGuides,
  type ApproachLike,
  type GuidePoint,
  type StraightGuide,
} from "./navStraight";
import {
  formatDistance,
  headingOf,
  idleView,
  noRoadName,
  roadLabel,
  type NavListItem,
  type NavView,
} from "./navView";
import type { RouteInfo } from "../world/guidePlan";
import type { LaneUse, TurnRule } from "../world/regulations";
import type { GameClock } from "../world/ruleTime";
import { isLaneChangeBanned, laneOfOffset, laneOfPoint } from "../world/laneChange";
import { speedLimit, type RoadGraph, type Segment } from "../world/roads";
import {
  laneAt,
  laneIndex,
  planRoute,
  progressOn,
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
/** The goal's flag, in the same 48×48 box. */
const GOAL_FLAG = "M15 42V8M15 10h19l-5 7 5 7H15";

// Spoken at these distances before a turn, then "まもなく" (soon) close to it.
const CALLS = [700, 300, 100];
const SOON = 35;
const OFF_ROUTE = 18; // metres from the route line before replanning
const PLAN_EVERY = 1000; // ms between plans at most
const LOCATE_EVERY = 250; // ms between nearest-street searches (a scan of the whole graph)
const NOTICES_EVERY = 200; // ms between notice collections
const DRAW_EVERY = 120; // ms between picture redraws
const AHEAD_RANGE = 600; // m of the way ahead read for notices
const IDLE_RANGE = 1000; // m of the street followed with nothing to guide
const STRAIGHT_SOON = 120; // m: 直進案内 said this close says 「まもなく」, not 「この先」
const STRAIGHT_LATE = 60; // m: closer than this the straight-on call is dropped

/** OSM route numbers and names matched to the streets and the junction names (GuideSigns.roadInfo). */
export type RoadNames = {
  graph: RoadGraph;
  routes: ReadonlyMap<number, RouteInfo>;
  names: ReadonlyArray<{ ja: string; en?: string; pos: Vector3 }>;
};

/**
 * Said before the next call: the start of guidance, a replan or a change of travel mode. A replan's
 * words do not count when telling a repeated call (a replan that lands on the same turn, e.g. once
 * the regulations arrive, must not repeat it); the travel mode's do, as before.
 */
type Intro = { text: string; isReplan: boolean };

/**
 * Whether the car, on a 進路変更禁止 segment of the route, is in another lane than the route plans
 * there (lanes counted as the violation check counts them; not on a corner's curve).
 */
function laneAstray(route: Route, graph: RoadGraph, car: Vector3, index: number): boolean {
  const i = Math.min(index, route.stepOf.length - 1);
  const step = route.steps[route.stepOf[i] ?? 0];
  if (!step || !isLaneChangeBanned(step.seg)) return false;
  const plan = laneAt(route, route.cum[i] ?? 0, i);
  if (plan.corner) return false;
  const seg = step.seg;
  const mine = laneOfPoint(seg, graph.nearestOn(seg, car).lateral * step.dir);
  const planned = Math.max(0, Math.min(seg.lanes - 1, laneOfOffset(seg, plan.offset)));
  return mine !== null && mine !== planned;
}

const NO_ROUTES: ReadonlyMap<number, RouteInfo> = new Map();
// Fixed empties: prepare() compares its inputs by identity, a fresh [] per frame would redo it.
const NO_APPROACHES: readonly ApproachLike[] = [];
const NO_ORBIS: readonly OrbisLike[] = [];
const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;
const isWalkable = (seg: Segment) => seg.line.kind !== "highway";
const keyOf = (pos: Vector3) => `${Math.round(pos.x)},${Math.round(pos.z)}`;
const setText = (el: Element | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text;
};

/**
 * Turn-by-turn guidance for the mission target and, with nothing to guide, the current location:
 * plans and replans the route, fills the fixed HUD panel (navView.ts) and speaks in the style of
 * Japanese car navigation systems — turns at 700/300/100 m and 「まもなく」, 直進案内 at named major
 * junctions (navStraight.ts), and 安全運転支援 notices (navNotices.ts) when the voice is free.
 */
export class NavGuide {
  route: Route | null = null;
  private graph: RoadGraph | null = null;
  private target: Vector3 | null = null;
  private lastPlan = -Infinity;
  private hint = 0;
  private offSince: number | null = null;
  /** Since when the car has been in another lane than the route's on a 進路変更禁止 stretch. */
  private laneSince: number | null = null;

  /** The car has left the route (it will be planned again in a moment). */
  get isOffRoute(): boolean {
    return this.offSince !== null;
  }
  private readonly called = new Set<string>();
  private arrived = false;
  mode: TravelMode = "car";
  private names: NamedPoint[] = [];
  private namesFrom: unknown[] = [];
  private routes: ReadonlyMap<number, RouteInfo> = NO_ROUTES;
  private approaches: readonly ApproachLike[] = [];
  private orbis: readonly OrbisLike[] = [];
  private clock: GameClock | null = null;
  private place = { ward: "", town: "" };
  private speedKmh = 0;
  private visible = true;
  private lastDraw = -Infinity;
  /** Said before the next turn call: "ルート案内を開始します。" or the replanning notice. */
  private intro: Intro | null = null;
  /** The car's distance along the route at the last update (for the band on the road). */
  lastAt = 0;
  /** Bumped whenever a new route is planned (the minimap caches its geodetic copy). */
  version = 0;
  /** レーン案内 along the current route. */
  hints: LaneHint[] = [];
  private laneUse: readonly LaneUse[] = [];
  /** 直進案内 and the junction names of the turns, for the route, names and signals they came from. */
  private straights: StraightGuide[] = [];
  private turnNames: Array<string | null> = [];
  private prepared: unknown[] = [];
  private located: {
    at: number;
    graph: RoadGraph | null;
    hit: { seg: Segment; s: number; dir: 1 | -1 } | null;
  } = { at: -Infinity, graph: null, hit: null };
  private lastRoad = { label: null as string | null, at: -Infinity };
  private notices: { at: number; list: Notice[] } = { at: -Infinity, list: [] };
  /** 緊急車両 approaching (the pursuit): shown first and said every half minute. */
  alert: { text: string; voice: string } | null = null;
  private readonly noticeVoice = new NoticeVoice();
  /** When a turn or straight-on call was last made (notices keep clear of it). */
  private lastGuidanceAt = -Infinity;
  private lastClosedCheck = -Infinity;
  private readonly el: {
    view: HTMLCanvasElement | null;
    lanes: HTMLElement | null;
    arrowSvg: SVGSVGElement | null;
    arrow: SVGPathElement | null;
    compass: HTMLElement | null;
    dist: HTMLElement | null;
    sub: HTMLElement | null;
    turn: HTMLElement | null;
    list: HTMLElement | null;
    limit: HTMLElement | null;
    road: HTMLElement | null;
    notice: HTMLElement | null;
  };

  constructor(
    private readonly panel: HTMLElement,
    private readonly isMuted: () => boolean,
  ) {
    const q = <T extends Element>(sel: string) => panel.querySelector<T>(sel);
    this.el = {
      view: q<HTMLCanvasElement>(".nav-view"),
      lanes: q<HTMLElement>(".nav-lanes"),
      arrowSvg: q<SVGSVGElement>(".nav-arrow"),
      arrow: q<SVGPathElement>(".nav-arrow path"),
      compass: q<HTMLElement>(".nav-compass"),
      dist: q<HTMLElement>(".nav-dist"),
      sub: q<HTMLElement>(".nav-sub"),
      turn: q<HTMLElement>(".nav-turn"),
      list: q<HTMLElement>(".nav-list"),
      limit: q<HTMLElement>(".nav-limit"),
      road: q<HTMLElement>(".nav-road-name"),
      notice: q<HTMLElement>(".nav-notice"),
    };
  }

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
    /** Signals' 交差点名 (regulations), with the OSM English name where there is one. */
    junctionNames?: Array<{ pos: Vector3; name: string; en?: string }>;
    /** 進行方向別通行区分 at junction approaches, for レーン案内. */
    laneUse?: readonly LaneUse[];
    /** Road names and numbers and junction names incl. junction=yes (GuideSigns.roadInfo). */
    roads?: RoadNames | null;
    /** Signals and 一時停止 (TrafficControl.approaches): 直進案内 and the 一時停止 notice. */
    approaches?: readonly ApproachLike[];
    /** オービス on the streets (OrbisDevices.sites). */
    orbis?: readonly OrbisLike[];
    /** Where the player is (e-Stat 町丁), for the panel with nothing to guide. */
    place?: { ward: string; town: string };
    speedKmh?: number;
    /** False while 設定 hides the panel; the guidance is still spoken. */
    visible?: boolean;
  }): void {
    const { now, graph, car, target } = opts;
    const roads = opts.roads && opts.roads.graph === graph ? opts.roads : null;
    this.setNames(opts.junctionNames ?? [], roads);
    this.routes = roads?.routes ?? NO_ROUTES;
    this.laneUse = opts.laneUse ?? [];
    this.approaches = opts.approaches ?? NO_APPROACHES;
    this.orbis = opts.orbis ?? NO_ORBIS;
    this.clock = opts.clock;
    this.place = opts.place ?? { ward: "", town: "" };
    this.speedKmh = opts.speedKmh ?? 0;
    this.visible = opts.visible ?? true;
    if (!opts.mode) {
      if (!target) this.stop();
      this.panel.hidden = true;
      return;
    }
    if (!target) {
      if (this.target) this.stop();
      this.mode = opts.mode;
      this.showIdle(graph, car, opts.forward, now, false);
      return;
    }
    if (!graph) {
      this.showIdle(null, car, opts.forward, now, true);
      return;
    }
    // Switching between driving and walking needs a different route (one-way streets etc.).
    if (opts.mode !== this.mode && this.route) {
      this.mode = opts.mode;
      this.lastPlan = -Infinity;
      this.plan(graph, opts.turnRules, car, opts.forward, target, opts.clock, now);
      this.intro = {
        text: t(opts.mode === "walk" ? "nav.say.walkRoute" : "nav.say.carRoute"),
        isReplan: false,
      };
    }
    this.mode = opts.mode;
    const isNewTarget = !this.target || this.target.distanceTo(target) > 1;
    const isNewGraph = graph !== this.graph;
    let reason: "new" | "off" | "closed" | "lane" | null = isNewTarget ? "new" : isNewGraph ? "off" : null;
    if (this.route && !reason) {
      const p = progressOn(this.route, car, this.hint);
      this.hint = p.index;
      this.offSince = p.off > OFF_ROUTE ? (this.offSince ?? now) : null;
      if (this.offSince !== null && now - this.offSince > 1500) reason = "off";
      // On a yellow lane line the car cannot move over to the route's lane: plan again from its
      // own (the route then keeps to it, or goes round a turn that lane cannot make). Silently:
      // the car is on the route, only in another lane.
      const isLaneAstray = this.mode === "car" && laneAstray(this.route, graph, car, p.index);
      this.laneSince = isLaneAstray ? (this.laneSince ?? now) : null;
      if (!reason && this.laneSince !== null && now - this.laneSince > 1500) reason = "lane";
    }
    // A closure that began after the route was planned (通学路 at 7:30): plan round it.
    const isClosureCheckDue = this.mode === "car" && now - this.lastClosedCheck > 2000;
    if (this.route && !reason && isClosureCheckDue) {
      this.lastClosedCheck = now;
      const isClosedAhead = routeAhead(this.route, this.lastAt, Infinity).some(
        (st) => st.seg.closed && st.start > 0,
      );
      if (isClosedAhead) reason = "closed";
    }
    if (!this.route) reason ??= "new";
    if (reason && now - this.lastPlan > PLAN_EVERY) {
      this.plan(graph, opts.turnRules, car, opts.forward, target, opts.clock, now);
      if (isNewTarget) {
        this.called.clear();
        this.noticeVoice.reset();
        this.arrived = false;
        this.intro = { text: t("nav.say.start"), isReplan: true };
      } else if (reason === "closed") this.intro = { text: t("nav.say.closedAhead"), isReplan: true };
      else if (reason === "off" && !isNewGraph) this.intro = { text: t("nav.say.offRoute"), isReplan: true };
    }
    if (!this.route) {
      this.showIdle(graph, car, opts.forward, now, true);
      return;
    }
    this.show(car, opts.forward, now);
  }

  stop(): void {
    this.route = null;
    this.target = null;
    this.graph = null;
    this.offSince = null;
    this.called.clear();
    this.straights = [];
    this.turnNames = [];
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
    const isUsable = this.mode === "walk" ? isWalkable : isDrivable;
    const hit = graph.nearest(car, 30, isUsable);
    if (!hit) {
      this.route = null;
      return;
    }
    const dir: 1 | -1 = hit.dir.dot(forward) >= 0 ? 1 : -1;
    // From the car's own lane, which the route keeps to on a 進路変更禁止 stretch.
    const from = { seg: hit.seg, s: hit.s, dir, lane: laneOfPoint(hit.seg, hit.lateral * dir) ?? 0 };
    this.route = planRoute(graph, from, target, clock, turnRules, this.mode, this.laneUse);
    this.laneSince = null;
    this.hints = this.route?.hints ?? [];
    this.version++;
  }

  /** Junction names: the guide-sign data's (signals and junction=yes) when loaded, else the signals'. */
  private setNames(signals: NamedPoint[], roads: RoadNames | null): void {
    const from = [signals, roads?.names];
    if (from[0] === this.namesFrom[0] && from[1] === this.namesFrom[1]) return;
    this.namesFrom = from;
    this.names = roads ? roads.names.map((n) => ({ pos: n.pos, name: n.ja, en: n.en })) : signals;
  }

  /**
   * 直進案内 and the turns' junction names, again when the route or what they read changes — or the
   * language, since the names are kept as shown (日比谷交差点 / Hibiya / 日比谷路口).
   */
  private prepare(route: Route, graph: RoadGraph): void {
    const inputs = [route, this.names, this.routes, this.approaches, this.mode, getLocale()];
    const isSame = inputs.length === this.prepared.length && inputs.every((v, i) => v === this.prepared[i]);
    if (isSame) return;
    this.prepared = inputs;
    const ctx = { approaches: this.approaches, names: this.names, routes: this.routes };
    this.straights = this.mode === "car" ? straightGuides(graph, route, ctx) : [];
    this.turnNames = route.maneuvers.map((m) => junctionLabel(this.names, m.pos));
  }

  /** The street the player is on (searched a few times a second, projected every frame). */
  private locate(graph: RoadGraph, car: Vector3, forward: Vector3, now: number) {
    const isStale = now - this.located.at > LOCATE_EVERY || this.located.graph !== graph;
    if (isStale) {
      const hit = graph.nearest(car, 30, this.mode === "walk" ? isWalkable : isDrivable);
      const dir: 1 | -1 = hit && hit.dir.dot(forward) < 0 ? -1 : 1;
      this.located = { at: now, graph, hit: hit ? { seg: hit.seg, s: hit.s, dir } : null };
      return this.located.hit;
    }
    const hit = this.located.hit;
    if (!hit) return null;
    return { ...hit, s: graph.nearestOn(hit.seg, car).s };
  }

  /**
   * The street's name for the road line. A short unnamed piece (the links inside a big crossing)
   * keeps the name of the road just driven for a few seconds.
   */
  private roadName(seg: Segment | null, now: number): string | null {
    if (!seg) return null;
    const label = roadLabel(this.routes.get(seg.id), seg.line.kind, this.place.town !== "");
    if (label) {
      this.lastRoad = { label, at: now };
      return label;
    }
    const isBoxLink = seg.length < 30 && now - this.lastRoad.at < 4000;
    return isBoxLink ? this.lastRoad.label : null;
  }

  private collect(steps: readonly AheadStep[], limit: number | null, now: number): Notice[] {
    if (this.mode === "walk") return [];
    if (now - this.notices.at < NOTICES_EVERY) return this.notices.list;
    const list = collectNotices(steps, {
      limit,
      approaches: this.approaches,
      orbis: this.orbis,
      clock: this.clock ?? undefined,
    });
    if (this.alert) list.unshift(emergencyNotice(this.alert));
    this.notices = { at: now, list };
    return list;
  }

  /** Nothing to guide: where the player is, the street followed and what is on it. */
  private showIdle(
    graph: RoadGraph | null,
    car: Vector3,
    forward: Vector3,
    now: number,
    searching: boolean,
  ): void {
    this.lastAt = 0;
    const here = graph ? this.locate(graph, car, forward, now) : null;
    const ahead =
      graph && here ? roadAhead(graph, here, IDLE_RANGE, { mode: this.mode, routes: this.routes }) : [];
    const limit = this.mode === "car" && here ? speedLimit(here.seg) : null;
    const notices = this.collect(ahead, limit, now);
    const view = idleView({
      ward: this.place.ward,
      town: this.place.town,
      road: this.roadName(here?.seg ?? null, now),
      heading: compassLabel(headingOf(forward)),
      limit,
      mode: this.mode,
      junctions: graph ? junctionsAhead(graph, ahead, this.names) : [],
      notice: shownNotice(notices),
      searching,
    });
    this.render(view);
    if (this.el.lanes) renderLanes(this.el.lanes, null, [], null);
    this.panel.classList.remove("close");
    this.drawMap(now, { graph, car, forward, route: null, at: 0, next: null, goal: null, follow: ahead });
    this.speakNotice(notices, now, false);
  }

  private show(car: Vector3, forward: Vector3, now: number): void {
    const route = this.route;
    const graph = this.graph;
    if (!route || !graph) return;
    const p = progressOn(route, car, this.hint);
    this.hint = p.index;
    this.lastAt = p.at;
    this.prepare(route, graph);
    const { primary, list } = nextGuidance(route, this.straights, this.turnNames, p.at);
    const nextIndex = route.maneuvers.findIndex((m) => m.at > p.at + 2);
    const next: Maneuver | undefined = route.maneuvers[nextIndex];
    const nextName = this.turnNames[nextIndex] ?? null;
    const toEnd = route.length - p.at;
    const isWalk = this.mode === "walk";

    // The street the player is on: the route's while on it, the nearest one when astray.
    const ahead = routeAhead(route, p.at, AHEAD_RANGE);
    const isOnRoute = p.off < 12;
    const hereSeg = isOnRoute
      ? (ahead[0]?.seg ?? null)
      : (this.locate(graph, car, forward, now)?.seg ?? null);
    const limit = !isWalk && hereSeg ? speedLimit(hereSeg) : null;
    const notices = this.collect(ahead, limit, now);
    const notice = shownNotice(notices);

    // レーン案内 for the next designated junction within 300 m.
    const lane = this.hints.find((h) => h.at > p.at - 3 && h.at - p.at < 300) ?? null;
    const step = route.steps[route.stepOf[Math.min(p.index, route.stepOf.length - 1)] ?? 0];
    const isOnApproach = lane !== null && step?.seg === lane.seg && step.dir === lane.dir;
    const current = isOnApproach ? laneIndex(graph, lane.seg, lane.dir, lane.lanes.length, car) : null;
    if (this.el.lanes) renderLanes(this.el.lanes, lane?.lanes ?? null, lane?.ok ?? [], current);
    const isWrongLane = lane !== null && current !== null && !lane.ok[current];
    // In the wrong lane behind a yellow lane line, 「…の車線を走行してください」 would ask for 進路変更禁止違反
    // (第26条の2第3項): no lane advice there; the route is planned again from this lane instead.
    const isLaneHeld = isWrongLane && step !== undefined && isLaneChangeBanned(step.seg);
    const advice = lane && !isLaneHeld ? laneAdvice(lane.ok) : null;
    const laneKey = lane ? `lane:${lane.node}:${Math.round(lane.at)}` : "";

    // On foot: the time at 80 m a minute, the walking pace Japanese property listings use.
    const walkMinutes = Math.max(1, Math.ceil(toEnd / 80));
    const sub = route.reachesTarget
      ? isWalk
        ? t("nav.walkTime", { min: walkMinutes, dist: formatDistance(toEnd) })
        : t("nav.toGoal", { dist: formatDistance(toEnd) })
      : t("nav.towardGoal");
    const isArrived = route.reachesTarget && toEnd < 40;
    const listItems: NavListItem[] = list.map((g) => ({
      icon: g.kind === "goal" ? "goal" : g.turn,
      dist: formatDistance(Math.max(0, g.at - p.at)),
      name: g.kind === "goal" ? (g.name ?? t("nav.goal")) : (g.name ?? turnWord(g.turn)),
    }));
    const guide = primary ? this.guidanceWords(primary) : "";
    const road = this.roadName(hereSeg, now);
    const view: NavView = {
      state: primary ? (primary.kind === "straight" ? "straight" : "turn") : isArrived ? "arrive" : "follow",
      icon: primary
        ? { kind: "arrow", turn: primary.turn }
        : isArrived
          ? { kind: "goal" }
          : { kind: "arrow", turn: "straight" },
      dist: formatDistance(primary ? primary.at - p.at : toEnd),
      sub,
      words: primary
        ? guide
        : isArrived
          ? t("nav.arrived")
          : route.reachesTarget
            ? t("nav.followToGoal")
            : t("nav.follow"),
      list: listItems,
      listNote: "",
      limit,
      walk: isWalk,
      road: road ?? noRoadName(),
      roadKnown: road !== null,
      notice: notice ? { kind: notice.kind, text: notice.text } : null,
    };
    this.render(view);

    // 交差点拡大図 for the last 300 m of a turn or a guided straight-on junction, else the map.
    const isClose = primary !== null && primary.at - p.at < CLOSE_RANGE;
    this.panel.classList.toggle("close", isClose);
    if (isClose && primary) this.drawClose(now, graph, route, primary, p.at);
    else {
      const goal = route.reachesTarget ? (route.points[route.points.length - 1] ?? null) : null;
      this.drawMap(now, {
        graph,
        car,
        forward,
        route,
        at: p.at,
        next: primary?.pos ?? null,
        goal,
        follow: null,
      });
    }

    // Voice: the turn calls first, then 直進案内, then a notice when the voice is free.
    let spoke = false;
    if (next) {
      spoke = this.callTurn(next, nextName, p.at, lane, advice, laneKey, now);
      if (!spoke && isWrongLane && advice && !this.called.has(laneKey)) {
        // Going straight on (no turn to call) in a lane that must turn: say which lanes to take.
        this.called.add(laneKey);
        this.guide(sayLane(advice, true), now);
        spoke = true;
      }
    } else {
      if (isArrived && !this.arrived) {
        this.arrived = true;
        this.guide(t("nav.say.arrived"), now);
        spoke = true;
      } else if (this.intro) {
        this.guide(t("nav.say.follow"), now, this.intro);
        spoke = true;
      }
      this.intro = null;
    }
    if (!spoke) spoke = this.callStraight(primary, p.at, lane, advice, laneKey, now);
    if (!spoke) this.speakNotice(notices, now, this.isGuidanceDue(next, primary, p.at));
  }

  /** 「日比谷交差点を右方向」「直進」 / "Turn right at Hibiya": the panel's second line. */
  private guidanceWords(g: GuidePoint): string {
    return turnPhrase(g.turn, g.name);
  }

  /** The turn calls at 700/300/100 m and 「まもなく」; returns whether something was said. */
  private callTurn(
    next: Maneuver,
    name: string | null,
    at: number,
    lane: LaneHint | null,
    advice: string | null,
    laneKey: string,
    now: number,
  ): boolean {
    const d = next.at - at;
    const key = keyOf(next.pos);
    // The lanes for this turn go with its call ("…右方向です。右側の車線を走行してください。").
    const isLaneOfTurn = lane !== null && Math.abs(lane.at - next.at) < 30 && advice !== null;
    const laneWords = isLaneOfTurn && advice ? sayLane(advice) : null;
    if (isLaneOfTurn) this.called.add(laneKey);
    // After (re)planning, call the next turn at once from wherever the car is.
    const call = this.intro
      ? CALLS.find((c) => d <= c)
      : CALLS.find((c) => d <= c && d > c - 60 && !this.called.has(`${key}:${c}`));
    const intro = this.intro;
    this.intro = null;
    if (d < SOON + 15 && !this.called.has(`${key}:soon`)) {
      this.called.add(`${key}:soon`);
      for (const c of CALLS) this.called.add(`${key}:${c}`);
      this.guide(joinSpoken([sayTurn({ turn: next.turn, name, distance: null }), laneWords]), now, intro);
      return true;
    }
    if (call !== undefined) {
      for (const c of CALLS) if (c >= call) this.called.add(`${key}:${c}`);
      const spoken = d < call - 20 ? d : call;
      this.guide(joinSpoken([sayTurn({ turn: next.turn, name, distance: spoken }), laneWords]), now, intro);
      return true;
    }
    if (intro) {
      this.guide("", now, intro);
      return true;
    }
    return false;
  }

  /**
   * 直進案内, once per named junction: 「この先、日比谷交差点を直進です。」 when it comes within
   * 300 m (「まもなく」 when it is first reached under 120 m), never over another call; dropped
   * when the voice stays busy until 60 m before it. Unnamed ones are shown only.
   */
  private callStraight(
    g: GuidePoint | null,
    at: number,
    lane: LaneHint | null,
    advice: string | null,
    laneKey: string,
    now: number,
  ): boolean {
    if (!g || g.kind !== "straight" || !g.name) return false;
    const key = `straight:${keyOf(g.pos)}`;
    if (this.called.has(key)) return false;
    const d = g.at - at;
    if (d < STRAIGHT_LATE) {
      this.called.add(key);
      return false;
    }
    const isBusy = this.isSpeaking() || now - this.lastGuidanceAt < 4000;
    if (isBusy) return false;
    this.called.add(key);
    const isLaneOfJunction = lane !== null && Math.abs(lane.at - g.at) < 30 && advice !== null;
    if (isLaneOfJunction) this.called.add(laneKey);
    const laneWords = isLaneOfJunction && advice ? sayLane(advice) : null;
    this.guide(joinSpoken([sayStraight({ name: g.name, soon: d < STRAIGHT_SOON }), laneWords]), now);
    return true;
  }

  /** Whether a turn or straight-on call is about to be made (within ~5 s at the current speed). */
  private isGuidanceDue(next: Maneuver | undefined, primary: GuidePoint | null, at: number): boolean {
    const lead = Math.max(40, (this.speedKmh / 3.6) * 5);
    const isStraightDue =
      primary?.kind === "straight" &&
      primary.name !== null &&
      !this.called.has(`straight:${keyOf(primary.pos)}`) &&
      primary.at - at - CLOSE_RANGE < lead;
    if (isStraightDue) return true;
    if (!next) return false;
    const d = next.at - at;
    const key = keyOf(next.pos);
    const isCallDue = CALLS.some((c) => !this.called.has(`${key}:${c}`) && d > c && d - c < lead);
    const isSoonDue = !this.called.has(`${key}:soon`) && d - (SOON + 15) < lead;
    return isCallDue || isSoonDue;
  }

  private speakNotice(notices: readonly Notice[], now: number, guidanceDue: boolean): void {
    if (this.mode === "walk" || notices.length === 0) return;
    const pick = this.noticeVoice.pick(notices, {
      now,
      speaking: this.isSpeaking(),
      lastGuidanceAt: this.lastGuidanceAt,
      guidanceDue,
      speedKmh: this.speedKmh,
    });
    if (pick?.voice) this.say(pick.voice);
  }

  private drawClose(now: number, graph: RoadGraph, route: Route, g: GuidePoint, at: number): void {
    const view = this.el.view;
    if (!this.visible || !view || now - this.lastDraw < DRAW_EVERY) return;
    this.lastDraw = now;
    drawJunction(view, graph, route, g, at, g.name);
  }

  private drawMap(
    now: number,
    s: {
      graph: RoadGraph | null;
      car: Vector3;
      forward: Vector3;
      route: Route | null;
      at: number;
      next: Vector3 | null;
      goal: Vector3 | null;
      follow: readonly AheadStep[] | null;
    },
  ): void {
    const view = this.el.view;
    if (!this.visible || !view || now - this.lastDraw < DRAW_EVERY) return;
    this.lastDraw = now;
    drawRouteMap(view, { ...s, mode: this.mode, kmh: this.speedKmh });
  }

  /** Fills the panel's fixed slots; only text that changed is written. */
  private render(v: NavView): void {
    if (!this.visible) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    this.panel.dataset.state = v.state;
    this.panel.classList.toggle("walk", v.walk);
    const e = this.el;
    const isCompass = v.icon.kind === "compass";
    e.arrowSvg?.toggleAttribute("hidden", isCompass);
    if (e.compass) e.compass.hidden = !isCompass;
    if (v.icon.kind === "compass") setText(e.compass, v.icon.label);
    const glyph =
      v.icon.kind === "arrow" ? TURN_ARROWS[v.icon.turn] : v.icon.kind === "goal" ? GOAL_FLAG : "";
    if (glyph && e.arrow?.getAttribute("d") !== glyph) e.arrow?.setAttribute("d", glyph);
    setText(e.dist, v.dist);
    setText(e.sub, v.sub);
    setText(e.turn, v.words);
    this.renderList(v);
    if (e.limit) {
      const text = v.walk ? t("nav.walkBadge") : v.limit !== null ? String(v.limit) : "—";
      setText(e.limit, text);
      e.limit.classList.toggle("walk", v.walk);
      e.limit.classList.toggle("unknown", !v.walk && v.limit === null);
      const title = v.walk
        ? t("nav.walking")
        : v.limit !== null
          ? t("nav.limitTitle", { limit: v.limit })
          : t("nav.limitUnknown");
      if (e.limit.title !== title) e.limit.title = title;
    }
    setText(e.road, v.road);
    e.road?.classList.toggle("unknown", !v.roadKnown);
    if (e.notice) {
      const kind = v.notice?.kind ?? "";
      if (e.notice.dataset.kind !== kind) e.notice.dataset.kind = kind;
      setText(e.notice, v.notice?.text ?? t("nav.noNotice"));
    }
  }

  private renderList(v: NavView): void {
    const list = this.el.list;
    if (!list) return;
    const key = JSON.stringify(v.list) + v.listNote;
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    if (v.list.length === 0) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = v.listNote;
      list.replaceChildren(li);
      return;
    }
    const ns = "http://www.w3.org/2000/svg";
    list.replaceChildren(
      ...v.list.map((item) => {
        const li = document.createElement("li");
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 48 48");
        svg.setAttribute("aria-hidden", "true");
        svg.classList.toggle("goal", item.icon === "goal");
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", item.icon === "goal" ? GOAL_FLAG : TURN_ARROWS[item.icon]);
        svg.append(path);
        const dist = document.createElement("span");
        dist.className = "d";
        dist.textContent = item.dist;
        const name = document.createElement("span");
        name.className = "n";
        name.textContent = item.name;
        li.append(svg, dist, name);
        return li;
      }),
    );
  }

  private lastSaid = { text: "", at: -Infinity };

  /** A turn or straight-on call (after `intro`, if any): notices keep clear of it for a few seconds. */
  private guide(text: string, now: number, intro: Intro | null = null): void {
    this.lastGuidanceAt = now;
    this.say(text, intro);
  }

  private isSpeaking(): boolean {
    return "speechSynthesis" in window && speechSynthesis.speaking;
  }

  /**
   * Speaks `intro` then `core` in the language in force (a voice of that language, speech.ts); a
   * call heard in the last 10 s is not said again.
   */
  private say(core: string, intro: Intro | null = null): void {
    const text = joinSpoken([intro?.text, core]);
    // A replan that lands on the same turn (e.g. once the regulations arrive) must not repeat it.
    const compared = intro && !intro.isReplan ? text : core;
    const isRepeat = compared === this.lastSaid.text && performance.now() - this.lastSaid.at < 10_000;
    this.lastSaid = { text: compared, at: performance.now() };
    if (!text || isRepeat || this.isMuted()) return;
    // No voice for the language on this device: the panel alone (speech.ts says why).
    const u = localUtterance(text);
    if (!u) return;
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
