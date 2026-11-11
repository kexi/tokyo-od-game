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
  game_started: info({}),
  /** 終了: back to the title (the page reloads). */
  title_reload: info({}),
  data_loaded: info({ pois: count, geoid: z.boolean(), busStops: count }),
  data_load_failed: failedWith({ file: z.string() }),
  renderer_ready: info({ backend: z.string(), depth: z.string(), samples: count }),
  gpu_device_lost: warning({ reason: z.string().nullable(), error }),
  pipelines_compiled: info({ durationMs: z.number() }),
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
   * A chunk near the car has had no collider for longer than the hold allows: the car is let go
   * (isReadyNear), as a missing deck must not freeze the game.
   */
  expressway_hold_expired: warning({ chunks: z.array(z.string()), heldMs: z.number() }),
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
  }),

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
  /**
   * A person and the player's car touched but it was not the driver's accident: the car stood
   * (game/pedestrianBlow.ts) or the person's Δv was a nudge. `carKmh` is the car's speed into the blow.
   */
  pedestrian_bump: info({ carKmh: z.number(), otherDeltaVKmh: z.number() }),
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
  }),
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
