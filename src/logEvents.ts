import { z } from "zod";

/**
 * Every structured log event the game and the build scripts write, one zod schema per event name
 * (knowledge/logging.md). log.ts types its log()/warn()/error() by this table and checks the fields
 * against it at run time, so a line in the console always has the shape written here.
 *
 * Conventions (the registry test checks the mechanical ones):
 * - event names are snake_case, `<subject>_<what happened>` (`pursuit_stage`, `road_tile_failed`);
 *   one name means one shape: no `event` sub-field that would overwrite the line's own `event`.
 * - fields are camelCase; a quantity carries its unit as a suffix: `Ms` `S` `H` (time), `M` `Km`
 *   (distance), `Kmh` (speed), `Km2`, `Deg`, `Mm` (focal length), `Mb`, `Yen`. Counts are plain
 *   plural nouns (`segments`, `lamps`), ids end in `Id` / `Ids`, a failure's message is `error`.
 * - the line's own keys (ts, level, event, traceId, spanId, parentId) are never event fields.
 *
 * Why not z.enum for kinds (violation kind, unit kind…): the schemas would have to import the game
 * modules that define them (three.js and the world among them) into the logger, which boot.ts and
 * the Node scripts load first; a string keeps the logger a leaf module. Strict objects still catch
 * a renamed or misspelt field, which is what goes wrong at call sites.
 */

const info = <S extends z.ZodRawShape>(shape: S) => ({
  level: "info" as const,
  fields: z.strictObject(shape),
});
const warning = <S extends z.ZodRawShape>(shape: S) => ({
  level: "warn" as const,
  fields: z.strictObject(shape),
});
const failure = <S extends z.ZodRawShape>(shape: S) => ({
  level: "error" as const,
  fields: z.strictObject(shape),
});

const count = z.number().int().nonnegative();
const milliseconds = z.number().nonnegative();
const counts = z.record(z.string(), count);
/** String(error) of a caught failure ("TypeError: …"). */
const error = z.string();
/** [lat, lon]. */
const latLon = z.array(z.number()).length(2);
const ids = z.array(z.string());

/** A failure with nothing more to say than the error. */
const failedWith = <S extends z.ZodRawShape = {}>(extra?: S) => warning({ ...(extra as S), error });

