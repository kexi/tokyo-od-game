import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { junctionsAhead, roadAhead, routeAhead } from "../src/game/navAhead";
import { planRoute, type Maneuver, type Route, type Turn } from "../src/game/navigation";
import { collectNotices, isSchoolRun, NoticeVoice, shownNotice, type Notice } from "../src/game/navNotices";
import { CLOSE_RANGE, nextGuidance, straightGuides, type ApproachLike } from "../src/game/navStraight";
import { headingOf, idleView, roadLabel } from "../src/game/navView";
import { CLOSURE } from "../src/world/closures";
import type { RouteInfo } from "../src/world/guidePlan";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";

const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950; // degrees per metre
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
// x = east metres, y = north metres from (35.68, 139.76).
const road = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  extra: Partial<Pick<RoadLine, "oneway" | "kind" | "width">> = {},
): RoadLine => ({
  coords: [139.76 + x0 * LON, 35.68 + y0 * LAT, 139.76 + x1 * LON, 35.68 + y1 * LAT],
  width: 8,
  oneway: 0,
  kind: "local",
  ...extra,
});
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const NORTH = new Vector3(0, 0, -1);
const clock = gameClock(2026, 10, 1, 600);
const segAt = (graph: RoadGraph, x: number, y: number): Segment => {
  const hit = graph.nearest(at(x, y), 5);
  if (!hit) throw new Error(`no street at ${x},${y}`);
  return hit.seg;
};
const startOn = (graph: RoadGraph, x: number, y: number, heading = NORTH) => {
  const hit = graph.nearest(at(x, y), 5);
  if (!hit) throw new Error("no street");
  return { seg: hit.seg, s: hit.s, dir: (hit.dir.dot(heading) >= 0 ? 1 : -1) as 1 | -1 };
};
const plan = (graph: RoadGraph, from: [number, number], to: [number, number], heading = NORTH): Route => {
  const route = planRoute(graph, startOn(graph, ...from, heading), at(...to), clock, []);
  if (!route) throw new Error("no route");
  return route;
};
const info = (name: string, cls: RouteInfo["cls"] = 3, refs: string[] = []): RouteInfo => ({
  cls,
  refs,
  name,
  nameEn: "",
  key: name,
});
/** A signal facing the route where its step arrives at the junction at (x, y). */
const signalAt = (route: Route, x: number, y: number): ApproachLike => {
  const p = at(x, y);
  for (const st of route.steps) {
    const end = st.dir === 1 ? st.seg.pts[st.seg.pts.length - 1] : st.seg.pts[0];
    if (end.distanceTo(p) > 1) continue;
    const node = st.dir === 1 ? st.seg.to : st.seg.from;
    return { seg: st.seg, dir: st.dir, at: st.seg.length - 5, kind: "signal", controller: { nodes: [node] } };
  }
  throw new Error(`the route does not reach ${x},${y}`);
};

// A main street north from (0, 0) to (0, 400), crossed every 100 m.
const avenue = () => [
  road(0, 0, 0, 100),
  road(0, 100, 0, 200),
  road(0, 200, 0, 300),
  road(0, 300, 0, 400),
  ...[100, 200, 300].flatMap((y) => [road(0, y, 100, y), road(0, y, -100, y)]),
];

