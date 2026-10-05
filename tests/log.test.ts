import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  error,
  log,
  LogRing,
  newSpan,
  recentLogs,
  setLogSink,
  setLogValidation,
  spanOf,
  traceId,
  warn,
  type LogEntry,
} from "../src/log";
import { BASE_KEYS, entrySchema, LOG_EVENTS, type LogEventName, type LogFields } from "../src/logEvents";
import { postSpan, type SocialPost } from "../src/game/social";
import { SESSION, TrafficLaw, VIOLATIONS, violationSpan } from "../src/game/traffic";

/**
 * One line of every event, as a call site would write it. The mapped type makes a new event in
 * logEvents.ts fail typecheck here until it has a sample, so every schema is parsed at least once.
 */
const SAMPLES: { [E in LogEventName]: LogFields<E> } = {
  log_schema_invalid: { invalidEvent: "accident", issues: [{ path: "speedKmh", message: "Required" }] },
  log_ship_dropped: { lines: 40 },
  session_start: {
    path: "/tokyo-od-game/",
    params: { start: "35.68,139.76" },
    seed: 12345,
    seeded: false,
    reproUrl: "http://localhost:5173/tokyo-od-game/?start=35.68%2C139.76&seed=12345",
    mode: "development",
    language: "ja",
    viewport: { width: 1600, height: 900, dpr: 2 },
  },
  drive_started: {
    time: "day",
    weather: "auto",
    raining: false,
    startLat: 35.68,
    startLon: 139.76,
    assist: "easy",
    graphicsPreset: "high",
    reproUrl: "http://localhost:5173/tokyo-od-game/?seed=12345&start=35.68%2C139.76&time=day&weather=clear",
  },
  uncaught_error: {
    source: "window_error",
    message: "x is undefined",
    stack: "TypeError: x is undefined\n    at tick (http://localhost:5173/tokyo-od-game/src/main.ts:10:5)",
    frames: [
      { fn: "tick", file: "/tokyo-od-game/src/main.ts", line: 10, column: 5, original: "src/main.ts:12:3" },
    ],
    spans: [{ spanId: "pursuit-2", parentId: "vio-x", lastEvent: "pursuit_stage" }],
    state: { mode: "car", lat: 35.68, lon: 139.76, backend: "webgpu", activeSpans: ["pursuit-2"] },
    recent: [{ ts: "2026-10-05T04:00:00.000Z", level: "info", event: "pursuit_stage", spanId: "pursuit-2" }],
    suppressed: 0,
  },
  game_started: {},
  title_reload: {},
  data_loaded: { pois: 2310, geoid: true, busStops: 3801 },
  data_load_failed: { file: "pois.json", error: "TypeError: Failed to fetch" },
  renderer_ready: { backend: "WebGPU", depth: "reversed", samples: 4 },
  gpu_device_lost: { reason: null, error: "device lost" },
  pipelines_compiled: { durationMs: 1840 },
  precompile_failed: { error: "Error: x" },
  prewarm_failed: { error: "Error: x" },
  controls_changed: {
    layout: "wasd",
    assist: "easy",
    seatUpM: 0,
    seatBackM: 0,
    volume: 0.8,
    minimap: true,
    minimapNorthUp: false,
    nav: true,
    charm: "none",
  },
  pad_connected: {
    padId: "057e-2009",
    name: "Pro Controller",
    mapping: "standard",
    family: "nintendo",
    source: "api",
  },
  pad_disconnected: { padId: "057e-2009" },
  pad_profile_changed: {
    padId: "057e-2009",
    changedBindings: 2,
    gyro: true,
    rumble: true,
    steerDeadzone: 0.1,
    throttleButton: 7,
  },
  procon_hid_connected: { name: "Pro Controller", usb: false, reportBytes: 48 },
  procon_hid_disconnected: {},
  procon_hid_failed: { step: "open", error: "NotAllowedError: x" },
  perf_phase: { phase: "violation.total", durationMs: 3.4, blocking: true },
  i18n_missing: { locale: "en", key: "toast.found" },
  speech_no_voice: { lang: "zh-CN", voices: 0 },
  avatar_studio_failed: { error: "Error: x" },
  checkpoint_model_failed: { error: "Error: x" },
  heli_model_failed: { error: "Error: x" },
  cockpit_load_failed: { error: "Error: x" },
  darkroom_failed: { error: "x" },
  road_worker_failed: { error: "x" },
  road_network_failed: { error: "x" },
  road_network_prepared: {
    backend: "worker",
    segments: 100,
    computeMs: 100,
    restoreMs: 1,
    sendMs: 1,
    durationMs: 105,
  },
  darkroom_grab_failed: { error: "Error: x" },
  guide_fonts_failed: { error: "Error: x" },
  guide_signs_load_failed: { error: "Error: x" },
  landmarks_load_failed: { error: "Error: x" },
  landmark_model_failed: { path: "models/tokyo_tower.glb", error: "Error: x" },
  mirror_charms_load_failed: { error: "Error: x" },
  officer_model_failed: { kind: "police", error: "Error: x" },
  orbis_load_failed: { error: "Error: x" },
  portable_orbis_load_failed: { error: "Error: x" },
  smartphone_load_failed: { error: "Error: x" },
  vehicle_model_failed: { kind: "bus", error: "Error: x" },
  llm_enable_failed: { error: "Error: x" },
  llm_reply_failed: { error: "Error: x" },
  tts_init_failed: { error: "wasm" },
  amedas_fetch_failed: { error: "Error: x" },
  odpt_poll_failed: { error: "Error: x" },
  tide_table_failed: { year: 2026, error: "Error: x" },
  water_levels_failed: { error: "Error: x" },
  screen_grab_failed: { error: "Error: x" },
  pavement_tile_failed: { key: "13101", error: "Error: x" },
  regulation_tile_failed: { path: "regs/14550-6450.json", error: "Error: x" },
  road_tile_failed: { key: "14/14550/6450", error: "Error: x" },
  route_tile_failed: { key: "14/14550/6450", error: "Error: x" },
  water_tile_failed: { key: "14/14550/6450", error: "Error: x" },
  road_network_built: {
    segments: 4210,
    oneway: 380,
    posted: 900,
    signals: 120,
    stops: 40,
    crossings: 300,
    signs: 210,
  },
  pavements_built: { wards: ["千代田区"], polygons: 812 },
  frame_recentered: { lat: 35.68124, lon: 139.76712 },
  guide_signs_placed: { signs: 12, advance: 3, overhead: 5, routed: 9, mapped: 40, durationMs: 18 },
  street_lights_placed: {
    lamps: 600,
    sodium: 40,
    byClass: { arterial: 100, main: 200, street: 150, residential: 100, lane: 50 },
    signals: 80,
    durationMs: 22,
  },
  orbis_placed: {
    sites: [{ siteId: 3, kind: "gantry", lanes: 2, limitKmh: 60 }],
    signs: 2,
    portable: [{ at: [35.66, 139.65], bearingDeg: null, limitKmh: 30, key: "grid" }],
  },
  closure_area_implausible: { areaKm2: 317.2, maxKm2: 5, kind: 1, at: [139.65, 35.64] },
  closures_implausible_share: { closed: 300, streets: 900, maxShare: 0.2 },
  trip_started: { target: "東京タワー", distanceM: 2400 },
  destination_set: { name: "浅草寺", distanceKm: 5.1 },
  poi_collected: { poiId: 12, category: "library", ward: "千代田区" },
  accident: { kind: "pedestrian", speedKmh: 32 },
  lane_turn_disallowed: { lanes: ["left", "straight+right"], lane: 0, turn: "right", source: "osm" },
  route_lane_blocked: { turns: 1, attempt: 0, replanned: true },
  autopilot_on: { cruising: true, routeM: 1200 },
  autopilot_off: {},
  autopilot_gave_up: { why: "stuck" },
  taxi_no_route: { to: "東京駅" },
  taxi_ride: { fareYen: 1500, distanceM: 3200, slowS: 40 },
  warp_start: { to: "渋谷駅", lat: 35.658, lon: 139.7016 },
  warp_landed: { to: "渋谷駅", durationMs: 4200 },
  day_end: { distanceM: 12000, violations: 3, caught: 1, notices: 1, points: 2, sanction: "none" },
  sanction: { kind: "suspension", suspendedDays: 30, course: true, prior: 1 },
  violation_booked: {
    violationId: "000001759650000000-0001",
    kind: "signal",
    status: "uncaught",
    points: 2,
    totalPoints: 0,
    place: "千代田区 丸の内二丁目",
    lat: 35.68,
    lon: 139.76,
    speedKmh: 38,
    limitKmh: 40,
    detail: undefined,
  },
  violation_cited: { violationId: "x", kind: "signal", by: "patrol", via: "spot", points: 2, totalPoints: 2 },
  violation_noticed: { violationId: "x", kind: "speed", by: "orbis" },
  replay_clip_saved: { violationId: "x", samples: 100 },
  orbis_fired: { siteId: 3, kind: "gantry", lane: 1, speedKmh: 95, limitKmh: 60, violationId: null },
  social_filmed: { kind: "signal", filmers: 2, witnesses: 9 },
  social_post: { postId: 7, kind: "signal", witnesses: 9, reach: 1200 },
  witness_shot: {
    postId: 7,
    account: "a12",
    device: "phone",
    view: "side",
    focalMm: 26,
    aspect: "9:16",
    distanceM: 18,
    probes: 3,
  },
  witness_shot_failed: { postId: 7, error: "Error: x" },
  social_reported: { postId: 7, kind: "signal", reposts: 12000 },
  social_praise: { kind: "crosswalk" },
  social_video_played: { postId: 7, camera: "witness" },
  social_stop_post: { postId: 9, phase: "ticket", reach: 300 },
  patrol_pursuit: { unitKind: "patrol", violationIds: ["x"] },
  patrol_ticket: { unitKind: "patrol", kinds: ["signal"], violationIds: ["x"], totalPoints: 2 },
  patrol_lost: { unitKind: "unmarked", violationIds: ["x"] },
  pursuit_begin: { unitKind: "patrol", article67: false, violationIds: ["x"] },
  pursuit_dangerous_injury: { item: 4, points: 45, violationId: "x" },
  pursuit_unit_hit: { unitKind: "patrol", deliberate: false, speedKmh: 20 },
  pursuit_overlap: { stop: true, story: false },
  pursuit_fleeing: {},
  pursuit_stage: { stage: 2 },
  pursuit_checkpoint: { aheadM: 320 },
  pursuit_end: { end: "stopped", fled: false, stage: 1, records: 1, violationIds: ["x"] },
  pursuit_criminal: { why: "procedure.fled", kinds: ["signal"], violationIds: ["x"] },
  pursuit_identified: { kind: "laterNotice" },
  stop_begin: { end: "stopped", disposal: "blue", safe: true, issues: [], violationIds: ["x"] },
  stop_ticket: { disposal: "blue", kinds: ["signal"], violationIds: ["x"], totalPoints: 2 },
  stop_end: { disposal: "blue" },
  story_begin: { kind: "arrest", panels: 5 },
  fetch_retry: { url: "https://example.org/a.csv", attempt: 2, error: "Error: HTTP 503" },
  cache_hit: { file: ".cache/osm.pbf", ageH: 20 },
  download: { url: "https://example.org/a.zip" },
  source_parsed: { url: "https://example.org/a.csv", rows: 120, kept: 100, skipped: 20 },
  licence_verified: { dataset: "t000001", license: "CC-BY-4.0", note: null },
  poi_dropped_ward_mismatch: { name: "某図書館", stated: "港区", located: "品川区" },
  pois_written: { total: 2000, counts: { library: 200 }, wards: { 千代田区: 80 } },
  areas_written: { towns: 3100 },
  busstops_written: { stops: 3800 },
  geoid_written: { points: 400, minM: 36.1, maxM: 37.2 },
  jartic_download: { month: "202609", link: "https://example.org/jartic.zip" },
  jartic_parsed: {
    counts: { "1": 10 },
    skipped: { "113": { variable: 3 } },
    closureSkipped: { area: 1 },
    tiles: 900,
  },
  jartic_closure_skipped: {
    reason: "area",
    key: "k1",
    code: "1",
    areaKm2: 317.2,
    maxKm2: 5,
    vertices: 400,
    at: [139.65, 35.64],
  },
  osm_parsed: {
    police: 102,
    orbis: 25,
    centres: ["府中"],
    signals: 15000,
    named: 3000,
    footbridges: 400,
    stairs: 800,
    turnlanes: 2000,
  },
  police_written: { stations: 102, orbis: 25, bySource: { osm: 25 } },
  osm_loaded: { bytes: 400_000_000 },
  ways_read: { roads: 1000, dests: 300, nodes: 90000 },
  places_located: { placed: 300, stations: 120, missing: ["某"], via: { 新宿: "signal" } },
  guide_signs_written: { tiles: 900, roads: 1000, dests: 300, places: 300, chars: 2400 },
  osm_read: { nodes: 1, ways: 2, relations: 3, coords: 4 },
  destinations_written: {
    file: "public/data/destinations.json",
    items: 4183,
    counts: { station: 490 },
    featured: [],
    movedIntoWards: 3,
    brandQids: [],
    durationS: 40,
    rssMb: 900,
  },
  moved_into_wards: { list: ["葛西臨海公園"] },
  water_stations: { all: 200, levelStations: 120, wards: 60 },
  station_page_unreadable: { code: "101", name: "某橋" },
  levels_missing: { day: "20261001" },
  water_levels_written: { file: "public/data/water-levels.json", gauges: 60, tidal: 12, bay: { tp: 0.1 } },
};