export const LOG_EVENTS = {
  // ---------- the logger itself ----------
  /** A log call whose fields did not match its schema (or an event not in this table). */
  log_schema_invalid: warning({
    invalidEvent: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),

  /** The page shipped fewer lines to the dev server than it wrote (its queue was full). */
  log_ship_dropped: warning({ lines: count }),

  // ---------- start-up, reproduction and failures (diagnostics.ts) ----------
  /** The first line of a page load: what it takes to load it again the same way. */
  session_start: info({
    path: z.string(),
    params: z.record(z.string(), z.string()),
    /** Math.random's seed (from ?seed= or drawn now): the same seed, the same random sequence. */
    seed: z.number().int().nonnegative(),
    seeded: z.boolean(),
    reproUrl: z.string(),
    mode: z.string(),
    language: z.string(),
    viewport: z.strictObject({ width: count, height: count, dpr: z.number() }),
  }),
  /** スタート: the drive's own random choices, and the URL that starts the same drive. */
  drive_started: info({
    time: z.string(),
    weather: z.string(),
    raining: z.boolean(),
    startLat: z.number(),
    startLon: z.number(),
    assist: z.string(),
    graphicsPreset: z.string(),
    reproUrl: z.string(),
  }),
  /**
   * A failure nothing handled (window error, unhandled rejection, WebGPU device lost, main() failing),
   * with where it was thrown (frames; `original` is the TypeScript file:line the dev server mapped it
   * to), the spans active around it, the game's state and the lines just before it.
   */
  uncaught_error: failure({
    source: z.enum(["window_error", "unhandled_rejection", "device_lost", "fatal"]),
    message: z.string(),
    stack: z.string().nullable(),
    frames: z.array(
      z.strictObject({
        fn: z.string().optional(),
        file: z.string(),
        line: z.number().int(),
        column: z.number().int(),
        original: z.string().optional(),
      }),
    ),
    spans: z.array(
      z.strictObject({ spanId: z.string(), parentId: z.string().optional(), lastEvent: z.string() }),
    ),
    state: z
      .strictObject({
        mode: z.string().optional(),
        state: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        gameTime: z.string().optional(),
        timeMode: z.string().optional(),
        weather: z.string().optional(),
        graphicsPreset: z.string().optional(),
        backend: z.string().optional(),
        activeSpans: z.array(z.string()).optional(),
      })
      .nullable(),
    recent: z.array(
      z.strictObject({ ts: z.string(), level: z.string(), event: z.string(), spanId: z.string().optional() }),
    ),
    /** The same failure seen again within 5 s before this line (not each logged). */
    suppressed: count,
  }),

  // ---------- start-up and the page ----------
  game_started: info({}),
  /** 終了: back to the title (the page reloads). */
  title_reload: info({}),
  data_loaded: info({ pois: count, geoid: z.boolean(), busStops: count }),
  data_load_failed: failedWith({ file: z.string() }),
  renderer_ready: info({ backend: z.string(), depth: z.string(), samples: count }),
  gpu_device_lost: warning({ reason: z.string().nullable(), error }),
  pipelines_compiled: info({ durationMs: z.number() }),
  precompile_failed: failedWith(),
  streamed_shader_failed: failedWith({ meshId: z.string() }),
  streamed_shaders_prepared: info({ meshes: count, durationMs: milliseconds }),
  prewarm_failed: failedWith(),
  controls_changed: info({
    layout: z.string(),
    assist: z.string(),
    seatUpM: z.number(),
    seatBackM: z.number(),
    volume: z.number(),
    minimap: z.boolean(),
    minimapNorthUp: z.boolean(),
    nav: z.boolean(),
    charm: z.string(),
  }),
  // ---------- gamepads and the Pro Controller over WebHID (gamepad.ts, procon.ts) ----------
  /** The pad in use changed (first press, or another pad pressed); `source` api or hid. */
  pad_connected: info({
    padId: z.string(),
    name: z.string(),
    mapping: z.string(),
    family: z.string(),
    source: z.string(),
  }),
  /** The pad in use is gone and none is left. */
  pad_disconnected: info({ padId: z.string() }),
  /** 設定 › コントローラー saved (once per change, not per slider step). */
  pad_profile_changed: info({
    padId: z.string(),
    changedBindings: count,
    gyro: z.boolean(),
    rumble: z.boolean(),
    steerDeadzone: z.number(),
    /** -1: unbound. */
    throttleButton: z.number().int(),
  }),
  /** The Pro Controller opened over WebHID; `reportBytes` its output report size (63 USB, 48 BT). */
  procon_hid_connected: info({ name: z.string(), usb: z.boolean(), reportBytes: count }),
  procon_hid_disconnected: info({}),
  /** A WebHID step failed: restore, request, open, init or rumble. */
  procon_hid_failed: warning({ step: z.string(), error }),
  /** A timed phase over 2 ms (perf.ts, dev builds): `blocking` is main-thread work in one go. */
  perf_phase: info({ phase: z.string(), durationMs: z.number(), blocking: z.boolean() }),
  i18n_missing: warning({ locale: z.string(), key: z.string() }),
  speech_no_voice: warning({ lang: z.string(), voices: count }),

  // ---------- models, data and services that failed to load ----------
  avatar_studio_failed: failedWith(),
  checkpoint_model_failed: failedWith(),
  heli_model_failed: failedWith(),
  cockpit_load_failed: failedWith(),
  darkroom_failed: failedWith(),
  darkroom_grab_failed: failedWith(),
  guide_fonts_failed: failedWith(),
  guide_signs_load_failed: failedWith(),
  landmarks_load_failed: failedWith(),
  landmark_model_failed: failedWith({ path: z.string() }),
  mirror_charms_load_failed: failedWith(),
  officer_model_failed: failedWith({ kind: z.string() }),
  orbis_load_failed: failedWith(),
  portable_orbis_load_failed: failedWith(),
  smartphone_load_failed: failedWith(),
  vehicle_model_failed: failedWith({ kind: z.string() }),
  llm_enable_failed: failedWith(),
  llm_reply_failed: failedWith(),
  tts_init_failed: failedWith(),
  tts_synth_failed: failedWith({ locale: z.enum(["ja", "en", "zh"]), id: count }),
  amedas_fetch_failed: failedWith(),
  odpt_poll_failed: failedWith(),
  tide_table_failed: failedWith({ year: z.number().int() }),
  water_levels_failed: failedWith(),
  screen_grab_failed: failedWith(),
  pavement_tile_failed: failedWith({ key: z.string() }),
  regulation_tile_failed: failedWith({ path: z.string() }),
  road_tile_failed: failedWith({ key: z.string() }),
  road_worker_failed: failedWith(),
  dem_worker_failed: failedWith(),
  water_worker_failed: failedWith(),
  building_worker_failed: failedWith(),
  building_shader_failed: failedWith({ key: z.string() }),
  building_shader_prepared: info({ key: z.string(), meshes: count, durationMs: z.number() }),
  terrain_worker_failed: failedWith(),
  collider_worker_failed: failedWith(),
  terrain_build_failed: failedWith({ key: z.string() }),
  road_network_failed: failedWith(),
  route_tile_failed: failedWith({ key: z.string() }),
  water_tile_failed: failedWith({ key: z.string() }),

  // ---------- the world as built ----------
  collider_shape_prepared: info({
    key: z.string(),
    backend: z.enum(["worker", "inline"]),
    vertices: count,
    triangles: count,
    bytes: count,
    computeMs: z.number(),
    sendMs: z.number(),
    durationMs: z.number(),
  }),
  terrain_chunk_prepared: info({
    key: z.string(),
    backend: z.enum(["worker", "inline"]),
    vertices: count,
    computeMs: z.number(),
    prepareMs: z.number(),
    sendMs: z.number(),
    mainMs: z.number(),
    durationMs: z.number(),
    maxSliceMs: z.number(),
    yields: count,
  }),
  building_facade_prepared: info({
    key: z.string(),
    backend: z.enum(["worker", "inline"]),
    vertices: count,
    computeMs: z.number(),
    prepareMs: z.number(),
    sendMs: z.number(),
    mainMs: z.number(),
    durationMs: z.number(),
    maxSliceMs: z.number(),
    yields: count,
  }),
  building_batch_table_skipped: info({
    url: z.string(),
    bytesBefore: count,
    bytesAfter: count,
    cpuMs: z.number(),
  }),
  water_masks_prepared: info({
    backend: z.enum(["worker", "inline"]),
    x: z.number().int(),
    y: z.number().int(),
    size: count,
    computeMs: z.number(),
    durationMs: z.number(),
    bytes: count,
  }),
  road_network_prepared: info({
    backend: z.enum(["worker", "inline"]),
    segments: count,
    computeMs: z.number(),
    restoreMs: z.number(),
    sendMs: z.number(),
    readMs: z.number(),
    unpackMs: z.number(),
    packMs: z.number(),
    maxSliceMs: z.number(),
    yields: count,
    durationMs: z.number(),
  }),
  road_network_built: info({
    durationMs: z.number().optional(),
    cpuMs: z.number().optional(),
    maxSliceMs: z.number().optional(),
    yields: count.optional(),
    stagesMs: z.record(z.string(), z.number()).optional(),
    segments: count,
    oneway: count,
    posted: count,
    signals: count,
    stops: count,
    crossings: count,
    signs: count,
  }),
  pavements_built: info({ wards: z.array(z.string()), polygons: count }),
  frame_recentered: info({
    lat: z.number(),
    lon: z.number(),
    anchorMs: z.number().optional(),
    stagesMs: z.record(z.string(), z.number()).optional(),
  }),
  guide_signs_placed: info({
    signs: count,
    advance: count,
    overhead: count,
    routed: count,
    mapped: count,
    durationMs: z.number(),
  }),
  street_lights_placed: info({
    lamps: count,
    sodium: count,
    byClass: counts,
    signals: count,
    durationMs: z.number(),
  }),
  orbis_placed: info({
    sites: z.array(
      z.strictObject({ siteId: z.number().int(), kind: z.string(), lanes: count, limitKmh: z.number() }),
    ),
    signs: count,
    portable: z.array(
      z.strictObject({
        at: latLon,
        bearingDeg: z.number().nullable(),
        limitKmh: z.number(),
        key: z.string().optional(),
      }),
    ),
  }),
  closure_area_implausible: warning({
    areaKm2: z.number(),
    maxKm2: z.number(),
    /** closures.ts CLOSURE code. */
    kind: z.number().int(),
    at: z.array(z.number()),
  }),
  closures_implausible_share: warning({ closed: count, streets: count, maxShare: z.number() }),

  // ---------- driving ----------
  trip_started: info({ target: z.string(), distanceM: z.number() }),
  destination_set: info({ name: z.string(), distanceKm: z.number() }),
  poi_collected: info({ poiId: z.number().int(), category: z.string(), ward: z.string() }),
  /** A crash: the car's speed, and for a body with a mass the blow by both masses (Δv, energy). */
  accident: info({
    kind: z.string(),
    speedKmh: z.number(),
    otherDeltaVKmh: z.number().optional(),
    carDeltaVKmh: z.number().optional(),
    energyKj: z.number().optional(),
    otherMassKg: z.number().optional(),
  }),
  /** Left a junction the way its lane does not allow (the booking follows). */
  lane_turn_disallowed: info({
    lanes: z.array(z.string()),
    lane: count,
    turn: z.string(),
    source: z.string(),
  }),
  /**
   * A car route turns where its lane cannot get to without crossing a yellow lane line (進路変更禁止):
   * `turns` such junctions, on try `attempt`; `replanned` when it is planned again without them.
   */
  route_lane_blocked: info({ turns: count, attempt: count, replanned: z.boolean() }),
  route_worker_failed: failedWith(),
  route_plan_discarded: info({ reason: z.enum(["graph", "rules"]) }),
  route_plan_applied: info({ mainMs: milliseconds, found: z.boolean() }),
  route_plan_prepared: info({
    backend: z.enum(["worker", "inline"]),
    segments: count,
    found: z.boolean(),
    computeMs: milliseconds,
    prepareMs: milliseconds,
    restoreMs: milliseconds,
    sendMs: milliseconds,
    durationMs: milliseconds,
  }),
  autopilot_on: info({ cruising: z.boolean(), routeM: z.number() }),
  autopilot_off: info({}),
  autopilot_gave_up: info({ why: z.string() }),
  taxi_no_route: info({ to: z.string() }),
  taxi_ride: info({ fareYen: z.number(), distanceM: z.number(), slowS: z.number() }),
  /** Span `warp-<n>`: from the choice to the car standing in the loaded town (warp_landed). */
  warp_start: info({ to: z.string(), lat: z.number(), lon: z.number() }),
  warp_landed: info({ to: z.string(), durationMs: z.number() }),
  day_end: info({
    distanceM: z.number(),
    violations: count,
    caught: count,
    notices: count,
    points: z.number(),
    sanction: z.string(),
  }),
  sanction: info({ kind: z.string(), suspendedDays: z.number(), course: z.boolean(), prior: count }),

  // ---------- a violation and what follows it (span vio-<record id>) ----------
  violation_booked: info({
    violationId: z.string(),
    kind: z.string(),
    status: z.string(),
    points: z.number(),
    totalPoints: z.number(),
    place: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    speedKmh: z.number().nullable(),
    limitKmh: z.number().nullable().optional(),
    detail: z.string().optional(),
  }),
  /** Caught: the points count now (`via: "post"` for a notice delivered at the end of the day). */
  violation_cited: info({
    violationId: z.string(),
    kind: z.string(),
    by: z.string(),
    via: z.enum(["spot", "post"]),
    points: z.number(),
    totalPoints: z.number(),
  }),
  /** A notice to appear is on its way (orbis, a read plate, a post the police saw). */
  violation_noticed: info({ violationId: z.string(), kind: z.string(), by: z.string() }),
  /** The ±5 s clip of the violation, cut from the recording for the saved history. */
  replay_clip_saved: info({ violationId: z.string(), samples: count }),
  orbis_fired: info({
    siteId: z.number().int(),
    kind: z.string(),
    lane: z.number().int().nullable(),
    speedKmh: z.number(),
    limitKmh: z.number(),
    violationId: z.string().nullable(),
  }),
  social_filmed: info({ kind: z.string(), filmers: count, witnesses: count }),
  /** Span post-<id>, parent the violation: a bystander's post went up. */
  social_post: info({ postId: z.number().int(), kind: z.string(), witnesses: count, reach: z.number() }),
  witness_shot: info({
    postId: z.number().int(),
    account: z.string(),
    device: z.string(),
    view: z.string(),
    focalMm: z.number(),
    aspect: z.string(),
    distanceM: z.number(),
    probes: count,
  }),
  witness_shot_failed: failedWith({ postId: z.number().int() }),
  /** The police saw the post: the violation becomes a notice (violation_noticed by "sns"). */
  social_reported: info({ postId: z.number().int(), kind: z.string(), reposts: count }),
  social_praise: info({ kind: z.string() }),
  social_video_played: info({ postId: z.number().int(), camera: z.string() }),
  /** A passer-by posted the roadside stop (span of the stop). */
  social_stop_post: info({ postId: z.number().int(), phase: z.string(), reach: z.number() }),

  // ---------- the police ----------
  /** A patrol unit lit up for what it saw (span: the violation it saw last). */
  patrol_pursuit: info({ unitKind: z.string().nullable(), violationIds: ids }),
  patrol_ticket: info({
    unitKind: z.string(),
    kinds: z.array(z.string()),
    violationIds: ids,
    totalPoints: z.number(),
  }),
  patrol_lost: info({ unitKind: z.string(), violationIds: ids }),
  /** Span pursuit-<n>, parent the violation the lead unit saw last; every pursuit_* carries it. */
  pursuit_begin: info({ unitKind: z.string(), article67: z.boolean(), violationIds: ids }),
  pursuit_dangerous_injury: info({ item: z.number().int(), points: z.number(), violationId: z.string() }),
  pursuit_unit_hit: info({ unitKind: z.string(), deliberate: z.boolean(), speedKmh: z.number() }),
  pursuit_overlap: info({ stop: z.boolean(), story: z.boolean() }),
  pursuit_fleeing: info({}),
  pursuit_stage: info({ stage: z.number().int() }),
  pursuit_checkpoint: info({ aheadM: z.number() }),
  pursuit_end: info({
    end: z.string(),
    fled: z.boolean(),
    stage: z.number().int(),
    records: count,
    violationIds: ids,
  }),
  pursuit_criminal: info({ why: z.string(), kinds: z.array(z.string()), violationIds: ids }),
  /** After a getaway, the identification came (span: the pursuit's). */
  pursuit_identified: info({ kind: z.string() }),
  /** Span stop-<n>, parent the pursuit: the roadside stop, to stop_end. */
  stop_begin: info({
    end: z.string(),
    disposal: z.string(),
    safe: z.boolean(),
    issues: z.array(z.string()),
    violationIds: ids,
  }),
  stop_ticket: info({
    disposal: z.string(),
    kinds: z.array(z.string()),
    violationIds: ids,
    totalPoints: z.number(),
  }),
  stop_end: info({ disposal: z.string() }),
  /** Span story-<n>, parent the stop or the pursuit: the panels of what came after. */
  story_begin: info({ kind: z.string(), panels: count }),

  // ---------- build scripts (scripts/*.ts) ----------
  fetch_retry: info({ url: z.string(), attempt: count, error }),
  cache_hit: info({ file: z.string(), ageH: z.number() }),
  download: info({ url: z.string() }),
  source_parsed: info({ url: z.string(), rows: count.optional(), kept: count, skipped: count.optional() }),
  licence_verified: info({ dataset: z.string(), license: z.string(), note: z.string().nullable() }),
  poi_dropped_ward_mismatch: info({ name: z.string(), stated: z.string(), located: z.string() }),
  pois_written: info({ total: count, counts, wards: counts }),
  areas_written: info({ towns: count }),
  busstops_written: info({ stops: count }),
  geoid_written: info({ points: count, minM: z.number(), maxM: z.number() }),
  jartic_download: info({ month: z.string(), link: z.string() }),
  jartic_parsed: info({
    counts,
    skipped: z.record(z.string(), counts),
    closureSkipped: counts,
    tiles: count,
  }),
  /** A JARTIC closure area too large to be one (knowledge/traffic-regulations.md): not written. */
  jartic_closure_skipped: warning({
    reason: z.string(),
    key: z.string(),
    code: z.string(),
    areaKm2: z.number(),
    maxKm2: z.number(),
    vertices: count,
    at: z.array(z.number()),
  }),
  osm_parsed: info({
    police: count,
    orbis: count,
    centres: z.array(z.string()),
    signals: count,
    named: count,
    footbridges: count,
    stairs: count,
    turnlanes: count,
  }),
  police_written: info({ stations: count, orbis: count, bySource: counts }),
  osm_loaded: info({ bytes: count }),
  ways_read: info({ roads: count, dests: count, nodes: count }),
  places_located: info({
    placed: count,
    stations: count,
    missing: z.array(z.string()),
    via: z.record(z.string(), z.string()),
  }),
  guide_signs_written: info({ tiles: count, roads: count, dests: count, places: count, chars: count }),
  osm_read: info({ nodes: count, ways: count, relations: count, coords: count }),
  destinations_written: info({
    file: z.string(),
    items: count,
    counts,
    featured: z.array(z.unknown()),
    movedIntoWards: count,
    brandQids: z.array(z.string()),
    durationS: z.number(),
    rssMb: z.number(),
  }),
  moved_into_wards: info({ list: z.array(z.string()) }),
  water_stations: info({ all: count, levelStations: count, wards: count }),
  station_page_unreadable: info({ code: z.string(), name: z.string() }),
  levels_missing: info({ day: z.string() }),
  water_levels_written: info({ file: z.string(), gauges: count, tidal: count, bay: z.unknown() }),
} as const;

export type LogEvents = typeof LOG_EVENTS;
export type LogEventName = keyof LogEvents;
export type LogLevel = "info" | "warn" | "error";
/** The events written at `level` (log() takes the info ones, warn() the warn ones…). */
export type EventsAt<L extends LogLevel> = {
  [E in LogEventName]: LogEvents[E]["level"] extends L ? E : never;
}[LogEventName];
/** What a call site passes for `event` (optional fields may be left out or undefined). */
export type LogFields<E extends LogEventName> = z.input<LogEvents[E]["fields"]>;

/** The line's own keys, around every event's fields. */
export const LogBaseSchema = z.strictObject({
  ts: z.iso.datetime(),
  level: z.enum(["info", "warn", "error"]),
  event: z.string().regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/),
  /** The page load (= traffic.ts SESSION, kept on saved violations) or the script run. */
  traceId: z.string().min(1),
  /** The code that wrote the line: `<commit>[+<uncommitted-change hash>]@<version>` (buildLabel.ts). */
  build: z.string().min(1),
  /** The unit of work the event belongs to (`<kind>-<key>`: vio-…, post-…, pursuit-3, warp-2…). */
  spanId: z.string().min(1).optional(),
  /** The span that caused `spanId`'s (a post's violation, a stop's pursuit). */
  parentId: z.string().min(1).optional(),
});
export const BASE_KEYS = Object.keys(LogBaseSchema.shape) as ReadonlyArray<
  keyof z.infer<typeof LogBaseSchema>
>;

/** A whole line of `event` (base keys and its fields): what tests and tools parse a line with. */
export function entrySchema<E extends LogEventName>(event: E) {
  return LogBaseSchema.extend(LOG_EVENTS[event].fields.shape).extend({ event: z.literal(event) });
}
