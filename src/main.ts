import RAPIER from "@dimforge/rapier3d-compat";
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { z } from "zod";
import { RECENTER_DISTANCE, SPAWN, TERRAIN_ZOOM } from "./config";
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
import { renderCredits } from "./game/credits";
import { Input } from "./game/input";
import { Minimap } from "./game/minimap";
import { Missions } from "./game/missions";
import { PoiField, storageKeyFor } from "./game/pois";
import { log, warn } from "./log";
import { Vehicle } from "./physics/vehicle";
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
import { Transit } from "./world/transit";
import { fetchTokyoObservation } from "./world/weather";

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
  log("data_loaded", {
    pois: pois.length,
    geoid: geoidGrid !== null,
    busStops: Object.keys(stopFile?.stops ?? {}).length,
  });

  const renderer = new WebGLRenderer({
    canvas: $<HTMLCanvasElement>("#scene"),
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 40000);

  const dem = new DemStore(new Geoid(geoidGrid));
  setLoading("地形（国土地理院 DEM）を読み込み中…", 0.18);
  await dem.load(
    Math.floor(lonToTileX(SPAWN.lon, TERRAIN_ZOOM)),
    Math.floor(latToTileY(SPAWN.lat, TERRAIN_ZOOM)),
  );
  let frame = new LocalFrame(SPAWN.lat, SPAWN.lon, dem.heightAt(SPAWN.lat, SPAWN.lon) ?? 40);

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
  let mode: "car" | "foot" = "car";
  const focusPos = (target = new Vector3()) =>
    mode === "foot" ? walker.position(target) : vehicle.position(target);
  const pedestrians = new Pedestrians(
    scene,
    world,
    (x, z) => groundY(x, z),
    (x, z, g) => isOpenGround(x, z, g),
  );
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
    $("#credits-body").innerHTML = renderCredits(poiFile?.sources ?? []);
    $<HTMLDialogElement>("#credits").showModal();
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
      pedestrians.crowd = Math.round(18 + Math.min(26, hit.density / 600));
    } else {
      townName = "";
    }
  };

  let lastGeo = { lat: SPAWN.lat, lon: SPAWN.lon };
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
  input.on("door", () => {
    if (state !== "playing" || conversation.active) return;
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
      mode = "foot";
      toast("車を降りました（F で乗車・Shift で走る・Space でジャンプ・←→ やドラッグで視点）", "#4dd2ff");
      return;
    }
    if (walker.position().distanceTo(vehicle.position()) > 4.5) {
      toast("車のそばで F を押すと乗車します");
      return;
    }
    walker.leave();
    mode = "car";
    chase.snap();
    toast("乗車しました");
  });
  input.on("close", () => conversation.close());

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
  const contactCooldown = new Map<number, number>();
  const loadStart = performance.now();
  const startButton = $<HTMLButtonElement>("#start");
  camera.position.set(-60, 90, 140);
  camera.lookAt(0, 30, 0);

  startButton.addEventListener("click", () => {
    if (state !== "ready") return;
    audio.start();
    $("#loading").hidden = true;
    $("#hud").hidden = false;
    buildings.buildCollidersNear(new Vector3());
    vehicle.teleport(findOpenGround(0, 0), SPAWN.yaw);
    vehicle.setFrozen(false);
    frozen = false;
    chase.snap();
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
      terrain.update(SPAWN.lat, SPAWN.lon);
      buildings.update(new Vector3(), now);
      env.update(dt, new Vector3(), camera.position, SPAWN.lat, SPAWN.lon);
      camera.position.applyAxisAngle(new Vector3(0, 1, 0), dt * 0.05);
      camera.lookAt(0, 30, 0);
      const groundReady = terrain.hasColliderAt(SPAWN.lat, SPAWN.lon);
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
    const drive = isOnFoot ? { throttle: 0, brake: 0, steer: 0, handbrake: false } : input.read(dt);
    const walk = input.readWalk();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= world.timestep && steps < 4) {
      const isParked = conversation.active !== null || isOnFoot;
      if (!frozen)
        vehicle.update(
          world.timestep,
          isParked ? { throttle: 0, brake: 1, steer: 0, handbrake: true } : drive,
        );
      if (isOnFoot && !frozen)
        walker.update(
          world.timestep,
          conversation.active ? { forward: 0, right: 0, run: false, jump: false, turn: 0 } : walk,
          env.isRaining(),
        );
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
        onAccident("pedestrian", kmh, ped.profile.name);
      } else if (!ped && kmh > 5) {
        onAccident("vehicle", kmh, "");
      }
    });

    const carPos = vehicle.position();
    const carRot = vehicle.quaternion();
    const focus = focusPos();
    const geo = frame.toGeodetic(focus);
    const speed = isOnFoot ? walker.speed * 3.6 : vehicle.speedKmh();

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
    pedestrians.update(dt, focus, carPos, isOnFoot ? 0 : speed / 3.6, carForward);
    const partner = conversation.active;
    if (partner && partner.object.position.distanceTo(focus) > 18) conversation.close();
    const talkRange = isOnFoot ? 3.5 : 10;
    const talkable =
      !partner && Math.abs(speed) < (isOnFoot ? 99 : 4) ? pedestrians.nearest(focus, talkRange) : null;
    const nearCar = isOnFoot && walker.position().distanceTo(carPos) < 4.5;
    const hint = $("#talk-hint");
    const hints = [
      talkable ? `E で話しかける（${talkable.profile.name}さん）` : "",
      nearCar ? "F で乗車" : "",
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
    else if (result) {
      score += result.reward;
      audio.chime(true);
      toast(`ミッション達成！ ${result.target.name} +${result.reward}`, "#7dff9a");
    }
    const target = missions.current?.target ?? null;
    missions.updateArrow(
      isOnFoot ? walker.model.root : vehicle.object,
      target ? field.localPosition(target) : null,
    );

    if (debugCamera) debugCamera(camera, focus);
    else if (isOnFoot) walker.updateCamera(camera, dt);
    else chase.update(dt, carPos, carRot, speed / 3.6);
    env.update(dt, focus, camera.position, geo.lat, geo.lon);
    if (Math.abs(env.nightFactor - appliedNight) > 0.02) {
      appliedNight = env.nightFactor;
      buildings.setNightFactor(appliedNight);
    }
    vehicle.updateLights(env.nightFactor > 0.25 || env.isRaining());
    audio.update(isOnFoot ? 0 : speed, drive.throttle);

    if (now - lastLocate > 500) {
      lastLocate = now;
      locate(geo.lat, geo.lon);
    }

    if (now - lastHud > 150) {
      lastHud = now;
      const yaw = isOnFoot ? Math.atan2(walker.forward().x, walker.forward().z) : carYaw(carRot);
      updateHud(geo.lat, geo.lon, yaw, speed, now);
      conversation.refreshStatus();
    }
    renderer.render(scene, camera);
  };

  // Accident handling; traffic-law scoring is layered on top in game/traffic.ts.
  const onAccident = (kind: "pedestrian" | "vehicle", kmh: number, who: string) => {
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

  const updateHud = (lat: number, lon: number, yaw: number, speed: number, now: number) => {
    $("#speed").textContent = String(Math.round(Math.abs(speed)));
    $("#ward").textContent = wardName;
    $("#town").textContent = townName || " ";
    const hour = env.displayHour(lat, lon);
    const hh = String(Math.floor(hour)).padStart(2, "0");
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, "0");
    $("#clock").textContent = `${TIME_LABEL[env.timeMode]} ${hh}:${mm}`;
    const obs = env.getObservation();
    const obsText = obs
      ? `東京 ${obs.temp ?? "-"}℃ 風 ${obs.wind ?? "-"}m/s 降水 ${obs.precip10m ?? "-"}mm (${obs.time})`
      : "気象データ取得中…";
    $("#weather").textContent = env.weather === "real" ? obsText : `${WEATHER_LABEL[env.weather]}（固定）`;
    const nearestBus = transit.nearest(lat, lon);
    $("#transit").textContent =
      nearestBus && nearestBus.distance < 120 ? `🚌 ${nearestBus.bus.note.split(" ")[0]}` : transit.status;

    $("#score").textContent = score.toLocaleString();
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
      $("#mission-meta").textContent =
        `${cat?.label ?? ""}・${mission.target.ward}・残り ${Math.round(d)} m・${Math.max(0, Math.ceil(missions.remaining(now)))} 秒`;
    } else {
      $("#mission-name").textContent = "N キー / 目的地ボタンでミッション開始";
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
