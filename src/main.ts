import RAPIER from "@dimforge/rapier3d-compat";
import {
  DoubleSide,
  Frustum,
  Group,
  Matrix4,
  MathUtils,
  type Material,
  type Object3D,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import type { z } from "zod";
import { RECENTER_DISTANCE, SPAWN, TERRAIN_ZOOM } from "./config";
// As a namespace: main has its own `t`s (times, taxis) in inner scopes.
import * as i18n from "./i18n";
import { formatClock, formatDay, formatNumber, formatYen } from "./i18n/format";
import { lawRef, recordPlace, violationDetail, violationName } from "./i18n/law";
import { inJapanese } from "./i18n/reverse";
import { localUtterance } from "./i18n/speech";

const SPAWN_DEFAULT = { ...SPAWN, label: () => i18n.t("start.default") };
import { GRAPHICS, pixelRatioFor, QUALITY } from "./device";
import { buildGraphicsPanel, buildTitlePreset } from "./game/graphicsPanel";
import { savedVoice, saveVoice } from "./game/titlePrefs";
import type { GraphicsSettings } from "./graphics";
import {
  BusStopFileSchema,
  expandPois,
  GeoidGridSchema,
  PoiFileSchema,
  type Category,
  type Poi,
} from "./data/schema";
import { haversineMeters } from "./geo/ellipsoid";
import { AreaIndex, type AreaFile } from "./geo/areas";
import { LocalFrame } from "./geo/frame";
import { Geoid } from "./geo/geoid";
import { latToTileY, lonToTileX } from "./geo/tiles";
import { NpcBrain } from "./ai/llm";
import { Voice } from "./ai/tts";
import type { Surroundings } from "./ai/dialogue";
import { GameAudio } from "./game/audio";
import { ConversationController } from "./game/conversation";
import { Walker } from "./game/walker";
import { ChaseCamera } from "./game/camera";
import { createLowCar, loadCarModels } from "./game/carModel";
import { Speedometer } from "./game/speedometer";
import { ParkingPatrol } from "./game/parkingPatrol";
import { GROUND_QUERY_GROUPS } from "./physics/groups";
import { centralImpact, massContactsFor, restitution, type Impact } from "./physics/massContacts";
import { ADULT_KG } from "./physics/masses";
import { Stamps, shortLabel } from "./game/stamp";
import { NavGuide } from "./game/navGuide";
import { CLOSURE_WORDS } from "./world/closures";
import { StreetFurniture, type Places } from "./world/streetFurniture";
import { StreetLights } from "./world/streetLights";
import { OrbisDevices } from "./world/orbis";
import { jstDateAt } from "./geo/sun";
import { gameClock, inForce as isInForceTime, timeNote, tokyoDate, type GameClock } from "./world/ruleTime";
import { classifyTurn, laneAllows, laneIndex, planRoute, type Turn } from "./game/navigation";
import { RouteArrows } from "./game/routeArrows";
import { RoboTaxi, type TaxiWorld } from "./game/robotaxi";
import { AutoDriver, kerbLeft, keepLeftOffset, type DriveObstacle } from "./game/autoDriver";
import { rapierClearance } from "./game/autoRecovery";
import { halfLengthOf } from "./game/autoTraffic";
import { loadSignalModels } from "./world/signalModels";
import { SidewalkNetwork } from "./world/sidewalks";
import { KERB, Pavements, PavementTiles, type PavementPolygon } from "./world/pavements";
import { initStartPicker, readStart } from "./game/startPoint";
import { renderCredits } from "./game/credits";
import { Input, keyFor, LOOK_KEYS } from "./game/input";
import { Minimap } from "./game/minimap";
import { Missions } from "./game/missions";
import { PoiField, storageKeyFor } from "./game/pois";
import { captureFailure, reproUrl, setDiagnosticsState } from "./diagnostics";
import { log, newSpan, recentLogs, warn, type Span } from "./log";
import { Vehicle, type DriveInput } from "./physics/vehicle";
import { Buildings } from "./world/buildings";
import { DemStore } from "./world/dem";
import {
  Environment,
  GAME_TIME_SCALE,
  TIME_LABEL,
  TIME_MODES,
  type TimeMode,
  type WeatherMode,
} from "./world/environment";
import { Terrain } from "./world/terrain";
import { TokyoTide } from "./world/tide";
import { WaterLayer } from "./world/water";
import { Pedestrians, type Pedestrian } from "./world/pedestrians";
import {
  RegulationTiles,
  isInForce,
  type AppliedRegulations,
  type LaneUse,
  type RegulationData,
} from "./world/regulations";
import { isLaneChangeBanned, laneOfOffset } from "./world/laneChange";
import { leftOf, speedLimit, type RoadGraph, type RoadLine, type Segment } from "./world/roads";
import { RoadNetworkBuilder } from "./world/roadNetworkBuilder";
import type { RoadNetwork } from "./world/roadNetworkData";
import { RoadSurface } from "./world/roadSurface";
import { RoadTiles } from "./world/roadTiles";
import { TrafficControl } from "./world/trafficControl";
import { TrafficSigns, loadSignModels } from "./world/signs";
import { GuideSigns } from "./world/guideSigns";
import { createHuman, disposeHuman, loadHumanModels } from "./world/human";
import { loadFacadeTextures } from "./world/facade";
import { TrafficAI } from "./world/traffic-ai";
import {
  formatViolation,
  injuryViolation,
  SESSION,
  speedViolation,
  TrafficLaw,
  VIOLATIONS,
  type Violation,
  type ViolationContext,
  type ViolationRecord,
  violationSpan,
} from "./game/traffic";
import { renderReview } from "./game/violationReview";
import { loadViolations, saveViolations, ViolationSync } from "./game/violationStore";
import { ClipPose, CLIP_AFTER_MS, CLIP_BEFORE_MS, cutClip, type ActorDesc } from "./game/replayClip";
import { renderTicket } from "./game/ticketForm";
import { PolicePatrol, type PatrolKind } from "./game/policePatrol";
import { PursuitDirector } from "./game/pursuitDirector";
import { isEnforcing } from "./game/pursuitEscalation";
import { loadPursuitModels, PursuitScene } from "./game/pursuitScene";
import type { StopSite } from "./game/trafficStop";
import { CarControls, type AutoContext } from "./game/carControls";
import { Cockpit } from "./game/cockpit";
import { CHARM_TIP, firstCharmTip, MirrorCharms } from "./game/mirrorCharm";
import { CarNavi } from "./game/carNavi";
import { displayOffset, NaviTv } from "./game/naviTv";
import type { TvInfo } from "./game/tvRules";
import { buildToolbar, labelToolbar } from "./game/toolbar";
import { mountPadSettings } from "./game/padSettings";
import { MotionBlur } from "./world/motionBlur";
import { Bloom, bloomSettings } from "./world/bloom";
import { LensFlare } from "./world/lensFlare";
import { createRenderer } from "./render/renderer";
import { drawShadowsOf, FrameComposer } from "./render/frame";
import { NoticeLog, type NoticeKind } from "./game/noticeLog";
import { loadHome, saveHome, searchPlaces, type Home, type Place as WarpPlace } from "./game/warp";
import { byDistance, renderPlaceList } from "./game/placePicker";
import { loadDestinations, type Destination } from "./game/destinations";
import {
  charmOf,
  DEFAULT_PREFS,
  loadPrefs,
  renderKeyList,
  savePrefs,
  volumeOf,
  SEAT_RANGE,
  seatOf,
  type ControlPrefs,
} from "./game/controlsHelp";
import { CAMERA_LABEL, ReplayDirector, ReplayRecorder, type Pose, type ReplayCamera } from "./game/replay";
import {
  createVehicle,
  loadVehicleModels,
  type VehicleInstance,
  type VehicleKind,
} from "./game/vehicleModels";
import { fetchLandmarks, Landmarks, replacedFootprints } from "./world/landmarks";
import { formatCount, postSpan, SocialFeed, type SocialPost, type SocialWorld } from "./game/social";
import type { PraiseKind } from "./game/socialTexts";
import { WitnessPhones } from "./game/witnessPhones";
import { appTile, SocialApp } from "./game/socialView";
import { SOCIAL_APP_NAME } from "./game/socialTheme";
import { WitnessShot } from "./game/witnessShot";
import { Darkroom } from "./game/darkroom";
import { DueQueue } from "./game/frameSlices";
import { frameStats, longFramesDuring, perf, round, watchFrames } from "./game/perf";
import { adviceFor } from "./game/drivingTips";
import { decideSanction } from "./game/sanctions";
import { EmergencyResponse, loadAmbulanceModel } from "./game/emergency";
import { Phone } from "./game/phone";
import { Transit } from "./world/transit";
import { fetchTokyoObservation } from "./world/weather";

const LIGHT_KEY = { green: "hud.signal.green", yellow: "hud.signal.yellow", red: "hud.signal.red" } as const;
/** What the car hit (`name` fills the pedestrian's). */
const ACCIDENT_KEY = {
  pedestrian: "accident.pedestrian",
  vehicle: "accident.vehicle",
  building: "accident.building",
  pole: "accident.pole",
} as const;

// ---------- Words on screen (the Japanese tables stay for the AI's context and the records) ----------
const TIME_KEY: Record<TimeMode, i18n.MessageKey> = {
  real: "time.label.real",
  morning: "time.label.morning",
  day: "time.label.day",
  evening: "time.label.evening",
  night: "time.label.night",
};
const WEATHER_KEY: Record<WeatherMode, i18n.MessageKey> = {
  real: "weather.label.real",
  auto: "weather.label.auto",
  clear: "weather.label.clear",
  rain: "weather.label.rain",
};
const CAMERA_KEY = {
  chase: "camera.chase",
  far: "camera.far",
  hood: "camera.hood",
  cockpit: "camera.cockpit",
} as const satisfies Record<string, i18n.MessageKey>;
const REPLAY_CAMERA_KEY: Record<ReplayCamera, i18n.MessageKey> = {
  auto: "replay.camera.auto",
  chase: "replay.camera.chase",
  front: "replay.camera.front",
  side: "replay.camera.side",
  roadside: "replay.camera.roadside",
  heli: "replay.camera.heli",
  wheel: "replay.camera.wheel",
  cockpit: "replay.camera.cockpit",
  witness: "replay.camera.witness",
};
// One sentence per unit rather than the unit in a slot: English needs "a"/"an" and "the" with each.
const SEEN_BY_KEY: Record<PatrolKind, i18n.MessageKey> = {
  patrol: "notify.seenBy.patrol",
  unmarked: "notify.seenBy.unmarked",
  shirobai: "notify.seenBy.shirobai",
};
const ESCAPED_KEY: Record<PatrolKind, i18n.MessageKey> = {
  patrol: "notify.escaped.patrol",
  unmarked: "notify.escaped.unmarked",
  shirobai: "notify.escaped.shirobai",
};
/** pois.json's categories by id (their labels in the data are Japanese). */
const CATEGORY_KEY: Partial<Record<string, i18n.MessageKey>> = {
  culture: "mission.category.culture",
  landmark: "mission.category.landmark",
  nightview: "mission.category.nightview",
  facility: "mission.category.facility",
  sports: "mission.category.sports",
  station: "mission.category.station",
  water: "mission.category.water",
  waterbase: "mission.category.waterbase",
  shelter: "mission.category.shelter",
  destination: "mission.category.destination",
};
/** destinations.json's kinds (station, temple …) in the language in force. */
const DEST_KIND_KEY: Partial<Record<string, i18n.MessageKey>> = {
  station: "destKind.station",
  airport: "destKind.airport",
  government: "destKind.government",
  temple: "destKind.temple",
  shrine: "destKind.shrine",
  church: "destKind.church",
  worship: "destKind.worship",
  zoo: "destKind.zoo",
  aquarium: "destKind.aquarium",
  theme_park: "destKind.theme_park",
  museum: "destKind.museum",
  theatre: "destKind.theatre",
  hall: "destKind.hall",
  stadium: "destKind.stadium",
  tower: "destKind.tower",
  bridge: "destKind.bridge",
  crossing: "destKind.crossing",
  market: "destKind.market",
  shopping: "destKind.shopping",
  park: "destKind.park",
  garden: "destKind.garden",
  historic: "destKind.historic",
  attraction: "destKind.attraction",
  viewpoint: "destKind.viewpoint",
  area: "destKind.area",
};
/** A spot category's name in the language in force; the data's own label for one we don't know. */
const categoryLabel = (id: string, fallback: string): string => {
  const key = CATEGORY_KEY[id];
  return key ? i18n.t(key) : fallback;
};
/** The turn as the records write it (the words TURN_WORDS had), translated back on screen. */
const TURN_RECORD: Record<Turn, i18n.MessageKey> = {
  straight: "violationWord.straight",
  slightLeft: "violationWord.turnSlightLeft",
  left: "violationWord.turnLeft",
  slightRight: "violationWord.turnSlightRight",
  right: "violationWord.turnRight",
  uturn: "violationWord.turnUturn",
};
/** A lane's painted arrows as the records write them. */
const LANE_RECORD: Partial<Record<string, i18n.MessageKey>> = {
  left: "violationWord.left",
  slight_left: "violationWord.slightLeft",
  through: "violationWord.straight",
  slight_right: "violationWord.slightRight",
  right: "violationWord.right",
  reverse: "violationWord.reverse",
};

/** "3 日" / "3 days" / "1 day": a count of days with its unit, for the slots that take one. */
const daysText = (n: number) => i18n.t(n === 1 ? "hud.dayOne" : "hud.days", { n: formatNumber(n) });
/** "2 点" / "2 points" / "1 point". */
const pointsCount = (n: number) => i18n.t(n === 1 ? "hud.pointOne" : "hud.points", { n: formatNumber(n) });

/** Items in a sentence: 「A、B」 / "A, B" / 「A、B」. */
function listOf(items: readonly string[]): string {
  const locale = i18n.getLocale();
  if (locale === "ja") return items.join("、");
  // Why not "conjunction" in English: these are labels, not a sentence's end ("A, B, and C").
  const isChinese = locale === "zh";
  const style = isChinese ? "narrow" : "short";
  return new Intl.ListFormat(i18n.bcp47(), { type: isChinese ? "conjunction" : "unit", style }).format(items);
}

/**
 * The HUD's clock in the language in force (formatDay: 「10/5(月・祝)」, "Mon, 10/5 (holiday)").
 * main's clockLabel stays Japanese: the records keep it and recordClock() reads it back.
 */
function renderClock(el: HTMLElement, clock: GameClock, date: { m: number; d: number }): void {
  const dayClass = clock.holiday || clock.weekday === 0 ? "sun" : clock.weekday === 6 ? "sat" : "";
  const label = formatDay(date, clock.weekday, clock.holiday);
  const hhmm = formatClock(clock.minutes);
  if (el.textContent === `${label} ${hhmm}`) return;
  el.textContent = "";
  const day = document.createElement("span");
  day.className = `clock-day ${dayClass}`;
  day.textContent = label;
  const time = document.createElement("span");
  time.className = "clock-time";
  time.textContent = ` ${hhmm}`;
  el.append(day, time);
}

/** Horizontal unit vector the car's nose points along (local yaw 0 faces +Z). */
function headingVector(q: Quaternion): Vector3 {
  const f = new Vector3(0, 0, 1).applyQuaternion(q);
  f.y = 0;
  return f.normalize();
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

async function loadJson<S extends z.ZodType>(name: string, schema: S): Promise<z.infer<S> | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
    if (!res.ok) return null;
    return schema.parse(await res.json());
  } catch (error) {
    warn("data_load_failed", { file: name, error: String(error) });
    return null;
  }
}

/** The title screen's progress line; `text` runs again when the language is switched. */
function setLoading(text: () => string, progress: number): void {
  i18n.bindText($("#loading-status"), text);
  $("#loading-bar").style.width = `${Math.round(progress * 100)}%`;
}

function toast(text: string, color = "#ffe14d"): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderLeftColor = color;
  el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3300);
}

