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

/** |Δz| over a set of stations (scripts/compareExpresswayHeights.ts): how many, percentiles, max (m). */
const heightSpread = z.strictObject({
  stations: z.number().int().nonnegative(),
  p50: z.number().nonnegative(),
  p90: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

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
const counts = z.record(z.string(), count);
/** String(error) of a caught failure ("TypeError: …"). */
const error = z.string();
/** [lat, lon]. */
const latLon = z.array(z.number()).length(2);
const ids = z.array(z.string());
/**
 * A movement at a signal (src/signals/plan.ts Movement). An enum written out here rather than
 * imported: the logger stays a leaf module (see the note above on kinds); the four are fixed by law.
 */
const movement = z.enum(["left", "through", "right", "uturn"]);

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
  /**
   * A phone's near town for this page (device.ts, phoneTownWatch.ts): the kind of phone, the town
   * (`full` / `low`), why (`param` / `default` / `demoted` / `no_storage`), the URL's `?phoneTown=`
   * (null when absent), and whether the page before ended while on screen (a suspected crash).
   */
  phone_town_chosen: info({
    kind: z.string(),
    town: z.string(),
    reason: z.string(),
    param: z.string().nullable(),
    crashed: z.boolean(),
    demotedNow: z.boolean(),
  }),
  game_started: info({}),
  /** 終了: back to the title (the page reloads). */
  title_reload: info({}),
  data_loaded: info({ pois: count, geoid: z.boolean(), busStops: count }),
  data_load_failed: failedWith({ file: z.string() }),
  renderer_ready: info({ backend: z.string(), depth: z.string(), samples: count }),
  gpu_device_lost: warning({ reason: z.string().nullable(), error }),
  pipelines_compiled: info({ durationMs: z.number() }),
  /**
   * 画質 › シェーダーの事前作成 is off: the loading screen let play start without precompile, and
   * each pipeline is built in the frame its material is first drawn (in place of pipelines_compiled).
   */
  pipelines_skipped: info({ setting: z.literal("off") }),
  precompile_failed: failedWith(),
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
  /**
   * src/world/guideSigns.ts: a planned 案内標識 whose content fails BoardContentSchema
   * (src/signs/board/content.ts); it is not stood up.
   */
  guide_board_invalid: warning({
    kind: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
  landmarks_load_failed: failedWith(),
  landmark_model_failed: failedWith({ path: z.string() }),
  /** A landmark's deckLevels that do not match src/world/deckLevels.ts (the roads ignore them). */
  landmark_deck_levels_invalid: failedWith({ landmarkId: z.string() }),
  /** A landmarks.json entry that does not match landmarkEntry.ts (left out; the others still load). */
  landmark_entry_invalid: failedWith({ index: count, landmarkId: z.string().nullable() }),
  /** The near file has no node named nodes.near: the whole file is shown, the far node with it. */
  landmark_near_node_missing: warning({ path: z.string(), node: z.string() }),
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
  road_network_failed: failedWith(),
  route_tile_failed: failedWith({ key: z.string() }),
  water_tile_failed: failedWith({ key: z.string() }),
  /** public/data/expressway (meta.json or a tile) could not be loaded: no decks there. */
  expressway_tile_failed: failedWith({ key: z.string() }),
  /**
   * Two tiles carry different summaries of one run (format 6 repeats a run's summary in every tile
   * with a chunk of it): the first read is kept. A broken build, never expected.
   */
  expressway_tile_run_mismatch: warning({ key: z.string(), run: z.string() }),

  // ---------- the world as built ----------
  road_network_prepared: info({
    backend: z.enum(["worker", "inline"]),
    segments: count,
    computeMs: z.number(),
    restoreMs: z.number(),
    sendMs: z.number(),
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
    /** Controllers whose plan has a 右折矢印 step (src/signals/assign.ts). */
    rightArrows: count.optional(),
    /** 単路 (mid-block) crossing controllers, and those of them that are push-button (T3). */
    crossingSignals: count.optional(),
    pushButtons: count.optional(),
    /** Junction controllers by day plan template and by night plan (`night:<template>`) (T4). */
    signalPlans: z.record(z.string(), count).optional(),
    /** Right-turn arrow groups the scramble and 時差式 templates dropped (T4, assign.ts). */
    droppedRightArrows: count.optional(),
    stops: count,
    crossings: count,
    signs: count,
  }),
  pavements_built: info({ wards: z.array(z.string()), polygons: count }),
  /** P9: streets and pavements laid again round expressway holes (cuts, tunnel portals) read later. */
  ground_cuts_relaid: info({ holes: count, pavements: count }),
  ground_cuts_relay_failed: warning({ error: z.string() }),
  /** Street sections after a rebuild: segments by basis, and OSM lanes that differ by direction. */
  road_sections: info({ segments: count, byBasis: counts, asymmetric: count }),
  /** Streets whose lanes reach into PLATEAU's pavement (the 幅員 / pavement assumption to check). */
  pavement_over_lanes: info({ checked: count, under: count }),
  /**
   * Expressway decks built or dropped around the player (expresswayDeck.ts), with their colliders:
   * how many chunks have one, and how many this refresh made and removed.
   */
  expressway_decks_built: info({
    chunks: count,
    built: count,
    dropped: count,
    colliders: count,
    collidersBuilt: count,
    collidersDropped: count,
    cpuMs: z.number(),
    maxSliceMs: z.number(),
    /** Median and 90th percentile of the refresh's slices, and its slowest single body (trimesh). */
    sliceP50Ms: z.number(),
    sliceP90Ms: z.number(),
    bodyMsMax: z.number(),
    durationMs: z.number(),
  }),
  frame_recentered: info({
    lat: z.number(),
    lon: z.number(),
    anchorMs: z.number().optional(),
    stagesMs: z.record(z.string(), z.number()).optional(),
  }),
  /** The 都市高速's signs stood on the decks around the player (src/world/expresswaySigns.ts). */
  expressway_signs_placed: info({
    chunks: count,
    boards: count,
    plates: count,
    gantries: count,
    girders: count,
    barriers: count,
  }),
  /**
   * A 103-A / 104 found no place before an entrance (src/world/entranceBoards.ts): no street at the
   * ramp's ground end, the street across the ramp or one-way against it, or the street turning
   * away / ending within the distance.
   */
  entrance_board_unplaced: warning({ run: z.string(), kind: z.string(), reason: z.string() }),
  /** A 103-A / 104 stood: how far before the entrance, and whether no post stands in its drivers' sight. */
  entrance_board_placed: info({ run: z.string(), kind: z.string(), before: count, sightClear: z.boolean() }),
  /** guide_signs.glb / signs.glb could not be read for the deck signs: none stand. */
  expressway_signs_failed: warning({ error: z.string() }),
  /** A deck sign of the tiles that fails the board schema, or a plate with no artwork: left out. */
  expressway_sign_invalid: warning({ chunk: z.string(), id: z.string(), s: z.number() }),
  guide_signs_placed: info({
    signs: count,
    advance: count,
    /** 105-A〜C 方面、方向及び距離 (src/world/guideRows.ts). */
    direction: count,
    /** 106-A 方面及び距離 (確認標識). */
    confirm: count,
    /** 103-A・104 before the 都市高速's entrances (src/world/entranceBoards.ts). */
    entrance: count.optional(),
    overhead: count,
    routed: count,
    mapped: count,
    durationMs: z.number(),
  }),
  street_lights_placed: info({
    lamps: count,
    sodium: count,
    /** Lamps left out because an expressway deck passes through their height (isUnderDeck). */
    underDeck: count,
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
  /**
   * Road lines whose level and structure contradict (a ground line off level 0, a viaduct at or
   * below it; roadClass.ts isLevelInconsistent): kept as given, the data needs fixing.
   */
  road_level_mismatch: warning({
    count,
    examples: z.array(
      z.strictObject({ level: z.number(), structure: z.string(), xid: z.string().nullable() }),
    ),
  }),
  /**
   * An expressway ramp's ground end found no GSI street within `reachM` to join
   * (expresswayRoads.ts joinExpressway): it stays a dead end and routes cannot use it.
   */
  ramp_unattached: warning({ run: z.string(), end: z.enum(["start", "end"]), reachM: z.number() }),
  /**
   * A GSI street taken out where it crosses an expressway embankment or cut at grade (expresswayRoads.ts
   * cutAtSites, P2.7-6 PR 7b): the chunk and run distance it crosses at, where, how much of the street
   * was taken out, the angle and the street's width. A dead end on each side until the compiler makes
   * the crossing a bridge or an underpass.
   */
  street_cut_at_expressway: warning({
    chunk: z.string(),
    s: z.number(),
    at: latLon,
    lengthM: z.number().nonnegative(),
    angleDeg: z.number(),
    widthM: z.number(),
    overGroundM: z.number(),
    /** cut / under: crosses the site; same-road: the street's whole width lies in it (the ramp itself, R1-2b M1). */
    kind: z.enum(["cut", "under", "same-road"]),
    tunnel: z.boolean(),
  }),
  /**
   * A road network was replaced after `hits` nearestOnSurface answers fell back to a ground road
   * whose terrain had not loaded (no height to gate by, roads.ts).
   */
  road_surface_unknown: warning({ hits: count, segments: count }),
  /**
   * The expressway chunks in a new road network (?expressway): its segments, the chunks they
   * come from and the ramp ends joined to a street (expresswayRoads.ts).
   */
  expressway_graph_joined: info({ segments: count, chunks: count, rampEndsJoined: count }),
  /**
   * The car on a deck passed through a PLATEAU building there (buildings are not solid on a deck
   * until P4 cuts them out; this is that list). Once per ~20 m cell.
   */
  expressway_building_crossed: warning({ lat: z.number(), lon: z.number(), xid: z.string().nullable() }),
  /**
   * The buildings could not be told about new decks' cut points (ExpresswayDecks.announceCuts): those
   * decks are still built, but buildings standing into them stay whole.
   */
  expressway_cuts_failed: failure({ chunks: count, error }),
  /**
   * The player's car held (frozen) or let go, with ?expressway: which collider was missing
   * (terrain, a deck near the car: ExpresswayDecks.isReadyNear) or a warp in progress.
   */
  vehicle_hold_changed: info({
    frozen: z.boolean(),
    terrainReady: z.boolean(),
    deckReady: z.boolean(),
    warping: z.boolean(),
    lat: z.number(),
    lon: z.number(),
  }),
  /**
   * The player's car put back by the game itself (main.ts respawnHere): fallen under the ground or
   * adrift in the water (P2.7-5: a car on a deck over a river was put back at 47 km/h). `onDeck`
   * whether the deck check had it on a deck then. A warning: something let the car fall or drift.
   */
  car_respawned: warning({
    reason: z.enum(["underground", "adrift"]),
    lat: z.number(),
    lon: z.number(),
    onDeck: z.boolean(),
    kmh: z.number(),
  }),
  /**
   * The car put back on request: the reset key or a retraining. Info, not a warning: nothing went
   * wrong (PR #71 review). Same fields as car_respawned.
   */
  car_put_back: info({
    reason: z.enum(["reset", "retrained"]),
    lat: z.number(),
    lon: z.number(),
    onDeck: z.boolean(),
    kmh: z.number(),
  }),
  /**
   * The car stood still on a deck for 3 s (main.ts noteDeckStall): held (`frozen`) or touching
   * something (`touching`: the chassis' overlaps, PLATEAU buildings and everything else).
   */
  expressway_car_stalled: warning({
    lat: z.number(),
    lon: z.number(),
    xid: z.string().nullable(),
    frozen: z.boolean(),
    deckReady: z.boolean(),
    /** The car's body disabled by anyone (the hold above, or an arrest's showArrest). */
    carFrozen: z.boolean(),
    /** An accident in progress (EmergencyResponse.incident) and a police pursuit after it. */
    incident: z.boolean(),
    pursuit: z.boolean(),
    touching: z.object({ buildings: count, other: count }),
    stillMs: count,
  }),
  /**
   * PLATEAU buildings cut down below an elevated deck's soffit (buildings.ts cutAboveDecks): at a
   * tile's load (`loaded`) or when new decks became known (`decks`). `features` buildings in
   * `meshes` meshes; `points` the deck's cut points tested.
   */
  buildings_cut_above_deck: info({
    reason: z.enum(["loaded", "decks"]),
    features: count,
    meshes: count,
    points: count,
  }),
  /**
   * A chunk's deck could not be built (expresswayDeck.ts refresh): it is skipped from then on and
   * no longer holds a car near it.
   */
  expressway_chunk_failed: failedWith({ chunk: z.string() }),
  /**
   * A stretch of a chunk that the compiler made one surface with another run (decks "same") but the
   * deck builder left apart (expresswayMerge.ts): level_apart where |Δz| > MERGE_MAX_DZ. One line per
   * chunk, partner and reason.
   */
  expressway_merge_skipped: info({
    chunk: z.string(),
    with: z.string(),
    reason: z.enum(["level_apart"]),
    s0: z.number(),
    s1: z.number(),
    maxDzM: z.number(),
  }),
  /**
   * A tunnel or cut chunk's openings as built (S7-4a, expresswayMerge.ts openBore): the stretches
   * opened per other run and side (`tipM`: how far past the data's stretch, the other run's
   * carriageway still inside the wall band), the other runs with no loaded chunk (N1: walls kept)
   * and the stretches where the other run lies on the side opposite the data's (walls kept). One
   * line per chunk that has any of them.
   */
  expressway_bore_opening: info({
    chunk: z.string(),
    opened: z.array(
      z.object({
        with: z.string(),
        side: z.enum(["left", "right"]),
        s0: z.number(),
        s1: z.number(),
        tipM: z.number(),
      }),
    ),
    noPartner: z.array(z.string()),
    sideMismatch: z.array(
      z.object({ with: z.string(), side: z.enum(["left", "right"]), s0: z.number(), s1: z.number() }),
    ),
  }),
  /**
   * A chunk's 分離壁 between it and a same-direction deck that has let go of one surface below it
   * (expresswayMerge.ts dividerOf, A1): the s range, the thinnest wall and how far its outer face
   * reaches down. One line per chunk and partner, beside expressway_merge_skipped.
   */
  /**
   * A wall closing a run's end with nothing written going on (expresswayDeck.ts, R1-1b 3.2): the
   * chunk, which end, the wall's width across the road and its height over the slab's bottom.
   */
  expressway_end_wall_built: info({
    chunk: z.string(),
    end: z.enum(["start", "end"]),
    widthM: z.number().nonnegative(),
    heightM: z.number().nonnegative(),
    /** The width whose top another run's deck over it lowered, and the width left without a box (A2). */
    loweredM: z.number().nonnegative(),
    noneM: z.number().nonnegative(),
    boxes: count,
    /** The width left to a road going on past the end, those runs, and the largest height between the roads there (追記 4 D3). */
    yieldedM: z.number().nonnegative(),
    yieldTo: z.array(z.string()),
    yieldPastDzM: z.number().nonnegative(),
    yieldFootDzM: z.number().nonnegative(),
  }),
  /**
   * Such an end left without a wall (R1-1b 3.4): `tunnel` (a tunnel's section, none in the data) or
   * `hidden` (its road shows nothing at the end ring, under another deck: a child ending at its
   * parent's end).
   */
  expressway_end_wall_skipped: info({
    chunk: z.string(),
    end: z.enum(["start", "end"]),
    reason: z.enum(["tunnel", "hidden", "covered"]),
  }),
  expressway_divider_built: info({
    chunk: z.string(),
    with: z.string(),
    s0: z.number(),
    s1: z.number(),
    minWidthM: z.number(),
    maxDropM: z.number(),
  }),
  /**
   * A chunk's nose step over a same-direction deck it has let go of (A1: the lanes' edges closer than
   * DIVIDER_MIN_WIDTH): a wall lower than a 壁高欄 filling the gap between the lanes' edges, as high
   * as the drop past MERGE_MAX_DZ. The s range, the largest height of the step and the narrowest gap.
   * One line per stretch, beside expressway_divider_built.
   */
  expressway_nose_step_built: info({
    chunk: z.string(),
    with: z.string(),
    s0: z.number(),
    s1: z.number(),
    maxDzM: z.number(),
    minGapM: z.number(),
  }),
  /**
   * A chunk near the car has had no collider for longer than the hold allows: the car is let go
   * (isReadyNear), as a missing deck must not freeze the game.
   */
  expressway_hold_expired: warning({ chunks: z.array(z.string()), heldMs: z.number() }),
  /**
   * The dev server answers data/expressway from XW_DATA_DIR's folder, not public/data/expressway
   * (scripts/xwDataServe.ts, R1-5): which folder, and the SHA-256 of its meta.json.
   */
  xw_data_served: info({ dir: z.string(), metaSha256: z.string() }),
  /**
   * A steady-speed drive over the decks (dev hook src/debug/expresswayDrive.ts): the chunks it
   * crossed, the car's height over the surface (dy, from the chassis' ride height), its vertical
   * speed and acceleration, and whether it fell through.
   */
  expressway_drive_checked: info({
    label: z.string(),
    seconds: z.number(),
    distanceM: z.number(),
    chunks: z.array(z.string()),
    frames: count,
    deckFrames: count,
    maxAbsDyM: z.number(),
    maxAbsVyMs: z.number(),
    rmsAyMs2: z.number(),
    maxAbsAyMs2: z.number(),
    maxShortfallKmh: z.number(),
    maxLaneOffM: z.number(),
    maxDyAt: z.string().nullable(),
    maxLaneOffAt: z.string().nullable(),
    maxShortfallAt: z.string().nullable(),
    fell: z.boolean(),
    endsOnDeck: z.boolean(),
    /**
     * Why the drive does not count (null: it does): an incident or a pursuit before it started or
     * when it stopped (the car may have been held by an arrest, not by the deck).
     */
    invalid: z.string().nullable(),
    /**
     * A wall-stop drive's (R1-1b, scripts/qa/deckRoutes.ts "wall"): the end chunk, how far past its
     * end the car's centre came (m, below zero short of it), its top speed, and its height over the
     * deck at the last sample on one.
     */
    wall: z
      .strictObject({
        chunk: z.string(),
        maxPastEndM: z.number(),
        maxKmh: z.number().nonnegative(),
        lastDyM: z.number().nullable(),
      })
      .optional(),
  }),
  /**
   * The autopilot driven over the expressway by the dev hook (debug.expressway.route, P6): the
   * ride's numbers as expressway_drive_checked, and what the route took (the runs in order, the
   * merges and diverges it planned, the navi's expressway calls) and what the law check booked.
   */
  expressway_route_driven: info({
    label: z.string(),
    seconds: z.number(),
    distanceM: z.number(),
    runs: z.array(z.string()),
    links: z.array(z.string()),
    calls: z.array(z.string()),
    violations: z.array(z.string()),
    maxAbsDyM: z.number(),
    fell: z.boolean(),
    arrived: z.boolean(),
    gaveUp: z.string().nullable(),
    yieldedS: z.number(),
  }),
  /** A call the navi says (in the language in force), whether or not the voice is muted. */
  nav_spoken: info({ text: z.string() }),
  /**
   * A traffic car already on the road put back on its lane where it was off it by more than 8 m
   * unseen, or 25 m (traffic-ai.ts drive): its id, segment, place along it and the segment's length
   * (m); how far its centre was off (m); whether that centre was in the camera's view; the spot it
   * is put on to the player's car (m); the road it had chosen next, the turn into it (degrees, left
   * +) and how far its centre was from that road's lane (m); seconds since the graph was swapped
   * and since it last slid from a shove. Nulls: none.
   */
  traffic_car_put_back: info({
    carId: count,
    segId: z.number().int(),
    sM: z.number(),
    segLengthM: z.number(),
    offLaneM: z.number(),
    isSeen: z.boolean(),
    playerDistM: z.number().nullable(),
    nextSegId: z.number().int().nullable(),
    turnDeg: z.number().nullable(),
    nextOffM: z.number().nullable(),
    sinceGraphS: z.number().nullable(),
    sinceShoveS: z.number().nullable(),
  }),
  /**
   * A put-back held off: the spot the traffic car would land on was within 60 m of the player's car
   * (traffic-ai.ts drive), so it drives on from where it is. Once per car until it is put back or
   * within 8 m of its lane again: its id, segment, place along it (m), how far off it is (m), the
   * spot to the player's car (m; null: no player yet).
   */
  traffic_car_put_back_held: info({
    carId: count,
    segId: z.number().int(),
    sM: z.number(),
    offLaneM: z.number(),
    playerDistM: z.number().nullable(),
  }),
  /** Traffic AI cars on the expressway at a moment (debug.expressway.traffic, P6). */
  expressway_traffic_seen: info({
    cars: count,
    onDeck: count,
    onRamps: count,
    merged: count,
    diverged: count,
  }),

  // ---------- driving ----------
  trip_started: info({ target: z.string(), distanceM: z.number() }),
  destination_set: info({ name: z.string(), distanceKm: z.number() }),
  poi_collected: info({ poiId: z.number().int(), category: z.string(), ward: z.string() }),
  /**
   * A crash: the car's speed, and for a body with a mass the blow by both masses (Δv, energy).
   * `otherKind` who was hit (a traffic car, a kerbside parked car, the robotaxi, a patrol, a bus, a
   * person; else `kind` again); `otherRef` its number in autopilot_front_pick. Without a mass
   * record, Δv from the velocities over the frame's steps (`deltaVFrom`: velocities; the other's
   * only for a patrol or the robotaxi, the dynamic cars) and `otherKmhBefore` its speed before them.
   */
  accident: info({
    kind: z.string(),
    speedKmh: z.number(),
    otherKind: z.enum([
      "traffic",
      "parked",
      "robotaxi",
      "patrol",
      "bus",
      "pedestrian",
      "vehicle",
      "building",
      "pole",
    ]),
    otherRef: count.optional(),
    otherDeltaVKmh: z.number().optional(),
    carDeltaVKmh: z.number().optional(),
    energyKj: z.number().optional(),
    otherMassKg: z.number().optional(),
    deltaVFrom: z.enum(["mass", "velocities"]).optional(),
    otherKmhBefore: z.number().optional(),
  }),
  /**
   * A person and the player's car touched but it was not the driver's accident: the car stood
   * (game/pedestrianBlow.ts) or the person's Δv was a nudge. `carKmh` is the car's speed into the blow.
   */
  pedestrian_bump: info({ carKmh: z.number(), otherDeltaVKmh: z.number() }),
  /**
   * A vehicle hit the player's car while it stood (game/vehicleBlow.ts: its own speed going in at
   * 1 km/h or under), above the 5 km/h an accident takes: no accident, nothing booked. `ownKmh` the
   * car's own speed going in, `speedAfterKmh` after the steps (the push in it); the blow by both
   * masses where the mass contact recorded it.
   */
  vehicle_bump: info({
    ownKmh: z.number(),
    speedAfterKmh: z.number(),
    ownDeltaVKmh: z.number().optional(),
    otherDeltaVKmh: z.number().optional(),
    otherMassKg: z.number().optional(),
  }),
  /**
   * The player's car began to touch a traffic car (main.ts, judged an accident or not; the 3 s per
   * body of the contact check). The other: its id (TrafficAI), segment, place along it (m) and
   * speed; `ownKmh` the player's car going into the blow; both Δv; `bearingDeg` where the other is
   * seen from the player's heading (ahead 0, left +, behind ±180); its look's gap at its last frame
   * (m); where its look began to take in the player's car without a break, and its speed then;
   * seconds since it was last put back on its lane. Δv only from the mass contact's own record.
   * Nulls: none.
   */
  traffic_contact: info({
    carId: count,
    segId: z.number().int(),
    sM: z.number(),
    carKmh: z.number(),
    ownKmh: z.number(),
    ownDeltaVKmh: z.number().nullable(),
    otherDeltaVKmh: z.number().nullable(),
    bearingDeg: z.number(),
    lookGapM: z.number().nullable(),
    firstSeenM: z.number().nullable(),
    firstSeenKmh: z.number().nullable(),
    sincePutBackS: z.number().nullable(),
    isAccident: z.boolean(),
  }),
  /**
   * A jump (移動, 復帰, debug place) put the player more than 80 m from an open accident scene:
   * leaving and the 119 deadline are held until they are back within 80 m (game/emergency.ts).
   * `jumpM` is the jump, `awayM` the distance from the scene after it.
   */
  incident_jump: info({ jumpM: z.number(), awayM: z.number() }),
  /** Back within 80 m of the scene after a jump: the hold ends; `heldMs` is how long it lasted. */
  incident_resumed: info({ heldMs: z.number() }),
  /**
   * Crossed a signal's stop line while an arrow over red allowed only some movements (`allowed`):
   * the 信号無視 check waits for the arm the car leaves by (src/signals/redLight.ts).
   */
  signal_crossing_held: info({ approachId: count, allowed: z.array(movement) }),
  /**
   * A held crossing decided: `violation` (left by a movement the arrow did not allow; the booking
   * follows), `permitted`, `unconfirmed` (not booked: what the law text read does not settle), or
   * `dropped` (`reason`: backedOut, reset) with `movement` null.
   */
  signal_crossing_resolved: info({
    approachId: count,
    outcome: z.enum(["violation", "permitted", "unconfirmed", "dropped"]),
    movement: movement.nullable(),
    reason: z.enum(["backedOut", "reset"]).optional(),
    heldMs: z.number(),
  }),
  /**
   * A walker pressed a 単路 crossing's 押ボタン and the call was taken; presses while a call waits
   * or while the walk is still to come are not logged.
   */
  signal_button_pressed: info({ controllerId: z.number() }),
  /**
   * A junction controller went into or out of its night plan (夜間点滅, 夜間の押ボタン; T4) as the
   * game's time of day crossed the plan's window: `template` is the plan it runs now.
   */
  signal_plan_switched: info({ controllerId: z.number(), template: z.string(), isNight: z.boolean() }),
  /**
   * 単路 crossings among the OSM records that got no controller, by why (trafficControl.ts): off
   * the road graph's streets (the tiles reach further), no JARTIC 横断歩道 within reach, next to a
   * signalled junction, or no room for a stop line.
   */
  signal_crossings_skipped: info({ outside: count, noCrosswalk: count, nearJunction: count, noRoom: count }),
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
  autopilot_on: info({ cruising: z.boolean(), routeM: z.number() }),
  autopilot_off: info({}),
  autopilot_gave_up: info({ why: z.string() }),
  /**
   * Why the autopilot stood or went (knowledge/autopilot-recovery.md「汐留出口の連結路の足」):
   * `still` once it has stood STILL_LOG_S, `movedOff` as it moves off after that, `accident` at a
   * crash while it drives. `why` is AutoDriver.why (each speed limit, m/s, and what set it; null:
   * none applied); `ahead` the nearest vehicle in front within 30 m (m along and across the car's
   * heading, its speed m/s, its heading against the car's in degrees).
   */
  /**
   * The autopilot found its car off its lane (AutoDriver.offLane, D2 大手町一丁目): `why` the test
   * that held (pavement under it, off the path, misaligned, off every road), the route's segment
   * and lane, `offM` from the driven path, `yawErrorDeg` against the path's heading.
   */
  autopilot_lost_lane: warning({
    why: z.string(),
    lat: z.number(),
    lon: z.number(),
    gameMs: z.number(),
    segId: count,
    lane: z.number().int(),
    lanes: count,
    offM: z.number(),
    yawErrorDeg: z.number(),
    speedMs: z.number(),
    onPavement: z.boolean(),
    offPath: z.boolean(),
    misaligned: z.boolean(),
  }),
  /**
   * The autopilot's car in front changed (`changed`, a fresh pick only), or the last pick at an
   * accident (`accident`; `staleTicks` driver updates since it was made: the offLane hold makes
   * none). The car: `pathOffM` from its driven path, `ownM` its nose across the path (+ left),
   * the band (m) a vehicle has to be within of it, and the slant it swept by (`slantPerM`, across per
   * metre along, + left: the smaller of the heading's `headingSlantPerM` and the nose's drift over the
   * last 8 m `driftPerM` when both point the same way, else 0; D4 v2). Each vehicle placed up to 60 m ahead: its log ref
   * (as accident's otherRef), who it is, along (`aheadM`) and across the path, across from the nose
   * (`fromOwnM`), straight-line distance, seconds stood. `dropped`: near ahead in a straight line
   * (to 60 m, 4 m across the heading) but left out of the look, and why (another level, off the path).
   * Nulls: no car picked, a vehicle with no key or source, stood forever (a parked car).
   */
  autopilot_front_pick: info({
    phase: z.enum(["changed", "accident"]),
    gameMs: z.number(),
    staleTicks: count,
    mode: z.string(),
    lostWhy: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
    speedMs: z.number(),
    pathOffM: z.number(),
    ownM: z.number(),
    bandM: z.number(),
    slantPerM: z.number(),
    headingSlantPerM: z.number(),
    driftPerM: z.number(),
    pickedRef: count.nullable(),
    candidates: z.array(
      z.strictObject({
        ref: count.nullable(),
        source: z.string().nullable(),
        kind: z.string(),
        aheadM: z.number(),
        lateralM: z.number(),
        fromOwnM: z.number(),
        straightM: z.number(),
        stoppedForS: z.number().nullable(),
        picked: z.boolean(),
      }),
    ),
    dropped: z.array(
      z.strictObject({
        ref: count.nullable(),
        source: z.string().nullable(),
        aheadM: z.number(),
        acrossM: z.number(),
        why: z.enum(["level", "offPath"]),
      }),
    ),
  }),
  autopilot_stop_trace: info({
    phase: z.enum(["still", "movedOff", "accident"]),
    stillS: z.number(),
    /** The game's clock (ms, main.ts gameNow): the signals' phase runs on it. */
    gameMs: z.number(),
    /** The driver's mode (drive, or a manoeuvre: align, uturn, stuck, reroute, pass) and why it left its lane. */
    mode: z.string(),
    lostWhy: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
    speedMs: z.number(),
    why: z
      .object({
        want: z.number(),
        cruise: z.number(),
        block: z.number().nullable(),
        blockBy: z.enum(["stop", "obstacle"]).nullable(),
        stop: z
          .object({
            kind: z.string(),
            dist: z.number(),
            action: z.string(),
            onward: z.boolean(),
            light: z.string().nullable(),
            controller: z.number().nullable(),
            cycleS: z.number().nullable(),
          })
          .nullable(),
        front: z
          .object({
            gap: z.number(),
            along: z.number(),
            stoppedFor: z.number().nullable(),
            kind: z.string(),
          })
          .nullable(),
        verdict: z.string(),
        follow: z.number().nullable(),
        junction: z.number().nullable(),
        merge: z.number().nullable(),
        yieldingAtMerge: z.boolean(),
        signallingOff: z.boolean(),
        pass: z.string().nullable(),
      })
      .nullable(),
    ahead: z
      .object({
        along: z.number(),
        across: z.number(),
        speedMs: z.number(),
        headingDeg: z.number(),
        kind: z.string(),
      })
      .nullable(),
  }),
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
    /**
     * A missed 合図 (signalOmission.ts signalRecord): game ms since each indicator was last on, and
     * for a turn the distance from the junction's node (m) and game ms since its watch began.
     */
    signal: z
      .object({
        leftAgoMs: z.number().nullable(),
        rightAgoMs: z.number().nullable(),
        fromNodeM: z.number().nullable(),
        watchedMs: z.number().nullable(),
      })
      .optional(),
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
  /** An OSM tile layer came out byte for byte as committed, so it was left alone (scripts/regulations.ts). */
  osm_layer_unchanged: info({ layer: z.string(), tiles: count }),
  osm_parsed: info({
    police: count,
    orbis: count,
    centres: z.array(z.string()),
    signals: count,
    /** Signal records kept and what their OSM tags say (scripts/osm-signals.ts, T3). */
    signalTags: z
      .object({ kept: count, midBlock: count, pushButton: count, sound: count, crossingOnly: count })
      .optional(),
    named: count,
    footbridges: count,
    stairs: count,
    turnlanes: count,
  }),
  /** The census of OSM signal tags in the 23 wards (scripts/signal-tags.ts). */
  signal_tags_counted: info({
    extract: z.string(),
    nodes: count,
    byKind: counts,
    byTag: counts,
    midBlock: counts,
  }),
  /** scripts/regulations.ts: street ways with lanes / width kept for public/data/roadlanes. */
  osm_road_lanes: info({
    ways: count,
    tiles: count,
    lanes: count,
    forwardBackward: count,
    width: count,
    oneway: count,
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
  /**
   * scripts/plateauRoot.ts: the root joining the prefectures' PLATEAU tilesets, written; `gates` is
   * how many municipality regions each gated prefecture's gate holds.
   */
  plateau_root_written: info({
    file: z.string(),
    sources: z.array(z.string()),
    gates: counts,
    bytes: count,
  }),
  /**
   * scripts/plateauRoot.ts --check: one prefecture's tileset as the service serves it now. `codes`
   * are its municipalities (5-digit codes from the URIs), `problems` why the check fails (empty: ok).
   */
  plateau_root_checked: info({
    code: z.string(),
    name: z.string(),
    url: z.string(),
    status: count,
    cors: z.string(),
    geometricError: z.number(),
    regionDeg: z.array(z.number()),
    children: count,
    codes: z.array(z.string()),
    problems: z.array(z.string()),
    ok: z.boolean(),
  }),
  /** scripts/sign-law-table.ts: 別表第一 read from e-Gov at the pinned revision. */
  sign_law_table_written: info({ file: z.string(), revision: z.string(), signs: count }),
  /** scripts/signs.ts: the sign definitions written out as registry.json, game.json and catalog.json. */
  sign_registry_written: info({ files: z.array(z.string()), signs: count, drawn: count, lanes: count }),
  /** scripts/qa/signMounts.ts: each plate's mounting for the sign review (.qa/signs/mounts.json). */
  sign_mounts_written: info({ file: z.string(), plates: count }),
  /** scripts/signals.ts wrote the signal-head registry signals.py models from. */
  signal_heads_written: info({ file: z.string(), heads: count }),
  /**
   * src/world/signs.ts: a 進行方向別通行区分 whose lane pattern was not drawn ahead of time (more than
   * the 6 lanes assumedLanes covers, or a turn:lanes value newer than the registry), so no plate is
   * put up. Once per pattern. `lanes` is the render key (src/signs/lanes.ts laneKey).
   */
  sign_lanes_unrendered: warning({ lanes: z.string(), count }),
  /** A 補助標識 whose wording has no face drawn ahead of time (registry.json older than public/data/regs); left off. */
  sign_aux_undrawn: warning({ sign: z.string(), lines: z.array(z.string()) }),
  /**
   * Faces of sign posts left off because their mount had no room for them (src/signs/mount.ts:
   * more than two columns of plates, or a 補助標識 that would hang under the lowest allowed edge).
   */
  sign_faces_unmounted: warning({ faces: count, posts: count }),
  /** src/world/signs.ts: posts stood on a rebuild, how many on two posts or on a signal pole, and their faces. */
  sign_mounts_resolved: info({ posts: count, double: count, shared: count, faces: count }),
  /**
   * src/world/signs.ts: columns of sign posts hidden inside buildings since the last rebuild, by
   * what they belonged to (a single post; the first or second column of a double post, and how many
   * double posts lost both). Logged when an update hides one.
   */
  sign_columns_hidden: info({
    single: count,
    doubleFirst: count,
    doubleSecond: count,
    doubleWhole: count,
    posts: count,
  }),
  /** A mount member role with no part in signs.glb (src/signs/mount.ts MEMBER_NODES), left undrawn; once per role. */
  sign_member_unloaded: warning({ role: z.string(), glb: z.string(), node: z.string() }),
  /**
   * src/world/signFaces.ts: an array texture of sign faces is on the GPU (its layer size, layer
   * count, backend and MB with mipmaps).
   */
  sign_face_pool_ready: info({
    pool: z.string(),
    size: count,
    layers: count,
    backend: z.enum(["webgpu", "webgl2", "three-fallback"]),
    mb: z.number(),
  }),
  /**
   * src/render/layerUpload.ts: on WebGPU, three's internals were not what the direct layer upload
   * expects (a three update), so the layers go through three's slow path (every layer's mips redrawn).
   */
  sign_face_upload_fallback: warning({ pool: z.string(), reason: z.string() }),
  /**
   * src/world/signFaces.ts: more faces wanted than a pool has layers; the furthest show the stand-in
   * (layer 0). Once per wanted-set size.
   */
  sign_face_layers_short: warning({ pool: z.string(), wanted: count, capacity: count }),
  /** src/world/signFaces.ts: a face's picture could not be decoded (it keeps the stand-in). */
  sign_face_load_failed: warning({ pool: z.string(), key: z.string(), error: z.string() }),
  /**
   * src/world/signs.ts / guideSigns.ts: the faces of a rebuild by pool: distinct artworks wanted,
   * layers in use, and the face meshes (draw calls) they need.
   */
  sign_faces_built: info({ pool: z.string(), artworks: count, meshes: count, instances: count }),
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
  // scripts/expressway.ts (the expressway compiler, knowledge/road-redesign-plan.md 4)
  expressway_osm_read: info({ ways: count, universeWays: count, nodes: count, junctions: count }),
  /** belowRuns: tunnels and cuts compiled (P9); belowDeferred: those left for later (below.ts). */
  expressway_planned: info({
    chains: count,
    runs: count,
    wanted: count,
    needed: count,
    crossings: count,
    belowRuns: count,
    belowDeferred: count,
    /**
     * Station pairs (plan.pairs entries) of two main lines touching down at the same place, not held a level apart
     * (compile.ts markSharedTouchdowns): over the whole plan, and among the runs the range needs.
     */
    untiedStations: count,
    untiedStationsNeeded: count,
  }),
  /**
   * S6 PR 7c2 (T, compile.ts cutFeet): the plan made again with the ramps' ground ends cut out of the
   * roads read, over the whole plan: the ends cut, the runs at grade taken into the viaduct beside them
   * (merged: every record with `into`, whatever the viaduct's foot then was), the ends left in a street
   * (foot-along-street), those kept, and the runs and needed runs of the new plan. Each foot once: a
   * taken-in foot is counted as merged only.
   */
  expressway_feet_cut: info({
    cut: count,
    merged: count,
    along: count,
    kept: count,
    deferred: count,
    runs: count,
    needed: count,
  }),
  /**
   * The OSM extract read (src/expressway/extract.ts): its replication timestamp against the pinned
   * one, its SHA-256, and whether a mismatch was let through by --accept-extract. R1-3: the
   * decisions' tables the build applies (`--decisions`, all by default), the first line of a build.
   */
  expressway_extract_checked: info({
    timestamp: z.string().nullable(),
    expected: z.string(),
    sha256: z.string(),
    pinned: z.boolean(),
    accepted: z.boolean(),
    decisions: z.enum(["all", "none", "feet-only", "structures-only"]),
  }),
  /** The pinned extract copied from kanto-latest (extract.ts), once, while that was still it. */
  expressway_extract_pinned: info({ file: z.string(), timestamp: z.string().nullable(), sha256: z.string() }),
  /** --range ship (src/expressway/scope.ts): the main lines and ramps of the shipped scope. */
  expressway_scope_chosen: info({ main: count, ramps: count, belowRuns: count, prunedBelow: z.boolean() }),
  /**
   * The shipped scope read off the plan (scripts/expresswayScopeProbe.ts, R1-1a 2): where the
   * operator's ways end along the shipped main lines (the cuts, the km they take out, those with an
   * operator's route ref on the far side), the unmarked ways between two operated ones, the ramps
   * scope v2 adds and drops against v1, the plan's dangling runs, the main lines whose ways fall in
   * more than one district, the refs the districts' table misses and the C2 runs the yamate box cuts.
   */
  /**
   * The districts of the written runs of a ship build from the plan (scope.ts planDistrictRuns) and
   * from the chunks (districtRunsOf), compared (R1-1a): how many written, how many differ, the first.
   */
  /**
   * What lies under the written stations outside the wards (scripts/expresswayOutsideGround.ts,
   * R1-1a): their km, those where DEM5A has the pixel, where the ground falls to DEM10B, where the
   * DEM tile is not cached, and where no gated PLATEAU prefecture's regions reach (no buildings).
   */
  expressway_outside_ground_measured: info({
    dir: z.string(),
    out: z.string(),
    outsideKm: z.number().nonnegative(),
    dem5aKm: z.number().nonnegative(),
    dem10bKm: z.number().nonnegative(),
    uncachedKm: z.number().nonnegative(),
    noPlateauKm: z.number().nonnegative(),
  }),
  /**
   * The tiles' gzip stage by stage of publishing the districts (scripts/expresswayDistrictSizes.ts,
   * R1-1a, U3): per stage the districts published, the tiles, their gzip total and the largest tile.
   */
  expressway_district_sizes_measured: info({
    dir: z.string(),
    out: z.string(),
    stages: z.array(
      z.strictObject({ districts: z.string(), tiles: count, gzipBytes: count, maxGzipBytes: count }),
    ),
  }),
  /** A --districts build (R1-1a): the stage written and the runs and chunks picked from the whole ship. */
  /**
   * Two scorecards gzipped by another node or zlib, or one without the record (compareExpresswayReports,
   * R1-1a): their gzip rows shown but not counted, and how many.
   */
  expressway_reports_gzip_unlike: warning({
    a: z.string(),
    b: z.string(),
    aEnv: z.string().nullable(),
    bEnv: z.string().nullable(),
    rows: count,
  }),
  /** A scorecard over U3's budget (budget.ts): the caps, the measured gzip, the largest tile. */
  expressway_budget_over: warning({
    label: z.string(),
    totalGzipMaxBytes: count,
    tileGzipMaxBytes: count,
    totalGzipBytes: count,
    maxTileGzipBytes: count,
    maxTile: z.string().nullable(),
    ok: z.boolean(),
  }),
  /**
   * The ends of a data folder with nothing written going on (scripts/expresswayEnds.ts, R1-1b 3.1):
   * the walls, the main lines' open ends by the end chunk's structure, their portals and ground ends,
   * the ramps' open ends and portals, the ends with a junction child at the node, those in a tunnel,
   * and against a scorecard the walls it lists that were not found and those found that it does not.
   */
  expressway_ends_counted: info({
    dir: z.string(),
    out: z.string(),
    districts: z.array(z.string()).nullable(),
    walls: count,
    mainOpen: count,
    mainOpenByStructure: z.record(z.string(), count),
    mainPortal: count,
    mainGround: count,
    rampOpen: count,
    rampPortal: count,
    withJunctionChild: count,
    tunnel: count,
    missing: z.array(z.string()),
    extra: z.array(z.string()),
    /** The ends whose answer from the tiles read when the game first can build them differs from the full one. */
    asBuiltDiffer: z.array(z.string()),
  }),
  /**
   * The end walls of a data folder probed in Node (scripts/expresswayEndWalls.ts, R1-1b): walls built
   * and the level rays at their faces that met nothing, ends skipped as hidden or in a tunnel and the
   * rays there that met nothing, ends going on as another run and those with more than PARAPET_WIDTH
   * of their face uncovered, the scorecard's mouths and those without the parent's wall or with a
   * branch line or ゼブラ painted.
   */
  expressway_end_walls_probed: info({
    dir: z.string(),
    out: z.string(),
    walls: count,
    wallMisses: count,
    /** Walls whose box top stands over another deck's underside over them, those lowered, ends left without one (A3). */
    poking: count,
    /** The same over faces level with this road, and walls where the two reads of a same partner's road part (R1-1b 追記 3 C3). */
    pokingLevel: count,
    readsPart: count,
    /** Walls counted by (b) without the faces inside the other run's own end wall (proposed, not judged). */
    pokingOffEndWalls: count,
    /** Raw (b) (any run's road, the line before 追記 4 D6), points met under − MERGE_MAX_DZ down to − SLAB, the farthest dead end of a run not counted, the widest open gap. */
    pokingRaw: count,
    deepPoints: count,
    uncountedFarthestEndM: z.number().nonnegative(),
    openM: z.number().nonnegative(),
    lowered: count,
    covered: count,
    hidden: count,
    tunnel: count,
    hiddenMisses: count,
    /** Ends going on as another run where the deck boxes the face, and those only looked at (a cut's). */
    onwardsBoxed: count,
    onwardsSeen: count,
    onwardOverWidth: count,
    mouths: count,
    mouthsBroken: count,
  }),
  expressway_districts_picked: info({ districts: z.array(z.string()), runs: count, chunks: count }),
  expressway_districts_compared: info({
    written: count,
    mismatched: count,
    mismatchedIds: z.array(z.string()),
  }),
  expressway_scope_probed: info({
    out: z.string(),
    below: z.string(),
    runBorders: z.string(),
    mainRuns: count,
    rampRuns: count,
    cuts: count,
    cutShippedKm: z.number().nonnegative(),
    operatorRefCuts: count,
    sandwichedKm: z.number().nonnegative(),
    addedRamps: count,
    addedRampKm: z.number().nonnegative(),
    lostRamps: count,
    droppedRamps: count,
    droppedWithFoot: count,
    danglingV2: count,
    mixedRuns: count,
    missingRefs: z.array(z.string()),
    boxBorderRuns: z.array(z.string()),
  }),
  /** The vertical objective of a build (P2.7-3, compile.ts Objective); v2's weights null for v1. */
  expressway_objective_chosen: info({
    objective: z.enum(["v1", "v2"]),
    gradeChange: z.number().nullable(),
    reachM: z.number().nullable(),
    reachBelowM: z.number().nullable(),
    targetScale: z.number().nullable(),
  }),
  /** The scorecard of a build (src/expressway/report.ts), written outside the data folder. */
  expressway_report_written: info({
    file: z.string(),
    plannedRuns: count,
    writtenRuns: count,
    closedRuns: count,
    unconverged: count,
    retried: count,
    bytes: count,
  }),
  /**
   * Two scorecards compared (scripts/compareExpresswayReports.ts): numbers listed, changed (timings
   * never), on one side only, and runs of the range added or removed.
   */
  expressway_reports_compared: info({
    a: z.string(),
    b: z.string(),
    fields: count,
    changed: count,
    added: count,
    removed: count,
    runsAdded: count,
    runsRemoved: count,
    /** Blocks (report partition) whose solution hash differs, and those on one side only. */
    blocksChanged: count,
    blocksAdded: count,
    blocksRemoved: count,
  }),
  /**
   * `--ramp-shift` (S6 PR 4 案 A, compile.ts solveWithRampShift): the cap, how many chains kept their
   * move, and the chains whose move was dropped for making a ramp worse.
   */
  expressway_ramps_shifted: info({ maxM: z.number(), chains: count, dropped: z.array(z.string()) }),
  /**
   * A build's not-allowed overlaps in S6's five shapes (scripts/expresswayOverlapShapes.ts), per kind
   * (parallel-ramp, changeover, other, nose): the pairs and their stations of each shape; the stations
   * of the parallel-ramp pairs joined; and with a base build, its parallel-ramp pairs joined from one
   * surface followed into this one (how many are still not allowed).
   */
  expressway_overlap_shapes: info({
    label: z.string(),
    byKind: z.record(z.string(), z.record(z.string(), z.strictObject({ pairs: count, stations: count }))),
    joinedStations: count,
    tracked: z.strictObject({ base: z.string(), pairs: count, stillNotAllowed: count }).nullable(),
  }),
  /**
   * --partition blocks (src/expressway/blocks.ts, P2.7-2): k and the least quiet margin, anchors and
   * pieces of the whole plan, the blocks the range needs, the route groups and the needed runs.
   */
  expressway_blocks_planned: info({
    quietFactor: z.number(),
    quietMinM: z.number(),
    anchors: count,
    pieces: count,
    blocks: count,
    neededBlocks: count,
    routeGroups: count,
    neededRuns: count,
  }),
  /**
   * Two builds' heights compared (scripts/compareExpresswayHeights.ts): |Δz| of b's stations against
   * a's Hermite surface, over the runs in both, near the anchors of b's report (±Q) and elsewhere,
   * and the runs that moved most.
   */
  expressway_heights_compared: info({
    a: z.string(),
    b: z.string(),
    runs: count,
    onlyA: count,
    onlyB: count,
    all: heightSpread,
    nearAnchors: heightSpread,
    elsewhere: heightSpread,
    top: z.array(
      z.strictObject({ run: z.string(), maxDzM: z.number(), s: z.number(), nearAnchor: z.boolean() }),
    ),
  }),
  /**
   * Two data folders' chunks compared byte for byte (scripts/compareExpresswayChunks.ts, P2.7-4):
   * the chunks of either, those only in one, and the ids (sorted, the first 50) of those that differ.
   */
  expressway_chunks_compared: info({
    a: z.string(),
    b: z.string(),
    chunksA: count,
    chunksB: count,
    same: count,
    differ: count,
    onlyA: count,
    onlyB: count,
    differIds: z.array(z.string()),
    onlyAIds: z.array(z.string()),
    onlyBIds: z.array(z.string()),
  }),
  /**
   * The terrain and the streets probed over the carriageway of a data folder's embankments, cuts and
   * at-grade runs (scripts/expresswayTerrainProbe.ts, P2.7-6 PR 7b): the points where the drawn
   * terrain (or only its collider) or a street's asphalt stands over the road less 2 cm, the worst
   * overM, and the chunks with the most such points (each with its worst point).
   */
  expressway_terrain_probed: info({
    dir: z.string(),
    chunks: count,
    structures: counts,
    points: count,
    terrainOut: count,
    drawnOut: count,
    colliderOut: count,
    streetOut: count,
    endTerrainOut: count,
    endStreetOut: count,
    maxOverM: z.number().nonnegative(),
    streetMaxOverM: z.number().nonnegative(),
    terrainChunks: z.array(
      z.strictObject({
        chunk: z.string(),
        structure: z.string(),
        points: count,
        maxOverM: z.number(),
        s: z.number(),
        lat: z.number(),
        lon: z.number(),
      }),
    ),
    streetChunks: z.array(
      z.strictObject({
        chunk: z.string(),
        structure: z.string(),
        points: count,
        maxOverM: z.number(),
        s: z.number(),
        lat: z.number(),
        lon: z.number(),
      }),
    ),
    endChunks: z.array(
      z.strictObject({
        chunk: z.string(),
        structure: z.string(),
        points: count,
        maxOverM: z.number(),
        s: z.number(),
        lat: z.number(),
        lon: z.number(),
      }),
    ),
    wallTopOut: count,
    wallFootOut: count,
    wallMaxOverM: z.number().nonnegative(),
    wallChunks: z.array(
      z.strictObject({
        chunk: z.string(),
        points: count,
        maxOverM: z.number(),
        s: z.number(),
        kind: z.string(),
      }),
    ),
    streetCrossings: counts,
    wideCuts: count,
    streetCuts: z.array(
      z.strictObject({
        chunk: z.string(),
        s: z.number(),
        widthM: z.number(),
        angleDeg: z.number(),
        overGroundM: z.number(),
        tunnel: z.boolean(),
        lat: z.number(),
        lon: z.number(),
      }),
    ),
    streetsUnder: z.array(
      z.strictObject({
        chunk: z.string(),
        s: z.number(),
        widthM: z.number(),
        angleDeg: z.number(),
        overGroundM: z.number(),
        tunnel: z.boolean(),
        lat: z.number(),
        lon: z.number(),
      }),
    ),
    streetTiles: count,
    durationMs: count,
  }),
  /**
   * The ramps' feet of a data folder joined to the GSI streets as the game joins them (S6 PR 7c1,
   * scripts/expresswayFeetProbe.ts): the ground ends probed and those skipped for a tile not to be
   * had, how each was joined (expresswayRoads.ts F1's rules: atGrade (a), street (b), inside (c),
   * unattached (d)), the feet whose connector breaks rule 1 (enters beside its own deck), rule 2 (its
   * first LEAD_M not straight ahead) or turns back (a street leg over 90° off the heading), each with
   * its point in the foot's (out, left), and the feet whose street leg turns more than 45°.
   */
  expressway_feet_probed: info({
    dir: z.string(),
    feet: count,
    groundRunFeet: count,
    skippedForMissingTiles: count,
    joined: z.strictObject({ atGrade: count, street: count, inside: count, unattached: count }),
    violations: count,
    violating: z.array(
      z.strictObject({
        run: z.string(),
        end: z.enum(["start", "end"]),
        rule: z.enum(["beside-deck", "not-straight", "turns-back"]),
        out: z.number(),
        left: z.number(),
      }),
    ),
    unattachedFeet: z.array(z.strictObject({ run: z.string(), end: z.enum(["start", "end"]) })),
    maxLegDeg: z.number().nonnegative(),
    steepFeet: z.array(
      z.strictObject({
        run: z.string(),
        end: z.enum(["start", "end"]),
        deg: z.number(),
        legM: z.number().nonnegative(),
        streetWidthM: z.number().nonnegative().nullable(),
      }),
    ),
    durationMs: count,
  }),
  /**
   * The street lanes over a cut's site (scripts/expresswayHoleLanes.ts, S6 PR 7c): the runs with
   * such a lane, the lanes, the longest stretch over a site, the cuts skipped for want of GSI's tiles.
   */
  /**
   * The street lanes left over an embankment's slab (scripts/expresswayLanesProbe.ts, S6 PR 7c): the
   * places (a chunk and a street), the most allowed (−1: none, a folder with no ledger), the chunks
   * skipped for want of GSI's tiles.
   */
  expressway_lanes_probed: info({
    dir: z.string(),
    places: count,
    max: z.number().int().min(-1),
    skippedForMissingTiles: count,
    list: z.array(
      z.strictObject({
        chunk: z.string(),
        s0: z.number(),
        s1: z.number(),
        lengthM: z.number().nonnegative(),
        streetM: z.number().nonnegative(),
        nearestM: z.number().nonnegative(),
      }),
    ),
    durationMs: count,
  }),
  expressway_hole_lanes_measured: info({
    dir: z.string(),
    runs: count,
    lanes: count,
    longestM: z.number().nonnegative(),
    skippedForMissingTiles: count,
    byRun: z.array(z.strictObject({ run: z.string(), lanes: count, longestM: z.number().nonnegative() })),
  }),
  /**
   * P2.7 R1-2b PR 1 (scripts/measureSameRoad.ts): the GSI street lines the same-road rule (M1, α)
   * takes out, one a line, as joinExpressway cuts them: how many, how long, by width class, whether
   * taking them out keeps through traffic, how their stretches end, how many run along the site for
   * most of their length, and the pieces left of them inside the band and not at the foot (none is
   * the rule's line, 追記 4 K4 2).
   */
  street_same_road_measured: info({
    dir: z.string(),
    skippedForMissingTiles: count,
    lines: count,
    alphaM: count,
    extendedM: z.number().nonnegative(),
    piecesLeft: count,
    leftInBandNotFoot: count,
    leftAtFoot: count,
    byClass: counts,
    byThrough: counts,
    byEnds: counts,
    wholeAlong: count,
    partAlong: count,
    fragmentsMismatch: count,
    islands: count,
    keptByVerdict: counts,
  }),
  /**
   * P2.7 R1-2b PR 1 (scripts/expresswaySameRoadIslands.ts): the islands of the game's network round
   * the sites (components other than the largest; cut by the window's edge, closed inside it, inside
   * and of class 0 streets only), and those the same-road rule makes (count, length m, where).
   */
  street_same_road_islands_counted: info({
    dir: z.string(),
    missingTiles: count,
    windows: count,
    edge: z.strictObject({ count, lengthM: count }),
    inside: z.strictObject({ count, lengthM: count }),
    insideClass0Only: z.strictObject({ count, lengthM: count }),
    madeByRule: z.strictObject({ count, lengthM: count }),
    madeByRuleAt: z.array(z.string()),
  }),
  /**
   * P2.7 R1-2b PR 1 (scripts/expresswaySameRoadStability.ts): the same-road rule's answers over every
   * window the game builds round the car: how many windows and lines, and how many lines (alpha ones
   * apart) get more than one answer outside the edge band (none is the rule's line) or only in it.
   */
  street_same_road_stability_measured: info({
    dir: z.string(),
    missingTiles: count,
    windows: count,
    lines: count,
    alphaLines: count,
    differOutsideBand: count,
    alphaDifferOutsideBand: count,
    differInBandOnly: count,
  }),
  /**
   * P2.7 R1-2 (scripts/measureStreetBands.ts): the street segments an expressway's site runs along,
   * by R1-2a's class (memo 改訂 1, 3.3: clear, A median, A' room cap, B1 / B2 / B3 / C not given), and the
   * jumps, pavements, feet, piers and two-segment nodes round them.
   */
  street_bands_measured: info({
    dir: z.string(),
    groups: count,
    siteChunks: count,
    skippedChunksForMissingTiles: count,
    groupsWithoutRegulations: count,
    segments: count,
    totalLengthM: count,
    byClass: z.strictObject({
      clear: count,
      A: count,
      "A'": count,
      B1: count,
      B2: count,
      B3: count,
      C: count,
    }),
    lengthByClass: z.strictObject({
      clear: count,
      A: count,
      "A'": count,
      B1: count,
      B2: count,
      B3: count,
      C: count,
    }),
    fewerLanes: count,
    widened: count,
    edgeOnPavement: count,
    jumps: count,
    jumpsGrown: count,
    jumpMostBeforeM: z.number().nonnegative(),
    jumpMostAfterM: z.number().nonnegative(),
    withPavement: count,
    footNear: count,
    piersOverLanes: count,
    twoNodes: count,
    twoNodesWithStop: count,
    twoNodesWithCrossing: count,
    twoNodesWithSignal: count,
    durationMs: count,
  }),
  /**
   * The drops with no wall at their edge of a data folder (scripts/expresswayBareDrops.ts, A1 test 22):
   * the points, their pairs, and against another list the new and the gone points (the first new ones).
   */
  expressway_bare_drops_counted: info({
    dir: z.string(),
    out: z.string(),
    against: z.string().nullable(),
    points: count,
    pairs: count,
    added: count,
    gone: count,
    addedAt: z.array(z.string()),
  }),
  /**
   * A data folder's ledger written again (scripts/expresswayLedger.ts, P2.7-4): the cases, those new
   * to it, left as they were, sent back to `new` (with a previous decision), per status, accepted by
   * a rule, the seam probes, whether it has a budget, its bytes, the diagnostics re-allowed.
   */
  expressway_ledger_updated: info({
    dir: z.string(),
    seed: z.string().nullable(),
    cases: count,
    added: count,
    unchanged: count,
    reopened: count,
    statuses: z.strictObject({ new: count, accepted: count, open: count, wontfix: count, gone: count }),
    byRule: count,
    seamProbes: count,
    /**
     * The tunnels' and cuts' openings as built (S7-4a, expresswaySeams.ts BoreProbe): stretches
     * opened (by chunk), named runs with no chunk (N1), stretches on the data's wrong side, and the
     * level rays along the opened stretches where both rings round them are open (no 分離壁, not
     * walled again) and those that met a wall of the chunk's own (0 expected).
     */
    boreOpenings: z.strictObject({
      opened: count,
      noPartner: count,
      sideMismatch: count,
      wallRays: count,
      wallHits: count,
    }),
    budget: z.boolean(),
    bytes: count,
    /** report.json diagnostics whose `allowed` the new ledger turned (the file rewritten when > 0). */
    reallowed: count,
  }),
  /** Two scorecards of another range, --below mode or extract: their differences are not the compiler's. */
  expressway_reports_unlike: warning({ a: z.string(), b: z.string() }),
  expressway_dem_ready: info({ tiles: count, fetched: count }),
  expressway_objects_read: info({ roads: count, rails: count }),
  /** The joint vertical QPs (compile.ts solveComponent): components, the largest, solves, time. */
  expressway_solved: info({
    components: count,
    largestRuns: count,
    largestVariables: count,
    solves: count,
    iterations: count,
    qpMs: count,
    unconverged: count,
    /** Solves solved again at a looser dual tolerance after a first try that did not converge. */
    retried: count,
    durationS: z.number(),
  }),
  /** A run the compiler could not satisfy, or satisfied only by a fallback (allowed: in the allowlist). */
  expressway_diagnostic: warning({
    run: z.string(),
    kind: z.string(),
    detail: z.string(),
    allowed: z.boolean(),
  }),
  /** The signs on the decks (src/expressway/signPlan.ts): all, by 別表第一 number, entrances, unplaced. */
  expressway_signs_planned: info({
    signs: count,
    byId: z.record(z.string(), count),
    entrances: count,
    unplaced: count,
  }),
  /** A sign the planner found no place for (on the run, clear of the others and of a deck above). */
  expressway_sign_unplaced: warning({ run: z.string(), id: z.string(), reason: z.string() }),
  /**
   * A structure override's landmark has no deck levels that parse (structures.ts): its bridge is
   * compiled as an ordinary viaduct (設計書 4.6「deckLevels が無ければ通常生成に落として警告」).
   */
  expressway_structure_missing: warning({ landmarkId: z.string(), hasEntry: z.boolean() }),
  /** How each structure deck met its deck levels (the 3 m rule and the compiled deck's distance). */
  expressway_structure_built: info({
    deck: z.string(),
    run: z.string(),
    osmM: z.number(),
    planM: z.number(),
    zM: z.number(),
  }),
  /**
   * The ledger a build decides `allowed` with (P2.7-4): the file (the output folder's as kept, or
   * --ledger; null: none, the rules alone), its cases, and the diagnostics allowed and not.
   */
  expressway_ledger_read: info({
    file: z.string().nullable(),
    cases: count,
    allowed: count,
    notAllowed: count,
  }),
  expressway_written: info({
    range: z.string(),
    tiles: count,
    runs: count,
    chunks: count,
    stations: count,
    bytes: count,
    diagnostics: count,
    unsolved: count,
    /** Runs of the range left out of the tiles (meta.closed), main lines and ramps. */
    closedMain: count,
    closedRamps: count,
    durationS: z.number(),
  }),

  // ---------- the multi-view review (src/debug/viewHooks.ts, scripts/qa/views.ts) ----------
  /** The dev camera was put at a view (window.__game.debug.camera). */
  debug_camera_placed: info({
    lat: z.number(),
    lon: z.number(),
    fovDeg: z.number(),
    isGroundReady: z.boolean(),
  }),
  /** A view's target is not in the game (an unknown id, or a renamed private list the hook reads). */
  debug_target_missing: warning({ kind: z.string(), targetId: z.string() }),
  /** A view table's page is loaded and the world streamed in around its start. */
  views_session_loaded: info({ viewTable: z.string(), start: z.string(), views: count, loadS: z.number() }),
  /** One view shot: the picture and its JSON. */
  views_shot: info({
    viewTable: z.string(),
    viewId: z.string(),
    file: z.string(),
    targetId: z.string().nullable(),
    isInView: z.boolean().nullable(),
    offCentre: z.number().nullable(),
  }),
  /** A view could not be shot (its target is not found near its start, or the page failed). */
  views_shot_failed: failedWith({ viewTable: z.string(), viewId: z.string() }),
  /** Every view of a table is shot; the contact sheet and the review template are written. */
  views_done: info({ viewTable: z.string(), round: count, shots: count, failed: count, outDir: z.string() }),
  /** scripts/qa/guideBoards.ts: one place's 案内標識 plans and drawn faces written. */
  guide_boards_dumped: info({
    place: z.string(),
    plans: count,
    durationMs: z.number(),
    /**
     * The BoardFacePool's drawing steps while the place settled (G5 on): how many, the first two
     * (the warm-up) and the rest's median and longest, ms; and FrameWork's longest slice. Absent
     * before G5 and for the fixed boards.
     */
    steps: count.optional(),
    warmupStepMs: z.array(z.number()).optional(),
    steadyMedianStepMs: z.number().optional(),
    steadyMaxStepMs: z.number().optional(),
    maxSliceMs: z.number().optional(),
  }),
  /** scripts/qa/guideBoards.ts: a place has no dump under the label compared against. */
  guide_boards_no_baseline: warning({ place: z.string(), against: z.string() }),
  /** scripts/qa/guideBoards.ts: placements and faces compared with an earlier label (changes: 108 series). */
  guide_boards_compared: info({ label: z.string(), against: z.string(), changed: count }),
  /** A review round compared with the one before (scripts/qa/reviewLoop.ts). */
  review_round_checked: info({
    viewTable: z.string(),
    round: count,
    newBlocking: count,
    gone: count,
    openCritical: count,
    verdict: z.enum(["converged", "continue", "escalate"]),
    reason: z.string(),
  }),
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