describe("直進案内: which junctions passed straight on are guided", () => {
  it("guides a named, signalled crossing of a main road, not a side street or an unsignalled one", () => {
    const graph = new RoadGraph(avenue(), frame);
    const route = plan(graph, [0, 10], [0, 390]);
    expect(route.maneuvers).toEqual([]);
    const routes = new Map<number, RouteInfo>();
    // y = 100: 晴海通り crosses, signalled. y = 200: a side street, signalled. y = 300: 外堀通り, no signal.
    for (const x of [50, -50]) {
      routes.set(segAt(graph, x, 100).id, info("晴海通り", 1, ["304"]));
      routes.set(segAt(graph, x, 300).id, info("外堀通り"));
    }
    const guides = straightGuides(graph, route, {
      approaches: [signalAt(route, 0, 100), signalAt(route, 0, 200)],
      names: [
        { pos: at(0, 100), name: "日比谷" },
        { pos: at(0, 200), name: "有楽町" },
        { pos: at(0, 300), name: "桜田門" },
      ],
      routes,
    });
    expect(guides.map((g) => [g.name, g.reason, Math.round(g.at)])).toEqual([["日比谷交差点", "major", 90]]);
  });

  it("guides a crossing box of a divided road once, named from its centre", () => {
    // 晴海通り as two one-way carriageways (eastbound y = 95, westbound y = 105): two GSI nodes.
    const graph = new RoadGraph(
      [
        road(0, 0, 0, 95),
        road(0, 95, 0, 105),
        road(0, 105, 0, 300),
        road(-100, 95, 0, 95, { oneway: 1 }),
        road(0, 95, 100, 95, { oneway: 1 }),
        road(100, 105, 0, 105, { oneway: 1 }),
        road(0, 105, -100, 105, { oneway: 1 }),
      ],
      frame,
    );
    const route = plan(graph, [0, 10], [0, 290]);
    const entry = signalAt(route, 0, 95);
    const box = segAt(graph, 0, 100);
    entry.controller = { nodes: [box.from, box.to] };
    const routes = new Map(
      [
        [50, 95],
        [-50, 95],
        [50, 105],
        [-50, 105],
      ].map(([x, y]) => [segAt(graph, x, y).id, info("晴海通り", 1, ["304"])]),
    );
    const guides = straightGuides(graph, route, {
      approaches: [entry],
      names: [{ pos: at(3, 100), name: "日比谷" }],
      routes,
    });
    expect(guides.map((g) => [g.name, Math.round(g.at)])).toEqual([["日比谷交差点", 85]]);
  });

  it("leaves out a junction less than 120 m after the last guided one or a turn", () => {
    const graph = new RoadGraph(avenue(), frame);
    const route = plan(graph, [0, 10], [0, 390]);
    const routes = new Map<number, RouteInfo>();
    for (const y of [100, 200, 300])
      for (const x of [50, -50]) routes.set(segAt(graph, x, y).id, info(`${y}通り`));
    const guides = straightGuides(graph, route, {
      approaches: [100, 200, 300].map((y) => signalAt(route, 0, y)),
      names: [100, 200, 300].map((y) => ({ pos: at(0, y), name: `${y}丁目` })),
      routes,
    });
    expect(guides.map((g) => g.name)).toEqual(["100丁目交差点", "300丁目交差点"]);
    // Turning left onto the avenue at y = 100: the crossing 100 m on is left out, the next is guided.
    const turned = plan(graph, [-90, 100], [0, 390], new Vector3(1, 0, 0));
    expect(turned.maneuvers.map((m) => m.turn)).toEqual(["left"]);
    const afterTurn = straightGuides(graph, turned, {
      approaches: [200, 300].map((y) => signalAt(turned, 0, y)),
      names: [200, 300].map((y) => ({ pos: at(0, y), name: `${y}丁目` })),
      routes,
    });
    expect(afterTurn.map((g) => g.name)).toEqual(["300丁目交差点"]);
  });

  it("counts a GSI 国道・都道 as a main road when OSM has no route for it", () => {
    const lines = avenue();
    lines[4] = road(0, 100, 100, 100, { kind: "national" });
    const graph = new RoadGraph(lines, frame);
    const route = plan(graph, [0, 10], [0, 390]);
    const guides = straightGuides(graph, route, {
      approaches: [signalAt(route, 0, 100)],
      names: [],
      routes: new Map(),
    });
    expect(guides.map((g) => [g.name, g.reason])).toEqual([[null, "major"]]);
  });

  it("does not guide straight on where the route turns", () => {
    const graph = new RoadGraph(avenue(), frame);
    const route = plan(graph, [0, 10], [80, 100]);
    expect(route.maneuvers.map((m) => m.turn)).toEqual(["right"]);
    const routes = new Map([[segAt(graph, 50, 100).id, info("晴海通り")]]);
    const guides = straightGuides(graph, route, {
      approaches: [signalAt(route, 0, 100)],
      names: [{ pos: at(0, 100), name: "日比谷" }],
      routes,
    });
    expect(guides).toEqual([]);
  });

  it("guides a Y fork where another way leaves close to straight on, even without a signal", () => {
    const graph = new RoadGraph([road(0, 0, 0, 100), road(0, 100, 0, 200), road(0, 100, 30, 190)], frame);
    const route = plan(graph, [0, 10], [0, 190]);
    const guides = straightGuides(graph, route, { approaches: [], names: [], routes: new Map() });
    expect(guides.map((g) => [g.reason, Math.round(g.at)])).toEqual([["fork", 90]]);
  });

  it("guides where the named road being followed turns off and the route goes on straight", () => {
    const graph = new RoadGraph([road(0, 0, 0, 100), road(0, 100, 0, 200), road(0, 100, 100, 130)], frame);
    const route = plan(graph, [0, 10], [0, 190]);
    const routes = new Map([
      [segAt(graph, 0, 50).id, info("外堀通り")],
      [segAt(graph, 50, 115).id, info("外堀通り")],
    ]);
    const guides = straightGuides(graph, route, { approaches: [], names: [], routes });
    expect(guides.map((g) => g.reason)).toEqual(["fork"]);
  });
});