/** What the logger wrote while `fn` ran, oldest first. */
function captured(fn: () => void): LogEntry[] {
  const lines: LogEntry[] = [];
  setLogSink((_level, line) => lines.push(JSON.parse(line) as LogEntry));
  try {
    fn();
  } finally {
    setLogSink(() => {});
  }
  return lines;
}

describe("the event registry (logEvents.ts)", () => {
  const names = Object.keys(LOG_EVENTS) as LogEventName[];

  it("has a sample for every event that its schema accepts", () => {
    expect(Object.keys(SAMPLES).toSorted()).toEqual(names.toSorted());
    for (const name of names) {
      const parsed = LOG_EVENTS[name].fields.safeParse(SAMPLES[name]);
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("names events in snake_case and fields in camelCase, never with a line's own keys", () => {
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      for (const field of Object.keys(LOG_EVENTS[name].fields.shape)) {
        expect(field, `${name}.${field}`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        expect(BASE_KEYS as readonly string[], `${name}.${field}`).not.toContain(field);
      }
    }
  });

  it("writes lines that parse as base keys plus the event's fields", () => {
    const lines = captured(() => {
      for (const name of names) {
        const level = LOG_EVENTS[name].level;
        const write = level === "info" ? log : level === "warn" ? warn : error;
        (write as (e: string, f: object, s?: object) => void)(name, SAMPLES[name], newSpan("test"));
      }
    });
    expect(lines.map((l) => l.event)).toEqual(names);
    for (const line of lines) {
      const parsed = entrySchema(line.event as LogEventName).safeParse(line);
      expect(parsed.success, `${line.event}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(line.traceId).toBe(traceId);
    }
  });
});

describe("the logger (log.ts)", () => {
  beforeEach(() => setLogValidation("all"));
  afterEach(() => setLogValidation("all"));

  it("takes only registered events with their own fields, at their own level (typecheck)", () => {
    const lines = captured(() => {
      // @ts-expect-error: not an event in logEvents.ts
      log("no_such_event", {});
      // @ts-expect-error: a field the event does not have (the old `kmh`)
      log("accident", { kind: "car", speedKmh: 30, kmh: 30 });
      // @ts-expect-error: a required field left out
      log("accident", { kind: "car" });
      // @ts-expect-error: a field of the wrong type
      log("accident", { kind: "car", speedKmh: "30" });
      // @ts-expect-error: a warn event written with log()
      log("road_tile_failed", { key: "k", error: "e" });
      // @ts-expect-error: an info event written with warn()
      warn("accident", { kind: "car", speedKmh: 30 });
    });
    // At run time each of them is still written, and reported once.
    const invalid = lines.filter((l) => l.event === "log_schema_invalid");
    expect(invalid.map((l) => l.invalidEvent)).toEqual([
      "no_such_event",
      "accident",
      "accident",
      "accident",
      "road_tile_failed",
      "accident",
    ]);
    expect(JSON.stringify(invalid[0].issues)).toContain("unknown event");
    expect(JSON.stringify(invalid[1].issues)).toContain("kmh");
    expect(JSON.stringify(invalid[2].issues)).toContain("speedKmh");
    expect(JSON.stringify(invalid[4].issues)).toContain("warn event");
  });

  it("reports an invalid line with the span of the line, and never throws", () => {
    const span = newSpan("warp");
    const lines = captured(() => {
      expect(() => log("warp_landed", { to: 3 } as never, span)).not.toThrow();
    });
    const report = lines.find((l) => l.event === "log_schema_invalid");
    expect(report?.level).toBe("warn");
    expect(report?.spanId).toBe(span.spanId);
    expect(report?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "to" }),
        expect.objectContaining({ path: "durationMs" }),
      ]),
    );
  });

  it("checks only the first line of each event in production mode", () => {
    setLogValidation("first");
    const lines = captured(() => {
      log("accident", { kind: "car", speedKmh: 30 });
      log("accident", { kind: "car" } as never);
      log("pursuit_stage", {} as never);
    });
    expect(lines.filter((l) => l.event === "log_schema_invalid").map((l) => l.invalidEvent)).toEqual([
      "pursuit_stage",
    ]);
  });

  it("uses the page's session as the trace, so a saved violation finds its lines", () => {
    expect(SESSION).toBe(traceId);
  });
});

describe("spans", () => {
  it("number new spans within the trace and keep their parent", () => {
    const parent = newSpan("pursuit");
    const child = newSpan("stop", parent);
    expect(parent.spanId).toMatch(/^pursuit-\d+$/);
    expect(child).toEqual({ spanId: expect.stringMatching(/^stop-\d+$/), parentId: parent.spanId });
    expect(spanOf("post", 7, parent)).toEqual({ spanId: "post-7", parentId: parent.spanId });
  });

  it("follow a violation through its notice, the post, the shot and a pursuit (recentLogs.chain)", () => {
    recentLogs.clear();
    const law = new TrafficLaw();
    const record = law.commit(VIOLATIONS.signal, 1000, 0);
    if (!record?.id) throw new Error("commit gives an id");
    const vio = violationSpan(record);
    expect(vio).toEqual({ spanId: `vio-${record.id}` });
    const post = { id: 41, record } as unknown as SocialPost;
    const unrelated = newSpan("warp");
    captured(() => {
      log(
        "violation_booked",
        {
          violationId: record.id ?? "",
          kind: record.kind,
          status: record.status,
          points: 2,
          totalPoints: 0,
          speedKmh: 40,
        },
        vio,
      );
      log("warp_start", { to: "渋谷", lat: 35.6, lon: 139.7 }, unrelated);
      log("social_post", { postId: post.id, kind: record.kind, witnesses: 3, reach: 100 }, postSpan(post));
      log(
        "witness_shot",
        {
          postId: post.id,
          account: "a",
          device: "phone",
          view: "side",
          focalMm: 26,
          aspect: "9:16",
          distanceM: 9,
          probes: 1,
        },
        postSpan(post),
      );
      const pursuit = newSpan("pursuit", vio);
      log(
        "pursuit_begin",
        { unitKind: "patrol", article67: false, violationIds: [record.id ?? ""] },
        pursuit,
      );
      log(
        "stop_begin",
        { end: "stopped", disposal: "blue", safe: true, issues: [], violationIds: [] },
        newSpan("stop", pursuit),
      );
      law.cite(record, "patrol");
    });
    const chain = recentLogs.chain(vio?.spanId ?? "");
    expect(chain.map((e) => e.event)).toEqual([
      "violation_booked",
      "social_post",
      "witness_shot",
      "pursuit_begin",
      "stop_begin",
      "violation_cited",
    ]);
    expect(chain.find((e) => e.event === "witness_shot")?.parentId).toBe(vio?.spanId);
    expect(chain.find((e) => e.event === "violation_cited")).toMatchObject({
      violationId: record.id,
      by: "patrol",
      via: "spot",
    });
  });
});

/** A line at 2026-10-05 00:00:<n>Z. */
const entry = (n: number, event = "accident", spanId?: string): LogEntry => ({
  ts: new Date(Date.UTC(2026, 9, 5, 0, 0, n)).toISOString(),
  level: "info",
  event,
  traceId: "t",
  build: "b",
  ...(spanId ? { spanId } : {}),
  n,
});

describe("the ring of recent lines (LogRing)", () => {
  it("keeps only the last `capacity` lines, oldest first", () => {
    const ring = new LogRing(3);
    for (let n = 1; n <= 5; n++) ring.push(entry(n));
    expect(ring.size).toBe(3);
    expect(ring.all().map((e) => e.n)).toEqual([3, 4, 5]);
    ring.clear();
    expect(ring.all()).toEqual([]);
  });

  it("filters by event (name, list or pattern), span, time and a limit, and writes JSON lines", () => {
    const ring = new LogRing(10);
    ring.push(entry(1, "pursuit_begin", "pursuit-1"));
    ring.push(entry(2, "pursuit_stage", "pursuit-1"));
    ring.push(entry(3, "warp_start", "warp-2"));
    ring.push(entry(4, "pursuit_end", "pursuit-1"));
    expect(ring.query({ event: "warp_start" }).map((e) => e.n)).toEqual([3]);
    expect(ring.query({ event: /^pursuit_/ }).map((e) => e.n)).toEqual([1, 2, 4]);
    expect(ring.query({ event: ["pursuit_begin", "warp_start"] }).map((e) => e.n)).toEqual([1, 3]);
    expect(ring.query({ spanId: "pursuit-1", limit: 2 }).map((e) => e.n)).toEqual([2, 4]);
    expect(ring.query({ since: entry(3).ts }).map((e) => e.n)).toEqual([3, 4]);
    const lines = ring.jsonl(ring.query({ spanId: "warp-2" })).split("\n");
    expect(lines.map((l) => (JSON.parse(l) as LogEntry).event)).toEqual(["warp_start"]);
  });
});

// ---------- the sources ----------

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const FILES = [...sources(join(ROOT, "src")), ...sources(join(ROOT, "scripts"))].map((p) => ({
  path: relative(ROOT, p),
  // Comments out (a `console.log` in a doc comment is not a call).
  code: readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1"),
}));

describe("the call sites (src/ and scripts/)", () => {
  it("write through the logger, not console.* (only the logger's own sink may)", () => {
    const ALLOWED = new Set(["src/log.ts"]);
    const offenders = FILES.filter(
      (f) => !ALLOWED.has(f.path) && /\bconsole\.(log|info|warn|error|debug)\b/.test(f.code),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("name only registered events in log() / warn() / error()", () => {
    const known = new Set(Object.keys(LOG_EVENTS));
    const unknown: string[] = [];
    for (const f of FILES) {
      for (const m of f.code.matchAll(/(?<![\w.])(log|warn|error|logError)\(\s*"([^"]+)"/g))
        if (!known.has(m[2])) unknown.push(`${f.path}: ${m[2]}`);
    }
    expect(unknown).toEqual([]);
  });

  it("do not keep a logger of their own (a local `const log = (event, …) =>`)", () => {
    const local = FILES.filter((f) => /\bconst (log|warn)\s*=\s*\(\s*event\b/.test(f.code)).map(
      (f) => f.path,
    );
    expect(local).toEqual([]);
  });
});