async function main(): Promise<void> {
  setLoading(() => i18n.t("loading.physics"), 0.04);
  await RAPIER.init();

  setLoading(() => i18n.t("loading.openData"), 0.1);
  const [poiFile, geoidGrid, stopFile, areaFile] = await Promise.all([
    loadJson("pois.json", PoiFileSchema),
    loadJson("geoid.json", GeoidGridSchema),
    loadJson("busstops.json", BusStopFileSchema),
    fetch(`${import.meta.env.BASE_URL}data/areas.json`)
      .then((r) => (r.ok ? (r.json() as Promise<AreaFile>) : null))
      .catch(() => null),
  ]);
  const areas = areaFile ? new AreaIndex(areaFile) : null;
  const pois: Poi[] = poiFile ? expandPois(poiFile) : [];
  const categories: Category[] = poiFile?.categories ?? [];
  const stations = pois
    .filter((p) => p.category === "station")
    .map((p) => ({ name: p.name, ward: p.ward, lat: p.lat, lon: p.lon }));
  const spawn = readStart(SPAWN_DEFAULT, stations);
  initStartPicker($<HTMLSelectElement>("#opt-start"), $("#opt-start-note"), stations, spawn);
  log("data_loaded", {
    pois: pois.length,
    geoid: geoidGrid !== null,
    busStops: Object.keys(stopFile?.stops ?? {}).length,
  });

  setLoading(() => i18n.t("loading.renderer"), 0.14);
  // WebGPU where the browser has it, WebGL 2 otherwise or when 画質 描画方式 asks (render/renderer.ts).
  const { renderer, info: renderInfo } = await createRenderer(
    $<HTMLCanvasElement>("#scene"),
    GRAPHICS.settings,
    QUALITY,
  );
  // The frame is drawn into one HDR target and tone-mapped once (render/frame.ts).
  const composer = new FrameComposer(renderer);
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 40000);

  const dem = new DemStore(new Geoid(geoidGrid));
  setLoading(() => i18n.t("loading.models", { place: spawn.label() }), 0.18);
  // 車内視点 (loaded with the other models, attached to the player's car once it exists).
  const cockpit = new Cockpit();
  // ミラーの飾り: hung in the car once both it and the cockpit (whose mirror they hang from) exist.
  const mirrorCharms = new MirrorCharms();
  await Promise.all([
    dem.load(
      Math.floor(lonToTileX(spawn.lon, TERRAIN_ZOOM)),
      Math.floor(latToTileY(spawn.lat, TERRAIN_ZOOM)),
    ),
    loadCarModels(),
    loadVehicleModels(),
    cockpit.load(),
    mirrorCharms.load(),
    loadSignModels(),
    loadSignalModels(),
    loadAmbulanceModel(),
    loadHumanModels(),
    loadFacadeTextures(),
    // The helicopter, the 検問's props and the officers on foot (each may fail on its own).
    loadPursuitModels(),
  ]);
  let frame = new LocalFrame(spawn.lat, spawn.lon, dem.heightAt(spawn.lat, spawn.lon) ?? 40);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  // Cars against traffic, people and parked cars by both masses (physics/massContacts.ts).
  const massContacts = massContactsFor(world);
  const AT_THE_WHEEL = [{ seat: "driver" as const, kg: ADULT_KG }];
  const NOBODY: typeof AT_THE_WHEEL = [];
  const terrain = new Terrain(scene, world, dem, renderer, frame);
  // Rivers, canals and the bay: their surface replaces the ground there, bridges get decks.
  const water = new WaterLayer(scene, world, dem, new TokyoTide(), frame);
  terrain.setWater(water);
  const buildings = new Buildings(scene, world, camera, renderer, frame);
  // Landmarks (東京タワー, スカイツリー, 東京駅) replace their PLATEAU copies: tell the buildings
  // before the first tiles arrive.
  const landmarkEntries = await fetchLandmarks();
  buildings.hideFootprints(replacedFootprints(landmarkEntries));
  const landmarks = new Landmarks(
    scene,
    frame,
    (lat, lon, h) => dem.ellipsoidal(lat, lon, h),
    landmarkEntries,
  );
  const env = new Environment(scene, renderer);
  // The sun's shadow map is drawn for the main view; the other views reuse it.
  drawShadowsOf(env.sun);
  const vehicle = new Vehicle(world);
  cockpit.attach(vehicle.object);
  mirrorCharms.attach(vehicle.object, cockpit.root);
  const carNavi = new CarNavi();
  const blur = new MotionBlur();
  // 光のにじみ: thresholds and strength by the light (bloom.ts), 画質 for the resolution.
  const bloom = new Bloom(renderer, () => bloomSettings(env.nightFactor, env.overcast));
  // レンズフレア: the sun's ghosts when the frame shows the sun (its probe reads the finished frame).
  const lensFlare = new LensFlare(renderer, scene, bloom);
  // The street passes, in order, on the street only (the interior and the wipers stay sharp): the
  // lights spill, the lens flares, then the street smears.
  composer.streetPasses.push(bloom, lensFlare, blur);
  composer.frameReaders.push(lensFlare.reader);
  const sunDir = new Vector3();
  /** The sun for the lens flare, this frame (call before the frame is drawn). */
  const placeFlare = () =>
    lensFlare.update(camera, {
      direction: sunDir.copy(env.sun.position).sub(env.sun.target.position).normalize(),
      elevation: env.sunElevation,
      overcast: env.overcast,
      color: env.sun.color,
      night: env.nightFactor,
    });
  const viewDir = new Vector3();
  let lastViewYaw = 0;
  cockpit.showOnDisplay(carNavi.canvas);
  let wasTvOnScreen = false;
  scene.add(vehicle.object);
  vehicle.setFrozen(true);
  const field = new PoiField(
    scene,
    pois,
    categories,
    dem,
    frame,
    storageKeyFor(poiFile?.generatedAt ?? "none"),
  );
  const missions = new Missions(field);
  // The floating yellow arrow over the car is not added: the route's green arrows and the navi lead
  // the way, and a pointer through the buildings only distracted.
  const transit = new Transit(scene, world, dem, stopFile?.stops ?? {}, frame);
  const chase = new ChaseCamera(camera);
  const input = new Input();
  // The key that gets in and out (Q in both layouts today), as the hints should name it.
  const doorKey = () => input.label("door");
  /** Any action's key in the layout in force (or its pad button after a pad was used), for hints. */
  const keyOf = (action: Parameters<typeof keyFor>[1]) => input.label(action);
  input.bindTouch($("#touch"));
  const audio = new GameAudio();
  const minimap = new Minimap($<HTMLCanvasElement>("#minimap"), categories);
  const walker = new Walker(scene, world);
  input.bindDrag($("#scene"));
  input.bindMouseLook($("#scene"));
  let mode: "car" | "foot" | "taxi" = "car";
  /** The 自動運転タクシー called from the phone, while one is about. */
  let taxi: RoboTaxi | null = null;
  /** 自動運転モード of the player's own car (with the mission target, or cruising about). */
  let autopilot: { driver: AutoDriver; cruising: boolean; input: DriveInput } | null = null;
  /** While a saved violation plays, the world streams around it (it may be far from the car). */
  let replayFocus: Vector3 | null = null;
  const focusPos = (target = new Vector3()) =>
    replayFocus
      ? target.copy(replayFocus)
      : mode === "foot"
        ? walker.position(target)
        : mode === "taxi" && taxi
          ? target.copy(taxi.position)
          : vehicle.position(target);
  const pavementTiles = new PavementTiles();
  const pavements = new Pavements(scene, world, (x, z) => groundY(x, z));
  let pavementPolys: PavementPolygon[] = [];
  // People on a PLATEAU pavement stand on the paving, a kerb above the road.
  const pedestrians = new Pedestrians(
    scene,
    world,
    (x, z) => {
      const g = groundY(x, z);
      return g === null ? null : g + (pavements.contains(x, z) ? KERB : 0);
    },
    (x, z, g) => isOpenGround(x, z, g),
  );
  // Bystanders who film the player's violations with their phones (Y on the screen).
  const witnessPhones = new WitnessPhones(pedestrians);
  const roadTiles = new RoadTiles();
  transit.snap = (p, heading) => {
    const hit = roadGraph?.nearest(p, 40);
    if (!hit) return null;
    // Travel along the road in the direction closest to the stop-to-stop heading.
    const fwd = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const dir = hit.dir.clone().multiplyScalar(fwd.dot(hit.dir) >= 0 ? 1 : -1);
    const lane = hit.seg.oneway === 0 ? hit.seg.line.width / 4 : 0;
    const centre = p.clone().add(new Vector3(-hit.dir.z * hit.lateral, 0, hit.dir.x * hit.lateral));
    return { pos: centre.add(leftOf(dir, lane)), heading: Math.atan2(dir.x, dir.z) };
  };
  const control = new TrafficControl(scene, (x, z) => groundY(x, z), world);
  const traffic = new TrafficAI(scene, world, (x, z) => groundY(x, z), control);
  const regulationTiles = new RegulationTiles();
  const signs = new TrafficSigns(
    scene,
    (x, z) => groundY(x, z),
    world,
    (x, z, g) => isOpenGround(x, z, g),
  );
  // 案内標識 (方面及び方向, 108 系) at the signalled junctions of numbered and named streets.
  const guideSigns = new GuideSigns(
    scene,
    (x, z) => groundY(x, z),
    world,
    (x, z, g) => isOpenGround(x, z, g),
  );
  const speedometer = new Speedometer($("#hud-speed"));
  const nav = new NavGuide($("#nav"), () => audio.muted);
  const ribbon = new RouteArrows(scene, (x, z) => groundY(x, z));
  let navGeo: { version: number; points: Array<{ lat: number; lon: number }> } = { version: -1, points: [] };
  const stamps = new Stamps($("#stamps"), () => audio.context, $("#scene"));
  // What a seal says, for under it, in a player's language other than Japanese (the seal is a
  // hanko in Japanese; in Japanese nothing more is written).
  const isJapanese = () => i18n.getLocale() === "ja";
  const stampReading = (label: string) => (isJapanese() ? "" : violationName(label));
  const inPlayersWords = (key: i18n.MessageKey, params?: Record<string, string | number>) =>
    isJapanese() ? "" : i18n.t(key, params);
  const patrol = new ParkingPatrol(scene, (x, z) => groundY(x, z));
  /** A 確認標章 waiting for the driver's choice when they get back in. */
  let pendingParking: Violation | null = null;
  const law = new TrafficLaw();
  // Match the rendered triangles without a physics query for every road/paint vertex.
  const roadSurface = new RoadSurface(
    scene,
    (x, z) => water.deckAt(x, z) ?? terrain.surfaceAt(x, z) ?? groundY(x, z),
  );
  let roadLines: RoadLine[] = [];
  let roadRegs: RegulationData | null = null;
  let roadApplied: AppliedRegulations | null = null;
  let roadGraph: RoadGraph | null = null;
  let roadCenter = { lat: 0, lon: 0 };
  let roadDataCenter = roadCenter;
  let roadsLoading = false;
  let roadRevision = 0;
  let roadLoadSerial = 0;
  const roadBuilder = new RoadNetworkBuilder();
  roadBuilder.inline = import.meta.env.DEV && new URLSearchParams(location.search).has("inlineRoads");
  roadBuilder.warm();
  /** The moment regulations are judged at: the game's date and time in Japan (曜日・祝日). */
  const gameClockNow = (): GameClock => {
    const minutes = env.displayHour(lastGeo.lat, lastGeo.lon) * 60;
    const { y, m, d } = tokyoDate(env.now());
    return gameClock(y, m, d, minutes);
  };
  /** Graph + JARTIC/OSM regulations + signals + markings for the current frame. */
  const furniture = new StreetFurniture(scene, (x, z) => groundY(x, z));
  // 道路照明 along the road graph (rebuilt with it), and the wet street shading.
  const streetLights = new StreetLights(scene, world, {
    graph: () => roadGraph,
    groundAt: (x, z) => {
      const g = groundY(x, z);
      return g === null ? null : g + (pavements.contains(x, z) ? KERB : 0);
    },
    isOpen: (x, z, g) => isOpenGround(x, z, g),
    control,
    traffic,
    player: vehicle,
  });
  // オービス and their 予告看板 (loads its own model and police.json).
  // 可搬式 units move with the game's date and favour streets by a 小学校 (places.json).
  const orbis = new OrbisDevices(
    scene,
    (x, z) => groundY(x, z),
    world,
    () => ({
      day: tokyoDate(env.now()),
      schools: places?.schools ?? [],
      kerbAt: (x, z) => (pavements.contains(x, z) ? KERB : 0),
    }),
  );
  let places: Places | null = null;
  void fetch(`${import.meta.env.BASE_URL}data/places.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Places | null) => {
      places = d;
      if (roadGraph) void buildRoadNetwork();
    })
    .catch(() => undefined);
  const installRoadNetwork = ({ graph, applied }: RoadNetwork) => {
    const started = performance.now();
    const stagesMs: Record<string, number> = {};
    const measure = <T>(name: string, work: () => T): T => {
      const start = performance.now();
      try {
        return work();
      } finally {
        stagesMs[name] = performance.now() - start;
      }
    };
    roadApplied = applied;
    graph.setClock(gameClockNow());
    roadGraph = graph;
    measure("traffic", () => traffic.setGraph(graph));
    measure("control", () => control.rebuild(graph, applied));
    // Bridge decks first: the road surface (through groundY) is laid on them.
    measure("water", () => water.setRoads(graph));
    measure("surface", () => roadSurface.rebuild(graph, applied, control.approaches));
    // 消火栓 and schools add their own signs to the posts.
    const furnitureSigns = measure("furniture", () => furniture.rebuild(graph, places, frame));
    if (applied) applied.signs.push(...furnitureSigns);
    measure("signs", () => signs.rebuild(graph, applied, control.approaches));
    measure("guideSigns", () =>
      guideSigns.rebuild(graph, frame, control.approaches, applied, roadDataCenter, signs.postPositions()),
    );
    measure("orbis", () => orbis.rebuild(graph, frame));
    measure("pedestrians", () =>
      pedestrians.setNetwork(
        new SidewalkNetwork(
          graph,
          applied?.crossings ?? [],
          (seg, near) => control.mayCross(seg, near),
          (x, z) => {
            const g = groundY(x, z);
            return g !== null && isOpenGround(x, z, g);
          },
          (x, z) => pavements.contains(x, z),
        ),
      ),
    );
    log("road_network_built", {
      durationMs: performance.now() - started,
      stagesMs,
      segments: graph.segments.length,
      oneway: graph.segments.filter((s) => s.onewayRule).length,
      posted: graph.segments.filter((s) => s.limitKind !== "statutory").length,
      signals: control.signalCount(),
      stops: control.approaches.filter((a) => a.kind === "stop").length,
      crossings: applied?.crossings.length ?? 0,
      signs: applied?.signs.length ?? 0,
    });
  };
  const buildRoadNetwork = async () => {
    const revision = ++roadRevision;
    const requestedFrame = frame;
    try {
      const network = await roadBuilder.build(roadLines, roadRegs, requestedFrame);
      const isStale = revision !== roadRevision || requestedFrame !== frame || network === null;
      if (isStale) return false;
      installRoadNetwork(network);
      return true;
    } catch (error) {
      warn("road_network_failed", { error: String(error) });
      return false;
    }
  };
  const refreshRoads = (lat: number, lon: number) => {
    if (roadsLoading) return;
    roadsLoading = true;
    const load = ++roadLoadSerial;
    roadRevision++;
    roadBuilder.invalidate();
    roadCenter = { lat, lon };
    // The water of the same tiles too: the decks of the bridges are built with the streets.
    void Promise.all([roadTiles.around(lat, lon), regulationTiles.around(lat, lon), water.around(lat, lon)])
      .then(([lines, regs]) => {
        const isStale = load !== roadLoadSerial;
        if (isStale) return;
        roadLines = lines;
        roadRegs = regs;
        roadDataCenter = { lat, lon };
        return buildRoadNetwork();
      })
      .catch((error: unknown) => warn("road_network_failed", { error: String(error) }))
      .finally(() => {
        const isCurrent = load === roadLoadSerial;
        if (isCurrent) roadsLoading = false;
      });
    // PLATEAU pavements come separately (larger tiles, only some wards): never hold up the roads.
    const wards = areas?.wardsIn(lon - 0.012, lat - 0.01, lon + 0.012, lat + 0.01) ?? [];
    void pavementTiles.around(lat, lon, wards).then((polys) => {
      const isStale = load !== roadLoadSerial;
      if (isStale) return;
      pavementPolys = polys;
      pavements.rebuild(polys, frame);
      pedestrians.pavementsChanged();
      log("pavements_built", { wards, polygons: polys.length });
    });
  };
  const brain = new NpcBrain();
  const voice = new Voice(() => audio.context);
  nav.voice = voice;
  const wardTotals = new Map<string, number>();
  for (const p of pois) wardTotals.set(p.ward, (wardTotals.get(p.ward) ?? 0) + 1);

  // ---------- helpers bound to the current frame ----------
  const groundY = (x: number, z: number): number | null => {
    // On a bridge the ground is its deck: the DEM there is the riverbed.
    const deck = water.deckAt(x, z);
    if (deck !== null) return deck;
    const g = frame.toGeodetic(new Vector3(x, 0, z));
    const h = dem.heightAt(g.lat, g.lon);
    return h === null ? null : frame.toLocal(g.lat, g.lon, h).y;
  };

  // Fixed colliders only (terrain + buildings): cars, buses and pedestrians are not "ground".
  const FIXED_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
  const rayDown = (x: number, z: number, fromY: number): number | null => {
    const hit = world.castRay(
      new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }),
      800,
      true,
      FIXED_ONLY,
      GROUND_QUERY_GROUPS,
    );
    return hit ? fromY - hit.timeOfImpact : null;
  };
  const isOpenGround = (x: number, z: number, g: number): boolean => {
    // Open water is not ground (a bridge deck is): nobody stands or is put there, nor where the
    // water is not known yet (people spawned in the first second stood on the river).
    const isOnWater = !water.isKnownLocal(x, z) || (water.deckAt(x, z) === null && water.isWaterLocal(x, z));
    if (isOnWater) return false;
    const hitY = rayDown(x, z, g + 60);
    return hitY !== null && Math.abs(hitY - g) < 1.2;
  };

  /** Spiral outwards until a car-sized patch of open ground (no building above) is found. */
  const findOpenGround = (x: number, z: number): Vector3 => {
    for (let r = 0; r <= 160; r += 6) {
      const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const g = groundY(px, pz);
        if (g === null) continue;
        const isClear = [
          [0, 0],
          [2.5, 0],
          [-2.5, 0],
          [0, 3.5],
          [0, -3.5],
        ].every(([ox, oz]) => {
          const hitY = rayDown(px + ox, pz + oz, g + 400);
          return hitY !== null && Math.abs(hitY - (groundY(px + ox, pz + oz) ?? g)) < 1.2;
        });
        if (isClear) return new Vector3(px, g + 1.4, pz);
      }
    }
    const g = groundY(x, z) ?? 0;
    return new Vector3(x, (rayDown(x, z, g + 400) ?? g) + 2, z);
  };

  const carYaw = (q: Quaternion) => {
    const f = new Vector3(0, 0, 1).applyQuaternion(q);
    return Math.atan2(f.x, f.z);
  };

  /**
   * Put the car in the left lane of the nearest proper street, facing a legal way (one-way
   * streets their way, otherwise the way it already faced): spawn points are stations and
   * plazas, which are not roads.
   */
  const placeOnStreet = (): boolean => {
    const graph = roadGraph;
    if (!graph) return false;
    const car = vehicle.position();
    const isStreet = (seg: Segment) =>
      seg.line.kind !== "highway" && seg.line.width >= 5.5 && seg.length > 30 && !seg.closed;
    const isLane = (seg: Segment) =>
      seg.line.kind !== "highway" && seg.line.width >= 4 && seg.length > 20 && !seg.closed;
    // Wider and wider until a street turns up: a place chosen in 移動 or on the start screen (a
    // park, the palace, a ward's middle, a tower) can be far from one; a narrow lane only if no
    // street is near at all.
    const hit =
      [150, 400, 1000]
        .map((r) => graph.nearest(car, r, isStreet) ?? graph.nearest(car, r, isLane))
        .find(Boolean) ?? null;
    if (!hit) return false;
    const seg = hit.seg;
    const s = Math.min(seg.length - 12, Math.max(12, hit.s));
    const { pos, dir } = graph.sample(seg, s);
    const faced = hit.dir.dot(
      new Vector3(Math.sin(carYaw(vehicle.quaternion())), 0, Math.cos(carYaw(vehicle.quaternion()))),
    );
    const sign = seg.oneway !== 0 ? seg.oneway : faced >= 0 ? 1 : -1;
    const travel = dir.multiplyScalar(sign);
    const offset = keepLeftOffset(seg, 0, pos, travel, (x, z) => pavements.contains(x, z));
    const at = pos.add(leftOf(travel, offset));
    const g = groundY(at.x, at.z);
    if (g === null) return false;
    at.y = g + 0.9;
    vehicle.teleport(at, Math.atan2(travel.x, travel.z));
    chase.snap();
    return true;
  };
  let needsStreetSpawn = false;
  const viewFrustum = new Frustum();
  const viewMatrix = new Matrix4();
  const viewSphere = new Sphere(new Vector3(), 3);
  // Within 400 m: buildings hide farther things, and fog and distance do the rest.
  const isSeen = (p: Vector3) =>
    p.distanceTo(camera.position) < 400 && viewFrustum.intersectsSphere(viewSphere.set(p, 3));
  traffic.isSeen = isSeen;
  pedestrians.isSeen = isSeen;
  // Who can really see the car: a ray from the eye through the fixed colliders (terrain, buildings,
  // the landmarks' walls) to the car's middle, stopping short of the car itself.
  const EYE_HEIGHT = 1.5;
  const lineOfSight = (from: Vector3, to: Vector3): boolean => {
    const o = { x: from.x, y: from.y + EYE_HEIGHT, z: from.z };
    const d = { x: to.x - o.x, y: to.y + 0.6 - o.y, z: to.z - o.z };
    const length = Math.hypot(d.x, d.y, d.z);
    if (length < 3) return true;
    const ray = new RAPIER.Ray(o, { x: d.x / length, y: d.y / length, z: d.z / length });
    return world.castRay(ray, length - 2.5, true, FIXED_ONLY, GROUND_QUERY_GROUPS) === null;
  };
  pedestrians.lineOfSight = lineOfSight;
  // The opening drive is set once the car stands on its street.
  let needsTrip = false;
  // Where the day starts and ends (the street the game put the car on).
  let home: Home | null = loadHome();
  // 目的地 and 移動 also search every station and the notable places (destinations.json, OSM).
  let destinations: Destination[] = [];
  void loadDestinations().then((d) => {
    if (d) destinations = d.items;
  });
  /** A station or a place as the lists show it: its English name in English, the kind translated. */
  const destinationPlace = (d: Destination): WarpPlace => {
    const isEnglish = i18n.getLocale() === "en";
    const kindKey = DEST_KIND_KEY[d.kind];
    return {
      name: isEnglish && d.nameEn ? d.nameEn : d.name,
      kind: kindKey ? i18n.t(kindKey) : d.kind,
      lat: d.lat,
      lon: d.lon,
      ward: d.ward ?? undefined,
      aka: [d.name, d.nameEn, d.note].filter(Boolean).join(" "),
    };
  };
  // Today's driving, for the end-of-day record.
  let todayMetres = 0;
  let todayFrom = 0; // index into law.state.log where today began
  let odometerAt: Vector3 | null = null;
  // 行政処分: earlier 処分 (前歴) and the days of suspension still to serve.
  let prior = 0;
  let suspendedDays = 0;
  let unlicensedWarnedAt = -Infinity;
  let streetSpawnSince = 0;
  let adriftSince: number | null = null;

  const respawnHere = () => {
    const p = vehicle.position();
    buildings.buildCollidersNear(p);
    vehicle.teleport(findOpenGround(p.x, p.z), carYaw(vehicle.quaternion()));
    // Back on the nearest street, as after a start or 移動 (open ground where it was, if none).
    placeOnStreet();
    chase.snap();
  };

  let recentering: object | null = null;
  const recenter = (force = false) => {
    const isPending = recentering !== null && !force;
    if (isPending) return;
    const job = {};
    recentering = job;
    const previous = frame;
    const revision = ++roadRevision;
    const pos = focusPos();
    const g = frame.toGeodetic(pos);
    const next = new LocalFrame(g.lat, g.lon, dem.heightAt(g.lat, g.lon) ?? g.h);
    return roadBuilder
      .build(roadLines, roadRegs, next)
      .then((network) => {
        const isStale = revision !== roadRevision || frame !== previous || network === null;
        if (isStale) return;
        const m = next.transformFrom(previous);
        const q = next.rotationFrom(previous);
        const offset = (p: Vector3) => p.applyMatrix4(m);
        vehicle.transform(offset, q);
        chase.transform(offset, q);
        camera.position.applyMatrix4(m);
        frame = next;
        terrain.setFrame(next);
        water.setFrame(next);
        buildings.setFrame(next);
        landmarks.setFrame(next);
        field.setFrame(next);
        transit.setFrame(next);
        const f = new Vector3(0, 0, 1).applyQuaternion(q);
        pedestrians.transform(offset, Math.atan2(f.x, f.z));
        if (walker.active) walker.transform(offset, Math.atan2(f.x, f.z));
        traffic.transform(offset, Math.atan2(f.x, f.z));
        emergency.transform(offset);
        patrol.transform(offset);
        pursuitDirector.transform(offset);
        taxi?.transform(offset, Math.atan2(f.x, f.z));
        autopilot?.driver.transform(offset, Math.atan2(f.x, f.z));
        pavements.rebuild(pavementPolys, frame);
        installRoadNetwork(network);
        // Units on patrol are not carried over (another comes by): those engaged keep their record.
        for (const unit of patrols.filter((u) => u.state === "cruising" || u.state === "leaving")) {
          unit.dispose();
          patrols.splice(patrols.indexOf(unit), 1);
          if (police === unit) police = null;
        }
        log("frame_recentered", { lat: Number(g.lat.toFixed(5)), lon: Number(g.lon.toFixed(5)) });
      })
      .catch((error: unknown) => warn("road_network_failed", { error: String(error) }))
      .finally(() => {
        const isCurrent = recentering === job;
        if (isCurrent) recentering = null;
      });
  };

  // ---------- 通知（左の欄） ----------
  const notices = new NoticeLog($("#notice-log"), (n) => {
    if (n.kind !== "social") return openReview();
    phone.show();
    showSocial(true);
    const post = n.ref as SocialPost | undefined;
    if (post) socialApp.openPost(post);
  });
  /** `text` as a function follows a language switch while the notice stays listed. */
  const notify = (kind: NoticeKind, text: () => string, ref?: SocialPost) =>
    notices.add(kind, text, clockLabel(gameClockNow(), tokyoDate(env.now())).split(" ").pop() ?? "", ref);

  // ---------- 移動（どこへでも） ----------
  /** While the destination loads the car waits there, frozen; then it starts on the nearest street. */
  let warping: { label: string; since: number; yaw: number; span: Span } | null = null;
  const warpTo = (place: WarpPlace) => {
    if (enforcing()) return toast(i18n.t("toast.warpBusy"), "#ff6b6b");
    if (mode === "taxi") return toast(i18n.t("toast.warpInTaxi"));
    if (replay) stopReplay();
    if (autopilot) stopAutopilot(i18n.t("toast.autopilotOffForWarp"));
    if (mode === "foot") {
      walker.leave();
      vehicle.setParked(false);
      mode = "car";
    }
    const yaw = carYaw(vehicle.quaternion());
    const at = frame.toLocal(place.lat, place.lon, frame.origin.h);
    vehicle.teleport(at, yaw);
    frozen = true;
    vehicle.setFrozen(true);
    warping = { label: place.name, since: performance.now(), yaw, span: newSpan("warp") };
    log("warp_start", { to: place.name, lat: place.lat, lon: place.lon }, warping.span);
    // The local frame follows the car there, so the far town is near the origin again.
    // A tile request from the previous destination must not overwrite this warp's streets.
    roadLoadSerial++;
    roadsLoading = false;
    recenter(true);
    toast(i18n.t("toast.warping", { place: place.name }), "#4dd2ff");
  };
  const finishWarp = (now: number) => {
    if (!warping) return;
    const pos = vehicle.position();
    const isRecentering = recentering !== null || Math.hypot(pos.x, pos.z) > 1;
    if (isRecentering) return;
    const g = frame.toGeodetic(new Vector3());
    const isGroundReady = terrain.hasColliderAt(g.lat, g.lon);
    const isTownReady = buildings.loadProgress() > 0.95 || now - warping.since > 12000;
    if (!isGroundReady || !isTownReady) return;
    buildings.buildCollidersNear(new Vector3());
    vehicle.teleport(findOpenGround(0, 0), warping.yaw);
    chase.snap();
    needsStreetSpawn = true;
    streetSpawnSince = now;
    toast(i18n.t("toast.warped", { place: warping.label }), "#7dff9a");
    log("warp_landed", { to: warping.label, durationMs: Math.round(now - warping.since) }, warping.span);
    warping = null;
  };
  /** Everything with a name and a place: landmarks, police, the licence centres, spots, wards. */
  const warpPlaces = (): WarpPlace[] => {
    const label = new Map(categories.map((c) => [c.id, categoryLabel(c.id, c.label)]));
    const wards = new Map<string, { lat: number; lon: number; n: number }>();
    for (const p of pois) {
      const w = wards.get(p.ward) ?? { lat: 0, lon: 0, n: 0 };
      wards.set(p.ward, { lat: w.lat + p.lat, lon: w.lon + p.lon, n: w.n + 1 });
    }
    return [
      ...landmarkEntries.map((l) => ({
        name: l.name,
        kind: i18n.t("warp.kind.landmark"),
        lat: l.lat,
        lon: l.lon,
      })),
      ...[...wards].map(([ward, w]) => ({
        name: ward,
        kind: i18n.t("warp.kind.ward"),
        lat: w.lat / w.n,
        lon: w.lon / w.n,
      })),
      ...(policeData?.centres ?? []).map(([lon, lat, name]) => ({
        name,
        kind: i18n.t("warp.kind.licenseCenter"),
        lat,
        lon,
      })),
      ...(policeData?.stations ?? []).map(([lon, lat, name]) => ({
        name,
        kind: i18n.t("warp.kind.policeStation"),
        lat,
        lon,
      })),
      ...pois.map((p) => ({
        name: p.name,
        kind: label.get(p.category) ?? p.category,
        lat: p.lat,
        lon: p.lon,
        ward: p.ward,
      })),
      ...destinations.map(destinationPlace),
    ];
  };
  /** Between a place's kind, ward and distance in the lists. */
  const kindSeparator = () => (i18n.getLocale() === "en" ? " · " : "・");
  const showWarpResults = () => {
    const query = $<HTMLInputElement>("#warp-query").value;
    const places = warpPlaces();
    // Before typing: the landmarks and the wards to choose from (their kinds, in the language in force).
    const firstKinds = new Set([i18n.t("warp.kind.landmark"), i18n.t("warp.kind.ward")]);
    const shown = query.trim() ? searchPlaces(places, query) : places.filter((p) => firstKinds.has(p.kind));
    const pick = (p: WarpPlace) => {
      $<HTMLDialogElement>("#warp").close();
      warpTo(p);
    };
    renderPlaceList($("#warp-results"), shown, pick, { separator: kindSeparator() });
    $("#warp-home-label").textContent = home
      ? i18n.t("warp.homeLabel", { place: home.label ?? i18n.t("warp.homeSet") })
      : i18n.t("warp.noHome");
  };
  $("#warp-query").addEventListener("input", showWarpResults);
  $("#warp-home").addEventListener("click", () => {
    if (!home) return toast(i18n.t("toast.noHome"));
    $<HTMLDialogElement>("#warp").close();
    warpTo({ name: i18n.t("warp.home"), kind: i18n.t("warp.home"), lat: home.lat, lon: home.lon });
  });
  $("#warp-set-home").addEventListener("click", () => {
    const g = frame.toGeodetic(focusPos());
    home = { lat: g.lat, lon: g.lon, label: [wardName, townName].filter(Boolean).join(" ") || undefined };
    saveHome(home);
    showWarpResults();
    toast(i18n.t("toast.homeSet"), "#7dff9a");
  });

  // ---------- UI wiring ----------
  const timeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-time]")];
  const setTime = (mode: TimeMode) => {
    env.timeMode = mode;
    for (const b of timeButtons) b.setAttribute("aria-pressed", String(b.dataset.time === mode));
  };
  setTime("real");
  for (const b of timeButtons) b.addEventListener("click", () => setTime(b.dataset.time as TimeMode));
  input.on("time", () => {
    const next = TIME_MODES[(TIME_MODES.indexOf(env.timeMode) + 1) % TIME_MODES.length];
    setTime(next);
    toast(i18n.t("toast.timeOfDay", { label: i18n.t(TIME_KEY[next]) }));
  });
  const weatherButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-weather]")];
  const setWeather = (mode: WeatherMode) => {
    env.weather = mode;
    for (const b of weatherButtons) b.setAttribute("aria-pressed", String(b.dataset.weather === mode));
  };
  setWeather(env.weather);
  for (const b of weatherButtons)
    b.addEventListener("click", () => setWeather(b.dataset.weather as WeatherMode));
  input.on("weather", () => {
    const order: WeatherMode[] = ["real", "auto", "clear", "rain"];
    setWeather(order[(order.indexOf(env.weather) + 1) % order.length]);
    toast(i18n.t("toast.weather", { label: i18n.t(WEATHER_KEY[env.weather]) }));
  });
  input.on("ground", () => {
    terrain.setStyle(terrain.getStyle() === "photo" ? "plateau" : "photo");
    const isPhoto = terrain.getStyle() === "photo";
    toast(i18n.t("toast.ground", { name: i18n.t(isPhoto ? "toast.groundPhoto" : "toast.groundPlateau") }));
  });
  input.on("camera", () => toast(i18n.t("toast.camera", { name: i18n.t(CAMERA_KEY[chase.cycle()]) })));
  input.on("mute", () => toast(i18n.t(audio.toggleMute() ? "toast.soundOff" : "toast.soundOn")));
  // 復帰 (R) puts the car on the nearest street: not while the police are dealing with it.
  input.on("reset", () => {
    if (enforcing()) return toast(i18n.t("toast.enforcingBusy"), "#ff6b6b");
    respawnHere();
  });
  input.on("help", () => $<HTMLDialogElement>("#help").showModal());
  // タイトルへ: the title screen is the page's own start screen, so going back is a fresh load (what
  // the browser keeps — records, spots, home, settings — survives it).
  input.on("title", () => {
    // A fresh load would end the pursuit, the stop or the story half way: they finish first.
    if (enforcing()) return toast(i18n.t("toast.enforcingBusy"), "#ff6b6b");
    $<HTMLDialogElement>("#title-dialog").showModal();
  });
  $("#title-confirm").addEventListener("click", () => {
    log("title_reload", {});
    location.reload();
  });
  input.on("warp", () => {
    showWarpResults();
    $<HTMLDialogElement>("#warp").showModal();
    $<HTMLInputElement>("#warp-query").focus();
  });
  input.on("credits", () => {
    void regulationTiles.meta().then((regs) => {
      $("#credits-body").innerHTML = renderCredits(poiFile?.sources ?? [], regs);
      $<HTMLDialogElement>("#credits").showModal();
    });
  });
  // 目的地 (N): the chooser — search, landmarks, home, おまかせ (the game's timed mission).
  input.on("mission", () => openDestinations());
  /** おまかせ: a real spot nearby, against the clock, for points. */
  const startRandomMission = () => {
    const g = frame.toGeodetic(vehicle.position());
    const m = missions.start(g.lat, g.lon, performance.now());
    if (m)
      toast(i18n.t("toast.missionStart", { name: m.target.name, m: Math.round(m.startDistance) }), "#ffe14d");
    else toast(i18n.t("toast.noMission"));
  };
  buildToolbar($("#hud-toolbar"));
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    b.addEventListener("click", () => {
      input.trigger(b.dataset.action as Parameters<Input["trigger"]>[0]);
      b.blur();
    });
  }
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    buildings.onResize();
  });

  // 画質 (graphics.ts): the panel in 設定, and what the renderer and the passes take from it at
  // once; the shaders read GRAPHICS.settings themselves.
  buildGraphicsPanel($("#graphics-options"), GRAPHICS, renderInfo.label);
  buildTitlePreset($<HTMLSelectElement>("#opt-graphics"), GRAPHICS);
  const applyGraphics = (g: GraphicsSettings) => {
    renderer.setPixelRatio(pixelRatioFor(g.resolution));
    renderer.setSize(window.innerWidth, window.innerHeight);
    buildings.onResize();
    blur.level = g.motionBlur;
    const hasShadows = g.shadows !== "off";
    const size = hasShadows ? Number(g.shadows) : env.sun.shadow.mapSize.x;
    const isShadowChanged = hasShadows !== renderer.shadowMap.enabled || env.sun.shadow.mapSize.x !== size;
    if (!isShadowChanged) return;
    // The shadow node resizes its map to mapSize itself.
    env.sun.shadow.mapSize.set(size, size);
    const isToggled = hasShadows !== renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = hasShadows;
    if (!isToggled) return;
    // Materials build the shadow lookups in or out: have them rebuilt.
    scene.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
  };
  applyGraphics(GRAPHICS.settings);
  GRAPHICS.onChange(applyGraphics);

  // ---------- live data ----------
  const refreshWeather = async () => {
    const obs = await fetchTokyoObservation();
    if (obs) env.setObservation(obs);
    // AMeDAS updates every 10 min; retry sooner after a transient failure.
    setTimeout(refreshWeather, obs ? 10 * 60_000 : 30_000);
  };
  void refreshWeather();

  let wardName = "—";
  let townName = "";
  let lastLocate = -Infinity;
  // Ward/town from bundled e-Stat 町丁 polygons (no per-player calls to GSI's reverse geocoder).
  const locate = (lat: number, lon: number) => {
    const hit = areas?.lookup(lat, lon) ?? null;
    if (hit) {
      wardName = hit.ward;
      townName = hit.town;
      pedestrians.crowd = Math.round((18 + Math.min(26, hit.density / 600)) * QUALITY.crowdScale);
    } else {
      townName = "";
    }
  };

  let lastGeo = { lat: spawn.lat, lon: spawn.lon };
  // What an uncaught_error line reports of the game (diagnostics.ts reads each on its own).
  setDiagnosticsState({
    mode: () => mode,
    state: () => state,
    lat: () => lastGeo.lat,
    lon: () => lastGeo.lon,
    gameTime: () => env.now().toISOString(),
    timeMode: () => env.timeMode,
    weather: () => env.weather,
    graphicsPreset: () => GRAPHICS.settings.preset,
    backend: () => renderInfo.backend,
    activeSpans: () => [
      pursuitDirector.chase?.span.spanId,
      pursuitDirector.stop?.span.spanId,
      warping?.span.spanId,
    ],
  });
  const surroundings = (): Surroundings => {
    const hour = env.displayHour(lastGeo.lat, lastGeo.lon);
    const obs = env.getObservation();
    const sky = env.isRaining() ? "雨" : (obs?.sun1h ?? 0) >= 0.3 ? "晴れ" : "くもり";
    const weather =
      env.weather === "real" && obs
        ? `${sky}で、気温は${Math.round(obs.temp ?? 20)}度くらい`
        : env.weather === "rain"
          ? "雨"
          : "晴れ";
    const bus = transit.nearest(lastGeo.lat, lastGeo.lon);
    return {
      ward: wardName === "—" ? "東京" : wardName,
      town: townName,
      timeLabel: TIME_LABEL[env.timeMode] === "リアル時刻" ? "いま" : TIME_LABEL[env.timeMode],
      clock: `${Math.floor(hour)}時${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}分`,
      weather,
      nearbyPois: field.near(lastGeo.lat, lastGeo.lon, 900),
      categories,
      lat: lastGeo.lat,
      lon: lastGeo.lon,
      busLine: bus && bus.distance < 400 ? (bus.bus.note.split(" ")[0] ?? null) : null,
    };
  };
  const emergency = new EmergencyResponse(scene, audio.spatial, (x, z) => groundY(x, z));
  const phone = new Phone(
    brain,
    voice,
    () => {
      const d = new Date(Date.now() + 9 * 3600_000);
      return {
        location: `${wardName === "—" ? "" : wardName}${townName}` || "不明",
        clock: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
        hasIncident: emergency.active,
      };
    },
    (line) => emergency.dispatch(line === "119" ? "ambulance" : "police", roadGraph),
  );
  // After an accident the phone opens where 119 and 110 are (its home), not on Y as usual.
  input.on("phone", () => {
    const isToReport = emergency.active && !phone.inCall;
    if (!isToReport) return phone.toggle();
    phone.show();
    showSocial(false);
  });
  // 拡大表示 (Shift+F): takes the phone out first if it is put away; either way it is working it.
  input.on("phoneZoom", () => {
    if (!phone.open) phone.show();
    phone.toggleZoom();
  });
  const conversation = new ConversationController(brain, voice, surroundings, (p) => pedestrians.endTalk(p));
  // 音源の位置 (game/spatialAudio.ts): the player's car, the nearest traffic, the crosswalk calls
  // (音響式信号機: walk light green, 8:00–19:00 as most are run) and people from where they stand.
  audio.spatial.car = vehicle.object;
  audio.spatial.traffic = (visit) => traffic.forEachCar(visit);
  audio.spatial.crosswalks = (visit) => {
    const hour = env.displayHour(lastGeo.lat, lastGeo.lon);
    const isOperating = hour >= 8 && hour < 19;
    if (isOperating) control.forEachWalking(visit);
  };
  conversation.voiceFrom = (p) => audio.spatial.voiceFrom(p.object, "voice");
  // ---------- リプレイ ----------
  const recorder = new ReplayRecorder();
  const director = new ReplayDirector();
  type Replay = {
    t: number;
    playing: boolean;
    speed: number;
    camera: ReplayCamera;
    clones: Map<Object3D, Object3D>;
    /** The live recording, or one rebuilt from a saved violation's clip. */
    rec: ReplayRecorder;
    /** Violations on the timeline: when, what, and why (shown as a caption around the moment). */
    marks: Array<{ at: number; label: string; why: string }>;
    isClip: boolean;
    /** Close by itself here (the moment shown at the roadside: 5 s after the violation). */
    stopAt?: number;
    /** Called once it closes (the roadside conversation goes on). */
    onClose?: () => void;
  };
  /** Saved clips play through the same director: their samples become a recording again. */
  type ReplaySource = {
    rec: ReplayRecorder;
    marks: Replay["marks"];
    moment: { ms: number; raining: boolean };
  };
  let replay: Replay | null = null;
  const replayCamera = $<HTMLSelectElement>("#replay-camera");
  replayCamera.replaceChildren(
    ...(Object.keys(CAMERA_LABEL) as ReplayCamera[]).map((k) => {
      const o = document.createElement("option");
      o.value = k;
      i18n.bindText(o, () => i18n.t("replay.cameraOption", { name: i18n.t(REPLAY_CAMERA_KEY[k]) }));
      return o;
    }),
  );
  const liveObjects = () => [...traffic.objects(), ...pedestrians.list.map((p) => p.object)];
  const formatT = (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, "0")}`;
  /** Open the replay at a moment (default: 20 s before the end of the recording). */
  const startReplay = (at?: number, source?: ReplaySource) => {
    const rec = source?.rec ?? recorder;
    if (rec.frames.length < (source ? 2 : 10) || state !== "playing")
      return toast(i18n.t("toast.noRecording"));
    for (const o of liveObjects()) o.visible = false;
    replay = {
      t: at ?? Math.max(rec.start, rec.end - 20000),
      playing: true,
      speed: 1,
      camera: "auto",
      clones: new Map(),
      rec,
      marks:
        source?.marks ??
        law.state.log
          .filter((r) => r.at >= rec.start && r.at <= rec.end)
          .map((r) => ({ at: r.at, label: r.label, why: replayWhy(r) })),
      isClip: source !== undefined,
    };
    if (source) {
      env.showMoment(source.moment);
      replayFocus = rec.frames[0]
        ? new Vector3(rec.frames[0].car.x, rec.frames[0].car.y, rec.frames[0].car.z)
        : null;
    }
    const r0 = replay;
    $("#replay-bar").hidden = false;
    $("#hud").classList.add("replaying");
    replayCamera.value = "auto";
    // Today's route arrows are not part of what happened.
    ribbon.clear();
    // Violations as red ticks on the timeline.
    const span = Math.max(1, rec.end - rec.start);
    $("#replay-marks").replaceChildren(
      ...r0.marks.map((r) => {
        const m = document.createElement("span");
        m.style.left = `${((r.at - rec.start) / span) * 100}%`;
        m.title = violationName(r.label);
        return m;
      }),
    );
  };
  const stopReplay = () => {
    const r = replay;
    if (!r) return;
    $("#replay-caption").hidden = true;
    for (const c of r.clones.values()) scene.remove(c);
    for (const o of liveObjects()) o.visible = true;
    replay = null;
    env.showMoment(null);
    replayFocus = null;
    $("#replay-bar").hidden = true;
    $("#hud").classList.remove("replaying");
    vehicle.syncVisuals();
    // A post's video ends: back to the phone as it was.
    director.witness = null;
    videoFrame?.remove();
    videoFrame = null;
    if (reopenPhone) phone.show(false);
    reopenPhone = false;
    r.onClose?.();
  };
  /** The frame of a post's video: the poster's aspect, black beyond it, who filmed it. */
  let videoFrame: HTMLElement | null = null;
  let reopenPhone = false;
  /**
   * Play a post's video: its moment replayed from where the poster stood, with their phone's field
   * of view and hand, framed to their aspect. false when nothing is left to replay (the viewer then
   * shows the still).
   */
  const playPostVideo = (id: number): boolean => {
    const post = social.posts.find((p) => p.id === id);
    if (!post) return false;
    const r = post.record;
    const isInBuffer = r.session === SESSION && r.at >= recorder.start && r.at <= recorder.end;
    if (!isInBuffer && !r.replay) return false;
    const from = post.filmedFrom;
    const eye = from?.geo
      ? frame.toLocal(from.geo.lat, from.geo.lon, from.geo.h)
      : from
        ? new Vector3(from.eye.x, from.eye.y, from.eye.z)
        : null;
    reopenPhone = phone.open;
    phone.close();
    if (isInBuffer) startReplay(Math.max(recorder.start, r.at - CLIP_BEFORE_MS));
    else playClip(r);
    const current = replay;
    if (!current) return false;
    director.witness = eye && from ? { eye, fov: from.fov, tilt: from.tilt } : null;
    current.camera = director.witness ? "witness" : "roadside";
    replayCamera.value = current.camera;
    const [aw, ah] = (from?.aspect ?? "16:9").split(":").map(Number);
    videoFrame = document.createElement("div");
    videoFrame.id = "video-frame";
    videoFrame.style.setProperty("--ar", String(aw / ah));
    const label = document.createElement("div");
    label.className = "video-frame-label";
    label.textContent = i18n.t("replay.filmedBy", {
      app: SOCIAL_APP_NAME,
      author: post.author,
      handle: post.handle,
    });
    videoFrame.append(label);
    document.body.append(videoFrame);
    log("social_video_played", { postId: post.id, camera: current.camera }, postSpan(post));
    return true;
  };
  /** Why a violation is one, for the replay caption: the article, points and fine, and what happened. */
  const replayWhy = (r: ViolationRecord): string => {
    const fine =
      r.fine === null ? i18n.t("replay.noFine") : i18n.t("replay.fine", { fine: formatNumber(r.fine) });
    const c = r.context;
    const kmh = c ? Math.round(c.kmh) : 0;
    const limitKey = c?.limitKind === "sign" ? "replay.kmhSign" : "replay.kmhStatutory";
    const speed = !c ? "" : c.limit === null ? `${kmh} km/h` : i18n.t(limitKey, { kmh, limit: c.limit });
    // The detail already says the speed when there is one.
    const why = i18n.t("replay.why", { article: lawRef(r.article), points: pointsCount(r.points), fine });
    const detail = c?.detail ? violationDetail(c.detail) : speed;
    return [why, detail, c?.place ? recordPlace(c.place) : ""].filter(Boolean).join(" ／ ");
  };
  const playReplay = (dt: number) => {
    const r = replay;
    if (!r) return;
    const rec = r.rec;
    if (r.playing) r.t = Math.min(rec.end, r.t + dt * 1000 * r.speed);
    if (r.stopAt !== undefined && r.t >= r.stopAt) return stopReplay();
    if (r.t >= rec.end) r.playing = false;
    const s = rec.at(r.t);
    if (!s) return;
    const { a, b, k } = s;
    const pos = new Vector3(a.car.x, a.car.y, a.car.z).lerp(new Vector3(b.car.x, b.car.y, b.car.z), k);
    const quat = new Quaternion(a.car.qx, a.car.qy, a.car.qz, a.car.qw).slerp(
      new Quaternion(b.car.qx, b.car.qy, b.car.qz, b.car.qw),
      k,
    );
    vehicle.object.position.copy(pos);
    vehicle.object.quaternion.copy(quat);
    // Traffic and people as they were: copies posed from the recording.
    for (const c of r.clones.values()) c.visible = false;
    for (const [o, pa] of a.others) {
      let c = r.clones.get(o);
      if (!c) {
        c = o.clone(true);
        c.visible = true;
        scene.add(c);
        r.clones.set(o, c);
      }
      const pb = b.others.get(o) ?? pa;
      c.visible = true;
      c.position.set(
        MathUtils.lerp(pa.x, pb.x, k),
        MathUtils.lerp(pa.y, pb.y, k),
        MathUtils.lerp(pa.z, pb.z, k),
      );
      c.rotation.set(0, pa.yaw + Math.atan2(Math.sin(pb.yaw - pa.yaw), Math.cos(pb.yaw - pa.yaw)) * k, 0);
    }
    control.update(r.t / 1000);
    const marks = r.marks.map((v) => v.at);
    // 違反の理由: from 2.5 s before each violation to 4 s after, what it was and why.
    const near = r.marks.find((m) => r.t > m.at - 2500 && r.t < m.at + 4000);
    const caption = $("#replay-caption");
    caption.hidden = !near;
    if (near && caption.dataset.at !== String(near.at)) {
      caption.dataset.at = String(near.at);
      caption.replaceChildren(
        Object.assign(document.createElement("strong"), { textContent: `⚠ ${violationName(near.label)}` }),
        Object.assign(document.createElement("span"), { textContent: near.why }),
      );
    }
    if (r.isClip) replayFocus = pos.clone();
    director.place(
      camera,
      r.camera,
      r.t,
      { pos, quat, speed: MathUtils.lerp(a.car.speed, b.car.speed, k) },
      marks,
      (x, z) => groundY(x, z),
    );
    $<HTMLInputElement>("#replay-seek").value = String(
      Math.round(((r.t - rec.start) / Math.max(1, rec.end - rec.start)) * 1000),
    );
    $("#replay-time").textContent = `${formatT(r.t - rec.start)} / ${formatT(rec.end - rec.start)}`;
    $("#replay-play").textContent = r.playing ? "❚❚" : "▶";
  };
  input.on("replay", () => (replay ? stopReplay() : startReplay()));
  $("#replay-exit").addEventListener("click", stopReplay);
  $("#replay-play").addEventListener("click", () => {
    if (!replay) return;
    if (replay.t >= replay.rec.end) replay.t = replay.rec.start;
    replay.playing = !replay.playing;
  });
  $<HTMLInputElement>("#replay-seek").addEventListener("input", (e) => {
    if (!replay) return;
    const v = Number((e.target as HTMLInputElement).value) / 1000;
    replay.t = replay.rec.start + v * (replay.rec.end - replay.rec.start);
  });
  $<HTMLSelectElement>("#replay-speed").addEventListener("change", (e) => {
    if (replay) replay.speed = Number((e.target as HTMLSelectElement).value);
  });
  replayCamera.addEventListener("change", () => {
    if (replay) replay.camera = replayCamera.value as ReplayCamera;
  });

  // ---------- 運転席のスイッチ（City Car Driving の配置） ----------
  const controls = new CarControls();
  // 設定: WASD and 簡単操作 unless this browser chose otherwise; the seat, the screen, the sound.
  let navHidden = false;
  let prefsNow = loadPrefs();
  /**
   * HUD text that names a key, from the layout in force (index.html's own copy names P, O and F
   * from older layouts): bound, so a language switch redraws it; applyPrefs redraws it for a new
   * layout.
   */
  const showKeyHints = () => {
    i18n.bindText($("#paused"), () => i18n.t("hud.paused", { key: keyOf("pause") }));
    i18n.bindText($("#autopilot-how"), () => i18n.t("hud.autopilotHow", { key: keyOf("autopilot") }));
    i18n.bindText($("#incident-text"), () => i18n.t("incident.text", { key: keyOf("phone") }));
    $("#phone-button").title = i18n.t("hud.phoneButton", { key: keyOf("phone") });
  };
  const applyPrefs = (prefs: ControlPrefs) => {
    prefsNow = prefs;
    input.layout = prefs.layout;
    audio.volume = prefs.volume;
    audio.spatial.applyLevel();
    $<HTMLInputElement>("#opt-volume").value = String(prefs.volume);
    $("#opt-volume-value").textContent = `${Math.round(prefs.volume * 100)}%`;
    $("#minimap").hidden = !prefs.minimap;
    $<HTMLInputElement>("#opt-minimap").checked = prefs.minimap;
    $<HTMLSelectElement>("#opt-minimap-north").value = prefs.minimapNorthUp ? "north" : "heading";
    navHidden = !prefs.nav;
    $<HTMLInputElement>("#opt-nav").checked = prefs.nav;
    controls.assist = prefs.assist;
    cockpit.setSeat(prefs.seatUp, prefs.seatBack);
    mirrorCharms.setChoice(prefs.charm);
    $<HTMLSelectElement>("#opt-charm").value = prefs.charm;
    $<HTMLInputElement>("#opt-seat-up").value = String(prefs.seatUp);
    $<HTMLInputElement>("#opt-seat-back").value = String(prefs.seatBack);
    const cm = (m: number) => `${m > 0 ? "+" : ""}${Math.round(m * 100)} cm`;
    $("#opt-seat-up-value").textContent = cm(prefs.seatUp);
    $("#opt-seat-back-value").textContent = cm(prefs.seatBack);
    $<HTMLSelectElement>("#opt-layout").value = prefs.layout;
    $<HTMLSelectElement>("#opt-assist").value = prefs.assist;
    showControls();
  };
  /** The help's list, the hints and the toolbar's badges: keys, or the pad's buttons after a pad. */
  const showControls = () => {
    const pad = input.pad.pad;
    renderKeyList($("#help-keys"), prefsNow, pad && { name: pad.name, rows: input.pad.helpRows() });
    showKeyHints();
    const isPad = input.pad.source === "pad" && pad !== null;
    labelToolbar($("#hud-toolbar"), prefsNow.layout, isPad ? (a) => input.label(a) : undefined);
  };
  applyPrefs(prefsNow);
  // The help's key list and the hints' titles are built in code: again in the new language, and
  // when a pad comes, goes, is rebound, or takes over from the keyboard (and back).
  i18n.onLocaleChange(showControls);
  input.pad.onChange(showControls);
  mountPadSettings($("#pad-settings"), input.pad);
  const savePrefsAndApply = (prefs: ControlPrefs) => {
    savePrefs(prefs);
    applyPrefs(prefs);
  };
  const SETTING_INPUTS = [
    "#opt-layout",
    "#opt-assist",
    "#opt-seat-up",
    "#opt-seat-back",
    "#opt-volume",
    "#opt-minimap",
    "#opt-minimap-north",
    "#opt-nav",
    "#opt-charm",
  ];
  // "input" too: the seat and the volume follow the slider while it is dragged.
  for (const id of SETTING_INPUTS)
    for (const type of ["input", "change"])
      $(id).addEventListener(type, () => {
        const prefs: ControlPrefs = {
          layout: $<HTMLSelectElement>("#opt-layout").value === "ccd" ? "ccd" : "wasd",
          assist: $<HTMLSelectElement>("#opt-assist").value === "real" ? "real" : "easy",
          seatUp: seatOf($<HTMLInputElement>("#opt-seat-up").value, SEAT_RANGE.up, DEFAULT_PREFS.seatUp),
          seatBack: seatOf(
            $<HTMLInputElement>("#opt-seat-back").value,
            SEAT_RANGE.back,
            DEFAULT_PREFS.seatBack,
          ),
          volume: volumeOf($<HTMLInputElement>("#opt-volume").value),
          minimap: $<HTMLInputElement>("#opt-minimap").checked,
          minimapNorthUp: $<HTMLSelectElement>("#opt-minimap-north").value === "north",
          nav: $<HTMLInputElement>("#opt-nav").checked,
          charm: charmOf($<HTMLSelectElement>("#opt-charm").value),
        };
        savePrefsAndApply(prefs);
        if (type === "change")
          log("controls_changed", {
            layout: prefs.layout,
            assist: prefs.assist,
            seatUpM: prefs.seatUp,
            seatBackM: prefs.seatBack,
            volume: prefs.volume,
            minimap: prefs.minimap,
            minimapNorthUp: prefs.minimapNorthUp,
            nav: prefs.nav,
            charm: prefs.charm,
          });
      });
  let paused = false;
  const inCarOnly = (fn: () => void) => () => {
    if (mode === "car" && state === "playing") fn();
  };
  input.on(
    "indicatorLeft",
    inCarOnly(() => controls.toggleIndicator("left")),
  );
  input.on(
    "indicatorRight",
    inCarOnly(() => controls.toggleIndicator("right")),
  );
  input.on(
    "hazard",
    inCarOnly(() => {
      controls.hazard = !controls.hazard;
      toast(i18n.t(controls.hazard ? "toast.hazardOn" : "toast.hazardOff"));
    }),
  );
  input.on(
    "lights",
    inCarOnly(() => {
      const lights = controls.cycleLights();
      const label = lights === "auto" ? "AUTO" : i18n.t(lights === "on" ? "hud.lightsOn" : "hud.lightsOff");
      toast(i18n.t("toast.lights", { mode: label }));
    }),
  );
  input.on(
    "highBeam",
    inCarOnly(() => {
      controls.highBeam = !controls.highBeam;
      toast(i18n.t(controls.highBeam ? "toast.highBeam" : "toast.lowBeam"));
    }),
  );
  input.on(
    "wipers",
    inCarOnly(() => {
      controls.wipers = (controls.wipers + 1) % 4;
      const wipers = ["OFF", i18n.t("hud.wipersIntermittent"), "LO", "HI"][controls.wipers];
      toast(i18n.t("toast.wipers", { mode: wipers ?? "OFF" }));
    }),
  );
  input.on(
    "belt",
    inCarOnly(() => {
      controls.belt = !controls.belt;
      toast(i18n.t(controls.belt ? "toast.beltOn" : "toast.beltOff"), controls.belt ? "#7dff9a" : "#ffb347");
    }),
  );
  // ナビのテレビ (game/naviTv.ts): the picture only stopped with the parking brake on, the sound always.
  const tvInfo = (): TvInfo => {
    // The numbers are observed whatever the sky is set to; the sky only in 実況.
    const obs = env.getObservation();
    const ward = wardName === "—" ? "" : wardName;
    return {
      hour: env.displayHour(lastGeo.lat, lastGeo.lon),
      place: [ward, townName].filter(Boolean).join(" "),
      ward,
      lat: lastGeo.lat,
      lon: lastGeo.lon,
      weather: {
        raining: env.isRaining(),
        fixedSky: env.weather !== "real" || obs === null,
        sun1h: obs?.sun1h ?? null,
        night: env.nightFactor > 0.5,
        temp: obs?.temp ?? null,
        humidity: obs?.humidity ?? null,
        precip10m: obs?.precip10m ?? null,
        wind: obs?.wind ?? null,
      },
      violations: law.state.log
        .slice(todayFrom)
        .map((r) => ({ label: r.label, caught: r.status !== "uncaught" })),
    };
  };
  const naviTv = new NaviTv({
    audio,
    voice,
    areas,
    info: tvInfo,
    speakerAt: () => displayOffset(cockpit.root, vehicle.object),
    // The people (a conversation, a call, the patrol car's loudspeaker) come first.
    canSpeak: () =>
      conversation.active === null &&
      !phone.inCall &&
      police?.state !== "pursuing" &&
      police?.state !== "ticketing",
  });
  input.on(
    "tv",
    inCarOnly(() => toast(naviTv.press(), "#4dd2ff")),
  );
  input.on(
    "tvChannel",
    inCarOnly(() => toast(naviTv.channelUp(), "#4dd2ff")),
  );
  input.on("pause", () => {
    if (state !== "playing") return;
    paused = !paused;
    $("#paused").hidden = !paused;
  });
  // The keys flip the same settings the 設定 screen shows, and they are remembered alike.
  input.on("nav", () => {
    savePrefsAndApply({ ...prefsNow, nav: !prefsNow.nav });
    toast(navHidden ? i18n.t("toast.navHidden", { key: keyOf("nav") }) : i18n.t("toast.navShown"));
  });
  input.on("minimap", () => savePrefsAndApply({ ...prefsNow, minimap: !prefsNow.minimap }));
  // A click on the small map turns it between 進行方向が上 and 北が上.
  $("#minimap").addEventListener("click", () => {
    savePrefsAndApply({ ...prefsNow, minimapNorthUp: !prefsNow.minimapNorthUp });
    toast(i18n.t(prefsNow.minimapNorthUp ? "toast.minimapNorthUp" : "toast.minimapHeadingUp"));
  });

  // 設定: everything stops while it is open (as the P pause), and goes on as it was when closed.
  const settingsDialog = $<HTMLDialogElement>("#settings");
  let pausedBeforeSettings = false;
  // 設定 › AI と声: the same two choices as the title's boxes, at any time during play (saved too).
  const playAi = $<HTMLInputElement>("#opt-ai-play");
  const playVoice = $<HTMLInputElement>("#opt-voice-play");
  const talkVoice = $<HTMLInputElement>("#voice-toggle");
  const showAiVoice = () => {
    const isAiOn = brain.status === "ready" || brain.status === "downloading" || brain.status === "loading";
    playAi.checked = isAiOn;
    playVoice.checked = talkVoice.checked;
  };
  playAi.addEventListener("change", () => {
    if (playAi.checked) void brain.enable();
    else brain.pause();
  });
  playVoice.addEventListener("change", () => {
    // Through the conversation panel's box, which switches the synthesizer itself.
    talkVoice.checked = playVoice.checked;
    talkVoice.dispatchEvent(new Event("change"));
    saveVoice(playVoice.checked);
  });
  talkVoice.addEventListener("change", () => saveVoice(talkVoice.checked));
  input.on("settings", () => {
    if (settingsDialog.open) return;
    showAiVoice();
    $<HTMLDialogElement>("#help").close();
    pausedBeforeSettings = paused;
    paused = true;
    document.exitPointerLock();
    settingsDialog.showModal();
  });
  settingsDialog.addEventListener("close", () => {
    paused = pausedBeforeSettings;
  });
  // The title screen's 設定 waits (disabled) until the dialog's controls above are wired.
  $<HTMLButtonElement>("#title-settings").disabled = false;
  input.on("cameraPrev", () => {
    chase.cycle();
    chase.cycle();
    toast(i18n.t("toast.camera", { name: i18n.t(CAMERA_KEY[chase.cycle()]) }));
  });
  input.on("screenshot", () => {
    // The next drawn frame, saved as a PNG.
    pendingScreenshot = true;
  });
  input.on("talk", () => {
    // E: the engine in the car (City Car Driving), talking to someone on foot.
    if (mode === "car" && state === "playing") {
      controls.engineOn = !controls.engineOn;
      toast(i18n.t(controls.engineOn ? "toast.engineOn" : "toast.engineOff"));
      return;
    }
    startTalk();
  });
  /** Talk to the nearest person: on foot (E), or from the stopped car through the window (Enter). */
  const startTalk = () => {
    if (conversation.active || state !== "playing") return;
    const isStopped = mode === "foot" || Math.abs(vehicle.speedKmh()) < 4;
    const p = isStopped ? pedestrians.nearest(focusPos(), mode === "foot" ? 3.5 : 10) : null;
    if (!p) {
      toast(i18n.t(isStopped ? "toast.noPedestrian" : "toast.stopToTalk"));
      return;
    }
    pedestrians.startTalk(p, focusPos());
    conversation.open(p);
  };
  // Enter: into the call's or the conversation's box; in the car with neither open, talking through
  // the window. Why not E there too: in the car E is the engine (City Car Driving's key), and the
  // hint said 「E で話しかける」 while E switched the engine off.
  input.on("enter", () => {
    // The window's first answer, or the story's next panel.
    if (pursuitDirector.primary()) return;
    if (phone.inCall) return phone.focusInput();
    if (conversation.active) return conversation.focusInput();
    if (mode === "car") startTalk();
  });
  input.on("autopilot", () => {
    // A is also the walking key (strafe) on foot: only the driver's seat has an autopilot.
    if (state !== "playing" || mode !== "car") return;
    if (autopilot) stopAutopilot(i18n.t("toast.autopilotOff"));
    else startAutopilot();
  });
  input.on("door", () => {
    if (state !== "playing") return;
    // Out of the car and away on foot would be a way out of the pursuit or the stop.
    if (mode === "car" && enforcing()) return toast(i18n.t("toast.enforcingBusy"), "#ff6b6b");
    if (autopilot) {
      if (autopilot.driver.speed > 0.5) return toast(i18n.t("toast.stopToGetOut"));
      stopAutopilot(i18n.t("toast.autopilotOff"));
    }
    if (mode === "taxi") {
      if (taxi && taxi.speed < 0.5) leaveTaxi();
      else toast(i18n.t("toast.waitTaxiStop"));
      return;
    }
    if (mode === "foot" && taxi?.state === "waiting" && walker.position().distanceTo(taxi.position) < 5) {
      boardTaxi();
      return;
    }
    if (mode === "car") {
      if (Math.abs(vehicle.speedKmh()) > 5) {
        toast(i18n.t("toast.stopToGetOut"));
        return;
      }
      // Right-hand drive: the driver's door is on the car's right (chassis −X when facing +Z).
      const q = vehicle.quaternion();
      const at = vehicle.position().add(new Vector3(-1.6, 0, 0.3).applyQuaternion(q));
      at.y = groundY(at.x, at.z) ?? at.y - 0.8;
      walker.enter(at, carYaw(q));
      vehicle.setParked(true);
      mode = "foot";
      announceIdlingStop();
      toast(i18n.t("toast.gotOut", { key: doorKey() }), "#4dd2ff");
      return;
    }
    if (walker.position().distanceTo(vehicle.position()) > 4.5) {
      toast(i18n.t("toast.getInHint", { key: doorKey() }));
      return;
    }
    // Nothing physically stops a suspended driver; the law does. Ask twice.
    if (law.state.suspended && performance.now() - unlicensedWarnedAt > 5000) {
      unlicensedWarnedAt = performance.now();
      // The key from the layout (the hint said F, the phone's key, from before 乗降 moved to Q).
      toast(i18n.t("toast.suspendedWarn", { days: daysText(suspendedDays), key: doorKey() }), "#ff6b6b");
      return;
    }
    walker.leave();
    vehicle.setParked(false);
    mode = "car";
    if (ticket.visible) {
      ticket.visible = false;
      if (pendingParking) openParkingDialog(pendingParking);
    }
    chase.snap();
    toast(i18n.t("toast.gotIn"));
  });
  // Esc: the conversation, the phone held large or in a call — or else 設定. The phone in its holder
  // stays (F puts it away): it is out all the time, so Esc would never reach 設定.
  input.on("close", () => {
    // Esc skips the story panels (what they tell still applies).
    if (pursuitDirector.skip()) return;
    const isTalking = !$("#chat").hidden;
    if (isTalking) return conversation.close();
    if (phone.open && phone.zoomed) return phone.setZoom(false);
    if (phone.inCall) return phone.close();
    input.trigger("settings");
  });

  // Dev-only hook so automated checks can frame the car from arbitrary angles.
  let debugCamera: ((cam: PerspectiveCamera, car: Vector3) => void) | null = null;

  // ---------- main loop ----------
  let state: "loading" | "ready" | "playing" = "loading";
  let score = 0;
  let accumulator = 0;
  let last = performance.now();
  let lastPoiRefresh = 0;
  let lastHud = 0;
  let frozen = true;
  let appliedNight = -1;
  const events = new RAPIER.EventQueue(true);
  let lastLawCheck = 0;
  let overSince: number | null = null;
  let rightSince: number | null = null;
  let wrongWaySince: number | null = null;
  let slowSince: number | null = null;
  let closedSince: number | null = null;
  let rightLaneSince: number | null = null;
  let laneAtJunction: { use: LaneUse; lane: number; tIn: Vector3; node: Vector3 } | null = null;
  // 合図: when each indicator last blinked, the junction being turned at, the lane last held.
  const indicatorSeen = { left: -Infinity, right: -Infinity };
  let turnAt: { tIn: Vector3; node: Vector3 } | null = null;
  let laneHeld: { seg: Segment; lane: number } | null = null;
  let hornFor = 0;
  let pendingScreenshot = false;
  /** The orbis flash: a red-white burst over the screen. */
  const flashScreen = () => {
    const el = document.createElement("div");
    el.className = "orbis-flash";
    document.body.append(el);
    setTimeout(() => el.remove(), 400);
  };
  let lastHeading: { seg: Segment; sgn: number; at: number } | null = null;
  let laneTrack: { seg: Segment; lane: number } | null = null;
  let lastStreet: { seg: Segment; dir: 1 | -1 } | null = null;
  let lawPrevPos: Vector3 | null = null;
  // Where and when the car last stood still, for 一時停止 (stop before the line, then go).
  let lastStop: { pos: Vector3; at: number } | null = null;
  let lastClockSync = 0;
  let currentLimit: number | null = null;
  let currentLimitKind: "sign" | "zone" | "statutory" | null = null;
  let currentOneway = false;
  let stoppedSince: number | null = null;
  // 確認標章: the yellow notice police stick on an illegally parked car.
  const ticket = new Mesh(
    new PlaneGeometry(0.34, 0.22),
    new MeshBasicMaterial({ color: 0xffd400, side: DoubleSide }),
  );
  ticket.position.set(0.3, 0.32, 0.72);
  ticket.rotation.x = -0.95;
  ticket.visible = false;
  vehicle.object.add(ticket);
  let idlingAnnounced = false;
  const announceIdlingStop = () => {
    if (idlingAnnounced) return;
    idlingAnnounced = true;
    toast(i18n.t("toast.idlingStop"), "#7dff9a");
  };
  const contactCooldown = new Map<number, number>();
  /** A person hit is one accident, however many steps the blow takes to part them. */
  const pedestrianCooldown = new WeakMap<Pedestrian, number>();
  const loadStart = performance.now();
  let lastBrainStatus = brain.status;
  const startButton = $<HTMLButtonElement>("#start");
  camera.position.set(-60, 90, 140);
  camera.lookAt(0, 30, 0);

  // Start-screen options: Gemma downloads in the background while playing (templates until ready).
  const optAi = $<HTMLInputElement>("#opt-ai");
  const optVoice = $<HTMLInputElement>("#opt-voice");
  const optAiNote = $("#opt-ai-note");
  // Both boxes remembered as they are left (titlePrefs.ts / NpcBrain's consent).
  optVoice.checked = savedVoice();
  optVoice.addEventListener("change", () => saveVoice(optVoice.checked));
  optAi.addEventListener("change", () => NpcBrain.setConsent(optAi.checked));
  void (async () => {
    const [support, cached] = await Promise.all([NpcBrain.support(), NpcBrain.isCached()]);
    if (!support.ok) {
      optAi.disabled = true;
      optAi.checked = false;
      const reason = support.reason;
      i18n.bindText(optAiNote, () => i18n.t("title.aiUnsupported", { reason: reason ? i18n.t(reason) : "" }));
      return;
    }
    optAi.checked = NpcBrain.hasConsent();
    if (cached) i18n.bindText(optAiNote, () => i18n.t("title.aiCached"));
  })();

  startButton.addEventListener("click", () => {
    if (state !== "ready") return;
    audio.start();
    if (QUALITY.isMobile) {
      // Android: play full-screen in landscape (both need the user gesture of this click).
      void document.documentElement
        .requestFullscreen?.({ navigationUI: "hide" })
        .then(() =>
          (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(
            "landscape",
          ),
        )
        .catch(() => undefined);
    }
    if (optAi.checked && !optAi.disabled) void brain.enable();
    if (optVoice.checked) {
      $<HTMLInputElement>("#voice-toggle").checked = true;
      void voice.enable();
    }
    $("#loading").hidden = true;
    $("#hud").hidden = false;
    buildings.buildCollidersNear(new Vector3());
    vehicle.teleport(findOpenGround(0, 0), spawn.yaw);
    vehicle.setFrozen(false);
    frozen = false;
    chase.snap();
    needsStreetSpawn = true;
    streetSpawnSince = performance.now();
    needsTrip = true;
    state = "playing";
    // Each drive starts at a random time of day and weather (the buttons still change them).
    const roll = Math.random();
    // A reproduction URL (drive_started.reproUrl) names the time and the weather it started with.
    const asked = new URLSearchParams(location.search);
    const askedTime = TIME_MODES.find((m) => m === asked.get("time"));
    const askedWeather = (["real", "auto", "clear", "rain"] as const).find((m) => m === asked.get("weather"));
    const time: TimeMode =
      askedTime ?? (roll < 0.2 ? "morning" : roll < 0.6 ? "day" : roll < 0.8 ? "evening" : "night");
    setTime(time);
    // おまかせ: it starts fair or wet and turns now and then.
    setWeather(askedWeather ?? "auto");
    log("drive_started", {
      time,
      weather: env.weather,
      raining: env.isRaining(),
      startLat: spawn.lat,
      startLon: spawn.lon,
      assist: controls.assist,
      graphicsPreset: GRAPHICS.settings.preset,
      reproUrl: reproUrl({
        start: `${spawn.lat},${spawn.lon}`,
        time,
        weather: env.isRaining() ? "rain" : "clear",
      }),
    });
    const sky = i18n.t(env.isRaining() ? "weather.label.rain" : "weather.label.clear");
    toast(i18n.t("toast.dayStart", { time: i18n.t(TIME_KEY[time]), weather: sky }), "#4dd2ff");
    // The phone starts in its holder, on screens wide enough to keep the road in view beside it.
    const isWideScreen = window.innerWidth >= 900;
    if (isWideScreen) {
      phone.show(false);
      // Y is the app the phone has open: the feed is what people around the player are posting.
      showSocial(true);
    }
    log("game_started", {});
    // Once per browser, after the opening toasts: hang it small (knowledge/mirror-charms.md).
    if (prefsNow.charm !== "none" && firstCharmTip())
      setTimeout(() => toast(i18n.t(CHARM_TIP), "#ffe14d"), 7000);
    toast(i18n.t("toast.welcome", { key: keyOf("mission") }), "#4dd2ff");
  });

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    step(now);
  };
  let compiling: Promise<void> | null = null;
  /**
   * Build the pipelines before play. WebGPU compiles a material's shaders and pipeline when it is
   * first drawn, a stall of tens of milliseconds each time; compileAsync builds them off the frame
   * for what a camera would see. So: the town around the start from street level in four
   * directions, the vehicles and a person that appear later (put in view only while compileAsync
   * collects them), the driver's seat with its glass, and the street passes.
   */
  const precompile = async (): Promise<void> => {
    const started = performance.now();
    const ground = groundY(0, 0) ?? 0;
    const eye = new PerspectiveCamera(100, camera.aspect, camera.near, camera.far);
    eye.position.set(0, ground + 1.6, 0);
    const gallery = new Group();
    const kinds: VehicleKind[] = [
      "bus",
      "truck10t",
      "truck8t",
      "motorbike",
      "patrol",
      "unmarked",
      "shirobai",
    ];
    const vehicles = kinds.map((k) => createVehicle(k)).filter((v): v is VehicleInstance => v !== null);
    for (const v of vehicles) gallery.add(v.object);
    gallery.add(createLowCar({ color: 0xd0d4d8 }));
    const person = createHuman({
      shirt: 0x3a5f8a,
      pants: 0x2b2b2b,
      skin: 0xe0b896,
      hair: 0x1a1410,
      umbrella: 0x223344,
    });
    gallery.add(person.root);
    gallery.traverse((o) => (o.frustumCulled = false));
    gallery.position.set(0, ground, 0);
    gallery.visible = false;
    scene.add(gallery);
    const pending: Array<Promise<unknown>> = [];
    composer.begin();
    for (let k = 0; k < 4; k++) {
      eye.rotation.set(0, (k * Math.PI) / 2, 0);
      eye.updateMatrixWorld();
      gallery.visible = k === 0;
      renderer.setRenderTarget(composer.target);
      pending.push(renderer.compileAsync(scene, eye));
    }
    // compileAsync has collected what to build: the gallery leaves at once (the loading view
    // orbits over the start, and would show it).
    scene.remove(gallery);
    renderer.setRenderTarget(null);
    pending.push(cockpit.precompile(renderer, composer, scene, camera.aspect), composer.precompile());
    // What the first violation would build in its frame: the bystanders' phones, the shots' probe.
    if (!isPrewarmOff) pending.push(...prewarmWitnesses());
    try {
      await Promise.all(pending);
    } finally {
      disposeHuman(person);
      for (const v of vehicles) for (const m of [...v.lamps.values(), ...v.beacons.flat()]) m.dispose();
    }
    log("pipelines_compiled", { durationMs: Math.round(performance.now() - started) });
  };
  /** The world from the main camera (no cockpit), with the street passes, to the canvas. */
  const drawPlain = () => {
    blur.stop();
    placeFlare();
    composer.begin();
    composer.drawWorld(scene, camera);
    composer.street();
    composer.present();
  };

  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state !== "playing") {
      terrain.update(spawn.lat, spawn.lon);
      buildings.update(new Vector3(), now);
      env.update(dt, new Vector3(), camera.position, spawn.lat, spawn.lon);
      camera.position.applyAxisAngle(new Vector3(0, 1, 0), dt * 0.05);
      camera.lookAt(0, 30, 0);
      const groundReady = terrain.hasColliderAt(spawn.lat, spawn.lon);
      const tilesProgress = buildings.loadProgress();
      const waited = now - loadStart;
      const isLoading = state === "loading" && compiling === null;
      if (isLoading)
        setLoading(
          () =>
            groundReady
              ? i18n.t("loading.plateau", { percent: Math.round(tilesProgress * 100) })
              : i18n.t("loading.terrain"),
          0.25 + 0.7 * (groundReady ? 0.3 + 0.7 * tilesProgress : 0),
        );
      const isReady = groundReady && (tilesProgress >= 0.999 || waited > 20000) && waited > 1500;
      if (isReady && isLoading) {
        // The town is here: build its pipelines (and those of what comes later) before play.
        setLoading(() => i18n.t("loading.shaders"), 0.95);
        compiling = precompile()
          .catch((error: unknown) => warn("precompile_failed", { error: String(error) }))
          .finally(() => {
            state = "ready";
            startButton.disabled = false;
            setLoading(() => i18n.t("loading.ready"), 1);
          });
      }
      drawPlain();
      return;
    }

    if (replay) {
      playReplay(dt);
      // The sky of the replay's moment; a saved violation may be elsewhere in Tokyo, so the
      // ground, buildings, streets and signs stream in around it.
      const focus = focusPos();
      const geo = frame.toGeodetic(focus);
      if (replay?.isClip) {
        terrain.update(geo.lat, geo.lon);
        buildings.update(focus, now);
        if (haversineMeters(geo.lat, geo.lon, roadCenter.lat, roadCenter.lon) > 300)
          refreshRoads(geo.lat, geo.lon);
        signs.update(focus, now);
        guideSigns.update(focus, now);
      }
      env.update(dt, focus, camera.position, geo.lat, geo.lon);
      water.update(dt, env);
      water.renderReflection(renderer, scene, camera, now);
      drawPlain();
      return;
    }
    if (paused) {
      // Through the cockpit as in play: a plain render would leave the interior (its own layer) out.
      blur.stop();
      placeFlare();
      cockpit.render(composer, renderer, scene, camera, false);
      composer.present();
      return;
    }
    const isOnFoot = mode === "foot";
    const isInCar = mode === "car";
    // The player's mass in the driver's seat while at the wheel (no change: no work).
    vehicle.setOccupants(isInCar ? AT_THE_WHEEL : NOBODY);
    const isInTaxi = mode === "taxi" && taxi !== null;
    // Once the streets are known, move the waiting car onto one — but never once the player has
    // started driving: stopped at a light later, the car would jump forward.
    // The kerb comes from PLATEAU paving, so wait for it (wards without it: give up after 10 s).
    const hasKerbs = pavements.count > 0 || now - streetSpawnSince > 10000;
    // Until it is on its street the car is held (see vehicle.update below): driving off first used
    // to cancel the move and leave it where the place itself was. After 15 s with no street it is
    // let go where it stands.
    if (needsStreetSpawn && roadGraph && hasKerbs && isInCar) needsStreetSpawn = !placeOnStreet();
    const isStreetSearchOver = now - streetSpawnSince > 15000;
    if (needsStreetSpawn && isStreetSearchOver) needsStreetSpawn = false;
    if (needsTrip && !needsStreetSpawn && !missions.current) {
      needsTrip = false;
      const g = frame.toGeodetic(vehicle.position());
      if (!home) {
        home = { lat: g.lat, lon: g.lon };
        saveHome(home);
      }
      const trip = missions.startTrip(g.lat, g.lon, now);
      if (trip) {
        const km = (trip.startDistance / 1000).toFixed(1);
        toast(i18n.t("toast.firstTrip", { name: trip.target.name, km }), "#ffe14d");
        if (controls.assist === "real")
          toast(i18n.t("toast.beltBeforeStart", { key: keyOf("belt") }), "#4dd2ff");
        log("trip_started", { target: trip.target.name, distanceM: Math.round(trip.startDistance) });
      }
    }
    const manual = isInCar ? input.read(dt) : { throttle: 0, brake: 0, steer: 0, handbrake: false };
    playerThrottle = manual.throttle;
    // Any steering, accelerator or brake input takes the car back, as with a real driver-assist system.
    const isOverride = Math.abs(manual.throttle) > 0.2 || manual.brake > 0.2 || Math.abs(manual.steer) > 0.3;
    if (autopilot && isOverride) stopAutopilot(i18n.t("toast.autopilotOverride"));
    // With the engine off the accelerator does nothing (E starts it again).
    const pedals = autopilot ? autopilot.input : manual;
    if (isInCar) controls.autoOperate(autoContext(manual.throttle), dt);
    const isHeld = controls.autoHold && !autopilot;
    const powered = controls.engineOn || autopilot ? pedals : { ...pedals, throttle: 0 };
    // At the roadside stop and through the story the car stays where it stopped.
    const drive = pursuitDirector.holdCar
      ? { ...powered, throttle: 0, brake: 0, handbrake: true }
      : isHeld
        ? { ...powered, handbrake: true }
        : powered;
    if (isInCar) controls.update(vehicle.yaw(), manual.steer);
    // Look aside / behind while held (左右 Ctrl, Z), as in City Car Driving.
    const lookKeys = LOOK_KEYS[input.layout];
    chase.look =
      lookKeys.left && input.held(lookKeys.left)
        ? Math.PI / 2
        : lookKeys.right && input.held(lookKeys.right)
          ? -Math.PI / 2
          : input.held(lookKeys.back) || input.padLookBack()
            ? Math.PI
            : input.look(dt, vehicle.speedKmh() > 5);
    input.onFoot = isOnFoot;
    const walk = input.readWalk();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= world.timestep && steps < 4) {
      // Held while it is being put on its street after a start or a 移動.
      const isHeldForStreet = needsStreetSpawn;
      if (!frozen && isInCar && !isHeldForStreet) vehicle.update(world.timestep, drive);
      taxi?.step(world.timestep);
      for (const unit of patrols) unit.step(world.timestep);
      if (isOnFoot && !frozen) walker.update(world.timestep, walk, env.isRaining());
      world.step(events);
      massContacts.afterStep(world.timestep);
      accumulator -= world.timestep;
      steps++;
    }
    vehicle.syncVisuals();
    // The charms feel the chassis' motion over the steps just taken (none: they stay as they are).
    mirrorCharms.update(vehicle.body, steps * world.timestep, cockpit.active);
    // People hit by the player's car, from the blows the mass contacts resolved (not from the
    // contact events below: a person bowled over drops their collider, and the event then named
    // nobody, so no accident was booked at speed).
    for (const blow of massContacts.takeBlows()) {
      const isPlayersCar = blow.car === vehicle.chassis;
      const ped = blow.body.owner as Pedestrian | null;
      const isPerson = blow.body.kind === "person" && ped !== null;
      if (!isPlayersCar || !isPerson) continue;
      const isCoolingDown = (pedestrianCooldown.get(ped) ?? 0) > performance.now();
      if (isCoolingDown) continue;
      const kmh = Math.abs(vehicle.speedKmh());
      const carKmh = Math.max(kmh, (blow.impact.closing + blow.impact.dvCar) * 3.6);
      const victimKmh = blow.impact.dvOther * 3.6;
      // Someone walking into a car that stands is their own bump.
      const isAccident = carKmh > 3 && victimKmh > 3;
      if (!isAccident) continue;
      pedestrianCooldown.set(ped, performance.now() + 3000);
      input.pad.contact("impact", blow.impact.dvCar + 1);
      pedestrians.knockDown(ped);
      emergency.start(ped, performance.now());
      onAccident("pedestrian", carKmh, ped.profile.name, blow.impact);
    }
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === vehicle.chassis.handle ? h2 : h2 === vehicle.chassis.handle ? h1 : null;
      if (other === null) return;
      const isCoolingDown = (contactCooldown.get(other) ?? 0) > performance.now();
      if (isCoolingDown) return;
      contactCooldown.set(other, performance.now() + 3000);
      const kmh = Math.abs(vehicle.speedKmh());
      // A police unit: was it hit on purpose? (pursuitLaw.ts decides, conservatively.)
      const unit = patrols.find((u) => u.car.chassis.handle === other);
      if (unit) {
        const fwd = headingVector(vehicle.quaternion());
        const to = unit.position.clone().sub(vehicle.position()).setY(0).normalize();
        const unitFwd = new Vector3(Math.sin(unit.car.yaw()), 0, Math.cos(unit.car.yaw()));
        pursuitDirector.onUnitHit(unit, {
          playerKmh: kmh,
          unitKmh: unit.car.forwardSpeed() * 3.6 * unitFwd.dot(fwd),
          angleDeg: (Math.acos(Math.min(1, Math.max(-1, to.dot(fwd)))) * 180) / Math.PI,
          throttle: drive.throttle,
        });
      }
      // The blow by both masses (massContacts.ts); a wall or a post has none, so the car's own speed.
      const impact = massContacts.recentImpact(other) ?? impactAgainstMass(other, kmh);
      // People are judged from the blows above.
      const ped = pedestrians.byCollider(other);
      if (ped) return;
      const what = hitKind(other);
      // The pad feels it: a kerb's bump by speed, anything else by the car's own Δv.
      input.pad.contact(
        what === "ground" ? "bump" : "impact",
        what === "ground" ? kmh / 3.6 : (impact?.dvCar ?? kmh / 3.6),
      );
      // Kerbs and the ground are bumps, not accidents.
      const isAccident = what !== "ground" && kmh > 5;
      if (isAccident) onAccident(what, kmh, "", impact);
    });

    // The camera's view for open-world spawning (traffic and people appear and leave out of it).
    viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewMatrix, camera.coordinateSystem, camera.reversedDepth);
    const carPos = vehicle.position();
    const carRot = vehicle.quaternion();
    // Today's distance at the wheel (re-anchoring and respawns jump; ignore those).
    if (isInCar && odometerAt) {
      const step = Math.hypot(carPos.x - odometerAt.x, carPos.z - odometerAt.z);
      if (step < 10) todayMetres += step;
    }
    odometerAt = isInCar ? carPos.clone() : null;
    const focus = focusPos();
    const geo = frame.toGeodetic(focus);
    const speed = isOnFoot ? walker.speed * 3.6 : isInTaxi && taxi ? taxi.speed * 3.6 : vehicle.speedKmh();

    // Never simulate the car over ground whose collider has not been built yet.
    const hasGround = terrain.hasColliderAt(geo.lat, geo.lon) && !warping;
    if (hasGround === frozen) {
      frozen = !hasGround;
      vehicle.setFrozen(frozen);
    }
    const gy = groundY(carPos.x, carPos.z);
    if (gy !== null && carPos.y < gy - 6) respawnHere();
    // In the water, off the streets and bridges (a channel too narrow to lose its ground collider
    // holds the car up over the drawn water): back on the bank after a moment.
    const isAdrift =
      isInCar && !frozen && water.isAdrift(carPos) && !roadGraph?.carriagewaysAt(carPos, 1).length;
    adriftSince = isAdrift ? (adriftSince ?? now) : null;
    if (adriftSince !== null && now - adriftSince > 1500) {
      adriftSince = null;
      respawnHere();
      toast(i18n.t("toast.fellInRiver"), "#4dd2ff");
    }
    const footGround = isOnFoot ? groundY(focus.x, focus.z) : null;
    // Fallen in the water (the riverbed is not ground): back up on the nearest bank.
    const isFallen = footGround !== null && focus.y < footGround - 4;
    if (isFallen)
      walker.enter(
        water.isWaterLocal(focus.x, focus.z)
          ? findOpenGround(focus.x, focus.z)
          : focus.setY(footGround + 0.5),
        0,
      );
    const needsRecenter = Math.hypot(focus.x, focus.z) > (warping ? 1 : RECENTER_DISTANCE);
    if (needsRecenter) recenter();

    terrain.update(geo.lat, geo.lon);
    buildings.update(focus, now);
    finishWarp(now);
    transit.update(now, geo.lat, geo.lon, focus);
    lastGeo = { lat: geo.lat, lon: geo.lon };
    pedestrians.raining = env.isRaining();
    const carForward = new Vector3(0, 0, 1).applyQuaternion(carRot);
    carForward.y = 0;
    carForward.normalize();
    pedestrians.update(dt, focus, carPos, isInCar ? speed / 3.6 : 0, carForward);
    witnessPhones.update(dt, env.nightFactor);
    if (haversineMeters(geo.lat, geo.lon, roadCenter.lat, roadCenter.lon) > 300)
      refreshRoads(geo.lat, geo.lon);
    control.update(now / 1000);
    signs.update(focus, now);
    guideSigns.update(focus, now);
    orbis.update(now);
    // カーナビ to the mission target, along legal streets.
    const navTarget = missions.current ? field.localPosition(missions.current.target) : null;
    nav.update({
      now,
      graph: roadGraph,
      turnRules: roadApplied?.turnRules ?? [],
      car: isOnFoot ? focus : carPos,
      forward: isOnFoot ? walker.forward() : carForward,
      target: navTarget,
      clock: gameClockNow(),
      mode: isInCar ? "car" : isOnFoot ? "walk" : null,
      junctionNames: roadApplied?.junctionNames,
      laneUse: roadApplied?.laneUse,
      roads: guideSigns.roadInfo,
      approaches: control.approaches,
      orbis: orbis.sites,
      place: { ward: wardName, town: townName },
      speedKmh: speed,
      visible: !navHidden,
    });
    ribbon.update(isInCar && !navHidden ? nav.route : null, nav.lastAt, now);
    if (nav.route && navGeo.version !== nav.version) {
      navGeo = {
        version: nav.version,
        points: nav.route.points
          .filter((_, i, a) => i % 3 === 0 || i === a.length - 1)
          .map((p) => frame.toGeodetic(p)),
      };
    }
    if (roadGraph && now - lastClockSync > 5000) {
      lastClockSync = now;
      roadGraph.setClock(gameClockNow());
    }
    traffic.extraObstacles = taxi ? [taxi.position] : [];
    traffic.update(dt, focus, carPos, carForward, isInCar ? speed / 3.6 : 0);
    updateTaxi(dt, now);
    updatePolice(dt, now);
    // The pursuit and what follows it (pursuitDirector.ts): only in play, so the pause holds it.
    pursuitDirector.update(dt, now);
    updateAutopilot(dt);
    speedometer.update(speed, currentLimit, currentLimitKind);

    // 道路交通法 checks while driving: speed vs (estimated) limit, keep-left on two-way roads.
    const isDriving = isInCar && !frozen && !law.state.suspended;
    if (isDriving && roadGraph && now - lastLawCheck > 200) {
      lastLawCheck = now;
      // The car drives at ground level: elevated 首都高 overhead is not the road it is on.
      const hit = roadGraph.nearest(carPos, 30, isSurfaceStreet);
      const onRoad = hit && Math.abs(hit.lateral) < hit.seg.line.width / 2 + 1.5 ? hit : null;
      currentLimit = onRoad ? speedLimit(onRoad.seg) : null;
      currentLimitKind = onRoad ? onRoad.seg.limitKind : null;
      currentOneway = onRoad !== null && onRoad.seg.oneway !== 0;
      const isOver = currentLimit !== null && speed > currentLimit + 1;
      overSince = isOver ? (overSince ?? now) : null;
      if (overSince !== null && currentLimit !== null && now - overSince > 3000) {
        const v = speedViolation(speed - currentLimit);
        // Recorded in Japanese (stored, read by Y and the AI); violationDetail() shows it translated.
        const key =
          currentLimitKind === "sign" ? "violationDetail.speedSign" : "violationDetail.speedStatutory";
        const over = Math.round(speed - currentLimit);
        const detail = inJapanese(key, { limit: currentLimit, kmh: Math.round(speed), over });
        if (v) book(v, now, 20000, detail);
      }
      const isTwoWay = onRoad !== null && onRoad.seg.oneway === 0 && onRoad.seg.line.width >= 5.5;
      const align = onRoad ? carForward.dot(onRoad.dir) : 0;
      // Positive lateral = left of the travel direction; well right of the centre line is 右側通行.
      const isRightSide =
        isTwoWay && speed > 10 && Math.abs(align) > 0.8 && onRoad.lateral * Math.sign(align) < -0.8;
      rightSince = isRightSide ? (rightSince ?? now) : null;
      if (rightSince !== null && now - rightSince > 2000) book(VIOLATIONS.keepLeft, now, 15000);

      // 一方通行 (JARTIC): driving against the permitted direction is 通行禁止違反.
      const isWrongWay =
        onRoad !== null && onRoad.seg.oneway !== 0 && speed > 5 && align * onRoad.seg.oneway < -0.7;
      wrongWaySince = isWrongWay ? (wrongWaySince ?? now) : null;
      if (wrongWaySince !== null && now - wrongWaySince > 1500) book(VIOLATIONS.noEntry, now, 20000);

      // 無免許運転: driving at all while the licence is suspended.
      if (law.state.suspended && speed > 5)
        book(
          VIOLATIONS.unlicensed,
          now,
          10 * 60_000,
          inJapanese("violationDetail.unlicensed", { days: suspendedDays }),
        );

      // 通行禁止 (車両通行止め, 歩行者用道路) in force: entering the street at all is the offence.
      closedSince = onRoad?.seg.closed && speed > 5 ? (closedSince ?? now) : null;
      if (closedSince !== null && now - closedSince > 1500 && onRoad) {
        const active = onRoad.seg.closures.find((c) => isInForceTime(c.time, clock));
        const what = active ? CLOSURE_WORDS[active.kind] : null;
        const note = active ? timeNote(active.time) : null;
        const detail =
          what === null
            ? inJapanese("violationDetail.closedRoadAny")
            : note
              ? inJapanese("violationDetail.closedRoadTimed", { what, note })
              : inJapanese("violationDetail.closedRoad", { what });
        book(VIOLATIONS.closedRoad, now, 20000, detail);
      }

      // JARTIC section rules in force now (時間帯指定を含む).
      const clock = gameClockNow();
      const inForce = (code: number) =>
        onRoad !== null && onRoad.seg.rules.some((r) => r.code === code && isInForce(r, clock));
      // 徐行: a speed at which the car can stop at once (about 10 km/h).
      slowSince = inForce(61) && speed > 10 ? (slowSince ?? now) : null;
      if (slowSince !== null && now - slowSince > 1500) book(VIOLATIONS.slow, now, 20000);
      // A U-turn is a flip of heading without leaving the street: going round the block and back
      // along it the other way is not one, so the record resets on any other street.
      if (lastHeading && onRoad && onRoad.seg !== lastHeading.seg) lastHeading = null;
      if (onRoad && Math.abs(align) > 0.7 && speed > 4) {
        // 転回禁止: the heading along the same street flips.
        const sgn = Math.sign(align);
        const isUturn =
          lastHeading !== null &&
          lastHeading.seg === onRoad.seg &&
          lastHeading.sgn !== sgn &&
          now - lastHeading.at < 20000;
        if (isUturn && inForce(51)) book(VIOLATIONS.uturn, now, 20000);
        lastHeading = { seg: onRoad.seg, sgn, at: now };
        // 指定方向外進行禁止: judged when the car leaves the approach for the next street.
        const dir: 1 | -1 = align > 0 ? 1 : -1;
        const prev = lastStreet;
        if (prev && prev.seg !== onRoad.seg) {
          const node = prev.dir === 1 ? prev.seg.to : prev.seg.from;
          const isNext = onRoad.seg.from === node || onRoad.seg.to === node;
          const rule = isNext
            ? roadApplied?.turnRules.find(
                (r) =>
                  r.node === node && r.approach === prev.seg && r.dir === prev.dir && isInForce(r, clock),
              )
            : undefined;
          if (rule) {
            const leaving = onRoad.seg.from === node ? 1 : -1;
            const tIn = roadGraph
              .sample(prev.seg, prev.dir === 1 ? prev.seg.length - 1 : 1)
              .dir.multiplyScalar(prev.dir);
            const tOut = roadGraph
              .sample(onRoad.seg, leaving === 1 ? 1 : onRoad.seg.length - 1)
              .dir.multiplyScalar(leaving);
            const side = leftOf(tIn, 1).dot(tOut);
            const turn = side > 0.57 ? 1 : side < -0.57 ? 4 : 2; // left / straight / right
            if (!(rule.mask & turn)) book(VIOLATIONS.turnBan, now, 15000);
          }
        }
        lastStreet = { seg: onRoad.seg, dir };
        // 指定通行区分 (第35条第1項): the lane held over the last 40 m of a designated approach…
        const use = roadApplied?.laneUse.find((u) => u.seg === onRoad.seg && u.dir === dir);
        const toNode = dir === 1 ? onRoad.seg.length - onRoad.s : onRoad.s;
        if (use && toNode < 40 && roadGraph) {
          const lane = laneIndex(roadGraph, use.seg, use.dir, use.lanes.length, carPos);
          const node = roadGraph.sample(use.seg, dir === 1 ? use.seg.length : 0).pos;
          laneAtJunction = { use, lane, tIn: onRoad.dir.clone().multiplyScalar(dir), node };
        }
      }
      // 合図 (第53条): a turn at a junction, judged 25 m past it, needs the indicator for that
      // side to have been on in the last seconds (it cancels itself as the wheel comes back).
      if (onRoad && Math.abs(align) > 0.7 && roadGraph) {
        const dir = align > 0 ? 1 : -1;
        const node = dir === 1 ? onRoad.seg.to : onRoad.seg.from;
        const toNode = dir === 1 ? onRoad.seg.length - onRoad.s : onRoad.s;
        const isJunction = (roadGraph.nodes.get(node)?.length ?? 0) >= 3;
        if (isJunction && toNode < 20 && !turnAt)
          turnAt = {
            tIn: onRoad.dir.clone().multiplyScalar(dir),
            node: roadGraph.sample(onRoad.seg, dir === 1 ? onRoad.seg.length : 0).pos,
          };
      }
      if (turnAt && Math.hypot(carPos.x - turnAt.node.x, carPos.z - turnAt.node.z) > 25) {
        const turn = classifyTurn(turnAt.tIn, carForward.clone().setY(0).normalize());
        turnAt = null;
        const side =
          turn === "left" || turn === "slightLeft"
            ? "left"
            : turn === "right" || turn === "uturn"
              ? "right"
              : null;
        if (side && now - indicatorSeen[side] > 6000)
          book(
            VIOLATIONS.signalOmission,
            now,
            15000,
            inJapanese(
              side === "left" ? "violationDetail.turnLeftNoSignal" : "violationDetail.turnRightNoSignal",
            ),
          );
      }
      // 合図 for changing lanes on a multi-lane road.
      if (onRoad && onRoad.seg.lanes >= 2 && Math.abs(align) > 0.85 && speed > 15) {
        const s = onRoad.seg;
        const span = s.oneway === 0 ? s.line.width / 2 : s.line.width;
        const lane = Math.floor((s.line.width / 2 - onRoad.lateral * Math.sign(align)) / (span / s.lanes));
        const isSameRoad = laneHeld !== null && laneHeld.seg === s;
        if (isSameRoad && laneHeld && lane !== laneHeld.lane && lane >= 0 && lane < s.lanes) {
          const side = lane < laneHeld.lane ? "left" : "right";
          if (now - indicatorSeen[side] > 6000)
            book(VIOLATIONS.signalOmission, now, 15000, inJapanese("violationDetail.laneChangeNoSignal"));
        }
        laneHeld = { seg: s, lane };
      } else laneHeld = null;
      // オービス (速度違反自動取締装置): crossing a device's line in the direction and lanes it
      // covers, 30 km/h or more over the limit (40 on an expressway: the 赤切符 range they are set
      // for), fires the camera and its strobe; the notice comes by post after the day ends.
      // 可搬式 units take 15 km/h or more: below 30 it is a 反則行為, settled with a 青切符 when the
      // driver answers the notice (第126条), as speedViolation's 反則金 says.
      for (const hit of orbis.check(lawPrevPos, carPos, speed, now)) {
        const photo = speedViolation(hit.excess) ?? VIOLATIONS.signal;
        const isPortable = hit.site.kind === "portable";
        const context = violationContext(
          inJapanese(isPortable ? "violationDetail.orbisPortable" : "violationDetail.orbis", {
            kmh: Math.round(speed),
            limit: hit.limit,
          }),
        );
        const committed = law.commit(photo, now, 0, context);
        if (committed) pendingShots.push(committed);
        // The speed check keeps one speeding record per 20 s, so commit is refused while that one is
        // open: the photo catches it instead, at the speed the camera measured.
        const open = law.state.log.findLast(
          (r) => r.kind === photo.kind && r.status === "uncaught" && now - r.at < 30000,
        );
        const record = committed ?? (open ? Object.assign(open, photo, { context }) : null);
        if (record) law.notice(record, isPortable ? "orbisPortable" : "orbis");
        // The photo is a violation on record (book() stamps the others): its seal too.
        if (committed)
          stamps.stamp("違反", shortLabel(committed.label), false, stampReading(committed.label));
        flashScreen();
        social.note("orbis", env.now().getTime());
        log(
          "orbis_fired",
          {
            siteId: hit.site.entry.id,
            kind: hit.site.kind,
            lane: hit.lane,
            speedKmh: Math.round(speed),
            limitKmh: hit.limit,
            violationId: record?.id ?? null,
          },
          record ? violationSpan(record) : undefined,
        );
      }

      // 無灯火 (第52条): at night with the headlights switched off.
      if (env.nightFactor > 0.5 && speed > 5 && !autopilot && !controls.headlightsOn(true))
        book(VIOLATIONS.noLights, now, 5 * 60_000, inJapanese("violationDetail.noLights"));
      // 座席ベルト (第71条の3).
      if (speed > 10 && !controls.belt)
        book(VIOLATIONS.seatBelt, now, 10 * 60_000, inJapanese("violationDetail.seatBelt"));
      // 警音器 (第54条第2項): only to prevent danger; nobody close ahead means it was not needed.
      if (hornFor > 0.4) {
        const fwd = carForward;
        const isDanger =
          pedestrians.list.some((q) => {
            const d = q.object.position.clone().sub(carPos);
            return d.length() < 20 && d.dot(fwd) > 0;
          }) || traffic.positions().some((q) => q.distanceTo(carPos) < 12);
        if (!isDanger) book(VIOLATIONS.hornMisuse, now, 30000, inJapanese("violationDetail.horn"));
      }

      // …against the way the car leaves, judged 25 m past the junction (clear of its box).
      if (laneAtJunction && onRoad && laneAtJunction.use.seg !== onRoad.seg) {
        const j = laneAtJunction;
        if (Math.hypot(carPos.x - j.node.x, carPos.z - j.node.z) > 25) {
          laneAtJunction = null;
          const tOut = carForward.clone().setY(0).normalize();
          const turn = classifyTurn(j.tIn, tOut);
          if (!laneAllows(j.use.lanes[j.lane], turn)) {
            log("lane_turn_disallowed", {
              lanes: j.use.lanes.map((l) => l.join("+")),
              lane: j.lane,
              turn,
              source: j.use.source,
            });
            // In Japanese, as recorded: 「直進・左折の車線（左から 1 番目）から右方向」.
            const words = (d: string) => {
              const key = LANE_RECORD[d];
              return key ? inJapanese(key) : d;
            };
            const allowed = j.use.lanes[j.lane].map(words).join("・");
            const detail = inJapanese("violationDetail.laneDirection", {
              allowed,
              n: j.lane + 1,
              turn: inJapanese(TURN_RECORD[turn]),
            });
            book(VIOLATIONS.laneDirection, now, 15000, detail);
          }
        }
      }
      // 通行帯違反 (第20条第1項): the rightmost lane of a multi-lane road is for overtaking and
      // getting ready to turn right, not for driving along.
      if (onRoad && onRoad.seg.lanes >= 2 && onRoad.seg.oneway === 0 && speed > 10 && Math.abs(align) > 0.8) {
        const s = onRoad.seg;
        const leftOfTravel = onRoad.lateral * Math.sign(align);
        const laneWidth = s.line.width / 2 / s.lanes;
        const lane = Math.floor((s.line.width / 2 - leftOfTravel) / laneWidth);
        const turnAhead = nav.route?.maneuvers.find((m) => m.at > nav.lastAt);
        const isPreparingRight =
          turnAhead !== undefined && turnAhead.at - nav.lastAt < 150 && /right|uturn/i.test(turnAhead.turn);
        // 第20条第3項: staying in the lane a yellow lane line keeps it in (第26条の2第3項) is no 通行帯違反.
        const isRightLane = lane === s.lanes - 1 && !isPreparingRight && !isLaneChangeBanned(s);
        rightLaneSince = isRightLane ? (rightLaneSince ?? now) : null;
        if (rightLaneSince !== null && now - rightLaneSince > 20000) book(VIOLATIONS.laneUse, now, 60000);
      } else rightLaneSince = null;

      // 進路変更禁止: crossing a yellow lane line (lanes counted from the left kerb).
      const seg = onRoad?.seg;
      if (onRoad && seg && isLaneChangeBanned(seg) && speed > 5 && Math.abs(align) > 0.8) {
        // The same lanes and the same "where" as the route's lane plan (src/world/laneChange.ts).
        const lane = laneOfOffset(seg, onRoad.lateral * Math.sign(align));
        // From lane to lane only: coming in over the edge or the centre line (a turn's curve, a
        // street that widens) crosses no yellow lane line.
        const isLaneChange =
          laneTrack !== null &&
          laneTrack.seg === seg &&
          laneTrack.lane !== lane &&
          laneTrack.lane >= 0 &&
          laneTrack.lane < seg.lanes &&
          lane >= 0 &&
          lane < seg.lanes;
        if (isLaneChange) book(VIOLATIONS.laneChange, now, 15000);
        laneTrack = { seg, lane };
      } else laneTrack = null;

      // Signals and 一時停止: judged when the car crosses a stop line heading into the junction.
      if (Math.abs(speed) < 3) lastStop = { pos: carPos.clone(), at: now };
      if (lawPrevPos && lawPrevPos.distanceTo(carPos) < 30) {
        for (const ap of control.crossed(lawPrevPos, carPos)) {
          if (ap.kind === "signal" && control.state(ap) === "red") book(VIOLATIONS.signal, now, 10000);
          const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
          const hasStopped =
            lastStop !== null && now - lastStop.at < 15000 && lastStop.pos.distanceTo(mid) < 12;
          if (ap.kind === "stop" && !hasStopped) book(VIOLATIONS.stopSign, now, 10000);
          if (ap.kind === "stop" && hasStopped) praise("fullStop");
        }
      }
      // Waiting while someone walks across in front: they may thank the driver (once each).
      if (Math.abs(speed) < 2) {
        const crossing = pedestrians.crossingAhead(carPos, carForward, 14).filter((q) => !letAcross.has(q));
        for (const q of crossing) letAcross.add(q);
        if (crossing.length > 0) praise("yieldPedestrian");
      }
      lawPrevPos = carPos.clone();
    } else if (!isDriving) {
      currentLimit = null;
      currentLimitKind = null;
      currentOneway = false;
      lawPrevPos = null;
    }

    // 放置駐車 and the 駐車監視員 patrol. 警視庁: regardless of how long it has stood, a car left on
    // a street where parking is prohibited, with the driver away and unable to drive it at once,
    // gets a 放置車両確認標章 — the patrol only has to come by.
    const carHit = roadGraph ? roadGraph.nearest(carPos, 15, isSurfaceStreet) : null;
    const isOnCarriageway = carHit !== null && Math.abs(carHit.lateral) < carHit.seg.line.width / 2;
    const place = isOnCarriageway && carHit ? parkingPlace(carHit) : null;
    // Riding a taxi away from the car leaves it just as abandoned as walking off.
    const isAbandoned =
      !isInCar && place !== null && focus.distanceTo(carPos) > 5 && !emergency.active && !ticket.visible;
    let kerb: Vector3 | null = null;
    let along: Vector3 | null = null;
    if (carHit && roadGraph) {
      const { pos, dir } = roadGraph.sample(carHit.seg, carHit.s);
      along = dir.clone();
      kerb = pos.clone().add(leftOf(dir, Math.sign(carHit.lateral || 1) * (carHit.seg.line.width / 2 + 0.8)));
    }
    const patrolEvent = patrol.update(dt, now, carPos, kerb, along, isAbandoned);
    if (patrolEvent === "ticketed" && place) {
      ticket.visible = true;
      pendingParking = place === "noStopping" ? VIOLATIONS.parkingNoStop : VIOLATIONS.parking;
      const isNoStopping = place === "noStopping";
      stamps.stamp(
        "確認標章",
        isNoStopping ? "駐停車禁止場所" : "駐車禁止場所",
        false,
        inPlayersWords(isNoStopping ? "stamp.reading.noStopping" : "stamp.reading.noParking"),
      );
      toast(i18n.t("toast.parkingTicketed"), "#ffd400");
    } else if (patrolEvent === "aborted") {
      toast(i18n.t("toast.parkingAborted"), "#7dff9a");
    }

    // Working the phone while the car moves (in its holder it is fine); emergency calls to rescue
    // the injured are exempt.
    if (isInCar && phone.isInUse(now) && Math.abs(speed) > 5 && !emergency.active) {
      book(VIOLATIONS.phone, now, 30000);
    }
    // Tokyo's environmental ordinance: switch the engine off when stopped for a while.
    const isStoppedInCar = isInCar && Math.abs(speed) < 1 && drive.throttle === 0;
    stoppedSince = isStoppedInCar ? (stoppedSince ?? now) : null;
    const isEngineOff = !isInCar || (stoppedSince !== null && now - stoppedSince > 20000);
    if (isEngineOff && isInCar) announceIdlingStop();
    if (!isEngineOff) idlingAnnounced = false;

    const incidentEvent = emergency.update(dt, now, focus, Math.abs(speed) / 3.6, (p) =>
      pedestrians.rescue(p),
    );
    if (incidentEvent?.type === "hitAndRun") {
      toast(i18n.t("toast.hitAndRun"), "#ff6b6b");
    } else if (incidentEvent?.type === "arrested") {
      const hit = law.book(VIOLATIONS.hitAndRun, now, 0);
      // The arrest told as the story panels (pursuitDirector.ts), then the arrest screen.
      pursuitDirector.hitAndRunArrest(incidentEvent.later, hit);
    } else if (incidentEvent?.type === "arrived") {
      toast(
        i18n.t(incidentEvent.kind === "ambulance" ? "toast.ambulanceArrived" : "toast.policeArrived"),
        "#4dd2ff",
      );
    } else if (incidentEvent?.type === "rescued") {
      toast(i18n.t("toast.rescued"), "#4dd2ff");
    } else if (incidentEvent?.type === "notReported") {
      notify("violation", () => i18n.t("notify.notReported"));
    } else if (incidentEvent?.type === "closed") {
      toast(i18n.t("toast.incidentClosed"), "#7dff9a");
    }

    updateIncidentPanel(now);
    const partner = conversation.active;
    if (partner && partner.object.position.distanceTo(focus) > 18) conversation.close();
    const talkRange = isOnFoot ? 3.5 : 10;
    const talkable =
      !partner && !isInTaxi && Math.abs(speed) < (isOnFoot ? 99 : 4)
        ? pedestrians.nearest(focus, talkRange)
        : null;
    const nearCar = isOnFoot && walker.position().distanceTo(carPos) < 4.5;
    const nearTaxi = isOnFoot && taxi?.state === "waiting" && walker.position().distanceTo(taxi.position) < 5;
    const hint = $("#talk-hint");
    const hints = [
      talkable
        ? i18n.t("hud.hintTalk", { key: isOnFoot ? keyOf("talk") : "Enter", name: talkable.profile.name })
        : "",
      nearCar ? i18n.t("hud.hintGetIn", { key: doorKey() }) : "",
      nearTaxi ? i18n.t("hud.hintTaxi", { key: doorKey() }) : "",
      isInTaxi && taxi && taxi.speed < 0.5 ? i18n.t("hud.hintTaxiOut", { key: doorKey() }) : "",
    ].filter(Boolean);
    hint.hidden = hints.length === 0 || partner !== null;
    hint.textContent = hints.join("　");

    if (now - lastPoiRefresh > 300) {
      lastPoiRefresh = now;
      field.refresh(geo.lat, geo.lon);
    }
    for (const p of field.collect(focus)) {
      const cat = field.category(p.category);
      score += cat?.points ?? 10;
      audio.chime();
      const category = categoryLabel(p.category, cat?.label ?? p.category);
      toast(i18n.t("toast.found", { name: p.name, category, points: cat?.points ?? 10 }), cat?.color);
      log("poi_collected", { poiId: p.id, category: p.category, ward: p.ward });
    }
    field.update(dt, env.nightFactor);

    // A chosen place is reached at the end of the navi's route (the street nearest to it).
    const isRouteDone = nav.route !== null && nav.route.reachesTarget && nav.route.length - nav.lastAt < 25;
    const result = missions.check(geo.lat, geo.lon, now, isRouteDone);
    if (result === "timeout") toast(i18n.t("toast.missionTimeout", { key: keyOf("mission") }), "#ff6b6b");
    // Home while the police are dealing with the car: the day ends once they are done.
    else if (result && result.target.category === "home") dayEndDue = true;
    else if (result && result.target.category === "appointment") appear();
    else if (result && result.target.category === "destination") {
      audio.chime(true);
      toast(i18n.t("toast.destArrived", { name: result.target.name }), "#7dff9a");
    } else if (result) {
      score += result.reward;
      audio.chime(true);
      toast(i18n.t("toast.missionDone", { name: result.target.name, points: result.reward }), "#7dff9a");
    }
    if (dayEndDue && !enforcing()) endDay();
    const target = missions.current?.target ?? null;
    // In the car the green route arrows show the way; the direction cone would only compete.
    const isGuided = isInCar && nav.route !== null;
    missions.updateArrow(
      isOnFoot ? walker.model.root : isInTaxi && taxi ? taxi.model.root : vehicle.object,
      target && !isGuided ? field.localPosition(target) : null,
    );

    // The roadside stop's shots (the patrol car behind, the officer walking up, the window).
    const isFilmed =
      pursuitDirector.filming &&
      pursuitScene.placeCamera(camera, {
        car: carPos,
        carQuat: carRot,
        patrol: pursuitDirector.stop?.unit.position ?? null,
        officer: pursuitScene.officer.position,
      });
    if (debugCamera) debugCamera(camera, focus);
    else if (isFilmed) camera.updateMatrixWorld();
    else if (isOnFoot) walker.updateCamera(camera, dt);
    else if (isInTaxi && taxi) chase.update(dt, taxi.position, taxi.model.root.quaternion, taxi.speed);
    else if (isInCar && chase.mode === "cockpit" && cockpit.root) {
      // Looking aside or back with the keys (a turn of ±90° / 180°) is level; the mouse and the
      // right stick also tilt the view a little.
      const isFreeLook =
        Math.abs(Math.abs(chase.look) - Math.PI / 2) > 1e-6 && Math.abs(chase.look) !== Math.PI;
      cockpit.placeCamera(camera, chase.look, isFreeLook ? input.pitch : 0);
    } else chase.update(dt, carPos, carRot, speed / 3.6);
    cockpit.setActive(isInCar && chase.mode === "cockpit" && !isFilmed);
    // The listener rides the camera; from inside the car the world is heard through the cabin.
    audio.spatial.update({
      dt,
      camera,
      inCar: isInCar,
      cockpit: cockpit.active,
      windowOpen: isInCar && conversation.active !== null,
      rainMmH: env.rainMmH(),
    });
    env.update(dt, focus, camera.position, geo.lat, geo.lon);
    water.update(dt, env);
    streetLights.update(dt, camera, env, now);
    if (Math.abs(env.nightFactor - appliedNight) > 0.02) {
      appliedNight = env.nightFactor;
      buildings.setNightFactor(appliedNight);
    }
    buildings.setFacadeClock(env.now(), env.wetness);
    const isDark = env.nightFactor > 0.25 || env.isRaining();
    const lamps = controls.lamps();
    vehicle.updateLights(controls.headlightsOn(isDark), { ...lamps, highBeam: controls.highBeam });
    // The indicator relay clicks, and the law checks remember when each side last blinked.
    const blink = Math.floor(performance.now() / 380) % 2 === 0;
    const signalLeft = autopilot ? autopilot.driver.signal === "left" : lamps.left;
    const signalRight = autopilot ? autopilot.driver.signal === "right" : lamps.right;
    if (isInCar) audio.tick((signalLeft || signalRight) && blink);
    if (signalLeft) indicatorSeen.left = now;
    if (signalRight) indicatorSeen.right = now;
    // 警音器 while H (or its pad button) is held.
    const isHorn = isInCar && input.horn();
    audio.horn(isHorn);
    hornFor = isHorn ? hornFor + dt : 0;
    const isCockpitView = isInCar && chase.mode === "cockpit";
    // In the driver's seat the car's own gauges read the speed: no second speedometer over the view.
    $("#hud").classList.toggle("in-cockpit", isCockpitView);
    if (isCockpitView)
      cockpit.setClock(clockLabel(gameClockNow(), tokyoDate(env.now())).split(" ").pop() ?? "");
    // ナビのテレビ: what its picture lock reads (the speed pulse, the parking brake, the engine).
    const tvNote = naviTv.update({
      now,
      drive: {
        kmh: vehicle.speedKmh(),
        parkingBrake: drive.handbrake,
        engineOff: isEngineOff || !controls.engineOn,
      },
      assist: controls.assist,
      routeActive: nav.route !== null,
      inCar: isInCar,
      inCabin: cockpit.active,
    });
    if (tvNote) toast(tvNote, "#4dd2ff");
    if (isCockpitView) {
      const tvFrame = naviTv.draw(carNavi.canvas, now);
      const isDisplayChanged =
        tvFrame.changed ||
        (!tvFrame.visible &&
          carNavi.draw(
            {
              now,
              graph: roadGraph,
              route: nav.route,
              at: nav.lastAt,
              pos: vehicle.position(),
              yaw: vehicle.yaw(),
              night: env.nightFactor > 0.35,
              kmh: vehicle.speedKmh(),
              limit: currentLimit,
              place: [wardName, townName].filter(Boolean).join(" "),
              clock: clockLabel(gameClockNow(), tokyoDate(env.now())).split(" ").pop() ?? "",
              tv: naviTv.badge,
            },
            wasTvOnScreen,
          ));
      wasTvOnScreen = tvFrame.visible;
      if (isDisplayChanged) cockpit.refreshDisplay();
    }
    cockpit.update({
      dt,
      now,
      kmh: vehicle.speedKmh(),
      throttle: drive.throttle,
      steerAngle: vehicle.steerAngle,
      left: signalLeft,
      right: signalRight,
      highBeam: controls.highBeam && controls.headlightsOn(isDark),
      parkingBrake: drive.handbrake,
      wipers: controls.wipers,
      rainMmH: env.rainMmH(),
      night: env.nightFactor,
    });
    audio.update(isEngineOff ? 0 : speed, isEngineOff ? 0 : drive.throttle, isEngineOff);
    // The pad's kerb jolts and (if chosen) the idle hum (game/gamepad.ts).
    input.pad.carFrame({
      inCar: isInCar,
      engineOn: isInCar && controls.engineOn && !isEngineOff,
      kmh: Math.abs(speed),
      throttle: drive.throttle,
      verticalSpeed: vehicle.body.linvel().y,
    });

    if (now - lastLocate > 500) {
      lastLocate = now;
      locate(geo.lat, geo.lon);
    }

    if (now - lastHud > 150) {
      lastHud = now;
      checkDeadlines();
      $("#car-status").hidden = !isInCar;
      $("#ind-left").classList.toggle("on", signalLeft && blink);
      $("#ind-right").classList.toggle("on", signalRight && blink);
      const lightMode = { auto: "AUTO", on: "ON", off: "OFF" }[controls.lights];
      $("#light-status").textContent = controls.highBeam
        ? i18n.t("hud.lightStatusHigh", { mode: lightMode })
        : `💡${lightMode}`;
      $("#belt-status").textContent = controls.belt
        ? i18n.t("hud.beltOn")
        : i18n.t("hud.beltOff", { key: keyOf("belt") });
      $("#belt-status").classList.toggle("warn", !controls.belt);
      {
        const c = gameClockNow();
        const d = tokyoDate(env.now());
        landmarks.update(
          geo.lat,
          geo.lon,
          { ...d, weekday: c.weekday, minutes: c.minutes },
          env.nightFactor > 0.35,
        );
      }
      furniture.update(now, (x, z) => pavements.contains(x, z));
      if (now % 1000 < 160) updateSocial();
      const yaw = isOnFoot
        ? Math.atan2(walker.forward().x, walker.forward().z)
        : isInTaxi && taxi
          ? taxi.model.root.rotation.y
          : carYaw(carRot);
      updateHud(geo.lat, geo.lon, yaw, now);
      conversation.refreshStatus();
      phone.refresh();
      if (brain.status !== lastBrainStatus) {
        if (brain.status === "ready") toast(i18n.t("toast.aiReady"), "#4dd2ff");
        if (brain.status === "error") toast(brain.detail, "#ff6b6b");
        lastBrainStatus = brain.status;
      }
      const chip = $("#ai-chip");
      const isBusy = brain.status === "downloading" || brain.status === "loading";
      chip.hidden = !isBusy && brain.status !== "error";
      chip.textContent =
        brain.status === "downloading"
          ? i18n.t("hud.aiDownloading", { percent: Math.round(brain.progress * 100) })
          : brain.status === "loading"
            ? i18n.t("hud.aiLoading")
            : i18n.t("hud.aiUnavailable");
    }
    // Record the moment for replays.
    recorder.capture(
      now,
      isOnFoot ? walker.model.root : vehicle.object,
      Math.abs(speed) / 3.6,
      liveObjects(),
    );
    // The water's reflection (only with water in view), then the frame.
    water.renderReflection(renderer, scene, camera, now);
    // ブラー: the car's speed (toward the vanishing point ahead) and the view's turn, smeared over the
    // street only — a street pass of the frame, before the wipers and the interior are drawn.
    camera.getWorldDirection(viewDir);
    const viewYaw = Math.atan2(viewDir.x, viewDir.z);
    const yawRate =
      Math.atan2(Math.sin(viewYaw - lastViewYaw), Math.cos(viewYaw - lastViewYaw)) / Math.max(dt, 1e-3);
    lastViewYaw = viewYaw;
    const aheadWorld = carPos
      .clone()
      .add(new Vector3(Math.sin(vehicle.yaw()) * 300, 1, Math.cos(vehicle.yaw()) * 300));
    // In front of the eye in camera space. Why not the projected z: its range depends on the
    // depth convention (WebGPU's 0…1, reversed here), and a point behind the eye can land inside it.
    const isAheadInFront = aheadWorld.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
    const ahead = aheadWorld.project(camera);
    const isAheadInView = isAheadInFront && Math.abs(ahead.x) < 1.2 && Math.abs(ahead.y) < 1.2;
    const size = renderer.getDrawingBufferSize(new Vector2());
    blur.update(
      {
        kmh: speed,
        // Screen uv with the origin at the top left, as the frame's passes sample it.
        focus: isAheadInView ? new Vector2((ahead.x + 1) / 2, (1 - ahead.y) / 2) : null,
        yawRate,
        dt,
        isOn: isInCar && !QUALITY.isMobile,
      },
      size.x,
      size.y,
    );
    placeFlare();
    // The world and the street; from the driver's seat, the wipers, the interior and the glass too.
    cockpit.render(composer, renderer, scene, camera);
    composer.present();
    // Same task as the present: the canvas still holds the frame for the grabs below.
    takeShots();
    // After the frame: a bystander's post that is due, and one off-screen render of the shots.
    afterViolations(now);
    if (pendingScreenshot) {
      pendingScreenshot = false;
      renderer.domElement.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tokyo-open-drive-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });
    }
  };

  /** Where, when and how fast, for the review screen (違反の記録) and the logs. */
  /** What 簡単操作 reads: the weather and the next turn on the route. */
  const autoContext = (throttle: number): AutoContext => {
    const route = nav.route;
    const next = route?.maneuvers.find((m) => m.at > nav.lastAt + 2);
    const side = (turn: string): "left" | "right" | null =>
      turn === "left" || turn === "slightLeft" ? "left" : turn === "straight" ? null : "right";
    return {
      raining: env.isRaining(),
      // The observed amount only when it is really raining (the 雨 preset has no amount).
      rain10m: (env.getObservation()?.precip10m ?? 0) > 0 ? (env.getObservation()?.precip10m ?? null) : null,
      nextTurn: next ? { side: side(next.turn), metres: next.at - nav.lastAt } : null,
      offRoute: nav.isOffRoute,
      kmh: vehicle.speedKmh(),
      throttle,
    };
  };
  const violationContext = (detail?: string): ViolationContext => {
    const p = vehicle.position();
    let junction = "";
    let best = 60;
    for (const j of roadApplied?.junctionNames ?? []) {
      const d = Math.hypot(j.pos.x - p.x, j.pos.z - p.z);
      if (d < best) {
        best = d;
        junction = j.name.endsWith("交差点") ? j.name : `${j.name}交差点`;
      }
    }
    return {
      clock: clockLabel(gameClockNow(), tokyoDate(env.now())),
      place: [wardName, townName, junction && `（${junction}付近）`].filter(Boolean).join(" "),
      lat: lastGeo.lat,
      lon: lastGeo.lon,
      kmh: Math.abs(mode === "foot" ? 0 : vehicle.speedKmh()),
      limit: currentLimit,
      limitKind: currentLimitKind,
      detail,
    };
  };
  // Records whose screen is grabbed right after the next frame is drawn.
  const pendingShots: ViolationRecord[] = [];
  // Pictures made off the main thread: the screen kept with a record, a bystander's photo.
  const darkroom = new Darkroom();
  /**
   * The screen at the violation, for its records (違反の記録, the roadside stop's 違反の映像). How: an
   * ImageBitmap of the canvas taken in the frame's own task (the canvas still holds the frame),
   * encoded to a JPEG in the darkroom worker; the records get it a moment later. Why not
   * drawImage + toDataURL here (as before): toDataURL waits for the GPU to finish the frame and
   * encodes on the main thread, in this frame. Still a data URL: the record is kept in IndexedDB,
   * where a blob: URL would not outlive the page.
   */
  const takeShots = () => {
    if (pendingShots.length === 0) return;
    const records = pendingShots.splice(0);
    const grabbing = perf.time("screen.grab", () => darkroom.grab(renderer.domElement, 480, 270, 0.7));
    void (darkroom.inline ? grabbing : perf.span("screen.encode", grabbing))
      .then((url) => {
        if (!url) return;
        for (const r of records) if (r.context) r.context.snapshot = url;
      })
      .catch((error: unknown) => warn("screen_grab_failed", { error: String(error) }));
  };
  // Offences the police always learn of: those of an accident they are called to.
  const ACCIDENT_KINDS = new Set([
    "safeDriving",
    "injury",
    "phoneDanger",
    "hitAndRun",
    "negligentInjury",
    "dangerousInjury",
  ]);
  /**
   * People who could see the car: pedestrians and drivers within 80 m. The people the game draws are
   * a sample of the street: busier areas (e-Stat density sets the crowd size) have more eyes and
   * dashcams than those modelled one by one.
   */
  const witnessesAround = (carPos: Vector3) =>
    pedestrians.list.filter((q) => q.object.position.distanceTo(carPos) < 80).length +
    traffic.positions().filter((q) => q.distanceTo(carPos) < 80).length +
    Math.floor(pedestrians.crowd / 12);
  /** The player drove well where people could see: one of them may thank them on Y. */
  const praise = (kind: PraiseKind) => {
    const c = social.maybePraise(kind, witnessesAround(vehicle.position()), env.now().getTime());
    if (!c) return;
    notify("social", () => i18n.t("notify.praised", { app: SOCIAL_APP_NAME }));
    socialUnread++;
    log("social_praise", { kind });
  };
  // People already counted as let across (one chance of a thank-you each).
  const letAcross = new WeakSet<object>();
  /**
   * A violation the driver committed. It counts only if someone catches it: the police at an
   * accident, or a patrol that sees it (then a chase and a ticket on the spot); otherwise it
   * stays the driver's own record (未検挙), shown so the player still learns from it.
   */
  const book = (
    v: Violation,
    now: number,
    cooldownMs?: number,
    detail?: string,
    /** Seen by the units on the car rather than found at an accident (the chase's 安全運転義務違反). */
    byPatrol = false,
  ): ViolationRecord | null => {
    const started = performance.now();
    const booked = perf.time("violation.commit", () =>
      law.commit(v, now, cooldownMs, violationContext(detail)),
    );
    if (!booked) return null;
    pendingShots.push(booked);
    score = Math.max(0, score - booked.points * 50);
    const isAccident = !byPatrol && (ACCIDENT_KINDS.has(booked.kind) || booked.kind.startsWith("injury"));
    const carPos = vehicle.position();
    // Every violation is stamped as it happens, caught or not: the seal says what the driver did;
    // whether anyone saw it is the notice's line (and the ticket's, later).
    stamps.stamp("違反", shortLabel(booked.label), false, stampReading(booked.label));
    input.pad.rumble("stamp");
    perf.time("violation.pursuit", () => pursuitDirector.onViolation(booked));
    perf.time("violation.police", () => {
      if (isAccident) {
        law.cite(booked, "accident");
        notify("caught", () => formatViolation(booked));
        // Part of the case when a pursuit or a stop is on.
        pursuitDirector.witness(booked);
      } else if (pursuitDirector.witness(booked)) {
        // The units on the car (or the helicopter over it) see it: the line names the article.
        notify("caught", () => formatViolation(booked));
      } else if (patrols.some((u) => u.sees(carPos))) {
        // The unit already on the car takes it; otherwise the first that saw it.
        const unit = police?.sees(carPos) ? police : (patrols.find((u) => u.sees(carPos)) ?? null);
        if (unit) {
          police = unit;
          if (unit.witness(booked) === "pursuit") startPursuit();
          notify("caught", () => i18n.t(SEEN_BY_KEY[unit.kind], { label: violationName(booked.label) }));
        }
      } else {
        notify("violation", () => i18n.t("notify.uncaught", { label: violationName(booked.label) }));
      }
    });
    // Bystanders and dashcams nearby: someone may film it and post it, a few seconds from now.
    const witnesses = perf.time("violation.witnesses", () => witnessesAround(carPos));
    const post = perf.time("violation.draft", () => draftWitnessPost(booked, witnesses));
    // Those of them who can see the car get their phones out (the poster among them, typing it).
    const filmers = perf.time("violation.phones", () => witnessPhones.react(booked, post, carPos));
    const span = violationSpan(booked);
    if (filmers > 0) log("social_filmed", { kind: booked.kind, filmers, witnesses }, span);
    if (post) queuePost(post, witnesses);
    const c = booked.context;
    log(
      "violation_booked",
      {
        violationId: booked.id ?? "",
        kind: booked.kind,
        status: booked.status,
        points: booked.points,
        totalPoints: law.state.points,
        place: c?.place,
        lat: c?.lat,
        lon: c?.lon,
        speedKmh: c ? Math.round(c.kmh) : null,
        limitKmh: c?.limit,
        detail: c?.detail,
      },
      span,
    );
    perf.add("violation.total", performance.now() - started, true, started);
    return booked;
  };

  // ---------- Y（SNS） ----------
  const social = new SocialFeed();
  // What everyday posts can talk about: where the player is, the weather, what is in sight.
  social.world = (): SocialWorld => {
    const { lat, lon } = lastGeo;
    const focus = focusPos();
    const river = water.riverNear(lat, lon, 1500);
    const signs = guideSigns.plans
      .filter((p) => Math.hypot(p.pos.x - focus.x, p.pos.z - focus.z) < 400)
      .flatMap((p) => p.board.arms.flatMap((a) => a.names))
      .filter((n, i, all) => all.findIndex((m) => m.ja === n.ja) === i)
      .slice(0, 6)
      .map(({ ja, en }) => ({ ja, en }));
    let standing = 0;
    traffic.forEachCar((object, speed) => {
      const isStanding = Math.abs(speed) < 1.5 && object.position.distanceTo(focus) < 80;
      if (isStanding) standing++;
    });
    return {
      ward: wardName === "—" ? null : wardName,
      town: townName || null,
      nearWards: areas?.wardsIn(lon - 0.03, lat - 0.025, lon + 0.03, lat + 0.025) ?? [],
      lat,
      lon,
      raining: env.isRaining(),
      tempC: env.getObservation()?.temp ?? null,
      landmarks: landmarkEntries.map((l) => ({
        name: l.name,
        km: haversineMeters(lat, lon, l.lat, l.lon) / 1000,
      })),
      parks: field
        .near(lat, lon, 1500)
        .map((p) => p.name)
        .filter((n) => n.endsWith("公園"))
        .slice(0, 5),
      river: river?.river ?? null,
      // Gauges are mostly named after their bridge (内匠橋); others (小台, 池上) are not bridges.
      bridge: river && /^[^（）]+橋$/.test(river.gauge) ? river.gauge : null,
      signs,
      buses: transit.positionsNear(lat, lon, 400).length,
      jammed: standing >= 6,
    };
  };
  // Each poster's photo is their own shot from where they stood, not the driver's screen.
  const witnessShot = new WitnessShot(
    renderer,
    composer,
    scene,
    {
      ground: (x, z) => groundY(x, z),
      subject: () => ({
        position: vehicle.position(),
        yaw: vehicle.yaw(),
        kmh: Math.abs(vehicle.speedKmh()),
      }),
      witnesses: (at) => pedestrians.witnessesOf(at, 60).map((p) => p.object.position),
      hidden: () => [ribbon.object, missions.arrow],
      isOpen: (x, z) => {
        const g = groundY(x, z);
        return g === null || isOpenGround(x, z, g);
      },
      // The shot's eye is already at eye height; the test adds it again, so lower the start.
      sight: (from, to) => lineOfSight(new Vector3(from.x, from.y - EYE_HEIGHT, from.z), to),
      subjectObject: () => vehicle.object,
      stage: (shoot) => {
        const wasCockpit = cockpit.active;
        cockpit.setActive(false);
        shoot();
        cockpit.setActive(wasCockpit);
      },
      // Where the poster stood, as latitude/longitude, so the video plays there after a recentre.
      filmed: (post) => {
        const from = post.filmedFrom;
        if (from) from.geo = frame.toGeodetic(new Vector3(from.eye.x, from.eye.y, from.eye.z));
      },
    },
    darkroom,
  );
  // Asked again when a post drafted at the violation is published: the shot is already under way.
  social.camera = (post) => witnessShot.shoot(post);
  // Dev: `?noprewarm` leaves the witnesses' pipelines to the first violation (to see what it saves).
  const isPrewarmOff = import.meta.env.DEV && new URLSearchParams(location.search).has("noprewarm");
  /** Built before play by precompile: the bystanders' phones, the shots' probe, the darkroom worker. */
  const prewarmWitnesses = (): Array<Promise<unknown>> => {
    darkroom.warm();
    return [
      perf.span("prewarm.phones", witnessPhones.precompile(renderer, composer.target, scene)),
      perf.span("prewarm.shot", witnessShot.precompile(composer.target)),
    ].map((p) => p.catch((error: unknown) => warn("prewarm_failed", { error: String(error) })));
  };
  // Bystanders' posts waiting to go up, in the order of what they saw.
  const postsDue = new DueQueue<{ post: SocialPost; witnesses: number }>();
  // Real seconds from seeing it to posting it (filming it, typing it).
  const POST_DELAY_S = [2.5, 5.5] as const;
  // Dev (window.__game.debug.perf): off puts all of it back in the violation's frame, as before.
  let isSpread = true;
  // Dev: the next violation is posted, with this medium.
  let forcedPost: "photo" | "video" | null = null;
  /** A bystander's post about `booked` if someone makes one: drafted now, published by queuePost. */
  const draftWitnessPost = (booked: ViolationRecord, witnesses: number): SocialPost | null => {
    const at = env.now().getTime();
    if (!forcedPost) return social.draftPost(booked, witnesses, at);
    // Drafted again until one comes in that medium (a draft only takes an id and an opener).
    for (let i = 0; i < 60; i++) {
      const p = social.draftPost(booked, Math.max(witnesses, 6), at);
      if (p?.media === forcedPost) return p;
    }
    return null;
  };
  /**
   * The post goes up a few seconds after the violation, as a bystander's does (they film it, then
   * type it: the phones show it being typed meanwhile). Its photo is started now, drawn over the
   * frames right after (the moment itself) and developed by the time it is posted.
   */
  const queuePost = (post: SocialPost, witnesses: number) => {
    if (post.media !== "text") witnessShot.shoot(post);
    if (!isSpread) return publishPost(post, witnesses);
    const delay = POST_DELAY_S[0] + Math.random() * (POST_DELAY_S[1] - POST_DELAY_S[0]);
    postsDue.push({ post, witnesses }, performance.now() + delay * 1000);
  };
  const publishPost = (post: SocialPost, witnesses: number) =>
    perf.time("post.publish", () => {
      social.publish(post, env.now().getTime());
      const label = post.record.label;
      notify(
        "social",
        () => i18n.t("notify.posted", { app: SOCIAL_APP_NAME, label: violationName(label) }),
        post,
      );
      socialUnread++;
      log(
        "social_post",
        { postId: post.id, kind: post.record.kind, witnesses, reach: post.reach },
        postSpan(post),
      );
    });
  /** After each frame of play: a post that is due (one a frame), and one render of the shots. */
  const afterViolations = (now: number) => {
    const due = postsDue.take(now);
    if (due) publishPost(due.post, due.witnesses);
    witnessShot.gate.tick();
  };
  // Posts in people's own words when the on-device AI is on (templates otherwise).
  const SOCIAL_VOICE = {
    post: "あなたは東京で暮らす一般の人で、SNS に投稿します。いま目の前で見た危ない運転について、日本語の口語で 1〜2 文だけ書いてください。ナンバーや個人を特定できる情報、ハッシュタグは書かないこと。",
    reply:
      "あなたは SNS の返信欄に書き込む一般の利用者です。元の投稿への反応を日本語で 30 字以内、1 文だけ書いてください。批判はよいが、差別・脅迫・個人攻撃・誹謗中傷は書かないこと。",
    quote:
      "あなたは SNS で投稿を引用して一言添える一般の利用者です。日本語で 30 字以内、1 文だけ。差別・脅迫・個人攻撃は書かないこと。",
  } as const;
  social.writer = async (role, post, seed) => {
    if (brain.status !== "ready") return null;
    // After the photos being drawn or developed (this post's too): the model shares the GPU.
    await witnessShot.idle();
    const c = post.record.context;
    const facts =
      role === "post"
        ? `見た場所: ${c?.place ?? "都内"}。見たこと: ${post.record.label}${c?.detail ? `（${c.detail}）` : ""}。`
        : `元の投稿: ${post.text}`;
    const text = await brain.reply(-3000 - post.id * 20 - seed, SOCIAL_VOICE[role], facts, () => undefined);
    return text?.trim() || null;
  };
  let socialUnread = 0;
  const viralShown = new Map<SocialPost, number>();
  const socialApp = new SocialApp($("#social-app"), social, () => env.now().getTime());
  appTile($("#social-open"));
  socialApp.playVideo = (id) => playPostVideo(id);
  const showSocial = (shown: boolean) => {
    $("#phone-home").hidden = shown;
    $("#phone-social").hidden = !shown;
    if (!shown) return;
    socialUnread = 0;
    socialApp.open();
    refreshSocial();
  };
  const refreshSocial = () => {
    $("#social-badge").hidden = socialUnread === 0;
    $("#social-badge").textContent = String(socialUnread);
    if ($("#phone-social").hidden) return;
    socialApp.refresh();
  };
  $("#social-open").addEventListener("click", () => showSocial(true));
  // The home indicator: back to the phone's home screen (each screen of the app has its own ←).
  $("#social-back").addEventListener("click", () => showSocial(false));
  /** Posts spread with game time; the police trace the car from clips that spread wide. */
  const updateSocial = () => {
    // People post at a human pace: the feed converts real seconds by how fast the clock runs.
    social.timeScale = env.timeMode === "real" ? 1 : GAME_TIME_SCALE;
    const noticed = perf.time("social.update", () => social.update(env.now().getTime()));
    for (const p of noticed) {
      if (p.record.status !== "uncaught") continue;
      law.notice(p.record, "sns");
      notify("police", () => i18n.t("notify.traced"));
      log("social_reported", { postId: p.id, kind: p.record.kind, reposts: p.reposts }, postSpan(p));
    }
    for (const p of social.posts) {
      const step = p.reposts >= 10000 ? 10000 : p.reposts >= 1000 ? 1000 : 0;
      if (step > (viralShown.get(p) ?? 0)) {
        viralShown.set(p, step);
        const counts = { reposts: formatCount(p.reposts), likes: formatCount(p.likes) };
        notify("social", () => i18n.t("notify.viral", counts), p);
      }
    }
    refreshSocial();
  };

  // ---------- 巡回中のパトカー ----------
  /**
   * Units on patrol around the player (up to three): 白黒のパトカー, 白バイ and 覆面パトカー.
   * `police` is the one dealing with the player now (pursuing or ticketing), else the nearest.
   */
  const patrols: PolicePatrol[] = [];
  const MAX_PATROLS = 3;
  let police: PolicePatrol | null = null;
  let policeDueAt = performance.now() + 15000;
  const patrolKind = (): PatrolKind => {
    const r = Math.random();
    return r < 0.5 ? "patrol" : r < 0.8 ? "shirobai" : "unmarked";
  };
  /**
   * The loudspeaker on the patrol car: from the car with the on-device voice, else only its level.
   * The on-device engine uses the player's language, including the translated loudspeaker line.
   * speechSynthesis is used when on-device speech is disabled.
   */
  const policeSay = (key: i18n.MessageKey) =>
    officerSay(key, undefined, police?.car.object ?? null, "loudspeaker");
  /**
   * An officer's line: from the loudspeaker or from the officer at the window. The on-device voice
   * speaks the translated line in the player's language.
   */
  const officerSay = (
    key: i18n.MessageKey,
    params: i18n.Params | undefined,
    from: Object3D | null,
    style: "loudspeaker" | "voice",
  ) => {
    const hasSpatialVoice = voice.enabled && from !== null;
    if (hasSpatialVoice) {
      voice.speak(i18n.t(key, params), audio.spatial.voiceFrom(from, style));
      const isJapanese = i18n.getLocale() === "ja";
      const isShownElsewhere = style === "voice";
      if (!isJapanese && !isShownElsewhere)
        toast(i18n.t("police.said", { line: i18n.t(key, params) }), "#ff6b6b");
      return;
    }
    if (audio.muted) return;
    const u = localUtterance(i18n.t(key, params));
    if (!u) return;
    u.rate = 0.95;
    u.pitch = 0.8;
    // speechSynthesis cannot be routed through WebAudio: only its volume follows the distance.
    u.volume = from ? audio.spatial.loudnessAt(from.position, style) : 1;
    speechSynthesis.speak(u);
  };
  const startPursuit = () => {
    social.note("pursuit", env.now().getTime());
    $("#pursuit-chip").hidden = false;
    policeSay("police.callStop");
    // Pulling over is the driver's to do: the self-driving hands the car back.
    if (autopilot) stopAutopilot(i18n.t("toast.autopilotOff"));
    if (police) pursuitDirector.begin(police);
    const seen = police?.seen ?? [];
    log(
      "patrol_pursuit",
      { unitKind: police?.kind ?? null, violationIds: seen.flatMap((r) => (r.id ? [r.id] : [])) },
      violationSpan(seen.at(-1) ?? {}),
    );
  };
  /** The roadside stop's ticket (pursuitDirector.ts): taken, it calls `onAccept`. */
  let ticketTaken: (() => void) | null = null;
  const openTicket = (records?: ViolationRecord[], onAccept?: () => void) => {
    const seen = records ?? [...(police?.seen ?? [])];
    if (seen.length === 0) return;
    ticketTaken = onAccept ?? null;
    const isRed = seen.some((r) => r.fine === null);
    i18n.setI18nText($("#ticket-intro"), "ticket.intro");
    $("#ticket-form-container").replaceChildren(renderTicket({ violations: seen }));
    i18n.setI18nText($("#ticket-note"), isRed ? "ticket.noteRed" : "ticket.noteBlue");
    $<HTMLDialogElement>("#ticket-dialog").showModal();
  };
  // At the roadside the ticket is taken, not waved away (Esc): the stop goes on from it.
  $("#ticket-dialog").addEventListener("cancel", (e) => {
    if (ticketTaken) e.preventDefault();
  });
  $("#ticket-accept").addEventListener("click", () => {
    const taken = ticketTaken;
    if (taken) {
      ticketTaken = null;
      $<HTMLDialogElement>("#ticket-dialog").close();
      taken();
      return;
    }
    const p = police;
    if (p) {
      for (const r of p.seen) {
        // Stamped already when committed (book): the ticket does not stamp it again.
        law.cite(r, "patrol");
      }
      log("patrol_ticket", {
        unitKind: p.kind,
        kinds: p.seen.map((r) => r.kind),
        violationIds: p.seen.flatMap((r) => (r.id ? [r.id] : [])),
        totalPoints: law.state.points,
      });
      const tw = taxiWorld();
      if (tw) p.release(tw, vehicle.position());
    }
    $("#pursuit-chip").hidden = true;
    $<HTMLDialogElement>("#ticket-dialog").close();
  });
  const updatePolice = (dt: number, now: number) => {
    const tw = taxiWorld();
    if (!tw || !roadGraph) return;
    const focus = focusPos();
    if (patrols.length < MAX_PATROLS && now > policeDueAt) {
      spawnPatrol(patrolKind(), focus);
      policeDueAt = now + 12000;
    }
    // Out of the area: it goes off duty here and another comes by later. A unit sent off after a
    // stop that is still beside the car 8 s later (blocked behind it, no way out) goes off duty once
    // out of view, or after 20 s whatever: it must not stand there into the next pursuit.
    const isLingering = (u: PolicePatrol) =>
      u.releasedAt !== null &&
      now - u.releasedAt > 8000 &&
      u.position.distanceTo(focus) < 60 &&
      (!isSeen(u.position) || now - u.releasedAt > 20000);
    const isOffDuty = (u: PolicePatrol) =>
      u.state !== "pursuing" &&
      u.state !== "ticketing" &&
      (u.position.distanceTo(focus) > 1100 || isLingering(u));
    for (const unit of patrols.filter(isOffDuty)) {
      unit.dispose();
      patrols.splice(patrols.indexOf(unit), 1);
      if (police === unit) police = null;
    }
    for (const unit of patrols) updatePatrol(unit, tw, dt, now);
    // A unit passing close by is seen (an unmarked car only once its lights are on).
    for (const unit of patrols) {
      const isSeen =
        unit.position.distanceTo(focus) < 50 && (unit.kind !== "unmarked" || unit.state === "pursuing");
      if (isSeen) social.note(unit.kind, env.now().getTime());
    }
    // The one the player deals with: pursuing or ticketing, else the nearest.
    const engaged = patrols.find((u) => u.state === "pursuing" || u.state === "ticketing");
    police =
      engaged ??
      patrols.toSorted((a, b) => a.position.distanceTo(focus) - b.position.distanceTo(focus))[0] ??
      null;
  };
  const updatePatrol = (
    p: PolicePatrol,
    tw: NonNullable<ReturnType<typeof taxiWorld>>,
    dt: number,
    now: number,
  ) => {
    tw.obstacles = tw.obstacles.filter((o) => o.distanceTo(p.position) > 1);
    const geo = frame.toGeodetic(p.position);
    const ground = { hasCollider: terrain.hasColliderAt(geo.lat, geo.lon), night: env.nightFactor > 0.25 };
    const event = p.update(
      dt,
      tw,
      ground,
      { position: vehicle.position(), speed: vehicle.forwardSpeed() },
      now,
    );
    // サイレン while chasing with the red lights on (not while writing the ticket).
    audio.spatial.siren(p, p.state === "pursuing" && p.lightsOn, p.car.object, "police");
    // Whoever is on the car now is the one the ticket, the callouts and the escape are about.
    const isEngaged = p.state === "pursuing" || p.state === "ticketing" || event === "lost";
    if (isEngaged) police = p;
    if (event === "pursuit") {
      police = p;
      startPursuit();
    } else if (event === "callout" && p.managed) pursuitDirector.callout(p);
    else if (event === "callout") policeSay("police.callStopShort");
    else if (event === "ticket") openTicket();
    else if (event === "lost") {
      // The plate was read: a notice to appear comes by post. Fleeing a stop made because the
      // driver had no valid licence is itself an offence (第67条第1項・第119条第1項第13号).
      if (p.seen.some((r) => r.kind === "unlicensed")) {
        const fled = law.commit(
          VIOLATIONS.ignoredStop,
          now,
          0,
          violationContext(inJapanese("violationDetail.fled")),
        );
        if (fled) {
          p.seen.push(fled);
          stamps.stamp("違反", shortLabel(fled.label), false, stampReading(fled.label));
        }
      }
      for (const r of p.seen) law.notice(r, "patrol");
      const lostIds = p.seen.flatMap((r) => (r.id ? [r.id] : []));
      p.seen.length = 0;
      $("#pursuit-chip").hidden = true;
      const escaped = ESCAPED_KEY[p.kind];
      notify("police", () => i18n.t(escaped));
      log("patrol_lost", { unitKind: p.kind, violationIds: lostIds });
    }
  };
  const isSurfaceStreet = (seg: Segment) => seg.line.kind !== "highway";
  // ---------- 追跡とその後（pursuitDirector.ts・pursuitScene.ts） ----------
  const pursuitScene = new PursuitScene(scene, $("#hud"));
  i18n.onLocaleChange(() => pursuitScene.relabel());
  /** The driver's accelerator this frame (pressed while boxed in tells that from stopping). */
  let playerThrottle = 0;
  /** Where the car stands, for judging a pull-over (第44条's places, the kerb, the lane). */
  const stopSite = (): StopSite => {
    const p = vehicle.position();
    const hit = roadGraph?.nearest(p, 15, isSurfaceStreet) ?? null;
    const none = { junction: false, crossing: false, noStopping: false, kerbGap: Infinity, rightLane: false };
    if (!hit) return none;
    const { junction, crossing, posted } = noStoppingAt(hit);
    const fwd = headingVector(vehicle.quaternion());
    const sgn = fwd.dot(hit.dir) >= 0 ? 1 : -1;
    const travel = hit.dir.clone().multiplyScalar(sgn);
    // The kerb: PLATEAU paving where there is some, else the carriageway's edge (GSI 幅員).
    const paved = kerbLeft(p, travel, hit.seg.line.width / 2 + 1, (x, z) => pavements.contains(x, z));
    const edge = hit.seg.line.width / 2 - hit.lateral * sgn;
    const kerbGap = Math.max(0, Math.min(paved, edge) - 0.92);
    const span = hit.seg.oneway === 0 ? hit.seg.line.width / 2 : hit.seg.line.width;
    const lane = Math.floor(
      (hit.seg.line.width / 2 - hit.lateral * sgn) / (span / Math.max(1, hit.seg.lanes)),
    );
    return { junction, crossing, noStopping: posted, kerbGap, rightLane: hit.seg.lanes >= 2 && lane > 0 };
  };
  /**
   * Nothing a car put at `p` would land on within `radius` m (horizontally): the other police units,
   * the traffic, the player's car and the taxi. Units are teleported only onto such spots: two
   * physics cars put into one another end up stacked.
   */
  const isSpotClear = (p: Vector3, radius: number, except?: PolicePatrol): boolean => {
    const isNear = (q: Vector3) => Math.hypot(q.x - p.x, q.z - p.z) < radius;
    if (patrols.some((u) => u !== except && isNear(u.position))) return false;
    if (traffic.positions().some(isNear)) return false;
    if (isNear(vehicle.position())) return false;
    return !(taxi && isNear(taxi.position));
  };
  /** A unit of `kind` on a street 250–450 m from `near`, on a clear spot (a few tries), or null. */
  const spawnPatrol = (kind: PatrolKind, near: Vector3): PolicePatrol | null => {
    const tw = taxiWorld();
    if (!tw || !roadGraph) return null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const unit = new PolicePatrol(scene, world, (x, z) => groundY(x, z), kind);
      // Disposed in the same frame, before the physics steps, when the spot is taken.
      const isPlaced = unit.spawn(roadGraph, tw, near) && isSpotClear(unit.position, 8, unit);
      if (isPlaced) {
        patrols.push(unit);
        return unit;
      }
      unit.dispose();
    }
    return null;
  };
  /** A moment of the chase for Y (not a booked record: fleeing an ordinary stop is not an offence). */
  const chaseMoment = (label: i18n.MessageKey = "social.chaseLabel"): ViolationRecord => ({
    ...VIOLATIONS.ignoredStop,
    label: inJapanese(label),
    at: performance.now(),
    session: SESSION,
    status: "caught",
    context: violationContext(),
  });
  /** The moment's replay at the window: the ±5 s around it, closing back to the conversation. */
  const showClip = (r: ViolationRecord, onDone: () => void): boolean => {
    const isInBuffer = r.session === SESSION && r.at >= recorder.start && r.at <= recorder.end;
    if (isInBuffer) startReplay(Math.max(recorder.start, r.at - CLIP_BEFORE_MS));
    else if (r.replay) playClip(r);
    const current = replay;
    if (!current) return false;
    if (isInBuffer) current.stopAt = r.at + CLIP_AFTER_MS;
    current.onClose = onDone;
    return true;
  };
  const pursuitDirector = new PursuitDirector({
    scene: pursuitScene,
    player: () => ({
      position: vehicle.position(),
      quat: vehicle.quaternion(),
      yaw: vehicle.yaw(),
      forward: headingVector(vehicle.quaternion()),
      speedKmh: vehicle.speedKmh(),
      throttle: playerThrottle,
    }),
    limit: () => currentLimit,
    othersNear: (p, r) =>
      pedestrians.list.filter((q) => q.object.position.distanceTo(p) < r).length +
      traffic.positions().filter((q) => q.distanceTo(p) < r).length,
    groundAt: (x, z) => groundY(x, z),
    sight: (from, to) => lineOfSight(from, to),
    night: () => env.nightFactor > 0.35,
    month: () => tokyoDate(env.now()).m,
    place: () => [wardName === "—" ? "" : wardName, townName].filter(Boolean).join(" "),
    graph: () => roadGraph,
    driveWorld: () => taxiWorld(),
    units: () => patrols,
    spawnUnit: (kind, near) => spawnPatrol(kind, near),
    isClear: (p, radius, except) => isSpotClear(p, radius, except),
    stopPost: (phase) => {
      const at = env.now().getTime();
      const carPos = vehicle.position();
      const moment = chaseMoment("social.stopLabel");
      const night = env.nightFactor > 0.5;
      const post = social.postStop(phase, moment, witnessesAround(carPos), at, night);
      if (!post) return false;
      // Those who can see it get their phones out (the poster among them).
      witnessPhones.react(moment, post, carPos);
      notify("social", () => i18n.t("notify.stopPosted", { app: SOCIAL_APP_NAME }), post);
      socialUnread++;
      log("social_stop_post", { postId: post.id, phase, reach: post.reach }, pursuitDirector.stop?.span);
      return true;
    },
    assist: () => controls.assist,
    leftSignalAgo: () => performance.now() - indicatorSeen.left,
    hazards: () => controls.hazard,
    setSignalLeft: () => controls.holdSignal("left"),
    setHazards: (on) => (controls.hazard = on),
    stopSite,
    law,
    book: (v, detail) => book(v, performance.now(), 0, detail, true),
    notify: (kind, text) => notify(kind, text),
    toast,
    stamp: (title, text, big) => stamps.stamp(title, shortLabel(text), big),
    say: officerSay,
    radioVoice: (key, params) => {
      if (audio.muted) return;
      if (voice.enabled) {
        voice.speak(i18n.t(key, params), audio.spatial.voiceFrom(vehicle.object, "loudspeaker"));
        return;
      }
      const u = localUtterance(i18n.t(key, params));
      if (!u) return;
      u.rate = 1.1;
      u.volume = 0.6;
      speechSynthesis.speak(u);
    },
    rotor: (on, anchor) => audio.spatial.siren(pursuitScene.heli, on, anchor, "rotor"),
    social: (event, stage) => {
      const at = env.now().getTime();
      if (event === "manhunt" || event === "heli" || event === "checkpoint") {
        social.note(event, at);
        return true;
      }
      if (event === "identified") return social.identified(at) !== null;
      const post = social.postChase(
        stage === 3 ? 3 : 2,
        chaseMoment(),
        witnessesAround(vehicle.position()),
        at,
      );
      if (!post) return false;
      notify("social", () => i18n.t("notify.chasePosted", { app: SOCIAL_APP_NAME }), post);
      socialUnread++;
      return true;
    },
    posts: () => social.posts.slice(0, 3).map((p) => ({ name: p.author, handle: p.handle, text: p.text })),
    tv: (b) => naviTv.setBreaking(b),
    navAlert: (a) => (nav.alert = a),
    chip: (on) => ($("#pursuit-chip").hidden = !on),
    openTicket: (records, onAccept) => openTicket(records, onAccept),
    showClip,
    hitAndRunPending: () => emergency.chasing,
    endHitAndRunChase: () => emergency.cancelPursuit(),
    endDay: () => endDay(),
    arrestScreen: (why) => showArrest(why),
    decideSanction: (points) => decideSanction(points, prior),
    keyOf: (action) => keyOf(action),
  });
  /**
   * The police are dealing with the player (pursuitEscalation.isEnforcing): 移動, 復帰, getting
   * out, タイトルへ and the day's end at home wait.
   */
  const enforcing = () =>
    isEnforcing({
      unitEngaged: patrols.some((u) => u.state === "pursuing" || u.state === "ticketing"),
      pursuitBusy: pursuitDirector.busy,
      ticketOpen: $<HTMLDialogElement>("#ticket-dialog").open,
      arrestShown: !$("#suspended").hidden,
      hitAndRunChase: emergency.chasing,
    });
  /**
   * Where the car stands, for parking: 駐停車禁止 (道路交通法 第44条: within 5 m of a junction's
   * side edge or of a crosswalk, or a JARTIC 駐停車禁止 section), 駐車禁止 (JARTIC section in force),
   * or null where parking on the street is not prohibited.
   */
  /** The 駐停車禁止 of 第44条 where the car is: a junction, a crosswalk, a posted section. */
  const noStoppingAt = (hit: { seg: Segment; s: number }) => {
    const clock = gameClockNow();
    const inForce = (code: number) => hit.seg.rules.some((r) => r.code === code && isInForce(r, clock));
    const junction = [hit.seg.from, hit.seg.to].some((node) => {
      const ids = roadGraph?.nodes.get(node) ?? [];
      if (ids.length < 3) return false;
      const sideEdge = Math.max(...ids.map((id) => roadGraph?.segments[id].line.width ?? 0)) / 2;
      const fromNode = node === hit.seg.from ? hit.s : hit.seg.length - hit.s;
      return fromNode < sideEdge + 5;
    });
    // A crosswalk is 4 m wide: its edges are 2 m either side of its centre.
    const crossing = (roadApplied?.crossings ?? []).some(
      (c) => c.seg === hit.seg && Math.abs(c.s - hit.s) < 2 + 5,
    );
    return { junction, crossing, posted: inForce(65), inForce };
  };
  const parkingPlace = (hit: { seg: Segment; s: number }): "noStopping" | "noParking" | null => {
    const { junction, crossing, posted, inForce } = noStoppingAt(hit);
    if (junction || crossing || posted) return "noStopping";
    // 消火栓 within 5 m (第45条第1項第5号).
    const isNearHydrant = furniture.nearHydrant(vehicle.position());
    return inForce(115) || isNearHydrant ? "noParking" : null;
  };
  const parkingDialog = $<HTMLDialogElement>("#parking-dialog");
  // The choice cannot be skipped with Esc: the sticker stays until one is made.
  parkingDialog.addEventListener("cancel", (e) => e.preventDefault());
  const openParkingDialog = (v: Violation) => {
    i18n.bindText($("#parking-detail"), () =>
      i18n.t("parking.detail", {
        label: violationName(v.label),
        article: lawRef(v.article),
        fine: formatNumber(v.fine ?? 0),
        points: v.points,
      }),
    );
    parkingDialog.showModal();
  };
  $("#parking-appear").addEventListener("click", () => {
    if (pendingParking) book(pendingParking, performance.now(), 0);
    pendingParking = null;
    parkingDialog.close();
  });
  $("#parking-owner").addEventListener("click", () => {
    if (pendingParking) {
      const order = law.chargeOwner(pendingParking, performance.now());
      stamps.stamp(
        "放置違反金",
        `${(order.fine ?? 0).toLocaleString()}円`,
        false,
        inPlayersWords("stamp.reading.parkingFine", { fine: formatNumber(order.fine ?? 0) }),
      );
      toast(i18n.t("toast.ownerOrder", { fine: formatNumber(order.fine ?? 0) }), "#ffd400");
      // 警視庁の処分基準: 普通自動車・前歴なしは 6 か月以内の納付命令 3 回で最長 20 日、4 回 30 日、5 回以上 40 日。
      if (law.ownerOrders >= 3) {
        const days = law.ownerOrders >= 5 ? 40 : law.ownerOrders === 4 ? 30 : 20;
        toast(i18n.t("toast.ownerOrderLimit", { n: law.ownerOrders, days }), "#ff6b6b");
      }
    }
    pendingParking = null;
    parkingDialog.close();
  });
  // ---------- 自動運転モード（自車） ----------
  /** A street 600–1,200 m away to cruise to when there is no mission. */
  const cruiseTarget = (): Vector3 | null => {
    if (!roadGraph) return null;
    const here = vehicle.position();
    const far = roadGraph.segments.filter((seg) => {
      if (seg.line.kind === "highway" || seg.line.width < 5.5 || seg.closed) return false;
      const d = roadGraph?.sample(seg, seg.length / 2).pos.distanceTo(here) ?? 0;
      return d > 600 && d < 1200;
    });
    const seg = far[Math.floor(Math.random() * far.length)];
    return seg && roadGraph ? roadGraph.sample(seg, seg.length / 2).pos.clone() : null;
  };
  const startAutopilot = () => {
    if (mode !== "car") return toast(i18n.t("toast.autopilotCarOnly"));
    const tw = taxiWorld();
    if (!tw) return toast(i18n.t("toast.roadsLoading"));
    const mission = missions.current ? field.localPosition(missions.current.target) : null;
    const target = mission ?? cruiseTarget();
    if (!target) return toast(i18n.t("toast.noDestination"));
    const driver = new AutoDriver();
    driver.place(vehicle.position(), vehicle.yaw());
    if (!driver.plan(tw, target)) return toast(i18n.t("toast.noRoute"));
    autopilot = { driver, cruising: !mission, input: { throttle: 0, brake: 0, steer: 0, handbrake: false } };
    $("#autopilot-chip").hidden = false;
    toast(i18n.t(mission ? "toast.autopilotToTarget" : "toast.autopilotCruise"), "#3cd17a");
    log("autopilot_on", { cruising: !mission, routeM: Math.round(driver.route?.length ?? 0) });
  };
  const stopAutopilot = (message: string) => {
    if (!autopilot) return;
    autopilot = null;
    vehicle.lightOverride = null;
    $("#autopilot-chip").hidden = true;
    toast(message, "#3cd17a");
    log("autopilot_off", {});
  };
  const updateAutopilot = (dt: number) => {
    const ap = autopilot;
    if (!ap || mode !== "car") return;
    const tw = taxiWorld();
    if (!tw) return;
    // The driver leaves its own car out of what it sees (anything within 1 m of itself).
    const pose = { position: vehicle.position(), yaw: vehicle.yaw(), speed: vehicle.forwardSpeed() };
    const { input, done, gaveUp } = ap.driver.update(dt, tw, pose);
    ap.input = input;
    vehicle.lightOverride = {
      brake: ap.driver.braking,
      left: ap.driver.signal === "left",
      right: ap.driver.signal === "right",
      reverse: ap.driver.reversing,
    };
    // Stuck after every go, or blocked where it may not pass: the driver takes the car back.
    if (gaveUp) {
      log("autopilot_gave_up", { why: gaveUp });
      return stopAutopilot(i18n.t(gaveUp === "stuck" ? "toast.autopilotStuck" : "toast.autopilotBlocked"));
    }
    if (!done) return;
    if (ap.cruising) {
      const next = cruiseTarget();
      if (next && ap.driver.plan(tw, next)) return;
    }
    stopAutopilot(i18n.t("toast.autopilotArrived"));
  };

  // ---------- 自動運転タクシー ----------
  /** `label` for the app's list (with the distance), `name` for the messages and the meter. */
  type TaxiDest = { name: string; label: string; lat: number; lon: number };
  let taxiDests: TaxiDest[] = [];
  let taxiArrivedAt = 0;
  let taxiStatusAt = 0;
  /** The taxi app's status line, kept in the language in force while it stays on screen. */
  const taxiStatus = (text: () => string) => i18n.bindText($("#taxi-status"), text);
  // What the self-driving cars see of the vehicles about (autoTraffic.ts): traffic with its speed
  // and heading, the kerbside parked cars, the player's car (parked while they are out of it), the
  // robotaxi and the patrols; each driver leaves itself out.
  const driveVehicles = (): DriveObstacle[] => {
    const list: DriveObstacle[] = [];
    const moving = (key: object, position: Vector3, speed: number, heading: number, halfLength?: number) =>
      list.push({ position, kind: "vehicle", speed, heading, halfLength, key });
    traffic.forEachCar((o, speed, kind) => moving(o, o.position, speed, o.rotation.y, halfLengthOf(kind)));
    for (const p of traffic.parkedPoses()) {
      list.push({ position: p.position, kind: "parked", heading: p.yaw, key: p.key });
    }
    const isDriven = mode === "car";
    if (isDriven) moving(vehicle, vehicle.position(), vehicle.forwardSpeed(), vehicle.yaw());
    else list.push({ position: vehicle.position(), kind: "parked", heading: vehicle.yaw(), key: vehicle });
    if (taxi) moving(taxi, taxi.position, taxi.speed, taxi.car.yaw());
    for (const u of patrols) moving(u, u.position, u.car.forwardSpeed(), u.car.yaw());
    return list;
  };
  // Buildings, poles and gantries round a pose, for the manoeuvres back onto the road.
  const driveClearance = rapierClearance(world, (x, z) => groundY(x, z));
  const taxiWorld = (): TaxiWorld | null =>
    roadGraph
      ? {
          graph: roadGraph,
          control,
          turnRules: roadApplied?.turnRules ?? [],
          clock: gameClockNow(),
          obstacles: pedestrians.list.filter((p) => p.state !== "talk").map((p) => p.object.position),
          vehicles: driveVehicles(),
          isPavement: (x: number, z: number) => pavements.contains(x, z),
          laneUse: roadApplied?.laneUse ?? [],
          crossings: roadApplied?.crossings ?? [],
          isClear: driveClearance,
        }
      : null;
  const fillTaxiDestinations = () => {
    const here = frame.toGeodetic(focusPos());
    const dist = (d: { lat: number; lon: number }) => haversineMeters(here.lat, here.lon, d.lat, d.lon);
    const dests: TaxiDest[] = [];
    const mission = missions.current?.target;
    const far = (name: string, at: { lat: number; lon: number }) => ({
      name,
      label: i18n.t("taxi.destWithKm", { name, km: Math.round(dist(at) / 100) / 10 }),
      lat: at.lat,
      lon: at.lon,
    });
    if (mission) {
      const name = i18n.t("taxi.destMission", { name: mission.name });
      dests.push({ name, label: name, lat: mission.lat, lon: mission.lon });
    }
    const car = frame.toGeodetic(vehicle.position());
    if (dist(car) > 150)
      dests.push({ name: i18n.t("taxi.destCar"), label: i18n.t("taxi.destCar"), lat: car.lat, lon: car.lon });
    const near = stations.filter((st) => dist(st) > 300).sort((a, b) => dist(a) - dist(b));
    for (const st of near.slice(0, 5)) dests.push(far(st.name, st));
    const spots = field
      .visibleList()
      .filter((p) => p.category !== "station" && dist(p) > 300 && dist(p) < 2500)
      .sort((a, b) => dist(a) - dist(b));
    for (const p of spots.slice(0, 4)) dests.push(far(p.name, p));
    taxiDests = dests;
    const select = $<HTMLSelectElement>("#taxi-dest");
    select.replaceChildren(
      ...dests.map((d, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = d.label;
        return o;
      }),
    );
  };
  const showTaxiApp = (shown: boolean) => {
    $("#phone-home").hidden = shown;
    $("#phone-taxi").hidden = !shown;
    if (shown) fillTaxiDestinations();
  };
  $("#taxi-open").addEventListener("click", () => showTaxiApp(true));
  // U / タクシー: the phone out on the taxi app, and a car called at once (the app says why not, in
  // the car); the destination can still be chosen there until boarding.
  input.on("taxi", () => {
    if (!phone.open) phone.show();
    showSocial(false);
    showTaxiApp(true);
    const isCalled = taxi !== null;
    if (!isCalled) $<HTMLButtonElement>("#taxi-call").click();
  });
  $("#taxi-back").addEventListener("click", () => showTaxiApp(false));
  $("#taxi-call").addEventListener("click", () => {
    const tw = taxiWorld();
    if (taxi) return taxiStatus(() => i18n.t("taxi.busy"));
    if (mode !== "foot") return taxiStatus(() => i18n.t("taxi.getOutFirst", { key: doorKey() }));
    if (!tw) return taxiStatus(() => i18n.t("taxi.loading"));
    const t = new RoboTaxi(scene, world, (x, z) => groundY(x, z));
    if (!t.dispatch(tw.graph, tw, walker.position(), walker.position())) {
      t.dispose();
      return taxiStatus(() => i18n.t("taxi.noCar"));
    }
    taxi = t;
    social.note("robotaxi", env.now().getTime());
    const eta = Math.max(1, Math.round((t.route?.length ?? 400) / 8 / 60));
    taxiStatus(() => i18n.t("taxi.dispatched", { min: eta }));
    $("#taxi-cancel").hidden = false;
    toast(i18n.t("toast.taxiComing", { min: eta }), "#ffd23c");
  });
  $("#taxi-cancel").addEventListener("click", () => {
    if (!taxi || mode === "taxi") return;
    const tw = taxiWorld();
    if (tw) taxi.leave(tw);
    else {
      taxi.dispose();
      taxi = null;
    }
    $("#taxi-cancel").hidden = true;
    taxiStatus(() => i18n.t("taxi.cancelled"));
  });
  const boardTaxi = () => {
    const tw = taxiWorld();
    if (!taxi || !tw) return;
    const dest = taxiDests[Number($<HTMLSelectElement>("#taxi-dest").value)] ?? taxiDests[0];
    if (!dest) {
      toast(i18n.t("toast.taxiChooseDest"), "#ffd23c");
      return;
    }
    const at = frame.toLocal(dest.lat, dest.lon, frame.origin.h).setY(0);
    // No way there from where it waits: the passenger stays on the kerb, with no fare.
    const isRouted = taxi.board(tw, at, dest.name);
    if (!isRouted) {
      toast(i18n.t("toast.taxiNoRoute", { place: dest.name }), "#ff6b6b");
      log("taxi_no_route", { to: dest.name });
      return;
    }
    walker.leave();
    mode = "taxi";
    chase.snap();
    $("#taxi-cancel").hidden = true;
    // 道路交通法 第71条の3第2項: every passenger wears a seat belt.
    toast(i18n.t("toast.taxiBoarded", { place: dest.name }), "#ffd23c");
  };
  const leaveTaxi = () => {
    if (!taxi) return;
    const tw = taxiWorld();
    const fare = taxi.fare;
    // Out on the kerb side (the car's left, +X when facing +Z).
    const side = new Vector3(1.8, 0, 0).applyQuaternion(taxi.model.root.quaternion);
    const at = taxi.position.clone().add(side);
    at.y = groundY(at.x, at.z) ?? at.y - 0.8;
    walker.enter(at, taxi.model.root.rotation.y);
    mode = "foot";
    toast(
      i18n.t("toast.taxiFare", { fare: formatNumber(fare), km: (taxi.metres / 1000).toFixed(1) }),
      "#ffd23c",
    );
    log("taxi_ride", {
      fareYen: fare,
      distanceM: Math.round(taxi.metres),
      slowS: Math.round(taxi.slowSeconds),
    });
    if (tw) taxi.leave(tw);
    $("#taxi-meter").hidden = true;
  };
  const updateTaxi = (dt: number, now: number) => {
    const t = taxi;
    if (!t) return;
    const tw = taxiWorld();
    if (!tw) return;
    const geo = frame.toGeodetic(t.position);
    const ground = {
      hasCollider: terrain.hasColliderAt(geo.lat, geo.lon),
      night: env.nightFactor > 0.25 || env.isRaining(),
    };
    const done = t.update(dt, tw, ground);
    if (t.state === "coming" && !done && now - taxiStatusAt > 1000) {
      taxiStatusAt = now;
      const minutes = Math.max(1, Math.round(t.remaining / 6 / 60));
      const metres = Math.round(t.remaining / 10) * 10;
      taxiStatus(() => i18n.t("taxi.coming", { m: metres, min: minutes }));
    }
    if (t.state === "coming" && done) {
      t.state = "waiting";
      toast(i18n.t("toast.taxiArrived", { key: doorKey() }), "#ffd23c");
      taxiStatus(() => i18n.t("taxi.arrived", { key: doorKey() }));
    } else if (t.state === "riding") {
      $("#taxi-meter").hidden = false;
      $("#taxi-flag").textContent = i18n.t(done ? "taxi.flagPay" : "taxi.flagHired");
      $("#taxi-fare").textContent = formatNumber(t.fare);
      $("#taxi-trip").textContent = i18n.t("taxi.trip", {
        km: (t.metres / 1000).toFixed(2),
        place: t.destinationName,
      });
      if (done) {
        t.state = "arrived";
        taxiArrivedAt = now;
        toast(i18n.t("toast.taxiAtDest"), "#ffd23c");
      }
    } else if (t.state === "arrived" && now - taxiArrivedAt > 1800) {
      leaveTaxi();
    } else if (t.state === "leaving" && (done || t.position.distanceTo(focusPos()) > 220)) {
      t.dispose();
      taxi = null;
      $("#taxi-cancel").hidden = true;
    }
  };

  // ---------- 帰宅と一日の終わり ----------
  input.on("home", () => {
    if (!home) return toast(i18n.t("toast.noStartYet"));
    const g = frame.toGeodetic(vehicle.position());
    const m = missions.startHome(home, performance.now(), g.lat, g.lon);
    toast(i18n.t("toast.headingHome", { km: (m.startDistance / 1000).toFixed(1) }), "#ffe14d");
  });
  // ---------- 目的地 ----------
  const destDialog = $<HTMLDialogElement>("#dest");
  const destQuery = $<HTMLInputElement>("#dest-query");
  /**
   * Before typing: the well-known landmarks (destinations.json's featured: 東京駅, 国会議事堂 …),
   * then the 名所・夜景 spots nearby, nearest first. Until that file is in, the modelled landmarks.
   */
  const featuredPlaces = (from: { lat: number; lon: number }): WarpPlace[] => {
    const featured = destinations.filter((d) => d.featured).map(destinationPlace);
    const landmark = i18n.t("warp.kind.landmark");
    const modelled = landmarkEntries.map((l) => ({ name: l.name, kind: landmark, lat: l.lat, lon: l.lon }));
    const spots = pois
      .filter((p) => p.category === "landmark" || p.category === "nightview")
      .map((p) => ({
        name: p.name,
        kind: categoryLabel(p.category, ""),
        lat: p.lat,
        lon: p.lon,
        ward: p.ward,
      }));
    const isLoaded = featured.length > 0;
    const first = isLoaded ? featured : modelled;
    return [...byDistance(first, from), ...byDistance(spots, from).slice(0, isLoaded ? 20 : 40)];
  };
  const chooseDestination = (p: WarpPlace) => {
    destDialog.close();
    const g = frame.toGeodetic(focusPos());
    const m = missions.startChosen(p, performance.now(), g.lat, g.lon);
    toast(i18n.t("toast.destSet", { name: p.name, km: (m.startDistance / 1000).toFixed(1) }), "#ffe14d");
    log("destination_set", { name: p.name, distanceKm: Math.round(m.startDistance / 100) / 10 });
  };
  const showDestinations = () => {
    const here = frame.toGeodetic(focusPos());
    const query = destQuery.value.trim();
    const shown = query ? searchPlaces(warpPlaces(), query, 40) : featuredPlaces(here);
    renderPlaceList($("#dest-results"), shown, chooseDestination, { separator: kindSeparator(), from: here });
    const isEmpty = shown.length === 0;
    $("#dest-list-title").textContent = !query
      ? i18n.t("dest.featured")
      : isEmpty
        ? i18n.t("dest.noResults")
        : i18n.t("dest.results", { n: shown.length });
    const current = missions.current?.target;
    const currentName = current?.category === "home" ? i18n.t("warp.home") : current?.name;
    $("#dest-current").hidden = !current;
    $("#dest-current").textContent = current ? i18n.t("dest.current", { name: currentName ?? "" }) : "";
    $("#dest-clear").hidden = !current;
    $("#dest-home").hidden = !home;
    const appointment = appointments[0];
    $("#dest-appointment").hidden = !appointment;
    if (appointment)
      $("#dest-appointment").textContent = i18n.t("dest.appointment", { place: appointment.place.name });
  };
  const openDestinations = () => {
    destQuery.value = "";
    showDestinations();
    destDialog.showModal();
    destQuery.focus();
  };
  destQuery.addEventListener("input", showDestinations);
  // Enter takes the first result; not while the IME is still composing the word.
  destQuery.addEventListener("keydown", (e) => {
    const isPickFirst = e.key === "Enter" && !e.isComposing;
    if (!isPickFirst) return;
    e.preventDefault();
    $("#dest-results").querySelector("button")?.click();
  });
  $("#dest-random").addEventListener("click", () => {
    destDialog.close();
    startRandomMission();
  });
  $("#dest-home").addEventListener("click", () => {
    destDialog.close();
    input.trigger("home");
  });
  $("#dest-appointment").addEventListener("click", () => {
    destDialog.close();
    nextAppointment();
  });
  $("#dest-clear").addEventListener("click", () => {
    destDialog.close();
    missions.clear();
    toast(i18n.t("toast.destCleared"));
  });
  let pendingSanction: ReturnType<typeof decideSanction> = { kind: "none" };
  // Notices that came by post today: they ask the driver to appear at the police station.
  let todayDelivered: ViolationRecord[] = [];
  /** Home was reached while the police were dealing with the car: the day ends after. */
  let dayEndDue = false;
  const endDay = () => {
    dayEndDue = false;
    const today = law.state.log.slice(todayFrom);
    const delivered = law.deliverNotices();
    todayDelivered = delivered;
    pendingSanction = decideSanction(law.state.points, prior);
    // 📮 the post: orbis and plate notices, and the 行政処分 notice when the points reach it.
    const mail: string[] = delivered.map((r) => {
      const how =
        r.by === "orbis"
          ? "dayEnd.byOrbis"
          : r.by === "orbisPortable"
            ? "dayEnd.byOrbisPortable"
            : r.by === "sns"
              ? "dayEnd.bySns"
              : "dayEnd.byPlate";
      const label = violationName(r.label);
      return i18n.t("dayEnd.mailNotice", { how: i18n.t(how), label, points: pointsCount(r.points) });
    });
    if (pendingSanction.kind !== "none") mail.push(i18n.t("dayEnd.mailSanction"));
    const mailBody = $("#day-mail-body");
    mailBody.replaceChildren(
      ...(mail.length ? mail : [i18n.t("dayEnd.noMail")]).map((t) => {
        const p = document.createElement("p");
        p.textContent = t;
        return p;
      }),
    );
    const caught = today.filter((r) => r.status === "caught");
    const uncaught = today.filter((r) => r.status === "uncaught");
    const counts = { n: today.length, caught: caught.length, uncaught: uncaught.length };
    const stats: Array<[string, string]> = [
      [i18n.t("dayEnd.distance"), i18n.t("dayEnd.km", { km: (todayMetres / 1000).toFixed(1) })],
      [i18n.t("dayEnd.violations"), i18n.t("dayEnd.violationCount", counts)],
      [i18n.t("dayEnd.fines"), formatYen(caught.reduce((a, r) => a + (r.fine ?? 0), 0))],
      [i18n.t("dayEnd.points"), i18n.t("dayEnd.pointsValue", { points: law.state.points, prior })],
    ];
    $("#day-stats").replaceChildren(
      ...stats.flatMap(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    const sanctionEl = $("#day-sanction");
    sanctionEl.hidden = pendingSanction.kind === "none";
    const course = $<HTMLButtonElement>("#day-course");
    course.hidden = pendingSanction.kind !== "suspension";
    course.disabled = false;
    if (pendingSanction.kind === "suspension") {
      const s = pendingSanction;
      $("#day-sanction-body").textContent = i18n.t("dayEnd.suspension", {
        days: s.days,
        points: law.state.points,
        prior,
        short: s.shortened,
        min: s.days - s.shortened,
      });
    } else if (pendingSanction.kind === "revocation") {
      $("#day-sanction-body").textContent = i18n.t("dayEnd.revocation", {
        points: law.state.points,
        prior,
        years: pendingSanction.years,
      });
    }
    const tips = adviceFor(today);
    const adviceEl = $("#day-advice");
    adviceEl.replaceChildren(
      ...(tips.length ? tips : [i18n.t("dayEnd.clean")]).map((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        return li;
      }),
    );
    // With the on-device AI on, an instructor sums the day up in its own words.
    if (brain.status === "ready" && today.length > 0) {
      const facts = today
        .map((r) => `${r.label}（${r.context?.place ?? ""}、${r.status === "caught" ? "検挙" : "未検挙"}）`)
        .join("、");
      const li = document.createElement("li");
      li.className = "ai-advice";
      li.textContent = i18n.t("dayEnd.thinking");
      adviceEl.prepend(li);
      void brain
        .reply(
          -77,
          // The facts stay Japanese (the records' words); the answer comes in the player's language.
          i18n.t("dayEnd.instructorPrompt"),
          `今日の違反: ${facts}`,
          (partial) => (li.textContent = `🧑‍🏫 ${partial}`),
        )
        .then((text) => {
          if (text) li.textContent = `🧑‍🏫 ${text}`;
          else li.remove();
        });
    }
    log("day_end", {
      distanceM: Math.round(todayMetres),
      violations: today.length,
      caught: caught.length,
      notices: delivered.length,
      points: law.state.points,
      sanction: pendingSanction.kind,
    });
    vehicle.setFrozen(true);
    $<HTMLDialogElement>("#day-end").showModal();
  };
  $("#day-course").addEventListener("click", () => {
    if (pendingSanction.kind !== "suspension") return;
    pendingSanction = {
      ...pendingSanction,
      days: pendingSanction.days - pendingSanction.shortened,
      shortened: 0,
    };
    $<HTMLButtonElement>("#day-course").disabled = true;
    $("#day-sanction-body").textContent = i18n.t("dayEnd.courseTaken", { days: pendingSanction.days });
  });
  $("#day-review").addEventListener("click", () => openReview());
  // ---------- 出頭（期限つき） ----------
  type Place = { name: string; lat: number; lon: number };
  type Appointment = {
    kind: "notice" | "sanction";
    place: Place;
    /** Game time (epoch ms) by which to appear. */
    deadline: number;
    records: ViolationRecord[];
    sanction: ReturnType<typeof decideSanction>;
    /** Notices not answered so far (the second one ends in an arrest). */
    strikes: number;
  };
  let appointments: Appointment[] = [];
  let policeData: {
    stations: Array<[number, number, string]>;
    centres: Array<[number, number, string]>;
  } | null = null;
  void fetch(`${import.meta.env.BASE_URL}data/police.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (policeData = d))
    .catch(() => undefined);
  const nearestOf = (list: Array<[number, number, string]>, lat: number, lon: number): Place | null => {
    let best: Place | null = null;
    let bestD = Infinity;
    for (const [plon, plat, name] of list) {
      const d = haversineMeters(lat, lon, plat, plon);
      if (d < bestD) {
        bestD = d;
        best = { name, lat: plat, lon: plon };
      }
    }
    return best;
  };
  /** 17:00 on the game's current day: the counter closes. */
  const closingTime = () => jstDateAt(17, env.now()).getTime();
  const deadlineText = (t: number) => {
    const d = new Date(t + 9 * 3600_000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
  };
  /** Go to the next appointment, if any, as the day's destination. */
  const nextAppointment = (): boolean => {
    const a = appointments[0];
    if (!a) return false;
    const g = frame.toGeodetic(vehicle.position());
    missions.startAppointment(a.place, performance.now(), g.lat, g.lon);
    const what = i18n.t(a.kind === "sanction" ? "toast.appointSanction" : "toast.appointNotice");
    toast(
      i18n.t("toast.appointment", { what, place: a.place.name, deadline: deadlineText(a.deadline) }),
      "#ffb347",
    );
    return true;
  };
  const officeDialog = $<HTMLDialogElement>("#office-dialog");
  const showOffice = (title: string, body: string, actions: Array<[string, () => void]>) => {
    $("#office-title").textContent = title;
    $("#office-body").textContent = body;
    $("#office-actions").replaceChildren(
      ...actions.map(([label, run]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", () => {
          officeDialog.close();
          run();
        });
        return b;
      }),
    );
    officeDialog.showModal();
  };
  /** The 処分 is carried out: the licence is handed in, points cleared, and it becomes 前歴. */
  const executeSanction = (sanction: ReturnType<typeof decideSanction>, withCourse: boolean) => {
    if (sanction.kind === "suspension") suspendedDays = sanction.days - (withCourse ? sanction.shortened : 0);
    else if (sanction.kind === "revocation") suspendedDays = 365 * sanction.years;
    prior++;
    law.state.points = 0;
    law.state.suspended = suspendedDays > 0;
    log("sanction", { kind: sanction.kind, suspendedDays, course: withCourse, prior });
  };
  /** At the counter: the notice is dealt with, or the licence is handed in. */
  const appear = () => {
    const a = appointments.shift();
    if (!a) return;
    if (a.kind === "notice") {
      const isRed = a.records.some((r) => r.fine === null);
      const labels = listOf(a.records.map((r) => violationName(r.label)));
      showOffice(
        i18n.t("dialog.officeAppeared", { place: a.place.name }),
        isRed ? i18n.t("dialog.officeRed") : i18n.t("dialog.officeBlue", { labels }),
        [[i18n.t("dialog.ok"), () => nextAppointment()]],
      );
      return;
    }
    const s = a.sanction;
    const days = s.kind === "suspension" ? s.days : 0;
    const body =
      s.kind === "suspension"
        ? i18n.t("dialog.suspensionBody", { days, short: s.shortened })
        : i18n.t("dialog.revocationBody");
    const done = (withCourse: boolean) => {
      executeSanction(s, withCourse);
      // Out of the driver's seat: the car stays here.
      if (mode === "car") input.trigger("door");
      const isShortened = withCourse && s.kind === "suspension";
      const left = { days: daysText(suspendedDays) };
      toast(i18n.t(isShortened ? "toast.courseDone" : "toast.sanctionStarted", left), "#ff6b6b");
      nextAppointment();
    };
    showOffice(
      i18n.t("dialog.officeAppeared", { place: a.place.name }),
      body,
      s.kind === "suspension"
        ? [
            [i18n.t("dialog.takeCourse"), () => done(true)],
            [i18n.t("dialog.skipCourse"), () => done(false)],
          ]
        : [[i18n.t("dialog.ok"), () => done(false)]],
    );
  };
  /** Past 17:00 without appearing. */
  const checkDeadlines = () => {
    const a = appointments[0];
    if (!a || env.now().getTime() < a.deadline) return;
    if (a.kind === "sanction") {
      appointments.shift();
      executeSanction(a.sanction, false);
      notify("police", () => i18n.t("notify.sanctionExecuted"));
      if (mode === "car") input.trigger("door");
      return;
    }
    a.strikes++;
    if (a.strikes >= 2) {
      appointments.shift();
      showArrest(
        "notice",
        a.records.map((r) => r.label),
      );
      return;
    }
    a.deadline = closingTime() + 24 * 3600_000;
    toast(
      i18n.t("toast.missedNotice", { deadline: deadlineText(a.deadline), place: a.place.name }),
      "#ff6b6b",
    );
  };
  $("#day-next").addEventListener("click", () => {
    env.startNextDay(8);
    // The day's appointments, from the post: the 行政処分 at the licence centre and the
    // notices at the police station, both by 17:00 today.
    const g = home ?? frame.toGeodetic(vehicle.position());
    const deadline = closingTime();
    const delivered = todayDelivered;
    todayDelivered = [];
    const station = policeData ? nearestOf(policeData.stations, g.lat, g.lon) : null;
    const centre = policeData ? nearestOf(policeData.centres, g.lat, g.lon) : null;
    if (pendingSanction.kind !== "none" && centre)
      appointments.push({
        kind: "sanction",
        place: centre,
        deadline,
        records: [],
        sanction: pendingSanction,
        strikes: 0,
      });
    else if (pendingSanction.kind !== "none") executeSanction(pendingSanction, false);
    if (delivered.length && station)
      appointments.push({
        kind: "notice",
        place: station,
        deadline,
        records: delivered,
        sanction: { kind: "none" },
        strikes: 0,
      });
    pendingSanction = { kind: "none" };
    if (suspendedDays > 0) suspendedDays--;
    law.state.suspended = suspendedDays > 0;
    todayMetres = 0;
    todayFrom = law.state.log.length;
    $<HTMLDialogElement>("#day-end").close();
    vehicle.setFrozen(false);
    if (nextAppointment()) return;
    if (law.state.suspended) {
      toast(i18n.t("toast.suspendedToday", { days: daysText(suspendedDays) }), "#ff6b6b");
      return;
    }
    const pos = frame.toGeodetic(vehicle.position());
    const trip = missions.startTrip(pos.lat, pos.lon, performance.now());
    if (trip)
      toast(
        i18n.t("toast.todayTrip", { name: trip.target.name, km: (trip.startDistance / 1000).toFixed(1) }),
        "#ffe14d",
      );
  });
  // 違反の記録 is kept in this browser: every violation, saved as it happens and as it changes.
  let history: ViolationRecord[] = [];
  void loadViolations().then((saved) => (history = saved));
  const violationSync = new ViolationSync();
  setInterval(() => {
    const changed = violationSync.changed(law.state.log);
    if (changed.length === 0) return;
    const known = new Set([...history.map((r) => r.id), ...law.state.log.map((r) => r.id)]);
    // Timed until the transaction is done (IndexedDB copies each record, screen JPEG and replay included).
    void perf.span("violations.save", saveViolations(changed, known.size));
  }, 2000);
  /** Play a saved violation: rebuild its traffic and people and run it through the replay. */
  const playClip = (r: ViolationRecord) => {
    const clip = r.replay;
    if (!clip) return;
    const pose = new ClipPose(clip, frame);
    const rec = new ReplayRecorder();
    const actors = clip.actors.map((a) => buildActor(a.desc));
    for (let i = 0; i < clip.count; i++) {
      const t = i * clip.step;
      const pos = new Vector3();
      const quat = new Quaternion();
      const speed = pose.car(t, pos, quat);
      const others = new Map<Object3D, Pose>();
      actors.forEach((o, k) => {
        const p = o && pose.actor(k, t);
        if (o && p) others.set(o, p);
      });
      rec.frames.push({
        t: clip.t0 + t,
        car: { x: pos.x, y: pos.y, z: pos.z, qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w, speed },
        others,
      });
    }
    startReplay(clip.t0, {
      rec,
      marks: [{ at: clip.at, label: r.label, why: replayWhy(r) }],
      moment: clip.moment,
    });
  };
  /** A model like the one recorded (vehicle kind, car colour, person's looks). */
  const buildActor = (d: ActorDesc): Object3D | null => {
    if (d.type === "vehicle") return createVehicle(d.kind)?.object ?? null;
    if (d.type === "lowCar") return createLowCar({ color: d.color, taxi: d.taxi });
    return createHuman(d.colors, d.height, d.variant).root;
  };
  // Each violation keeps 5 s either side of it, cut from the recording once the after part is in.
  setInterval(() => {
    const now = performance.now();
    for (const r of law.state.log) {
      const isReady = !r.replay && r.session === SESSION && now >= r.at + CLIP_AFTER_MS;
      if (!isReady) continue;
      const moment = { ms: env.now().getTime() - (now - r.at), raining: env.isRaining() };
      r.replay =
        perf.time("clip.cut", () => cutClip(recorder.frames, r.at, frame, { onFoot: false, moment })) ??
        undefined;
      if (r.replay)
        log("replay_clip_saved", { violationId: r.id ?? "", samples: r.replay.count }, violationSpan(r));
    }
  }, 1000);
  const openReview = () => {
    // Earlier sessions' records first (from this browser's history), then today's.
    const current = new Set(law.state.log.map((r) => r.id));
    const all = [...history.filter((r) => !current.has(r.id)), ...law.state.log];
    renderReview($("#violations-list"), all, (r) => {
      const isThisSession = r.session === undefined || r.session === SESSION;
      const isInBuffer = isThisSession && r.at >= recorder.start && r.at <= recorder.end;
      if (!isInBuffer) {
        // Older than the last 5 minutes, or from an earlier session: its saved clip.
        if (!r.replay) return false;
        $<HTMLDialogElement>("#violations").close();
        playClip(r);
        return true;
      }
      $<HTMLDialogElement>("#violations").close();
      startReplay(Math.max(recorder.start, r.at - 6000));
      return true;
    });
    const s = law.state;
    const earlier = all.length - s.log.length;
    const summary = { n: s.log.length, earlier, points: s.points, fines: formatNumber(s.fines) };
    i18n.bindText($("#violations-summary"), () =>
      i18n.t(earlier > 0 ? "dialog.reviewSummaryEarlier" : "dialog.reviewSummary", summary),
    );
    $<HTMLDialogElement>("#violations").showModal();
  };
  $("#review-open").addEventListener("click", openReview);
  $("#review-from-suspension").addEventListener("click", openReview);
  /** `labels`: the records' Japanese labels behind a notice-to-appear arrest. */
  const showArrest = (why: "hitAndRun" | "hitAndRunLater" | "notice", labels: readonly string[] = []) => {
    vehicle.setFrozen(true);
    const isNotice = why === "notice";
    // The stamp is drawn in the world's own Japanese, like a hanko: not translated (what it says
    // is written under it in the player's language).
    stamps.stamp(
      "逮捕",
      isNotice ? "出頭要請に応じず" : "救護義務違反（ひき逃げ）",
      true,
      inPlayersWords(isNotice ? "stamp.reading.arrestSummons" : "stamp.reading.arrestHitAndRun"),
    );
    // Keys, not textContent: the elements carry data-i18n, which a switch would otherwise re-apply.
    i18n.setI18nText($("#suspended h1"), isNotice ? "arrest.title" : "arrest.titleHitAndRun");
    const tagline: i18n.MessageKey = isNotice
      ? "arrest.taglineNotice"
      : why === "hitAndRunLater"
        ? "arrest.taglineLater"
        : "arrest.taglineCaught";
    i18n.setI18nText($("#suspended .tagline"), tagline);
    const points = law.state.points;
    const lines: Array<() => string> = isNotice
      ? [
          () => i18n.t("arrest.noticeDetail", { detail: listOf(labels.map(violationName)) }),
          () => i18n.t("arrest.noticeSummons"),
          () => i18n.t("arrest.noticeAdvice"),
        ]
      : [
          () => i18n.t("arrest.hitAndRunDuty"),
          () => i18n.t("arrest.hitAndRunPenalty"),
          () => i18n.t("arrest.hitAndRunPoints", { points }),
          () => i18n.t("arrest.hitAndRunAdvice"),
        ];
    $("#suspended-log").replaceChildren(
      ...lines.map((render) => {
        const li = document.createElement("li");
        i18n.bindText(li, render);
        return li;
      }),
    );
    i18n.setI18nText($("#retrain"), "arrest.restart");
    $("#suspended").hidden = false;
  };
  $("#retrain").addEventListener("click", () => {
    law.reset();
    $("#suspended").hidden = true;
    vehicle.setFrozen(false);
    respawnHere();
    toast(i18n.t("toast.retrained"), "#7dff9a");
  });

  // Accident handling: penalty points via the traffic-law model plus a score deduction.
  const updateIncidentPanel = (now: number) => {
    const panel = $("#incident");
    panel.hidden = !emergency.active;
    if (!emergency.active) return;
    const part = (kind: "ambulance" | "police", key: i18n.MessageKey, number: string) => {
      const label = i18n.t(key);
      if (!emergency.isCalled(kind)) {
        // On the line already: the operator sends the vehicle once they know the place and what
        // happened (ai/dispatch.ts hasEnoughInfo) — said here, as the call alone sends nothing.
        const isOnThisLine = phone.calling === number;
        return i18n.t(isOnThisLine ? "incident.tellPlace" : "incident.unreported", { label, number });
      }
      const way = emergency.enRoute(kind);
      if (!way) return i18n.t("incident.arrived", { label });
      const distance =
        way.metres >= 950 ? `${(way.metres / 1000).toFixed(1)} km` : `${Math.round(way.metres / 10) * 10} m`;
      const time =
        way.seconds >= 90
          ? i18n.t("incident.minutes", { m: Math.round(way.seconds / 60) })
          : i18n.t("incident.seconds", { s: way.seconds });
      return i18n.t("incident.onTheWay", { label, distance, time });
    };
    const left = emergency.isCalled("ambulance")
      ? ""
      : i18n.t("incident.left", { s: emergency.secondsLeft(now) });
    $("#incident-status").textContent =
      `${part("ambulance", "incident.ambulance", "119")}${left}　${part("police", "incident.police", "110")}`;
  };

  /**
   * What the car hit, from the collider: traffic and anything moving, or a parked car (a car-sized
   * box), is a vehicle; a building's or landmark's walls a building; a thin post a pole (signal,
   * sign, orbis); the terrain and paving (trimeshes) the ground. Why from the shape: the colliders
   * come from many modules, and only the building and traffic ones keep a list of their own.
   */
  const hitKind = (handle: number): "vehicle" | "building" | "pole" | "ground" => {
    if (traffic.isAiCollider(handle)) return "vehicle";
    if (buildings.isCollider(handle)) return "building";
    const collider = world.getCollider(handle);
    if (!collider) return "ground";
    const isMoving = collider.parent() !== null && !collider.parent()?.isFixed();
    if (isMoving) return "vehicle";
    const shape = collider.shape;
    if (shape instanceof RAPIER.Cuboid) {
      const h = shape.halfExtents;
      const isCarSized = h.x > 0.6 && h.z > 1.5 && h.y < 1.6;
      if (isCarSized) return "vehicle";
      const isThin = Math.min(h.x, h.z) < 0.4;
      return isThin ? "pole" : "building";
    }
    const isPost = shape instanceof RAPIER.Cylinder || shape instanceof RAPIER.Capsule;
    return isPost ? "pole" : "ground";
  };
  /**
   * The blow on a body with a mass when the step's own record missed it (the contact began before
   * massContacts saw a point): head-on, at the car's speed, with the same restitution.
   */
  const impactAgainstMass = (handle: number, kmh: number): Impact | null => {
    const body = massContacts.bodyOf(handle);
    if (!body) return null;
    const closing = kmh / 3.6;
    const carKg = vehicle.massKg;
    const e = restitution(closing, body.kind);
    const { dv1, dv2, energy } = centralImpact(carKg, body.mass, closing, e);
    return { closing, dvCar: dv1, dvOther: dv2, energy, carKg, otherKg: body.mass };
  };
  const onAccident = (
    kind: "pedestrian" | "vehicle" | "building" | "pole",
    kmh: number,
    who: string,
    impact: Impact | null = null,
  ) => {
    social.note("crash", env.now().getTime());
    pursuitDirector.onCrash();
    const careless = book(VIOLATIONS.safeDriving, performance.now(), 3000);
    // A crash with the phone in hand is the 交通の危険 form of ながら運転 (6 points, no 反則金).
    if (phone.isInUse(performance.now()) && mode === "car")
      book(VIOLATIONS.phoneDanger, performance.now(), 30000, inJapanese("violationDetail.phoneCrash"));
    if (kind === "pedestrian") {
      // How badly they are hurt goes with the speed the blow gave them (Δv from both masses).
      const injury = book(injuryViolation(impact ? impact.dvOther * 3.6 : kmh), performance.now(), 3000);
      // In a pursuit: 過失運転致傷 or 危険運転致傷 (自動車運転死傷処罰法), pursuitDirector.ts.
      pursuitDirector.onInjury(
        kmh,
        injury,
        [careless, injury].filter((r): r is ViolationRecord => r !== null),
      );
    }
    const penalty = kind === "pedestrian" ? 300 : 100;
    score = Math.max(0, score - penalty);
    const what = i18n.t(ACCIDENT_KEY[kind], { name: who });
    toast(i18n.t("toast.accident", { what, kmh: Math.round(kmh), penalty }), "#ff6b6b");
    log("accident", {
      kind,
      speedKmh: Math.round(kmh),
      ...(impact && {
        otherDeltaVKmh: Math.round(impact.dvOther * 36) / 10,
        carDeltaVKmh: Math.round(impact.dvCar * 36) / 10,
        energyKj: Math.round(impact.energy / 100) / 10,
        otherMassKg: Math.round(impact.otherKg),
      }),
    });
  };

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  /**
   * In-game clock: date, weekday and time, as the regulations see them, in Japanese whatever the
   * language: the records keep it (law.ts recordClock() shows it translated). The HUD's own is
   * renderClock().
   */
  const clockLabel = (clock: GameClock, date: { m: number; d: number }) => {
    const hh = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
    const mm = String(Math.floor(clock.minutes % 60)).padStart(2, "0");
    return `${date.m}/${date.d}(${WEEKDAYS[clock.weekday]}${clock.holiday ? "・祝" : ""}) ${hh}:${mm}`;
  };

  let wasRaining: boolean | null = null;
  const updateHud = (lat: number, lon: number, yaw: number, now: number) => {
    $("#ward").textContent = wardName;
    $("#town").textContent = townName || " ";
    renderClock($("#clock"), gameClockNow(), tokyoDate(env.now()));
    const obs = env.getObservation();
    const obsText = obs
      ? i18n.t("hud.weatherObs", {
          temp: obs.temp ?? "-",
          wind: obs.wind ?? "-",
          precip: obs.precip10m ?? "-",
          time: obs.time,
        })
      : i18n.t("hud.weatherLoading");
    const isRaining = env.isRaining();
    const weatherText =
      env.weather === "auto"
        ? i18n.t("hud.weatherAuto", { sky: i18n.t(isRaining ? "weather.label.rain" : "weather.label.clear") })
        : i18n.t("hud.weatherFixed", { sky: i18n.t(WEATHER_KEY[env.weather]) });
    $("#weather").textContent = env.weather === "real" ? obsText : weatherText;
    // おまかせ turned: said once, as the sky changes.
    const isTurned = env.weather === "auto" && wasRaining !== null && isRaining !== wasRaining;
    if (isTurned) toast(i18n.t(isRaining ? "toast.rainStart" : "toast.rainStop"), "#4dd2ff");
    wasRaining = isRaining;
    const nearestBus = transit.nearest(lat, lon);
    $("#transit").textContent =
      nearestBus && nearestBus.distance < 120 ? `🚌 ${nearestBus.bus.note.split(" ")[0]}` : transit.status;

    $("#score").textContent = formatNumber(score);
    const ahead =
      mode === "foot" ? null : control.ahead(vehicle.position(), headingVector(vehicle.quaternion()));
    const aheadM = ahead ? Math.round(ahead.dist) : 0;
    const aheadText = ahead
      ? ahead.approach.kind === "signal"
        ? i18n.t("hud.signalAhead", { light: i18n.t(LIGHT_KEY[control.state(ahead.approach)]), m: aheadM })
        : i18n.t("hud.stopAhead", { m: aheadM })
      : currentOneway
        ? i18n.t("hud.oneWay")
        : "";
    const regAhead = $("#reg-ahead");
    regAhead.hidden = aheadText === "";
    regAhead.textContent = aheadText;
    regAhead.dataset.state =
      ahead?.approach.kind === "signal" ? control.state(ahead.approach) : (ahead?.approach.kind ?? "");
    $("#license-points").textContent = i18n.t("hud.licensePoints", { points: law.state.points });
    $("#license-fines").textContent = i18n.t("hud.licenseFines", { fines: formatNumber(law.state.fines) });
    const inWard = pois.filter((p) => p.ward === wardName);
    const wardDone = inWard.filter((p) => field.collected.has(p.id)).length;
    const found = { found: formatNumber(field.collected.size), total: formatNumber(pois.length) };
    $("#collected").textContent = inWard.length
      ? i18n.t("hud.collectedWard", {
          ...found,
          ward: wardName,
          wardDone,
          wardTotal: wardTotals.get(wardName) ?? 0,
        })
      : i18n.t("hud.collected", found);

    const mission = missions.current;
    if (mission) {
      const d = haversineMeters(lat, lon, mission.target.lat, mission.target.lon);
      const cat = field.category(mission.target.category);
      // Home is named by the game (missions.ts: 「自宅」), the spots by the data.
      const isHome = mission.target.category === "home";
      $("#mission-name").textContent = isHome ? i18n.t("warp.home") : mission.target.name;
      const left = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      const clock = mission.isTrip
        ? i18n.t("hud.missionTrip")
        : i18n.t("hud.missionSeconds", { s: Math.max(0, Math.ceil(missions.remaining(now))) });
      const category = categoryLabel(mission.target.category, cat?.label ?? "");
      $("#mission-meta").textContent = i18n.t("hud.missionMeta", {
        category,
        ward: mission.target.ward,
        left,
        clock,
      });
    } else {
      $("#mission-name").textContent = QUALITY.isMobile
        ? i18n.t("hud.missionStartTouch")
        : i18n.t("hud.missionStartKey", { key: keyOf("mission") });
      $("#mission-meta").textContent = i18n.t("hud.nearbySpots", { n: field.visibleList().length });
    }

    // Heading clockwise from north; local yaw 0 faces +Z (= south).
    const heading = Math.PI - yaw;
    minimap.draw({
      lat,
      lon,
      heading,
      northUp: prefsNow.minimapNorthUp,
      radius: 600,
      pois: field.visibleList(),
      target: mission?.target ?? null,
      buses: transit.positionsNear(lat, lon, 700),
      route: nav.route ? navGeo.points : undefined,
      incident: emergency.scene ? frame.toGeodetic(emergency.scene) : null,
      responders: (["ambulance", "police"] as const).flatMap((kind) => {
        const way = emergency.enRoute(kind);
        return way ? [{ kind, ...frame.toGeodetic(way.position) }] : [];
      }),
      taxi:
        taxi && (taxi.state === "coming" || taxi.state === "waiting")
          ? {
              ...frame.toGeodetic(taxi.position),
              heading: Math.PI - taxi.car.yaw(),
              route: taxi.state === "coming" ? taxi.routeAhead().map((p) => frame.toGeodetic(p)) : [],
            }
          : null,
    });
  };

  if (import.meta.env.DEV) {
    // Debug handle for local inspection only; stripped from production builds.
    /**
     * Staging the pursuit and its aftermath for checks in the dev build (window.__game.debug.pursuit):
     * a unit 30 m behind sees a red-light run and lights up; `flee` jumps the chase on as if the
     * driver had not stopped for that long (30 s: 緊急配備, 60 s: the helicopter and the 検問); `end`
     * finishes it a given way; `identify` brings the identification after a getaway forward.
     */
    const debugPursuit = {
      start: (kind: PatrolKind = "patrol", violation: keyof typeof VIOLATIONS = "signal") => {
        const tw = taxiWorld();
        if (!tw || !roadGraph || pursuitDirector.busy) return false;
        // 30 m behind the car, or further back if a unit (the last stop's, leaving) or a car is there.
        const back = headingVector(vehicle.quaternion());
        const spot = [30, 38, 46, 55]
          .map((d) => vehicle.position().addScaledVector(back, -d))
          .find((p) => isSpotClear(p, 5));
        if (!spot) return false;
        const unit = spawnPatrol(kind, vehicle.position());
        if (!unit) return false;
        unit.placeAt(spot, vehicle.yaw());
        unit.state = "cruising";
        const record = law.commit(VIOLATIONS[violation], performance.now(), 0, violationContext());
        if (!record) return false;
        police = unit;
        if (unit.witness(record) === "pursuit") startPursuit();
        return true;
      },
      /** Driving while suspended (to see a 第67条 stop): the licence suspended for `days`. */
      suspend: (days = 30) => {
        suspendedDays = days;
        law.state.suspended = true;
        return true;
      },
      flee: (seconds = 30) => pursuitDirector.debugAdvance(seconds),
      end: (how: Parameters<PursuitDirector["debugEnd"]>[0] = "gaveUp") => pursuitDirector.debugEnd(how),
      identify: () => pursuitDirector.debugIdentifyNow(),
      story: (kind: Parameters<PursuitDirector["debugStory"]>[0] = "arrest") =>
        pursuitDirector.debugStory(kind, law.state.log.slice(-4)),
      state: () => ({
        mode: pursuitDirector.chase
          ? "chase"
          : pursuitDirector.stop
            ? "stop"
            : pursuitDirector.story
              ? "story"
              : pursuitDirector.identify
                ? "identify"
                : null,
        heli: pursuitScene.heli.describe(
          pursuitDirector.chase?.lastSeen ?? null,
          groundY(pursuitScene.heli.root.position.x, pursuitScene.heli.root.position.z) ?? 0,
        ),
        heliToCar: Math.round(pursuitScene.heli.root.position.distanceTo(vehicle.position())),
        chase: pursuitDirector.chase
          ? {
              stage: pursuitDirector.chase.esc.stage,
              fleeing: pursuitDirector.chase.esc.fleeing,
              elapsed: Math.round(pursuitDirector.chase.esc.elapsed),
              units: pursuitDirector.chase.units.size,
              heli: pursuitScene.heli.state,
              checkpoint: pursuitScene.checkpoint.active,
            }
          : null,
        stop: pursuitDirector.stop
          ? {
              end: pursuitDirector.stop.end,
              disposal: pursuitDirector.stop.disposal,
              step: pursuitDirector.stop.steps[pursuitDirector.stop.at]?.id,
            }
          : null,
        story: pursuitDirector.story?.kind ?? null,
        identifyIn: pursuitDirector.identify ? Math.round(pursuitDirector.identify.left) : null,
        enforcing: enforcing(),
      }),
    };
    /**
     * Measuring the hitch of a violation (window.__game.debug.perf). `violation(kind, media, seconds)`
     * books one in the next frame with a bystander's post in that medium (photo or video: both are
     * shot), and reports the frames of the second before (`before`) and of `seconds` after it
     * (`after`: the longest gap and when, p50/p95, how many over 25 and 50 ms), each phase timed
     * meanwhile (perf.ts; `blocking` false is a wait on the GPU or the worker, not main-thread work)
     * and Chrome's long animation frames with their longest scripts. `spread(false)` puts the post,
     * the shot's renders, the developing and the screen grab back in the violation's frame, as
     * before (an A/B in one build); `spread(true)` spreads them again.
     */
    const debugPerf = {
      violation: async (
        kind: keyof typeof VIOLATIONS = "signal",
        media: "photo" | "video" = "video",
        seconds = 7,
      ) => {
        if (state !== "playing") return { error: "start a drive first (state is not playing)" };
        const before = frameStats(await watchFrames(1000));
        const t0 = performance.now();
        const watching = longFramesDuring(t0, watchFrames(seconds * 1000));
        // In a frame, as a violation is (after that frame's own update and render).
        const booked = await new Promise<ViolationRecord | null>((resolve) =>
          requestAnimationFrame(() => {
            forcedPost = media;
            try {
              resolve(book(VIOLATIONS[kind], performance.now(), 0));
            } finally {
              forcedPost = null;
            }
          }),
        );
        const { result, long } = await watching;
        const phases = perf.since(t0).map((p) => ({ ...p, ms: round(p.ms), at: round(p.at - t0) }));
        const totals: Record<string, { n: number; sum: number; max: number }> = {};
        for (const p of phases) {
          const t = (totals[p.phase] ??= { n: 0, sum: 0, max: 0 });
          t.n++;
          t.sum = round(t.sum + p.ms);
          t.max = Math.max(t.max, p.ms);
        }
        const post = social.posts.find((p) => p.record === booked) ?? null;
        return {
          booked: booked?.kind ?? null,
          spread: isSpread,
          // When it went up and when its photo came in: the phases post.publish and shot.develop (at + ms).
          post: post ? { media: post.media, hasPhoto: Boolean(post.photo) } : null,
          before,
          after: frameStats(result),
          totals,
          phases,
          long,
        };
      },
      spread: (on = true) => {
        isSpread = on;
        witnessShot.gate.isOpen = !on;
        darkroom.inline = !on;
        return on;
      },
      /** The phases timed in the last `ms` (perf.ts). */
      phases: (ms = 10000) => perf.since(performance.now() - ms),
    };
    // Background tabs pause rAF; `advance` lets automated checks drive frames explicitly.
    // MessageChannel yields to network/decoder tasks without hidden-tab timer throttling.
    const yieldTask = () =>
      new Promise<void>((r) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(0);
      });
    const advance = async (seconds: number, keys: string[] = []) => {
      for (const code of keys) window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) {
        step(performance.now());
        await yieldTask();
      }
      for (const code of keys) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    };
    Object.assign(window, {
      __game: {
        scene,
        camera,
        renderer,
        renderInfo,
        composer,
        bloom,
        lensFlare,
        world,
        terrain,
        water,
        buildings,
        vehicle,
        audio,
        dem,
        field,
        env,
        missions,
        transit,
        advance,
        start: () => startButton.click(),
        pedestrians,
        traffic,
        control,
        getRoadGraph: () => roadGraph,
        emergency,
        phone,
        law,
        walker,
        ribbon,
        getAutopilot: () => autopilot,
        pavements,
        getTaxi: () => taxi,
        getPolice: () => police,
        getPatrols: () => patrols,
        getMission: () => missions.current,
        furniture,
        streetLights,
        orbis,
        guideSigns,
        groundY,
        // Staging for the teaser and tests: the screens behind events that take long to set up.
        debug: {
          roads: {
            builder: roadBuilder,
            surface: roadSurface,
            rebuild: buildRoadNetwork,
            input: () => ({ lines: roadLines, regs: roadRegs, origin: frame.origin }),
            recenter: () => recenter(true),
            warp: warpTo,
          },
          openTicket,
          endDay,
          flashScreen,
          startPursuit,
          gameNow: () => env.now().getTime(),
          pursuit: debugPursuit,
          perf: debugPerf,
          // The last 2,000 log lines: logs.query({ event: /^pursuit_/ }), logs.chain("vio-…"), logs.jsonl().
          logs: recentLogs,
        },
        getPursuit: () => pursuitDirector,
        social,
        witnessPhones,
        getHome: () => home,
        getMode: () => mode,
        nav,
        patrol,
        stamps,
        getApplied: () => roadApplied,
        getRegs: () => roadRegs,
        speedLimit,
        planRoute,
        isInForce,
        parkingPlace,
        getFrame: () => frame,
        getState: () => state,
        naviTv,
        mirrorCharms,
        setDebugCamera: (fn: typeof debugCamera) => (debugCamera = fn),
      },
    });
  }
  requestAnimationFrame(tick);
}

main().catch((error: unknown) => {
  captureFailure("fatal", error);
  setLoading(() => i18n.t("loading.failed", { error: String(error) }), 0);
});