/** A route with only what nextGuidance reads. */
const fakeRoute = (turns: Array<[number, Turn]>, length = 2000): Route =>
  ({
    maneuvers: turns.map(([d, turn]): Maneuver => ({
      at: d,
      turn,
      pos: new Vector3(0, 0, -d),
      node: d,
      dir: NORTH,
    })),
    length,
    points: [new Vector3(), new Vector3(0, 0, -length)],
    reachesTarget: true,
  }) as unknown as Route;
const straightAt = (d: number, name: string | null = "日比谷交差点") => ({
  at: d,
  pos: new Vector3(0, 0, -d),
  dir: NORTH,
  node: -1,
  name,
  reason: "major" as const,
});

describe("the next guidance and the list of what follows", () => {
  it("shows a straight-on junction first when it comes before the turn and within 300 m", () => {
    const route = fakeRoute([
      [400, "right"],
      [900, "left"],
    ]);
    const { primary, list } = nextGuidance(route, [straightAt(250)], ["桜田門交差点", null], 0);
    expect(primary?.kind).toBe("straight");
    expect(primary?.name).toBe("日比谷交差点");
    expect(list.map((g) => [g.kind, g.at, g.name])).toEqual([
      ["turn", 400, "桜田門交差点"],
      ["turn", 900, null],
      ["goal", 2000, "目的地"],
    ]);
  });

  it("keeps the turn as the main guidance while the straight-on junction is beyond 300 m", () => {
    const route = fakeRoute([[600, "left"]]);
    const { primary, list } = nextGuidance(route, [straightAt(CLOSE_RANGE + 50)], [null], 0);
    expect(primary?.kind).toBe("turn");
    expect(list.map((g) => g.kind)).toEqual(["goal"]);
  });

  it("lists at most three, the goal only when there is room, and drops what has been passed", () => {
    const route = fakeRoute([
      [100, "left"],
      [300, "right"],
      [500, "left"],
      [700, "right"],
      [900, "left"],
    ]);
    const { primary, list } = nextGuidance(route, [], [], 120);
    expect(primary?.at).toBe(300);
    expect(list.map((g) => g.at)).toEqual([500, 700, 900]);
  });

  it("has no main guidance after the last turn (道なり) and lists the goal", () => {
    const { primary, list } = nextGuidance(fakeRoute([[100, "left"]]), [], [null], 150);
    expect(primary).toBeNull();
    expect(list.map((g) => g.kind)).toEqual(["goal"]);
  });
});

describe("road names for the road line", () => {
  it("reads the OSM route: name and number, number alone, name alone", () => {
    expect(roadLabel(info("晴海通り", 1, ["304"]), "local")).toBe("晴海通り（都道304号）");
    expect(roadLabel(info("", 0, ["15"]), "national")).toBe("国道15号");
    expect(roadLabel(info("", 0, ["1", "15"]), "national")).toBe("国道1号・国道15号");
    expect(roadLabel(info("外堀通り", 3), "local")).toBe("外堀通り");
  });

  it("falls back on the GSI 道路種別, and on nothing for a nameless street", () => {
    expect(roadLabel(undefined, "national")).toBe("国道");
    expect(roadLabel(undefined, "prefectural")).toBe("都道");
    expect(roadLabel(undefined, "local")).toBeNull();
  });

  it("does not call a 県道 outside the 23 wards a 都道", () => {
    expect(roadLabel(info("", 2, ["7"]), "prefectural", false)).toBeNull();
    expect(roadLabel(info("府中街道", 2, ["9"]), "prefectural", false)).toBe("府中街道");
    expect(roadLabel(info("", 0, ["20"]), "national", false)).toBe("国道20号");
  });
});

