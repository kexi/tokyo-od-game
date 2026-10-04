import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACESFilmicToneMapping,
  DoubleSide,
  Frustum,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { z } from "zod";
import { RECENTER_DISTANCE, SPAWN, TERRAIN_ZOOM } from "./config";

const SPAWN_DEFAULT = { ...SPAWN, label: "東京駅 丸の内" };
import { QUALITY } from "./device";
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
import { loadCarModels } from "./game/carModel";
import { Speedometer } from "./game/speedometer";
import { ParkingPatrol } from "./game/parkingPatrol";
import { GROUND_QUERY_GROUPS } from "./physics/groups";
import { Stamps, shortLabel } from "./game/stamp";
import { NavGuide } from "./game/navGuide";
import { CLOSURE_WORDS } from "./world/closures";
import { jstDateAt } from "./geo/sun";
import { gameClock, inForce as isInForceTime, timeNote, tokyoDate, type GameClock } from "./world/ruleTime";
import { classifyTurn, laneAllows, laneIndex, planRoute, TURN_WORDS } from "./game/navigation";
import { RouteArrows } from "./game/routeArrows";
import { RoboTaxi, type TaxiWorld } from "./game/robotaxi";
import { AutoDriver, keepLeftOffset } from "./game/autoDriver";
import { loadSignalModels } from "./world/signalModels";
import { SidewalkNetwork } from "./world/sidewalks";
import { KERB, Pavements, PavementTiles, type PavementPolygon } from "./world/pavements";
import { initStartPicker, readStart } from "./game/startPoint";
import { renderCredits } from "./game/credits";
import { Input } from "./game/input";
import { Minimap } from "./game/minimap";
import { Missions } from "./game/missions";
import { PoiField, storageKeyFor } from "./game/pois";
import { log, warn } from "./log";
import { Vehicle, type DriveInput } from "./physics/vehicle";
import { Buildings } from "./world/buildings";
import { DemStore } from "./world/dem";
import {
  Environment,
  TIME_LABEL,
  TIME_MODES,
  WEATHER_LABEL,
  type TimeMode,
  type WeatherMode,
} from "./world/environment";
import { Terrain } from "./world/terrain";
import { Pedestrians } from "./world/pedestrians";
import {
  RegulationTiles,
  applyRegulations,
  isInForce,
  type AppliedRegulations,
  type LaneUse,
  type RegulationData,
} from "./world/regulations";
import { RoadGraph, leftOf, speedLimit, type RoadLine, type Segment } from "./world/roads";
import { RoadSurface } from "./world/roadSurface";
import { RoadTiles } from "./world/roadTiles";
import { TrafficControl } from "./world/trafficControl";
import { TrafficSigns, loadSignModels } from "./world/signs";
import { loadHumanModels } from "./world/human";
import { loadFacadeTextures } from "./world/facade";
import { TrafficAI } from "./world/traffic-ai";
import {
  formatViolation,
  injuryViolation,
  speedViolation,
  TrafficLaw,
  VIOLATIONS,
  type Violation,
  type ViolationContext,
  type ViolationRecord,
} from "./game/traffic";
import { renderReview } from "./game/violationReview";
import { PolicePatrol } from "./game/policePatrol";
import { adviceFor } from "./game/drivingTips";
import { decideSanction } from "./game/sanctions";
import { EmergencyResponse, loadAmbulanceModel } from "./game/emergency";
import { Phone } from "./game/phone";
import { Transit } from "./world/transit";
import { fetchTokyoObservation } from "./world/weather";

const LIGHT_LABEL = { green: "青", yellow: "黄", red: "赤" } as const;

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
    warn("data_load_failed", { name, error: String(error) });
    return null;
  }
}