describe("the way ahead with no route", () => {
  it("follows the street straight on and names the junctions coming up", () => {
    const graph = new RoadGraph(avenue(), frame);
    const steps = roadAhead(graph, startOn(graph, 0, 10), 1000, { mode: "car" });
    expect(steps.map((st) => Math.round(st.start))).toEqual([0, 90, 190, 290]);
    const names = [
      { pos: at(0, 100), name: "日比谷" },
      { pos: at(2, 300), name: "桜田門交差点" },
      { pos: at(60, 200), name: "遠い交差点" },
    ];
    expect(junctionsAhead(graph, steps, names).map((j) => [Math.round(j.distance), j.name])).toEqual([
      [90, "日比谷交差点"],
      [290, "桜田門交差点"],
    ]);
  });

  it("stops at a one-way street against it by car but walks on", () => {
    const lines = avenue();
    lines[1] = road(0, 200, 0, 100, { oneway: 1 }); // southbound only
    const graph = new RoadGraph(lines, frame);
    expect(roadAhead(graph, startOn(graph, 0, 10), 1000, { mode: "car" })).toHaveLength(1);
    expect(roadAhead(graph, startOn(graph, 0, 10), 1000, { mode: "walk" })).toHaveLength(4);
  });

  it("reads the route from the player's distance on", () => {
    const graph = new RoadGraph(avenue(), frame);
    const route = plan(graph, [0, 10], [0, 390]);
    const steps = routeAhead(route, 150, 200);
    expect(steps.map((st) => Math.round(st.start))).toEqual([-60, 40, 140]);
  });
});

const avenueSteps = () => {
  const graph = new RoadGraph(avenue(), frame);
  return { graph, steps: roadAhead(graph, startOn(graph, 0, 10), 1000, { mode: "car" }) };
};
const none = { limit: 60, approaches: [], orbis: [] };

const shownLike = (kind: Notice["kind"], priority: number, distance: number) =>
  ({ kind, priority, distance }) as Notice;

const notice = (
  kind: Notice["kind"],
  key: string,
  distance: number,
  extra: Partial<Notice> = {},
): Notice => ({
  kind,
  key,
  distance,
  text: kind,
  voice: `${kind}です。`,
  voiceWithin: 500,
  voiceMin: 10,
  minSpeed: 0,
  repeatAfter: 300_000,
  priority: kind === "orbis" ? 4 : 2,
  ...extra,
});

describe("安全運転支援 notices on the way ahead", () => {
  it("announces a 速度取締機 within 500 m with the limit, and not one further on", () => {
    const { graph, steps } = avenueSteps();
    const near = { seg: segAt(graph, 0, 350), s: 50, dir: 1 as const, entry: { id: 7 }, limit: 60 };
    const notices = collectNotices(steps, { ...none, orbis: [near] });
    expect(notices.map((n) => [n.kind, Math.round(n.distance)])).toEqual([["orbis", 340]]);
    expect(notices[0].voice).toBe("この先、速度取締機があります。制限速度は60キロです。");
    const far = collectNotices(roadAhead(graph, startOn(graph, 0, 10), 1000, { mode: "car" }).slice(0, 2), {
      ...none,
      orbis: [near],
    });
    expect(far).toEqual([]);
  });

  it("ignores a 速度取締機 facing the other way", () => {
    const { graph, steps } = avenueSteps();
    const site = { seg: segAt(graph, 0, 150), s: 50, dir: -1 as const, entry: { id: 8 }, limit: 60 };
    expect(collectNotices(steps, { ...none, orbis: [site] })).toEqual([]);
  });

  it("says a lower posted limit, shows a higher one, and ignores the estimated statutory limit", () => {
    const { graph, steps } = avenueSteps();
    const next = segAt(graph, 0, 150);
    next.limit = 40;
    next.limitKind = "sign";
    const lower = collectNotices(steps, none);
    expect(lower.map((n) => [n.kind, n.text, n.voice])).toEqual([
      ["limit", "この先 40km/h 区間・90m", "この先、制限速度が40キロに変わります。"],
    ]);
    const higher = collectNotices(steps, { ...none, limit: 30 });
    expect(higher[0].voice).toBeNull();
    next.limitKind = "statutory";
    next.limit = null;
    expect(collectNotices(steps, { ...none, limit: 30 })).toEqual([]);
  });

  it("warns of a 通学路 closed for the school run, with its hours", () => {
    const { graph, steps } = avenueSteps();
    const closed = segAt(graph, 0, 250);
    closed.closures = [{ kind: CLOSURE.pedestrianRoad, time: { on: [[450, 510, 0]], off: [] } }];
    closed.closed = true;
    const notices = collectNotices(steps, { ...none, clock: gameClock(2026, 10, 1, 460) });
    expect(notices.map((n) => [n.kind, n.text])).toEqual([
      ["school", "通学路 時間規制中（7:30-8:30）・190m"],
    ]);
    expect(notices[0].voice).toBe("この先、通学路の時間規制で、車は通行できません。");
  });

  it("tells the shopping streets' lunchtime 歩行者用道路 from a school run", () => {
    const { graph, steps } = avenueSteps();
    const closed = segAt(graph, 0, 250);
    closed.closures = [{ kind: CLOSURE.pedestrianRoad, time: { on: [[720, 780, 0]], off: [] } }];
    closed.closed = true;
    const notices = collectNotices(steps, { ...none, clock: gameClock(2026, 10, 1, 750) });
    expect(notices.map((n) => [n.kind, n.text, n.voice])).toEqual([
      ["closure", "歩行者用道路（12-13）・190m", "この先、歩行者用道路のため、車は通行できません。"],
    ]);
    expect(isSchoolRun(CLOSURE.pedestrianRoad, { on: [[450, 510, 0]], off: [] })).toBe(true);
    expect(
      isSchoolRun(CLOSURE.pedestrianRoad, {
        on: [
          [450, 510, 0],
          [900, 960, 0],
        ],
        off: [],
      }),
    ).toBe(true);
    expect(isSchoolRun(CLOSURE.pedestrianRoad, { on: [[1020, 300, 0]], off: [] })).toBe(false);
    expect(isSchoolRun(CLOSURE.vehicles, { on: [[450, 510, 0]], off: [] })).toBe(false);
  });

  it("gives the nearest 一時停止 within 120 m", () => {
    const { graph, steps } = avenueSteps();
    const stop = (x: number, y: number): ApproachLike => ({
      seg: segAt(graph, x, y),
      dir: 1,
      at: 95,
      kind: "stop",
      controller: null,
    });
    const notices = collectNotices(steps, { ...none, approaches: [stop(0, 150), stop(0, 50)] });
    expect(notices.map((n) => [n.kind, Math.round(n.distance)])).toEqual([["stop", 85]]);
  });

  it("shows the most important notice, the nearest of equals", () => {
    const n = shownLike;
    expect(shownNotice([n("stop", 2, 40), n("orbis", 4, 400), n("limit", 3, 100)])?.kind).toBe("orbis");
    expect(shownNotice([n("stop", 2, 90), n("stop", 2, 40)])?.distance).toBe(40);
    expect(shownNotice([])).toBeNull();
  });
});