function setLoading(text: string, progress: number): void {
  $("#loading-status").textContent = text;
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
  setLoading("物理エンジンを初期化中…", 0.04);
  await RAPIER.init();

  setLoading("東京都オープンデータを読み込み中…", 0.1);
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

  const renderer = new WebGLRenderer({
    canvas: $<HTMLCanvasElement>("#scene"),
    antialias: QUALITY.antialias,
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(QUALITY.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 40000);

  const dem = new DemStore(new Geoid(geoidGrid));
  setLoading(`地形と 3D モデルを読み込み中…（スタート: ${spawn.label}）`, 0.18);
  await Promise.all([
    dem.load(
      Math.floor(lonToTileX(spawn.lon, TERRAIN_ZOOM)),
      Math.floor(latToTileY(spawn.lat, TERRAIN_ZOOM)),
    ),
    loadCarModels(),
    loadSignModels(),
    loadSignalModels(),
    loadAmbulanceModel(),
    loadHumanModels(),
    loadFacadeTextures(),
  ]);
  let frame = new LocalFrame(spawn.lat, spawn.lon, dem.heightAt(spawn.lat, spawn.lon) ?? 40);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const terrain = new Terrain(scene, world, dem, renderer, frame);
  const buildings = new Buildings(scene, world, camera, renderer, frame);
  const env = new Environment(scene, renderer);
  const vehicle = new Vehicle(world);
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
  scene.add(missions.arrow);
  const transit = new Transit(scene, world, dem, stopFile?.stops ?? {}, frame);
  const chase = new ChaseCamera(camera);
  const input = new Input();
  input.bindTouch($("#touch"));
  const audio = new GameAudio();
  const minimap = new Minimap($<HTMLCanvasElement>("#minimap"), categories);
  const walker = new Walker(scene, world);
  input.bindDrag($("#scene"));
  let mode: "car" | "foot" | "taxi" = "car";
  /** The 自動運転タクシー called from the phone, while one is about. */
  let taxi: RoboTaxi | null = null;
  /** 自動運転モード of the player's own car (with the mission target, or cruising about). */
  let autopilot: { driver: AutoDriver; cruising: boolean; input: DriveInput } | null = null;
  const focusPos = (target = new Vector3()) =>
    mode === "foot"
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
  const speedometer = new Speedometer($("#hud-speed"));
  const nav = new NavGuide($("#nav"), () => audio.muted);
  const ribbon = new RouteArrows(scene, (x, z) => groundY(x, z));
  let navGeo: { version: number; points: Array<{ lat: number; lon: number }> } = { version: -1, points: [] };
  const stamps = new Stamps($("#stamps"), () => audio.context, $("#scene"));
  const patrol = new ParkingPatrol(scene, (x, z) => groundY(x, z));
  /** A 確認標章 waiting for the driver's choice when they get back in. */
  let pendingParking: Violation | null = null;
  const law = new TrafficLaw();
  // Roads follow the rendered terrain (collider = render mesh), falling back to the DEM.
  const roadSurface = new RoadSurface(scene, (x, z) => {
    const g = groundY(x, z);
    if (g === null) return null;
    const hit = rayDown(x, z, g + 3);
    // Only accept hits near the DEM height: anything higher is a parked car or a building.
    return hit !== null && Math.abs(hit - g) < 0.6 ? hit : g;
  });
  let roadLines: RoadLine[] = [];
  let roadRegs: RegulationData | null = null;
  let roadApplied: AppliedRegulations | null = null;
  let roadGraph: RoadGraph | null = null;
  let roadCenter = { lat: 0, lon: 0 };
  let roadsLoading = false;
  /** The moment regulations are judged at: the game's date and time in Japan (曜日・祝日). */
  const gameClockNow = (): GameClock => {
    const minutes = env.displayHour(lastGeo.lat, lastGeo.lon) * 60;
    const { y, m, d } = tokyoDate(env.now());
    return gameClock(y, m, d, minutes);
  };
  /** Graph + JARTIC/OSM regulations + signals + markings for the current frame. */
  const buildRoadNetwork = () => {
    const graph = new RoadGraph(roadLines, frame);
    const applied = roadRegs ? applyRegulations(graph, roadRegs, frame) : null;
    roadApplied = applied;
    graph.setClock(gameClockNow());
    roadGraph = graph;
    traffic.setGraph(graph);
    control.rebuild(graph, applied);
    roadSurface.rebuild(graph, applied, control.approaches);
    signs.rebuild(graph, applied, control.approaches);
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
    );
    log("road_network", {
      segments: graph.segments.length,
      oneway: graph.segments.filter((s) => s.onewayRule).length,
      posted: graph.segments.filter((s) => s.limitKind !== "statutory").length,
      signals: control.signalCount(),
      stops: control.approaches.filter((a) => a.kind === "stop").length,
      crossings: applied?.crossings.length ?? 0,
      signs: applied?.signs.length ?? 0,
    });
  };
  const refreshRoads = (lat: number, lon: number) => {
    if (roadsLoading) return;
    roadsLoading = true;
    roadCenter = { lat, lon };
    void Promise.all([roadTiles.around(lat, lon), regulationTiles.around(lat, lon)])
      .then(([lines, regs]) => {
        roadLines = lines;
        roadRegs = regs;
        buildRoadNetwork();
      })
      .finally(() => (roadsLoading = false));
    // PLATEAU pavements come separately (larger tiles, only some wards): never hold up the roads.
    const wards = areas?.wardsIn(lon - 0.012, lat - 0.01, lon + 0.012, lat + 0.01) ?? [];
    void pavementTiles.around(lat, lon, wards).then((polys) => {
      pavementPolys = polys;
      pavements.rebuild(polys, frame);
      pedestrians.pavementsChanged();
      log("pavements", { wards, polygons: polys.length });
    });
  };
  const brain = new NpcBrain();
  const voice = new Voice(() => audio.context);
  const wardTotals = new Map<string, number>();
  for (const p of pois) wardTotals.set(p.ward, (wardTotals.get(p.ward) ?? 0) + 1);

  // ---------- helpers bound to the current frame ----------
  const groundY = (x: number, z: number): number | null => {
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
    const hit = graph.nearest(car, 150, isStreet);
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
  // The opening drive is set once the car stands on its street.
  let needsTrip = false;
  // Where the day starts and ends (the street the game put the car on).
  let home: { lat: number; lon: number } | null = null;
  // Today's driving, for the end-of-day record.
  let todayMetres = 0;
  let todayFrom = 0; // index into law.state.log where today began
  let odometerAt: Vector3 | null = null;
  // 行政処分: earlier 処分 (前歴) and the days of suspension still to serve.
  let prior = 0;
  let suspendedDays = 0;
  let unlicensedWarnedAt = -Infinity;
  let streetSpawnSince = 0;

  const respawnHere = () => {
    const p = vehicle.position();
    buildings.buildCollidersNear(p);
    vehicle.teleport(findOpenGround(p.x, p.z), carYaw(vehicle.quaternion()));
    chase.snap();
  };

  const recenter = () => {
    const pos = focusPos();
    const g = frame.toGeodetic(pos);
    const next = new LocalFrame(g.lat, g.lon, dem.heightAt(g.lat, g.lon) ?? g.h);
    const m = next.transformFrom(frame);
    const q = next.rotationFrom(frame);
    const offset = (p: Vector3) => p.applyMatrix4(m);
    vehicle.transform(offset, q);
    chase.transform(offset, q);
    camera.position.applyMatrix4(m);
    frame = next;
    terrain.setFrame(next);
    buildings.setFrame(next);
    field.setFrame(next);
    transit.setFrame(next);
    const f = new Vector3(0, 0, 1).applyQuaternion(q);
    pedestrians.transform(offset, Math.atan2(f.x, f.z));
    if (walker.active) walker.transform(offset, Math.atan2(f.x, f.z));
    traffic.transform(offset, Math.atan2(f.x, f.z));
    emergency.transform(offset);
    patrol.transform(offset);
    taxi?.transform(offset, Math.atan2(f.x, f.z));
    autopilot?.driver.transform(offset, Math.atan2(f.x, f.z));
    pavements.rebuild(pavementPolys, frame);
    buildRoadNetwork();
    log("frame_recentered", { lat: g.lat.toFixed(5), lon: g.lon.toFixed(5) });
  };

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
    toast(`時間帯: ${TIME_LABEL[next]}`);
  });
  input.on("weather", () => {
    const order: WeatherMode[] = ["real", "clear", "rain"];
    env.weather = order[(order.indexOf(env.weather) + 1) % order.length];
    toast(`天気: ${WEATHER_LABEL[env.weather]}`);
  });
  input.on("ground", () => {
    terrain.setStyle(terrain.getStyle() === "photo" ? "plateau" : "photo");
    toast(`地面: ${terrain.getStyle() === "photo" ? "地理院 全国最新写真" : "PLATEAU オルソ画像 2023"}`);
  });
  input.on("camera", () =>
    toast(`視点: ${{ chase: "追従", far: "俯瞰", hood: "ボンネット" }[chase.cycle()]}`),
  );
  input.on("mute", () => toast(audio.toggleMute() ? "サウンド オフ" : "サウンド オン"));
  input.on("reset", respawnHere);
  input.on("help", () => $<HTMLDialogElement>("#help").showModal());
  input.on("credits", () => {
    void regulationTiles.meta().then((regs) => {
      $("#credits-body").innerHTML = renderCredits(poiFile?.sources ?? [], regs);
      $<HTMLDialogElement>("#credits").showModal();
    });
  });
  input.on("mission", () => {
    const g = frame.toGeodetic(vehicle.position());
    const m = missions.start(g.lat, g.lon, performance.now());
    if (m) toast(`目的地: ${m.target.name}（${Math.round(m.startDistance)} m）`, "#ffe14d");
    else toast("近くに目的地候補がありません");
  });
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
  const emergency = new EmergencyResponse(
    scene,
    () => audio.context,
    (x, z) => groundY(x, z),
  );
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
  input.on("phone", () => phone.toggle());
  const conversation = new ConversationController(brain, voice, surroundings, (p) => pedestrians.endTalk(p));
  input.on("talk", () => {
    if (conversation.active || state !== "playing") return;
    const isStopped = mode === "foot" || Math.abs(vehicle.speedKmh()) < 4;
    const p = isStopped ? pedestrians.nearest(focusPos(), mode === "foot" ? 3.5 : 10) : null;
    if (!p) {
      toast(isStopped ? "近くに歩行者がいません" : "停車してから話しかけましょう");
      return;
    }
    pedestrians.startTalk(p, focusPos());
    conversation.open(p);
  });
  input.on("enter", () => (phone.inCall ? phone.focusInput() : conversation.focusInput()));
  input.on("autopilot", () => {
    if (state !== "playing") return;
    if (autopilot) stopAutopilot("自動運転を解除しました");
    else startAutopilot();
  });
  input.on("door", () => {
    if (state !== "playing") return;
    if (autopilot) {
      if (autopilot.driver.speed > 0.5) return toast("停車してから降りましょう");
      stopAutopilot("自動運転を解除しました");
    }
    if (mode === "taxi") {
      if (taxi && taxi.speed < 0.5) leaveTaxi();
      else toast("タクシーが止まるまでお待ちください");
      return;
    }
    if (mode === "foot" && taxi?.state === "waiting" && walker.position().distanceTo(taxi.position) < 5) {
      boardTaxi();
      return;
    }
    if (mode === "car") {
      if (Math.abs(vehicle.speedKmh()) > 5) {
        toast("停車してから降りましょう");
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
      toast("車を降りました（F で乗車・Shift で走る・Space でジャンプ・←→ やドラッグで視点）", "#4dd2ff");
      return;
    }
    if (walker.position().distanceTo(vehicle.position()) > 4.5) {
      toast("車のそばで F を押すと乗車します");
      return;
    }
    // Nothing physically stops a suspended driver; the law does. Ask twice.
    if (law.state.suspended && performance.now() - unlicensedWarnedAt > 5000) {
      unlicensedWarnedAt = performance.now();
      toast(
        `免許停止中です（あと ${suspendedDays} 日）。運転すると無免許運転（道路交通法 第64条）になります。それでも乗るならもう一度 F`,
        "#ff6b6b",
      );
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
    toast("乗車しました");
  });
  input.on("close", () => (phone.open ? phone.close() : conversation.close()));

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
    toast("エンジンを停止しました（東京都環境確保条例 第52条：アイドリング・ストップ）", "#7dff9a");
  };
  const contactCooldown = new Map<number, number>();
  const loadStart = performance.now();
  let lastBrainStatus = brain.status;
  const startButton = $<HTMLButtonElement>("#start");
  camera.position.set(-60, 90, 140);
  camera.lookAt(0, 30, 0);

  // Start-screen options: Gemma downloads in the background while playing (templates until ready).
  const optAi = $<HTMLInputElement>("#opt-ai");
  const optVoice = $<HTMLInputElement>("#opt-voice");
  const optAiNote = $("#opt-ai-note");
  void (async () => {
    const [support, cached] = await Promise.all([NpcBrain.support(), NpcBrain.isCached()]);
    if (!support.ok) {
      optAi.disabled = true;
      optAi.checked = false;
      optAiNote.textContent = `この端末では会話 AI を使えません（${support.reason}）。定型応答で話せます。`;
      return;
    }
    optAi.checked = NpcBrain.hasConsent();
    if (cached)
      optAiNote.textContent =
        "ダウンロード済みのモデルを使います（再ダウンロード不要）。端末内で動き、会話は外部に送信されません。";
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
    log("game_started", {});
    toast("光の柱＝東京都オープンデータの実在スポット。N キーで目的地ミッション！", "#4dd2ff");
  });

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    step(now);
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
      setLoading(
        groundReady
          ? `PLATEAU 3D 都市モデルを読み込み中… ${Math.round(tilesProgress * 100)}%`
          : "地形を構築中…",
        0.25 + 0.75 * (groundReady ? 0.3 + 0.7 * tilesProgress : 0),
      );
      const isReady = groundReady && (tilesProgress >= 0.999 || waited > 20000) && waited > 1500;
      if (isReady && state === "loading") {
        state = "ready";
        startButton.disabled = false;
        setLoading("準備完了！", 1);
      }
      renderer.render(scene, camera);
      return;
    }

    const isOnFoot = mode === "foot";
    const isInCar = mode === "car";
    const isInTaxi = mode === "taxi" && taxi !== null;
    // Once the streets are known, move the waiting car onto one — but never once the player has
    // started driving: stopped at a light later, the car would jump forward.
    // The kerb comes from PLATEAU paving, so wait for it (wards without it: give up after 10 s).
    const hasKerbs = pavements.count > 0 || now - streetSpawnSince > 10000;
    const hasDriven = Math.abs(vehicle.speedKmh()) > 2 || autopilot !== null;
    if (needsStreetSpawn && hasDriven) needsStreetSpawn = false;
    if (needsStreetSpawn && roadGraph && hasKerbs && isInCar) needsStreetSpawn = !placeOnStreet();
    if (needsTrip && !needsStreetSpawn && !missions.current) {
      needsTrip = false;
      const g = frame.toGeodetic(vehicle.position());
      home ??= { lat: g.lat, lon: g.lon };
      const trip = missions.startTrip(g.lat, g.lon, now);
      if (trip) {
        const km = (trip.startDistance / 1000).toFixed(1);
        toast(`最初の目的地: ${trip.target.name}（約 ${km} km）。法令を守って向かいましょう`, "#ffe14d");
        log("trip", { target: trip.target.name, metres: Math.round(trip.startDistance) });
      }
    }
    const manual = isInCar ? input.read(dt) : { throttle: 0, brake: 0, steer: 0, handbrake: false };
    // Any steering, accelerator or brake input takes the car back, as with a real driver-assist system.
    const isOverride = Math.abs(manual.throttle) > 0.2 || manual.brake > 0.2 || Math.abs(manual.steer) > 0.3;
    if (autopilot && isOverride) stopAutopilot("運転操作で自動運転を解除しました");
    const drive = autopilot ? autopilot.input : manual;
    const walk = input.readWalk();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= world.timestep && steps < 4) {
      if (!frozen && isInCar) vehicle.update(world.timestep, drive);
      taxi?.step(world.timestep);
      police?.step(world.timestep);
      if (isOnFoot && !frozen) walker.update(world.timestep, walk, env.isRaining());
      world.step(events);
      accumulator -= world.timestep;
      steps++;
    }
    vehicle.syncVisuals();
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other = h1 === vehicle.chassis.handle ? h2 : h2 === vehicle.chassis.handle ? h1 : null;
      if (other === null) return;
      const isCoolingDown = (contactCooldown.get(other) ?? 0) > performance.now();
      if (isCoolingDown) return;
      contactCooldown.set(other, performance.now() + 3000);
      const kmh = Math.abs(vehicle.speedKmh());
      const ped = pedestrians.byCollider(other);
      if (ped && kmh > 3) {
        pedestrians.knockDown(ped);
        emergency.start(ped, performance.now());
        onAccident("pedestrian", kmh, ped.profile.name);
      } else if (!ped && kmh > 5) {
        onAccident("vehicle", kmh, "");
      }
    });

    // The camera's view for open-world spawning (traffic and people appear and leave out of it).
    viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewMatrix);
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
    const hasGround = terrain.hasColliderAt(geo.lat, geo.lon);
    if (hasGround === frozen) {
      frozen = !hasGround;
      vehicle.setFrozen(frozen);
    }
    const gy = groundY(carPos.x, carPos.z);
    if (gy !== null && carPos.y < gy - 6) respawnHere();
    const footGround = isOnFoot ? groundY(focus.x, focus.z) : null;
    if (footGround !== null && focus.y < footGround - 4) walker.enter(focus.setY(footGround + 0.5), 0);
    if (Math.hypot(focus.x, focus.z) > RECENTER_DISTANCE) recenter();

    terrain.update(geo.lat, geo.lon);
    buildings.update(focus, now);
    transit.update(now, geo.lat, geo.lon, focus);
    lastGeo = { lat: geo.lat, lon: geo.lon };
    pedestrians.raining = env.isRaining();
    const carForward = new Vector3(0, 0, 1).applyQuaternion(carRot);
    carForward.y = 0;
    carForward.normalize();
    pedestrians.update(dt, focus, carPos, isInCar ? speed / 3.6 : 0, carForward);
    if (haversineMeters(geo.lat, geo.lon, roadCenter.lat, roadCenter.lon) > 300)
      refreshRoads(geo.lat, geo.lon);
    control.update(now / 1000);
    signs.update(focus, now);
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
    });
    ribbon.update(isInCar ? nav.route : null, nav.lastAt, now);
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
        const label = currentLimitKind === "sign" ? "規制速度" : "法定速度";
        const detail = `${label} ${currentLimit} km/h のところ ${Math.round(speed)} km/h（${Math.round(speed - currentLimit)} km/h 超過）`;
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
        book(VIOLATIONS.unlicensed, now, 10 * 60_000, `免許停止中（あと ${suspendedDays} 日）に運転`);

      // 通行禁止 (車両通行止め, 歩行者用道路) in force: entering the street at all is the offence.
      closedSince = onRoad?.seg.closed && speed > 5 ? (closedSince ?? now) : null;
      if (closedSince !== null && now - closedSince > 1500 && onRoad) {
        const active = onRoad.seg.closures.find((c) => isInForceTime(c.time, clock));
        const what = active ? CLOSURE_WORDS[active.kind] : "通行禁止";
        const note = active ? timeNote(active.time) : null;
        book(VIOLATIONS.closedRoad, now, 20000, `${what}の道路に進入${note ? `（${note}）` : ""}`);
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
      // …against the way the car leaves, judged 25 m past the junction (clear of its box).
      if (laneAtJunction && onRoad && laneAtJunction.use.seg !== onRoad.seg) {
        const j = laneAtJunction;
        if (Math.hypot(carPos.x - j.node.x, carPos.z - j.node.z) > 25) {
          laneAtJunction = null;
          const tOut = carForward.clone().setY(0).normalize();
          const turn = classifyTurn(j.tIn, tOut);
          if (!laneAllows(j.use.lanes[j.lane], turn)) {
            log("lane_direction", {
              lanes: j.use.lanes.map((l) => l.join("+")),
              lane: j.lane,
              turn,
              source: j.use.source,
            });
            const words = (d: string) =>
              ({
                left: "左折",
                slight_left: "斜め左",
                through: "直進",
                slight_right: "斜め右",
                right: "右折",
                reverse: "転回",
              })[d] ?? d;
            const allowed = j.use.lanes[j.lane].map(words).join("・");
            book(
              VIOLATIONS.laneDirection,
              now,
              15000,
              `${allowed}の車線（左から ${j.lane + 1} 番目）から${TURN_WORDS[turn]}`,
            );
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
        const isRightLane = lane === s.lanes - 1 && !isPreparingRight;
        rightLaneSince = isRightLane ? (rightLaneSince ?? now) : null;
        if (rightLaneSince !== null && now - rightLaneSince > 20000) book(VIOLATIONS.laneUse, now, 60000);
      } else rightLaneSince = null;

      // 進路変更禁止: crossing a yellow lane line (lanes counted from the left kerb).
      const seg = onRoad?.seg;
      if (onRoad && seg && seg.noLaneChange && seg.lanes >= 2 && speed > 5 && Math.abs(align) > 0.8) {
        const span = seg.oneway === 0 ? seg.line.width / 2 : seg.line.width;
        const leftOfTravel = onRoad.lateral * Math.sign(align);
        const lane = Math.floor((seg.line.width / 2 - leftOfTravel) / (span / seg.lanes));
        const isLaneChange =
          laneTrack !== null &&
          laneTrack.seg === seg &&
          laneTrack.lane !== lane &&
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
        }
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
      stamps.stamp("確認標章", place === "noStopping" ? "駐停車禁止場所" : "駐車禁止場所");
      toast(
        "駐車監視員が放置車両確認標章を取り付けました（警察署への出頭か、放置違反金の納付が必要です）",
        "#ffd400",
      );
    } else if (patrolEvent === "aborted") {
      toast("運転者が戻ったため、駐車監視員は確認を取りやめました", "#7dff9a");
    }

    // Holding the phone while the car moves; emergency calls to rescue the injured are exempt.
    if (isInCar && phone.open && Math.abs(speed) > 5 && !emergency.active) {
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
      toast(
        "負傷者を救護せず現場を離れました。目撃者が 119 番・110 番に通報し、パトカーが追跡しています",
        "#ff6b6b",
      );
    } else if (incidentEvent?.type === "arrested") {
      law.book(VIOLATIONS.hitAndRun, now, 0);
      showArrest(incidentEvent.later ? "hitAndRunLater" : "hitAndRun");
    } else if (incidentEvent?.type === "arrived") {
      toast(
        incidentEvent.kind === "ambulance" ? "🚑 救急車が到着しました" : "🚓 パトカーが到着しました",
        "#4dd2ff",
      );
    } else if (incidentEvent?.type === "rescued") {
      toast("負傷者は病院へ搬送されました", "#4dd2ff");
    } else if (incidentEvent?.type === "notReported") {
      toast("警察に事故を報告しませんでした（道路交通法 第72条第1項後段：報告義務）", "#ff6b6b");
    } else if (incidentEvent?.type === "closed") {
      toast("警察の事故処理が終わりました。安全運転を心がけましょう", "#7dff9a");
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
      talkable ? `E で話しかける（${talkable.profile.name}さん）` : "",
      nearCar ? "F で乗車" : "",
      nearTaxi ? "F でタクシーに乗る" : "",
      isInTaxi && taxi && taxi.speed < 0.5 ? "F でタクシーを降りる" : "",
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
      toast(`発見！ ${p.name}（${cat?.label ?? p.category}） +${cat?.points ?? 10}`, cat?.color);
      log("poi_collected", { id: p.id, category: p.category, ward: p.ward });
    }
    field.update(dt, env.nightFactor);

    const result = missions.check(geo.lat, geo.lon, now);
    if (result === "timeout") toast("時間切れ… N で次の目的地", "#ff6b6b");
    else if (result && result.target.category === "home") endDay();
    else if (result && result.target.category === "appointment") appear();
    else if (result) {
      score += result.reward;
      audio.chime(true);
      toast(`ミッション達成！ ${result.target.name} +${result.reward}`, "#7dff9a");
    }
    const target = missions.current?.target ?? null;
    // In the car the green route arrows show the way; the direction cone would only compete.
    const isGuided = isInCar && nav.route !== null;
    missions.updateArrow(
      isOnFoot ? walker.model.root : isInTaxi && taxi ? taxi.model.root : vehicle.object,
      target && !isGuided ? field.localPosition(target) : null,
    );

    if (debugCamera) debugCamera(camera, focus);
    else if (isOnFoot) walker.updateCamera(camera, dt);
    else if (isInTaxi && taxi) chase.update(dt, taxi.position, taxi.model.root.quaternion, taxi.speed);
    else chase.update(dt, carPos, carRot, speed / 3.6);
    env.update(dt, focus, camera.position, geo.lat, geo.lon);
    if (Math.abs(env.nightFactor - appliedNight) > 0.02) {
      appliedNight = env.nightFactor;
      buildings.setNightFactor(appliedNight);
    }
    vehicle.updateLights(env.nightFactor > 0.25 || env.isRaining());
    audio.update(isEngineOff ? 0 : speed, isEngineOff ? 0 : drive.throttle, isEngineOff);

    if (now - lastLocate > 500) {
      lastLocate = now;
      locate(geo.lat, geo.lon);
    }

    if (now - lastHud > 150) {
      lastHud = now;
      checkDeadlines();
      const yaw = isOnFoot
        ? Math.atan2(walker.forward().x, walker.forward().z)
        : isInTaxi && taxi
          ? taxi.model.root.rotation.y
          : carYaw(carRot);
      updateHud(geo.lat, geo.lon, yaw, now);
      conversation.refreshStatus();
      phone.refresh();
      if (brain.status !== lastBrainStatus) {
        if (brain.status === "ready")
          toast("会話 AI（Gemma 4）の準備ができました。歩行者に話しかけてみましょう", "#4dd2ff");
        if (brain.status === "error") toast(brain.detail, "#ff6b6b");
        lastBrainStatus = brain.status;
      }
      const chip = $("#ai-chip");
      const isBusy = brain.status === "downloading" || brain.status === "loading";
      chip.hidden = !isBusy && brain.status !== "error";
      chip.textContent =
        brain.status === "downloading"
          ? `会話AI ダウンロード中 ${Math.round(brain.progress * 100)}%`
          : brain.status === "loading"
            ? "会話AI 準備中…"
            : "会話AI: 利用できません（定型応答）";
    }
    renderer.render(scene, camera);
    takeShots();
  };

  /** Where, when and how fast, for the review screen (違反の記録) and the logs. */
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
  const shotCanvas = document.createElement("canvas");
  shotCanvas.width = 480;
  shotCanvas.height = 270;
  const takeShots = () => {
    if (pendingShots.length === 0) return;
    const ctx = shotCanvas.getContext("2d");
    if (!ctx) return;
    // Same task as renderer.render, so the WebGL drawing buffer still holds the frame.
    ctx.drawImage(renderer.domElement, 0, 0, shotCanvas.width, shotCanvas.height);
    const url = shotCanvas.toDataURL("image/jpeg", 0.7);
    for (const r of pendingShots.splice(0)) if (r.context) r.context.snapshot = url;
  };
  // Offences the police always learn of: those of an accident they are called to.
  const ACCIDENT_KINDS = new Set(["safeDriving", "injury", "phoneDanger", "hitAndRun"]);
  /**
   * A violation the driver committed. It counts only if someone catches it: the police at an
   * accident, or a patrol that sees it (then a chase and a ticket on the spot); otherwise it
   * stays the driver's own record (未検挙), shown so the player still learns from it.
   */
  const book = (v: Violation, now: number, cooldownMs?: number, detail?: string) => {
    const booked = law.commit(v, now, cooldownMs, violationContext(detail));
    if (!booked) return;
    pendingShots.push(booked);
    score = Math.max(0, score - booked.points * 50);
    const isAccident = ACCIDENT_KINDS.has(booked.kind) || booked.kind.startsWith("injury");
    const carPos = vehicle.position();
    if (isAccident) {
      law.cite(booked, "accident");
      toast(`🚓 ${formatViolation(booked)}`, "#ff6b6b");
      stamps.stamp("違反", shortLabel(booked.label));
    } else if (police?.sees(carPos)) {
      if (police.witness(booked) === "pursuit") startPursuit();
      toast(`🚨 パトカーに見られた: ${booked.label}`, "#ff6b6b");
    } else {
      toast(`⚠ ${booked.label}（未検挙）`, "#ffb347");
    }
    const c = booked.context;
    log("violation", {
      kind: booked.kind,
      status: booked.status,
      points: booked.points,
      total: law.state.points,
      place: c?.place,
      lat: c?.lat,
      lon: c?.lon,
      kmh: c ? Math.round(c.kmh) : null,
      limit: c?.limit,
      detail: c?.detail,
    });
  };

  // ---------- 巡回中のパトカー ----------
  let police: PolicePatrol | null = null;
  let policeDueAt = performance.now() + 40000;
  const policeSay = (text: string) => {
    if (audio.muted || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.95;
    u.pitch = 0.8;
    speechSynthesis.speak(u);
  };
  const startPursuit = () => {
    $("#pursuit-chip").hidden = false;
    policeSay("前の車の運転手さん、左に寄って止まってください。");
    log("police", { event: "pursuit" });
  };
  const openTicket = () => {
    const p = police;
    if (!p) return;
    const seen = [...p.seen];
    const isRed = seen.some((r) => r.fine === null);
    $("#ticket-intro").textContent =
      "警察官が窓の横に来ました。「こんにちは、警察です。いま違反がありましたので、免許証を見せてください。」";
    $("#ticket-list").replaceChildren(
      ...seen.map((r) => {
        const li = document.createElement("li");
        li.textContent = `${formatViolation(r)}${r.context?.detail ? `（${r.context.detail}）` : ""}`;
        return li;
      }),
    );
    $("#ticket-note").textContent = isRed
      ? "反則金の対象にならない違反（赤切符）は刑事手続になり、後日、検察庁や裁判所から呼び出しがあります。違反点数は付き、累積すると後日、行政処分の通知が届きます。"
      : "交通反則告知書（青切符）と納付書を受け取りました。反則金は告知の翌日から 7 日以内に金融機関で納めます。違反点数は累積し、一定の点数に達すると後日、行政処分の通知が届きます。今日はこのまま運転して帰れます。";
    $<HTMLDialogElement>("#ticket-dialog").showModal();
  };
  $("#ticket-accept").addEventListener("click", () => {
    const p = police;
    if (p) {
      for (const r of p.seen) {
        law.cite(r, "patrol");
        stamps.stamp("違反", shortLabel(r.label));
      }
      log("police", { event: "ticket", kinds: p.seen.map((r) => r.kind), total: law.state.points });
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
    if (!police && now > policeDueAt) {
      const p = new PolicePatrol(scene, world, (x, z) => groundY(x, z));
      if (p.spawn(roadGraph, tw, focus)) police = p;
      else p.dispose();
      policeDueAt = now + 30000;
    }
    const p = police;
    if (!p) return;
    // Out of the area: it goes off duty here and another comes by later.
    if (p.state !== "pursuing" && p.position.distanceTo(focus) > 1100) {
      p.dispose();
      police = null;
      policeDueAt = now + 60000;
      return;
    }
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
    if (event === "callout") policeSay("前の車、左に寄って止まってください。");
    else if (event === "ticket") openTicket();
    else if (event === "lost") {
      // The plate was read: a notice to appear comes by post. Fleeing a stop made because the
      // driver had no valid licence is itself an offence (第67条第1項・第119条第1項第13号).
      if (p.seen.some((r) => r.kind === "unlicensed")) {
        const fled = law.commit(
          VIOLATIONS.ignoredStop,
          now,
          0,
          violationContext("無免許運転を見とがめられ、停止の求めに従わず逃走"),
        );
        if (fled) p.seen.push(fled);
      }
      for (const r of p.seen) law.notice(r, "patrol");
      p.seen.length = 0;
      $("#pursuit-chip").hidden = true;
      toast("パトカーを振り切った…が、ナンバーは控えられた。後日、出頭の通知が届く", "#ff6b6b");
      log("police", { event: "lost" });
    }
  };
  const isSurfaceStreet = (seg: Segment) => seg.line.kind !== "highway";
  /**
   * Where the car stands, for parking: 駐停車禁止 (道路交通法 第44条: within 5 m of a junction's
   * side edge or of a crosswalk, or a JARTIC 駐停車禁止 section), 駐車禁止 (JARTIC section in force),
   * or null where parking on the street is not prohibited.
   */
  const parkingPlace = (hit: { seg: Segment; s: number }): "noStopping" | "noParking" | null => {
    const clock = gameClockNow();
    const inForce = (code: number) => hit.seg.rules.some((r) => r.code === code && isInForce(r, clock));
    const nearJunction = [hit.seg.from, hit.seg.to].some((node) => {
      const ids = roadGraph?.nodes.get(node) ?? [];
      if (ids.length < 3) return false;
      const sideEdge = Math.max(...ids.map((id) => roadGraph?.segments[id].line.width ?? 0)) / 2;
      const fromNode = node === hit.seg.from ? hit.s : hit.seg.length - hit.s;
      return fromNode < sideEdge + 5;
    });
    // A crosswalk is 4 m wide: its edges are 2 m either side of its centre.
    const nearCrossing = (roadApplied?.crossings ?? []).some(
      (c) => c.seg === hit.seg && Math.abs(c.s - hit.s) < 2 + 5,
    );
    if (nearJunction || nearCrossing || inForce(65)) return "noStopping";
    return inForce(115) ? "noParking" : null;
  };
  const parkingDialog = $<HTMLDialogElement>("#parking-dialog");
  // The choice cannot be skipped with Esc: the sticker stays until one is made.
  parkingDialog.addEventListener("cancel", (e) => e.preventDefault());
  const openParkingDialog = (v: Violation) => {
    $("#parking-detail").textContent =
      `${v.label}（${v.article}）。反則金・放置違反金はどちらも ${(v.fine ?? 0).toLocaleString()} 円（普通車）、出頭した場合の違反点数は ${v.points} 点です。`;
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
      stamps.stamp("放置違反金", `${(order.fine ?? 0).toLocaleString()}円`);
      toast(
        `使用者に放置違反金 ${(order.fine ?? 0).toLocaleString()} 円の納付命令（違反点数なし）`,
        "#ffd400",
      );
      // 警視庁の処分基準: 普通自動車・前歴なしは 6 か月以内の納付命令 3 回で最長 20 日、4 回 30 日、5 回以上 40 日。
      if (law.ownerOrders >= 3) {
        const days = law.ownerOrders >= 5 ? 40 : law.ownerOrders === 4 ? 30 : 20;
        toast(
          `放置違反金の納付命令 ${law.ownerOrders} 回目: 車両の使用制限命令（最長 ${days} 日）の対象になり得ます（第75条の2第2項）`,
          "#ff6b6b",
        );
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
    if (mode !== "car") return toast("車に乗っているときだけ使えます");
    const tw = taxiWorld();
    if (!tw) return toast("道路データを読み込み中です");
    const mission = missions.current ? field.localPosition(missions.current.target) : null;
    const target = mission ?? cruiseTarget();
    if (!target) return toast("行き先が見つかりません");
    const driver = new AutoDriver();
    driver.place(vehicle.position(), vehicle.yaw());
    if (!driver.plan(tw, target)) return toast("ルートが見つかりません（道路の上で使ってください）");
    autopilot = { driver, cruising: !mission, input: { throttle: 0, brake: 0, steer: 0, handbrake: false } };
    $("#autopilot-chip").hidden = false;
    toast(mission ? "自動運転を開始しました（目的地へ）" : "自動運転を開始しました（周辺を巡回）", "#3cd17a");
    log("autopilot", { on: true, cruising: !mission, metres: Math.round(driver.route?.length ?? 0) });
  };
  const stopAutopilot = (message: string) => {
    if (!autopilot) return;
    autopilot = null;
    vehicle.lightOverride = null;
    $("#autopilot-chip").hidden = true;
    toast(message, "#3cd17a");
    log("autopilot", { on: false });
  };
  const updateAutopilot = (dt: number) => {
    const ap = autopilot;
    if (!ap || mode !== "car") return;
    const tw = taxiWorld();
    if (!tw) return;
    // Its own car is not an obstacle to itself.
    tw.obstacles = tw.obstacles.filter((o) => o.distanceTo(vehicle.position()) > 1);
    const pose = { position: vehicle.position(), yaw: vehicle.yaw(), speed: vehicle.forwardSpeed() };
    const { input, done } = ap.driver.update(dt, tw, pose);
    ap.input = input;
    vehicle.lightOverride = {
      brake: ap.driver.braking,
      left: ap.driver.signal === "left",
      right: ap.driver.signal === "right",
    };
    if (!done) return;
    if (ap.cruising) {
      const next = cruiseTarget();
      if (next && ap.driver.plan(tw, next)) return;
    }
    stopAutopilot("目的地に着きました。自動運転を終了します");
  };

  // ---------- 自動運転タクシー ----------
  type TaxiDest = { name: string; lat: number; lon: number };
  let taxiDests: TaxiDest[] = [];
  let taxiArrivedAt = 0;
  let taxiStatusAt = 0;
  const taxiStatus = (text: string) => ($("#taxi-status").textContent = text);
  const taxiWorld = (): TaxiWorld | null =>
    roadGraph
      ? {
          graph: roadGraph,
          control,
          turnRules: roadApplied?.turnRules ?? [],
          clock: gameClockNow(),
          obstacles: [
            ...traffic.positions(),
            vehicle.position(),
            ...pedestrians.list.filter((p) => p.state !== "talk").map((p) => p.object.position),
          ],
          isPavement: (x: number, z: number) => pavements.contains(x, z),
          laneUse: roadApplied?.laneUse ?? [],
        }
      : null;
  const fillTaxiDestinations = () => {
    const here = frame.toGeodetic(focusPos());
    const dist = (d: { lat: number; lon: number }) => haversineMeters(here.lat, here.lon, d.lat, d.lon);
    const dests: TaxiDest[] = [];
    const mission = missions.current?.target;
    if (mission) dests.push({ name: `ミッション: ${mission.name}`, lat: mission.lat, lon: mission.lon });
    const car = frame.toGeodetic(vehicle.position());
    if (dist(car) > 150) dests.push({ name: "自分の車", lat: car.lat, lon: car.lon });
    const near = stations.filter((st) => dist(st) > 300).sort((a, b) => dist(a) - dist(b));
    for (const st of near.slice(0, 5))
      dests.push({ name: `${st.name}（${Math.round(dist(st) / 100) / 10}km）`, lat: st.lat, lon: st.lon });
    const spots = field
      .visibleList()
      .filter((p) => p.category !== "station" && dist(p) > 300 && dist(p) < 2500)
      .sort((a, b) => dist(a) - dist(b));
    for (const p of spots.slice(0, 4))
      dests.push({ name: `${p.name}（${Math.round(dist(p) / 100) / 10}km）`, lat: p.lat, lon: p.lon });
    taxiDests = dests;
    const select = $<HTMLSelectElement>("#taxi-dest");
    select.replaceChildren(
      ...dests.map((d, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = d.name;
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
  $("#taxi-back").addEventListener("click", () => showTaxiApp(false));
  $("#taxi-call").addEventListener("click", () => {
    const tw = taxiWorld();
    if (taxi) return taxiStatus("すでに配車中です。");
    if (mode !== "foot") return taxiStatus("車を降りてから呼んでください（F で降車）。");
    if (!tw) return taxiStatus("道路データを読み込み中です。少し待ってからもう一度。");
    const t = new RoboTaxi(scene, world, (x, z) => groundY(x, z));
    if (!t.dispatch(tw.graph, tw, walker.position(), walker.position())) {
      t.dispose();
      return taxiStatus("近くに配車できる車がありません。広い道路の近くで呼んでください。");
    }
    taxi = t;
    const eta = Math.max(1, Math.round((t.route?.length ?? 400) / 8 / 60));
    taxiStatus(`配車しました（迎車）。到着まで約 ${eta} 分。道路沿いでお待ちください。`);
    $("#taxi-cancel").hidden = false;
    toast(`🚕 自動運転タクシーが向かっています（約 ${eta} 分）`, "#ffd23c");
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
    taxiStatus("キャンセルしました。");
  });
  const boardTaxi = () => {
    const tw = taxiWorld();
    if (!taxi || !tw) return;
    const dest = taxiDests[Number($<HTMLSelectElement>("#taxi-dest").value)] ?? taxiDests[0];
    if (!dest) {
      toast("スマホのタクシーアプリで行き先を選んでください", "#ffd23c");
      return;
    }
    const at = frame.toLocal(dest.lat, dest.lon, frame.origin.h).setY(0);
    walker.leave();
    mode = "taxi";
    taxi.board(tw, at, dest.name);
    chase.snap();
    $("#taxi-cancel").hidden = true;
    // 道路交通法 第71条の3第2項: every passenger wears a seat belt.
    toast(
      `ご乗車ありがとうございます。${dest.name.replace(/（.*）$/, "")}へ向かいます（シートベルトをお締めください）`,
      "#ffd23c",
    );
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
      `🚕 運賃 ${fare.toLocaleString()} 円（${(taxi.metres / 1000).toFixed(1)}km、アプリで精算済み）。ありがとうございました`,
      "#ffd23c",
    );
    log("taxi_ride", { fare, metres: Math.round(taxi.metres), slowSeconds: Math.round(taxi.slowSeconds) });
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
      taxiStatus(
        `迎車中: あと ${Math.round(t.remaining / 10) * 10} m（約 ${minutes} 分）。地図の黄色い車が配車中のタクシーです。`,
      );
    }
    if (t.state === "coming" && done) {
      t.state = "waiting";
      toast("🚕 自動運転タクシーが到着しました。そばで F を押すと乗車します", "#ffd23c");
      taxiStatus("到着しました。そばで F を押してご乗車ください。");
    } else if (t.state === "riding") {
      $("#taxi-meter").hidden = false;
      $("#taxi-flag").textContent = done ? "支払" : "賃走";
      $("#taxi-fare").textContent = t.fare.toLocaleString();
      $("#taxi-trip").textContent =
        `${(t.metres / 1000).toFixed(2)}km・${t.destinationName.replace(/（.*）$/, "")}`;
      if (done) {
        t.state = "arrived";
        taxiArrivedAt = now;
        toast("🚕 目的地に到着しました", "#ffd23c");
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
    if (!home) return toast("まだ出発地点が決まっていません");
    const g = frame.toGeodetic(vehicle.position());
    const m = missions.startHome(home, performance.now(), g.lat, g.lon);
    toast(
      `自宅へ向かいます（約 ${(m.startDistance / 1000).toFixed(1)} km）。着いたら今日の運転は終わりです`,
      "#ffe14d",
    );
  });
  let pendingSanction: ReturnType<typeof decideSanction> = { kind: "none" };
  // Notices that came by post today: they ask the driver to appear at the police station.
  let todayDelivered: ViolationRecord[] = [];
  const endDay = () => {
    const today = law.state.log.slice(todayFrom);
    const delivered = law.deliverNotices();
    todayDelivered = delivered;
    pendingSanction = decideSanction(law.state.points, prior);
    // 📮 the post: orbis and plate notices, and the 行政処分 notice when the points reach it.
    const mail: string[] = delivered.map(
      (r) =>
        `出頭通知書（${r.by === "orbis" ? "速度違反自動取締装置で撮影" : "ナンバーから特定"}）: ${r.label}／違反点数 ${r.points} 点`,
    );
    if (pendingSanction.kind !== "none")
      mail.push("運転免許本部から「行政処分出頭通知書」の封筒が届いています…");
    const mailBody = $("#day-mail-body");
    mailBody.replaceChildren(
      ...(mail.length ? mail : ["ポストには何も届いていませんでした。"]).map((t) => {
        const p = document.createElement("p");
        p.textContent = t;
        return p;
      }),
    );
    const caught = today.filter((r) => r.status === "caught");
    const uncaught = today.filter((r) => r.status === "uncaught");
    const stats: Array<[string, string]> = [
      ["走行距離", `${(todayMetres / 1000).toFixed(1)} km`],
      ["違反", `${today.length} 件（検挙 ${caught.length} 件・未検挙 ${uncaught.length} 件）`],
      ["反則金など", `${caught.reduce((a, r) => a + (r.fine ?? 0), 0).toLocaleString()} 円`],
      ["累積点数", `${law.state.points} 点（前歴 ${prior} 回）`],
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
      $("#day-sanction-body").textContent =
        `免許停止 ${s.days} 日（累積 ${law.state.points} 点・前歴 ${prior} 回）。指定の日に出頭して免許証を預けます。停止処分者講習を受けると、成績により最大 ${s.shortened} 日短くなります（${s.days - s.shortened} 日）。停止中に運転すると無免許運転（第64条）です。`;
    } else if (pendingSanction.kind === "revocation") {
      $("#day-sanction-body").textContent =
        `免許取消（累積 ${law.state.points} 点・前歴 ${prior} 回）。欠格期間 ${pendingSanction.years} 年が過ぎるまで免許を取り直せません。`;
    }
    const tips = adviceFor(today);
    const adviceEl = $("#day-advice");
    adviceEl.replaceChildren(
      ...(tips.length
        ? tips
        : ["今日は違反がありませんでした。この調子で、法令を守った運転を続けましょう。"]
      ).map((t) => {
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
      li.textContent = "指導員が考えています…";
      adviceEl.prepend(li);
      void brain
        .reply(
          -77,
          "あなたは自動車教習所のベテラン指導員です。今日の運転で起きた違反を聞き、責めずに、次にどう運転すればよいかを日本語で2〜3文で具体的に伝えてください。",
          `今日の違反: ${facts}`,
          (partial) => (li.textContent = `🧑‍🏫 ${partial}`),
        )
        .then((text) => {
          if (text) li.textContent = `🧑‍🏫 ${text}`;
          else li.remove();
        });
    }
    log("day_end", {
      metres: Math.round(todayMetres),
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
    $("#day-sanction-body").textContent =
      `講習を受けました。免許停止は ${pendingSanction.days} 日になりました。`;
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
    const what = a.kind === "sanction" ? "行政処分の出頭" : "出頭通知の手続き";
    toast(`${what}: ${a.place.name}へ（${deadlineText(a.deadline)} まで）`, "#ffb347");
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
    log("sanction", { kind: sanction.kind, days: suspendedDays, course: withCourse, prior });
  };
  /** At the counter: the notice is dealt with, or the licence is handed in. */
  const appear = () => {
    const a = appointments.shift();
    if (!a) return;
    if (a.kind === "notice") {
      const isRed = a.records.some((r) => r.fine === null);
      showOffice(
        `${a.place.name}に出頭しました`,
        isRed
          ? "交通課で取り調べを受け、供述調書が作られました。反則金の対象にならない違反（赤切符）は、後日、検察庁や裁判所から呼び出しがあります。"
          : `交通反則告知書（青切符）と納付書を受け取りました（${a.records.map((r) => r.label).join("、")}）。反則金は 7 日以内に金融機関で納めます。`,
        [["わかりました", () => nextAppointment()]],
      );
      return;
    }
    const s = a.sanction;
    const days = s.kind === "suspension" ? s.days : 0;
    const body =
      s.kind === "suspension"
        ? `免許証を預け、免許停止 ${days} 日の処分を受けました。停止処分者講習（この日に受講）を受けると、成績により最大 ${s.shortened} 日短くなります。処分が始まったので、ここからは運転できません。車は駐車場に置き、タクシーか歩きで帰りましょう。`
        : `免許取消の処分を受けました。欠格期間が過ぎるまで免許を取り直せません。車は駐車場に置き、タクシーか歩きで帰りましょう。`;
    const done = (withCourse: boolean) => {
      executeSanction(s, withCourse);
      // Out of the driver's seat: the car stays here.
      if (mode === "car") input.trigger("door");
      toast(
        withCourse && s.kind === "suspension"
          ? `講習を受けました。免許停止は ${suspendedDays} 日です`
          : `処分が始まりました（あと ${suspendedDays} 日）`,
        "#ff6b6b",
      );
      nextAppointment();
    };
    showOffice(
      `${a.place.name}に出頭しました`,
      body,
      s.kind === "suspension"
        ? [
            ["停止処分者講習を受ける", () => done(true)],
            ["講習を受けない", () => done(false)],
          ]
        : [["わかりました", () => done(false)]],
    );
  };
  /** Past 17:00 without appearing. */
  const checkDeadlines = () => {
    const a = appointments[0];
    if (!a || env.now().getTime() < a.deadline) return;
    if (a.kind === "sanction") {
      appointments.shift();
      executeSanction(a.sanction, false);
      toast("出頭期限を過ぎたため、処分が執行されました（講習による短縮はありません）", "#ff6b6b");
      if (mode === "car") input.trigger("door");
      return;
    }
    a.strikes++;
    if (a.strikes >= 2) {
      appointments.shift();
      showArrest("notice", a.records.map((r) => r.label).join("、"));
      return;
    }
    a.deadline = closingTime() + 24 * 3600_000;
    toast(
      `出頭しませんでした。再出頭通知: ${deadlineText(a.deadline)} までに ${a.place.name}へ。応じないと逮捕されることがあります`,
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
      toast(`免許停止中（あと ${suspendedDays} 日）。今日はタクシーか歩きで出かけましょう`, "#ff6b6b");
      return;
    }
    const pos = frame.toGeodetic(vehicle.position());
    const trip = missions.startTrip(pos.lat, pos.lon, performance.now());
    if (trip)
      toast(
        `今日の目的地: ${trip.target.name}（約 ${(trip.startDistance / 1000).toFixed(1)} km）`,
        "#ffe14d",
      );
  });
  const openReview = () => {
    renderReview($("#violations-list"), law.state.log);
    const s = law.state;
    $("#violations-summary").textContent =
      `違反 ${s.log.length} 件・違反点数 ${s.points} 点・反則金など ${s.fines.toLocaleString()} 円（普通車の基準によるゲーム内の参考値）`;
    $<HTMLDialogElement>("#violations").showModal();
  };
  $("#review-open").addEventListener("click", openReview);
  $("#review-from-suspension").addEventListener("click", openReview);
  const showArrest = (why: "hitAndRun" | "hitAndRunLater" | "notice", detail = "") => {
    vehicle.setFrozen(true);
    const isNotice = why === "notice";
    stamps.stamp("逮捕", isNotice ? "出頭要請に応じず" : "救護義務違反（ひき逃げ）", true);
    $("#suspended h1").textContent = isNotice ? "逮捕" : "ひき逃げで逮捕";
    $("#suspended .tagline").textContent = isNotice
      ? "出頭の通知に二度応じなかったため、逃亡のおそれがあるとして逮捕状が出され、朝、自宅で逮捕されました。"
      : why === "hitAndRunLater"
        ? "現場から逃げ切ったものの、後日、防犯カメラの映像と目撃情報から特定され逮捕されました。"
        : "パトカーに追いつかれ、その場で逮捕されました。";
    const lines = isNotice
      ? [
          `元の違反：${detail}。反則金を納めず出頭もしない場合、反則行為も通常の刑事手続になります（道路交通法 第130条）。`,
          "呼び出しに正当な理由なく応じないと、逮捕されることがあります（刑事訴訟法 第199条）。",
          "通知が届いたら、期限までに指定の場所へ出頭しましょう。",
        ]
      : [
          "救護義務違反（ひき逃げ）：交通事故を起こした運転者は、直ちに運転を停止し、負傷者を救護し、警察官に報告しなければなりません（道路交通法 第72条第1項）。",
          "罰則：人の死傷が運転に起因する場合、10年以下の拘禁刑又は100万円以下の罰金（同法 第117条第2項）。",
          `違反点数：基礎点数35点を加算し、合計 ${law.state.points} 点 → 免許取消（前歴なしで15点以上）。`,
          "事故を起こしたら、逃げずに停車し、119番・110番に通報してください。",
        ];
    $("#suspended-log").replaceChildren(
      ...lines.map((t) => {
        const li = document.createElement("li");
        li.textContent = t;
        return li;
      }),
    );
    $("#retrain").textContent = "最初からやり直す";
    $("#suspended").hidden = false;
  };
  $("#retrain").addEventListener("click", () => {
    law.reset();
    $("#suspended").hidden = true;
    vehicle.setFrozen(false);
    respawnHere();
    toast("講習を修了しました。安全運転で！", "#7dff9a");
  });

  // Accident handling: penalty points via the traffic-law model plus a score deduction.
  const updateIncidentPanel = (now: number) => {
    const panel = $("#incident");
    panel.hidden = !emergency.active;
    if (!emergency.active) return;
    const part = (kind: "ambulance" | "police", label: string, number: string) => {
      if (!emergency.isCalled(kind)) return `${label}: 未通報（スマホで ${number}）`;
      const eta = emergency.eta(kind);
      return `${label}: ${eta === null ? "到着" : `到着まで約${eta}秒`}`;
    };
    const left = emergency.isCalled("ambulance") ? "" : `・残り${emergency.secondsLeft(now)}秒`;
    $("#incident-status").textContent =
      `${part("ambulance", "🚑 救急", "119")}${left}　${part("police", "🚓 警察", "110")}`;
  };

  const onAccident = (kind: "pedestrian" | "vehicle", kmh: number, who: string) => {
    book(VIOLATIONS.safeDriving, performance.now(), 3000);
    // A crash with the phone in hand is the 交通の危険 form of ながら運転 (6 points, no 反則金).
    if (phone.open && mode === "car")
      book(VIOLATIONS.phoneDanger, performance.now(), 30000, "スマホを操作しながら事故を起こした");
    if (kind === "pedestrian") book(injuryViolation(kmh), performance.now(), 3000);
    const penalty = kind === "pedestrian" ? 300 : 100;
    score = Math.max(0, score - penalty);
    toast(
      kind === "pedestrian"
        ? `⚠ 歩行者（${who}さん）と接触しました（${Math.round(kmh)} km/h） −${penalty}`
        : `⚠ 車両と接触しました（${Math.round(kmh)} km/h） −${penalty}`,
      "#ff6b6b",
    );
    log("accident", { kind, kmh: Math.round(kmh) });
  };

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  /**
   * In-game clock: date, weekday and time, as the regulations see them (Saturday blue, Sunday and
   * 祝日 red as on a Japanese calendar).
   */
  const clockLabel = (clock: GameClock, date: { m: number; d: number }) => {
    const hh = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
    const mm = String(Math.floor(clock.minutes % 60)).padStart(2, "0");
    return `${date.m}/${date.d}(${WEEKDAYS[clock.weekday]}${clock.holiday ? "・祝" : ""}) ${hh}:${mm}`;
  };
  const renderClock = (el: HTMLElement, clock: GameClock, date: { m: number; d: number }) => {
    const hh = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
    const mm = String(Math.floor(clock.minutes % 60)).padStart(2, "0");
    const dayClass = clock.holiday || clock.weekday === 0 ? "sun" : clock.weekday === 6 ? "sat" : "";
    const label = `${date.m}/${date.d}(${WEEKDAYS[clock.weekday]}${clock.holiday ? "・祝" : ""})`;
    if (el.textContent === `${label} ${hh}:${mm}`) return;
    el.textContent = "";
    const day = document.createElement("span");
    day.className = `clock-day ${dayClass}`;
    day.textContent = label;
    const time = document.createElement("span");
    time.className = "clock-time";
    time.textContent = ` ${hh}:${mm}`;
    el.append(day, time);
  };

  const updateHud = (lat: number, lon: number, yaw: number, now: number) => {
    $("#ward").textContent = wardName;
    $("#town").textContent = townName || " ";
    renderClock($("#clock"), gameClockNow(), tokyoDate(env.now()));
    const obs = env.getObservation();
    const obsText = obs
      ? `東京 ${obs.temp ?? "-"}℃ 風 ${obs.wind ?? "-"}m/s 降水 ${obs.precip10m ?? "-"}mm (${obs.time})`
      : "気象データ取得中…";
    $("#weather").textContent = env.weather === "real" ? obsText : `${WEATHER_LABEL[env.weather]}（固定）`;
    const nearestBus = transit.nearest(lat, lon);
    $("#transit").textContent =
      nearestBus && nearestBus.distance < 120 ? `🚌 ${nearestBus.bus.note.split(" ")[0]}` : transit.status;

    $("#score").textContent = score.toLocaleString();
    const ahead =
      mode === "foot" ? null : control.ahead(vehicle.position(), headingVector(vehicle.quaternion()));
    const aheadText = ahead
      ? ahead.approach.kind === "signal"
        ? `🚦 ${LIGHT_LABEL[control.state(ahead.approach)]}・${Math.round(ahead.dist)}m`
        : `🛑 止まれ・${Math.round(ahead.dist)}m`
      : currentOneway
        ? "⬆ 一方通行"
        : "";
    const regAhead = $("#reg-ahead");
    regAhead.hidden = aheadText === "";
    regAhead.textContent = aheadText;
    regAhead.dataset.state =
      ahead?.approach.kind === "signal" ? control.state(ahead.approach) : (ahead?.approach.kind ?? "");
    $("#license-points").textContent = `違反点数 ${law.state.points} / 6`;
    $("#license-fines").textContent = `反則金 ${law.state.fines.toLocaleString()}円`;
    const inWard = pois.filter((p) => p.ward === wardName);
    const wardDone = inWard.filter((p) => field.collected.has(p.id)).length;
    $("#collected").textContent =
      `発見 ${field.collected.size.toLocaleString()} / ${pois.length.toLocaleString()}` +
      (inWard.length ? `・${wardName} ${wardDone}/${wardTotals.get(wardName) ?? 0}` : "");

    const mission = missions.current;
    if (mission) {
      const d = haversineMeters(lat, lon, mission.target.lat, mission.target.lon);
      const cat = field.category(mission.target.category);
      $("#mission-name").textContent = mission.target.name;
      const left = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      const clock = mission.isTrip
        ? "法令を守って向かおう"
        : `${Math.max(0, Math.ceil(missions.remaining(now)))} 秒`;
      $("#mission-meta").textContent = `${cat?.label ?? ""}・${mission.target.ward}・残り ${left}・${clock}`;
    } else {
      $("#mission-name").textContent = QUALITY.isMobile
        ? "🎯 でミッション開始"
        : "N キー / 目的地ボタンでミッション開始";
      $("#mission-meta").textContent = `近くのスポット ${field.visibleList().length} 件`;
    }

    // Heading clockwise from north; local yaw 0 faces +Z (= south).
    const heading = Math.PI - yaw;
    minimap.draw({
      lat,
      lon,
      heading,
      radius: 600,
      pois: field.visibleList(),
      target: mission?.target ?? null,
      buses: transit.positionsNear(lat, lon, 700),
      route: nav.route ? navGeo.points : undefined,
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
        world,
        terrain,
        buildings,
        vehicle,
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
        getMission: () => missions.current,
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
        setDebugCamera: (fn: typeof debugCamera) => (debugCamera = fn),
      },
    });
  }
  requestAnimationFrame(tick);
}

main().catch((error: unknown) => {
  warn("fatal", { error: String(error) });
  setLoading(`起動に失敗しました: ${String(error)}`, 0);
});