describe("speaking the notices: once, rate-limited, never over a turn call", () => {
  const free = { speaking: false, lastGuidanceAt: -Infinity, guidanceDue: false, speedKmh: 40 };

  it("waits while speaking, just after a turn call, or when one is due", () => {
    const voice = new NoticeVoice();
    const list = [notice("orbis", "o", 300)];
    expect(voice.pick(list, { ...free, now: 10_000, speaking: true })).toBeNull();
    expect(voice.pick(list, { ...free, now: 10_000, lastGuidanceAt: 7_000 })).toBeNull();
    expect(voice.pick(list, { ...free, now: 10_000, guidanceDue: true })).toBeNull();
    expect(voice.pick(list, { ...free, now: 10_000 })?.key).toBe("o");
  });

  it("says the most important first, each once, at most one every 8 s", () => {
    const voice = new NoticeVoice();
    const list = [notice("stop", "s", 60), notice("orbis", "o", 300)];
    expect(voice.pick(list, { ...free, now: 0 })?.key).toBe("o");
    expect(voice.pick(list, { ...free, now: 3_000 })).toBeNull();
    expect(voice.pick(list, { ...free, now: 8_500 })?.key).toBe("s");
    expect(voice.pick(list, { ...free, now: 20_000 })).toBeNull();
  });

  it("keeps to each notice's distances and speed", () => {
    const voice = new NoticeVoice();
    const stop = notice("stop", "s", 100, { voiceWithin: 80, voiceMin: 15, minSpeed: 15 });
    expect(voice.pick([stop], { ...free, now: 0 })).toBeNull(); // too far yet
    expect(voice.pick([{ ...stop, distance: 60 }], { ...free, now: 0, speedKmh: 8 })).toBeNull(); // creeping
    expect(voice.pick([{ ...stop, distance: 60 }], { ...free, now: 0 })?.key).toBe("s");
  });

  it("may say the same thing again after its repeat time", () => {
    const voice = new NoticeVoice();
    const limit = notice("limit", "limit:40", 100, { repeatAfter: 90_000 });
    expect(voice.pick([limit], { ...free, now: 0 })).not.toBeNull();
    expect(voice.pick([limit], { ...free, now: 60_000 })).toBeNull();
    expect(voice.pick([limit], { ...free, now: 100_000 })).not.toBeNull();
  });

  it("never says a shown-only notice", () => {
    const voice = new NoticeVoice();
    expect(voice.pick([notice("limit", "limit:60", 100, { voice: null })], { ...free, now: 0 })).toBeNull();
  });
});

describe("the panel with nothing to guide (current location)", () => {
  const base = {
    ward: "千代田区",
    town: "丸の内二丁目",
    road: "晴海通り（都道304号）",
    heading: "北東",
    limit: 50,
    mode: "car" as const,
    junctions: [{ distance: 182, name: "日比谷交差点" }],
    notice: null,
  };

  it("shows the town and ward, the heading, the street, its limit and the junctions ahead", () => {
    const v = idleView(base);
    expect([v.state, v.dist, v.sub, v.words, v.road, v.roadKnown, v.limit, v.walk]).toEqual([
      "idle",
      "丸の内二丁目",
      "千代田区",
      "北東へ進行中",
      "晴海通り（都道304号）",
      true,
      50,
      false,
    ]);
    expect(v.icon).toEqual({ kind: "compass", label: "北東" });
    expect(v.list).toEqual([{ icon: "straight", dist: "180m", name: "日比谷交差点" }]);
  });

  it("on foot: no limit, the walking badge", () => {
    const v = idleView({ ...base, mode: "walk" });
    expect([v.words, v.limit, v.walk]).toEqual(["北東へ歩行中", null, true]);
  });

  it("outside the town polygons and on a nameless street: placeholders, never empty slots", () => {
    const v = idleView({ ...base, ward: "—", town: "", road: null, junctions: [] });
    expect([v.dist, v.sub, v.road, v.roadKnown, v.list.length, v.listNote]).toEqual([
      "現在地",
      "",
      "道路名なし",
      false,
      0,
      "この先の交差点名はありません",
    ]);
  });

  it("says it is searching while a target has no route yet, and carries the notice", () => {
    const v = idleView({ ...base, searching: true, notice: { kind: "stop", text: "一時停止・60m" } });
    expect(v.words).toBe("ルートを探索しています");
    expect(v.notice).toEqual({ kind: "stop", text: "一時停止・60m" });
  });

  it("reads headings clockwise from north", () => {
    expect(headingOf(new Vector3(0, 0, -1))).toBeCloseTo(0);
    expect(headingOf(new Vector3(1, 0, 0))).toBeCloseTo(Math.PI / 2);
    expect(headingOf(new Vector3(0, 0, 1))).toBeCloseTo(Math.PI);
  });
});

describe("距離の表示", () => {
  it("reads 995–999 m as 1.0km, not 1000m (they round up to 1000 m)", async () => {
    const { formatDistance } = await import("../src/game/navView");
    expect(formatDistance(994)).toBe("990m");
    expect(formatDistance(996)).toBe("1.0km");
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(1260)).toBe("1.3km");
  });
});
