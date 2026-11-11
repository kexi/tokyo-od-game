import { Box3, Matrix4, Mesh, Vector3, type Object3D, type PerspectiveCamera, type Scene } from "three";
import { STATION_STRIDE, type XwChunk, type XwMeta, type XwTile } from "../expressway/format";
import type { LocalFrame } from "../geo/frame";
import { log, warn } from "../log";
import type { Environment } from "../world/environment";
import type { LandmarkEntry } from "../world/landmarkEntry";
import type { GuideTargetView } from "../world/guideSigns";
import type { Approach, TrafficControl } from "../world/trafficControl";
import { MOVEMENTS, crossingVerdict } from "../signals/plan";
import {
  faceInstances,
  nearestInstance,
  readLamps,
  readPosts,
  screenShare,
  notesOf,
  type PostView,
} from "./privateViews";

/**
 * The multi-view review's hooks on the dev build (window.__game.debug.camera / .targets / .settled,
 * scripts/qa/views.ts, knowledge/review-loop.md): put the camera anywhere, find where a thing to
 * review is drawn — a landmark, a sign plate, a signal head, an expressway chunk — with the way it
 * faces, hold a signal's 現示, and tell when the world around has finished streaming in.
 *
 * How the facing is found: from what is drawn, not from where the data says it should be. A sign
 * plate's normal is read from its instance matrix (the plate's local +Z), a signal head faces back
 * along its approach. The camera that did not face the signs (G1c) aimed along the post's travel,
 * which for a 326-A one-way plate (parallel to the street) or a plate on the far side looks past it.
 *
 * The camera is kept in geodetic coordinates and turned into the local frame every frame, so a
 * floating-origin recentre while a view settles does not move it.
 *
 * Targets are found by one call, `targets.find(spec)`, which says why when it cannot (`unknown-id`,
 * `not-built`, `renamed`, `none-near`, `not-drawn`): the runner passes the view's spec through and
 * fails the shot on the reason, so no target kind is handled in two places.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Geo = { lat: number; lon: number; h: number };
type LatLon = [number, number];

/** What a view can aim at, in the local frame at the time it is read. */
export type ViewTarget = {
  kind: "landmark" | "sign" | "guide" | "signal" | "expressway" | "point";
  id: string;
  name?: string;
  point: Vec3;
  /** Unit horizontal direction the thing faces (a plate's front, a head's lenses); null: round. */
  normal: Vec3 | null;
  /** m: about how large it is (the camera keeps it in frame). */
  size: number;
  /** The thing's box (local), for how much of the screen it takes. */
  box: { min: Vec3; max: Vec3 };
  /** Surface points ahead of and behind `point` in the travel direction (expressway decks). */
  path?: Vec3[];
  /** Index of `point` in `path`. */
  pathIndex?: number;
  geo: Geo;
  /** m from the player's car. */
  distanceM: number;
  /** Drawn now (the model, the plate, the deck); a shot of something not drawn fails. */
  isDrawn: boolean;
  /** What the screen should show about it (the frame's JSON). */
  facts: Record<string, unknown>;
};

/** The view table's target spec (scripts/qa/viewTable.ts TargetSchema), as the page receives it. */
export type TargetQuery =
  | { landmark: string; heightShare?: number }
  | { sign: string; note?: boolean | string; near?: LatLon; index?: number }
  | { signal: { near?: LatLon; arrow?: boolean; index?: number } }
  | { guide: { kind?: string; near?: LatLon; index?: number } }
  | { expressway: string; share?: number }
  | { point: { lat: number; lon: number; h: number; ref?: HeightRef } };

export type FindFailure = {
  ok: false;
  reason: "unknown-id" | "not-built" | "renamed" | "none-near" | "not-drawn";
  detail: string;
};
export type Found = { ok: true; target: ViewTarget } | FindFailure;

export type CameraSpot = {
  /** `above`: metres over the ground at x, z (a bridge's deck there, as the car stands); else `y`. */
  eye: { x: number; z: number; y?: number; above?: number };
  target: Vec3;
  /** Degrees (vertical). Not given: the game's own. */
  fov?: number;
  /** Moved out of the frame while placed. */
  hide?: HideKind[];
};

export type GeoSpot = {
  eye: { lat: number; lon: number; h: number; ref?: HeightRef };
  target: { lat: number; lon: number; h: number; ref?: HeightRef };
  fov?: number;
  hide?: HideKind[];
};

/** "ground": metres above the DEM there; "tp": T.P. (orthometric); "ellipsoid": WGS84. */
export type HeightRef = "ground" | "tp" | "ellipsoid";
export type HideKind = "traffic" | "pedestrians";

export type ViewHookDeps = {
  scene: Scene;
  camera: PerspectiveCamera;
  frame: () => LocalFrame;
  /** WGS84 ellipsoidal height of the ground (null while its DEM tile is not in). */
  groundEllipsoidal: (lat: number, lon: number) => number | null;
  /** WGS84 ellipsoidal height of a T.P. one. */
  ellipsoidal: (lat: number, lon: number, orthometric: number) => number;
  groundY: (x: number, z: number) => number | null;
  setDebugCamera: (fn: ((cam: PerspectiveCamera, car: Vector3) => void) | null) => void;
  carPosition: () => Vector3;
  landmarks: readonly LandmarkEntry[];
  /** TrafficSigns (its private posts are read through privateViews.ts). */
  signs: unknown;
  /** The 案内標識 (GuideSigns.debugTargets, public). */
  guide: { debugTargets(): GuideTargetView[] } | null;
  control: TrafficControl;
  env: Environment;
  baseUrl: string;
  /**
   * Called when a view is placed (true) and released (false): the motion blur off meanwhile (it
   * smears the cut and follows the car's speed, not this camera).
   */
  onPlaced: (isPlaced: boolean) => void;
  /** Hidden every frame while placed (the route arrows: the game shows them again each frame). */
  hiddenWhilePlaced: () => Array<{ visible: boolean }>;
  /** The objects of each kind a view may hide. */
  hideables: Record<HideKind, () => Object3D[]>;
  /** Whether the world around has been built: roads, buildings (PLATEAU tiles). */
  loadState: () => { isRoadsLoading: boolean; hasRoads: boolean; buildingsProgress: number };
};

const plain = (v: Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const vec = (v: Vec3): Vector3 => new Vector3(v.x, v.y, v.z);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const boxAround = (p: Vector3, half: Vec3) => ({
  min: { x: p.x - half.x, y: p.y - half.y, z: p.z - half.z },
  max: { x: p.x + half.x, y: p.y + half.y, z: p.z + half.z },
});
const fail = (reason: FindFailure["reason"], detail: string): FindFailure => ({ ok: false, reason, detail });
const flatDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The `index`-th of a list nearest first, or why there is none. */
function pick(list: ViewTarget[], index: number, what: string): Found {
  const t = list[index];
  if (!t) return fail("none-near", `${list.length} ${what} near (wanted #${index})`);
  if (!t.isDrawn) return fail("not-drawn", `${what} ${t.id} is in the data but not drawn`);
  return { ok: true, target: t };
}

/** A reader's result as health() reports it. */
function brief(r: { ok: true; value: { length: number } } | { ok: false; reason: string; detail: string }) {
  return r.ok ? { ok: true, count: r.value.length } : { ok: false, reason: r.reason, detail: r.detail };
}

export function createViewHooks(deps: ViewHookDeps) {
  const { scene, camera } = deps;
  const gameFov = camera.fov;
  const gameUp = camera.up.clone();

  /** Local position of a geodetic point now, its height read by `ref`. */
  const localOf = (p: { lat: number; lon: number; h: number; ref?: HeightRef }): Vector3 | null => {
    const ref = p.ref ?? "ground";
    if (ref === "ellipsoid") return deps.frame().toLocal(p.lat, p.lon, p.h);
    if (ref === "tp") return deps.frame().toLocal(p.lat, p.lon, deps.ellipsoidal(p.lat, p.lon, p.h));
    const ground = deps.groundEllipsoidal(p.lat, p.lon);
    if (ground === null) return null;
    return deps.frame().toLocal(p.lat, p.lon, ground + p.h);
  };
  /** A [lat, lon] as a local point at the frame's height (for horizontal distances). */
  const flatOf = (ll: LatLon) => deps.frame().toLocal(ll[0], ll[1], deps.frame().origin.h);
  const geoOf = (v: Vec3): Geo => {
    const g = deps.frame().toGeodetic(vec(v));
    return { lat: round(g.lat, 7), lon: round(g.lon, 7), h: round(g.h) };
  };
  const fromCar = (v: Vec3) => round(vec(v).distanceTo(deps.carPosition()), 1);

  let placed: { eye: GeoSpot["eye"]; target: GeoSpot["target"]; fov: number; hide: HideKind[] } | null = null;
  /** What this hook hid, to show again when the view changes (the game does not re-show them). */
  let hidden: Object3D[] = [];
  const showHidden = () => {
    for (const o of hidden) o.visible = true;
    hidden = [];
  };

  /** Aim the camera each frame (the game's own camera code is skipped while it is set). */
  const apply = (cam: PerspectiveCamera) => {
    if (!placed) return;
    for (const o of deps.hiddenWhilePlaced()) o.visible = false;
    // New cars and people appear as they spawn: hide them too, every frame.
    for (const kind of placed.hide)
      for (const o of deps.hideables[kind]()) {
        if (!o.visible) continue;
        o.visible = false;
        hidden.push(o);
      }
    const eye = localOf(placed.eye);
    const target = localOf(placed.target);
    // The DEM under a ground-relative point may not be in yet: keep the last pose until it is.
    if (!eye || !target) return;
    if (cam.fov !== placed.fov) {
      cam.fov = placed.fov;
      cam.updateProjectionMatrix();
    }
    // Looking (nearly) straight down, "up" cannot be the world's up: north is then the top.
    const dir = target.clone().sub(eye).normalize();
    const isStraightDown = Math.abs(dir.y) > 0.996;
    if (isStraightDown) cam.up.set(0, 0, -1);
    else cam.up.copy(gameUp);
    cam.position.copy(eye);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };

  const cameraApi = {
    /** Camera at `eye` looking at `target` (local coordinates now; kept geodetic from here on). */
    place(spot: CameraSpot) {
      const { x, z, above } = spot.eye;
      const ground = above === undefined ? null : deps.groundY(x, z);
      const isGroundless = above !== undefined && ground === null;
      if (isGroundless) return { error: `no ground loaded under the eye at ${round(x)}, ${round(z)}` };
      const y = ground !== null && above !== undefined ? ground + above : (spot.eye.y ?? 0);
      const eye = geoOf({ x, y, z });
      const target = geoOf(spot.target);
      return cameraApi.placeGeo({
        eye: { ...eye, ref: "ellipsoid" },
        target: { ...target, ref: "ellipsoid" },
        fov: spot.fov,
        hide: spot.hide,
      });
    },
    /** Camera from geodetic points (heights above the ground, T.P. or ellipsoidal). */
    placeGeo(spot: GeoSpot) {
      showHidden();
      placed = { eye: spot.eye, target: spot.target, fov: spot.fov ?? gameFov, hide: spot.hide ?? [] };
      deps.setDebugCamera((cam) => apply(cam));
      deps.onPlaced(true);
      const eye = localOf(spot.eye);
      log("debug_camera_placed", {
        lat: round(spot.eye.lat, 7),
        lon: round(spot.eye.lon, 7),
        fovDeg: placed.fov,
        isGroundReady: eye !== null,
      });
      return cameraApi.look();
    },
    /** Back to the game's camera. */
    release() {
      placed = null;
      showHidden();
      deps.setDebugCamera(null);
      deps.onPlaced(false);
      camera.fov = gameFov;
      camera.up.copy(gameUp);
      camera.updateProjectionMatrix();
      return true;
    },
    /** Where the camera is and what it looks at (the frame's JSON). */
    look() {
      const pos = plain(camera.position);
      const fwd = new Vector3();
      camera.getWorldDirection(fwd);
      return {
        eye: pos,
        geo: geoOf(pos),
        forward: plain(fwd),
        fovDeg: camera.fov,
        isPlaced: placed !== null,
      };
    },
    /** Where a local point falls on the screen: ndc −1..1, `isInView`, distance from the eye. */
    project(point: Vec3) {
      camera.updateMatrixWorld();
      const p = vec(point).project(camera);
      const isInView = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1;
      return {
        ndc: { x: round(p.x, 3), y: round(p.y, 3) },
        isInView,
        distanceM: round(camera.position.distanceTo(vec(point)), 1),
      };
    },
    /** How much of the screen a local box covers (`screenShare`) and how much of it is on it. */
    projectBox(box: { min: Vec3; max: Vec3 }) {
      camera.updateMatrixWorld();
      const corners: Array<{ x: number; y: number }> = [];
      let behind = 0;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const c = new Vector3(x, y, z);
            const isBehind = c.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0;
            if (isBehind) {
              behind++;
              continue;
            }
            const p = c.project(camera);
            corners.push({ x: p.x, y: p.y });
          }
      return screenShare(corners, behind);
    },
    /** Local ground height at x, z (null while not loaded). */
    groundAt: (x: number, z: number) => deps.groundY(x, z),
    /** Fix the sun, sky and rain at a moment (the season and hour); null: the game's own clock. */
    moment(iso: string | null, raining = false) {
      if (iso === null) {
        deps.env.showMoment(null);
        return null;
      }
      const ms = Date.parse(iso);
      const isBadDate = Number.isNaN(ms);
      if (isBadDate) return null;
      deps.env.showMoment({ ms, raining });
      return ms;
    },
  };

  // ---------- targets ----------

  const landmark = (id: string, heightShare = 0.5): Found => {
    const entry = deps.landmarks.find((e) => e.id === id);
    if (!entry) return fail("unknown-id", `no landmark ${id} in landmarks.json`);
    // The drawn model's box (near or far file, whichever is shown).
    const root = scene.getObjectByName(entry.id);
    const box = new Box3();
    root?.updateMatrixWorld(true);
    root?.traverseVisible((o) => {
      if (o instanceof Mesh) box.expandByObject(o);
    });
    if (box.isEmpty()) return fail("not-drawn", `landmark ${id} has no model drawn yet`);
    const extent = box.getSize(new Vector3());
    const point = box.getCenter(new Vector3());
    point.y = box.min.y + heightShare * extent.y;
    return {
      ok: true,
      target: {
        kind: "landmark",
        id: entry.id,
        name: entry.name,
        point: plain(point),
        normal: null,
        size: round(Math.max(extent.x, extent.y, extent.z)),
        box: { min: plain(box.min), max: plain(box.max) },
        geo: geoOf(point),
        distanceM: fromCar(point),
        isDrawn: true,
        facts: {
          heightM: round(extent.y),
          widthM: round(Math.max(extent.x, extent.z)),
          baseTp: entry.baseHeight,
        },
      },
    };
  };

  /** Every sign plate drawn now, nearest `near` first; `id` filters by 別表第一 number. */
  const signs = (q: { id?: string; note?: boolean | string; near?: Vec3; limit?: number } = {}) => {
    const read = readPosts(deps.signs);
    if (!read.ok) return read;
    const faces = faceInstances(scene.children);
    const from = q.near ?? plain(deps.carPosition());
    const isWanted = (p: PostView, id: string) => {
      const isIdOk = q.id === undefined || id === q.id;
      const notes = notesOf(p);
      const hasNote = (n: string) => notes.some((x) => x.includes(n));
      const isNoteOk =
        q.note === undefined || (typeof q.note === "string" ? hasNote(q.note) : q.note === notes.length > 0);
      return isIdOk && isNoteOk && !p.hidden;
    };
    const found: ViewTarget[] = [];
    for (const post of read.value) {
      post.plates.forEach((plate, level) => {
        if (!isWanted(post, plate.id)) return;
        const drawn = nearestInstance(faces.get(plate.file) ?? [], post.pos, post.travel);
        // Undrawn (the face not built yet): where the mount put it, or G2's 2.6 m − 1 m a level.
        const mounted = post.plateHeights?.[level] ?? 2.6 - level;
        const point =
          drawn?.pos ?? post.pos.clone().setY((deps.groundY(post.pos.x, post.pos.z) ?? 0) + mounted);
        const normal = drawn?.normal ?? post.travel.clone().negate();
        // The plate's drawing scale by number (G2: 警戒 1.3 倍 …) widens its box.
        const half = 0.45 * (plate.scale ?? 1);
        found.push({
          kind: "sign",
          id: plate.id,
          point: plain(point),
          normal: plain(normal),
          size: 2 * half,
          box: boxAround(point, { x: half, y: half, z: half }),
          geo: geoOf(point),
          distanceM: fromCar(point),
          isDrawn: drawn !== null,
          facts: {
            file: plate.file,
            level,
            platesOnPost: post.plates.map((x) => x.id),
            // Every 補助標識 on the post, and the ones hung under this plate (別表第二 備考二(二)2).
            notes: notesOf(post),
            aux: (post.auxOf[level] ?? []).map((a) => ({ sign: a.sign, lines: a.lines })),
            scale: plate.scale ?? 1,
            isParallel: plate.parallel === true,
            plateHeightM: round(point.y - (deps.groundY(point.x, point.z) ?? point.y)),
            travel: plain(post.travel),
          },
        });
      });
    }
    const sorted = found
      .toSorted((a, b) => flatDistance(a.point, from) - flatDistance(b.point, from))
      .slice(0, q.limit ?? 20);
    return { ok: true as const, value: sorted };
  };

  /**
   * 案内標識 faces standing now, nearest `near` first; `kind` filters by number ("106-A") or its
   * prefix ("105"). The point is the face's centre, the normal its front (from the face's matrix).
   */
  const guides = (q: { kind?: string; near?: Vec3; limit?: number } = {}) => {
    const all = deps.guide?.debugTargets() ?? null;
    if (!all) return { ok: false as const, reason: "not-built" as const, detail: "no guide signs" };
    const from = q.near ?? plain(deps.carPosition());
    const found: ViewTarget[] = all
      .filter((g) => !g.hidden && (q.kind === undefined || g.kind.startsWith(q.kind)))
      .map((g) => ({
        kind: "guide" as const,
        id: g.kind,
        point: plain(g.pos),
        normal: plain(g.normal),
        size: Math.max(g.width, g.height),
        box: boxAround(g.pos, { x: g.width / 2, y: g.height / 2, z: g.width / 2 }),
        geo: geoOf(g.pos),
        distanceM: fromCar(g.pos),
        isDrawn: true,
        facts: {
          widthM: round(g.width),
          heightM: round(g.height),
          letterCm: g.letterCm,
          mount: g.mount,
          beforeM: round(g.before, 1),
          bottomM: round(g.bottomM),
          layer: g.layer,
          names: g.names,
        },
      }));
    const sorted = found
      .toSorted((a, b) => flatDistance(a.point, from) - flatDistance(b.point, from))
      .slice(0, q.limit ?? 20);
    return { ok: true as const, value: sorted };
  };

  /** Signal heads (one per approach), nearest `near` first; `arrow` keeps the right-arrow ones. */
  const signals = (q: { near?: Vec3; arrow?: boolean; limit?: number } = {}) => {
    const read = readLamps(deps.control);
    if (!read.ok) return read;
    const lv = read.value;
    const from = q.near ?? plain(deps.carPosition());
    const centres = new Map<number, { sum: Vector3; n: number; hasArrow: boolean }>();
    const m = new Matrix4();
    const add = (mesh: typeof lv.lamps | null, owners: typeof lv.lampOwners, isArrow: boolean) => {
      if (!mesh) return;
      owners.forEach(({ approach }, i) => {
        mesh.getMatrixAt(i, m);
        const c = centres.get(approach.id) ?? { sum: new Vector3(), n: 0, hasArrow: false };
        c.sum.add(new Vector3().setFromMatrixPosition(m));
        c.n++;
        c.hasArrow ||= isArrow;
        centres.set(approach.id, c);
      });
    };
    add(lv.lamps, lv.lampOwners, false);
    add(lv.arrowLamps, lv.arrowOwners, true);
    const found: ViewTarget[] = [];
    for (const ap of deps.control.approaches) {
      const c = centres.get(ap.id);
      const isSignal = ap.kind === "signal" && c !== undefined;
      if (!isSignal) continue;
      const isArrowWanted = q.arrow === undefined || q.arrow === c.hasArrow;
      if (!isArrowWanted) continue;
      const point = c.sum.clone().divideScalar(c.n);
      found.push({
        kind: "signal",
        id: String(ap.id),
        point: plain(point),
        normal: plain(ap.travel.clone().setY(0).normalize().negate()),
        size: 1.6,
        box: boxAround(point, { x: 0.8, y: 0.6, z: 0.8 }),
        geo: geoOf(point),
        distanceM: fromCar(point),
        isDrawn: true,
        facts: signalFacts(ap, point),
      });
    }
    const sorted = found
      .toSorted((a, b) => flatDistance(a.point, from) - flatDistance(b.point, from))
      .slice(0, q.limit ?? 10);
    return { ok: true as const, value: sorted };
  };

  const signalFacts = (ap: Approach, point: Vector3) => ({
    approachId: ap.id,
    group: ap.group,
    lampState: deps.control.state(ap),
    right: deps.control.permits(ap, "right"),
    through: deps.control.permits(ap, "through"),
    // T4: every movement's permission and how 信号無視 would read crossing on it, without and after
    // a 一時停止 (赤の点滅 is booked only without); the walk lights of the step; night or day plan.
    permits: Object.fromEntries(MOVEMENTS.map((m) => [m, deps.control.permits(ap, m)])),
    verdicts: Object.fromEntries(
      MOVEMENTS.map((m) => {
        const p = deps.control.permits(ap, m);
        return [m, { moving: crossingVerdict(p, false), afterStop: crossingVerdict(p, true) }];
      }),
    ),
    ped: ap.controller ? { ...ap.controller.step.ped } : null,
    isNight: ap.controller?.isNight ?? false,
    step: held?.approachId === ap.id ? held.step : null,
    headHeightM: round(point.y - (deps.groundY(point.x, point.z) ?? point.y)),
    stopLine: plain(ap.a.clone().add(ap.b).multiplyScalar(0.5)),
    plan: ap.controller
      ? {
          template: ap.controller.plan.plan.template,
          cycleS: ap.controller.plan.cycle,
          walkers: ap.controller.plan.plan.walkers,
          steps: ap.controller.plan.plan.steps.map((s) => ({
            s: s.s,
            main: s.main[ap.group],
            arrows: s.arrows[ap.group] ?? [],
            all: s.main,
            ped: s.ped,
          })),
        }
      : null,
  });

  let xwChunks: Promise<XwChunk[]> | null = null;
  const loadChunks = () => {
    xwChunks ??= (async () => {
      const meta = (await (await fetch(`${deps.baseUrl}data/expressway/meta.json`)).json()) as XwMeta;
      const tiles = await Promise.all(
        meta.tiles.map(
          async (k) =>
            ((await (await fetch(`${deps.baseUrl}data/expressway/${k}.json`)).json()) as XwTile).chunks,
        ),
      );
      return tiles.flat();
    })().catch((error: unknown) => {
      xwChunks = null;
      warn("debug_target_missing", { kind: "expressway", targetId: `meta: ${String(error)}` });
      return [];
    });
    return xwChunks;
  };

  /** An expressway chunk's deck at `share` of its length (0–1), facing back along its stations. */
  const expressway = async (id: string, share = 0.5): Promise<Found> => {
    const chunk = (await loadChunks()).find((c) => c.id === id);
    if (!chunk) return fail("unknown-id", `no expressway chunk ${id} in public/data/expressway`);
    const isDrawn = scene.getObjectByName(`expressway-${chunk.id}`) !== undefined;
    if (!isDrawn)
      return fail("not-drawn", `chunk ${id} is not drawn (is ?expressway on, and the chunk within 1.5 km?)`);
    const n = Math.floor(chunk.st.length / STATION_STRIDE);
    const path: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const o = i * STATION_STRIDE;
      const [lon, lat, deck] = [chunk.st[o + 1], chunk.st[o + 2], chunk.st[o + 3]];
      path.push(deps.frame().toLocal(lat, lon, deps.ellipsoidal(lat, lon, deck)));
    }
    const at = Math.min(n - 1, Math.max(0, Math.round(share * (n - 1))));
    const ahead = path[Math.min(n - 1, at + 1)]
      .clone()
      .sub(path[Math.max(0, at - 1)])
      .setY(0)
      .normalize();
    const point = path[at];
    const width = chunk.lanes * chunk.laneWidth + chunk.shoulderL + chunk.shoulderR;
    return {
      ok: true,
      target: {
        kind: "expressway",
        id: chunk.id,
        name: chunk.name ?? chunk.ref ?? undefined,
        point: plain(point),
        // A deck "faces" the traffic coming along it: the front view is the driver's.
        normal: plain(ahead.clone().negate()),
        size: width,
        box: boxAround(point, { x: width / 2, y: 1.5, z: width / 2 }),
        path: path.map(plain),
        pathIndex: at,
        geo: geoOf(point),
        distanceM: fromCar(point),
        isDrawn,
        facts: {
          run: chunk.run,
          cls: chunk.cls,
          structure: chunk.structure,
          lanes: chunk.lanes,
          laneWidthM: chunk.laneWidth,
          widthM: round(width),
          designSpeedKmh: chunk.V,
          basis: chunk.basis,
          lengthM: round(chunk.st[(n - 1) * STATION_STRIDE] - chunk.st[0], 1),
        },
      },
    };
  };

  /** Ids of the chunks within `radiusM` of a point (nearest first), for a view table to pick. */
  const expresswayChunks = async (lat: number, lon: number, radiusM = 800) => {
    const chunks = await loadChunks();
    const here = flatOf([lat, lon]);
    return chunks
      .map((c) => {
        const mid = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
        const p = flatOf([c.st[mid + 2], c.st[mid + 1]]);
        return { id: c.id, cls: c.cls, structure: c.structure, distanceM: round(p.distanceTo(here), 1) };
      })
      .filter((c) => c.distanceM <= radiusM)
      .toSorted((a, b) => a.distanceM - b.distanceM);
  };

  /** A plain point (lat, lon, height by `ref`) as a target, facing nowhere in particular. */
  const point = (p: GeoSpot["target"], size = 10): Found => {
    const local = localOf(p);
    if (!local) return fail("not-built", `no ground loaded at ${p.lat}, ${p.lon}`);
    return {
      ok: true,
      target: {
        kind: "point",
        id: `${p.lat},${p.lon}`,
        point: plain(local),
        normal: null,
        size,
        box: boxAround(local, { x: size / 2, y: size / 2, z: size / 2 }),
        geo: geoOf(local),
        distanceM: fromCar(local),
        isDrawn: true,
        facts: {},
      },
    };
  };

  /**
   * The target of a view table's spec; `start` (the session's [lat, lon]) is where "near" defaults
   * to. Never throws: a failure says why (a renamed private field is caught here, not in the runner).
   */
  const find = async (spec: TargetQuery, start: LatLon): Promise<Found> => {
    try {
      if ("landmark" in spec) return landmark(spec.landmark, spec.heightShare);
      if ("sign" in spec) {
        const index = spec.index ?? 0;
        const near = plain(flatOf(spec.near ?? start));
        const id = spec.sign === "*" ? undefined : spec.sign;
        const r = signs({ id, note: spec.note, near, limit: index + 1 });
        return r.ok
          ? pick(r.value, index, `sign ${spec.sign}${spec.note ? " with 補助標識" : ""}`)
          : fail(r.reason, r.detail);
      }
      if ("signal" in spec) {
        const index = spec.signal.index ?? 0;
        const near = plain(flatOf(spec.signal.near ?? start));
        const r = signals({ arrow: spec.signal.arrow, near, limit: index + 1 });
        return r.ok
          ? pick(r.value, index, spec.signal.arrow ? "right-arrow signal" : "signal")
          : fail(r.reason, r.detail);
      }
      if ("guide" in spec) {
        const index = spec.guide.index ?? 0;
        const near = plain(flatOf(spec.guide.near ?? start));
        const r = guides({ kind: spec.guide.kind, near, limit: index + 1 });
        return r.ok ? pick(r.value, index, `guide ${spec.guide.kind ?? "*"}`) : fail(r.reason, r.detail);
      }
      if ("expressway" in spec) return await expressway(spec.expressway, spec.share);
      return point(spec.point);
    } catch (error) {
      return fail("renamed", `lookup threw: ${String(error)}`);
    }
  };

  /** Whether each kind of target can be read at all now (before any view asks for one). */
  const health = () => {
    const posts = readPosts(deps.signs);
    const lamps = readLamps(deps.control);
    return {
      signs: brief(posts),
      signals: lamps.ok ? { ok: true, count: lamps.value.lampOwners.length } : brief(lamps),
      landmarks: { ok: deps.landmarks.length > 0, count: deps.landmarks.length },
      guides: {
        ok: (deps.guide?.debugTargets().length ?? 0) > 0,
        count: deps.guide?.debugTargets().length ?? 0,
      },
    };
  };

  const targets = {
    find,
    health,
    landmarks: () => deps.landmarks.map((e) => ({ id: e.id, name: e.name, lat: e.lat, lon: e.lon })),
    expresswayChunks,
    /** Local position of a geodetic point now (null while its ground is not loaded). */
    local: (p: GeoSpot["target"]) => {
      const v = localOf(p);
      return v ? plain(v) : null;
    },
  };

  // ---------- holding a signal ----------

  let held: { approachId: number; step: number; clockS: number } | null = null;
  const originalUpdate = deps.control.update.bind(deps.control);
  let lastSeconds = 0;
  // The game calls control.update(now) every frame; while held, it gets the held clock instead.
  // Why not a clock-holding method on TrafficControl: the holding is dev-only and lives with the
  // other review hooks; TrafficControl only exposes update and the runs it reads.
  deps.control.update = (seconds: number, replay = false) => {
    lastSeconds = seconds;
    originalUpdate(held ? held.clockS : seconds, replay);
  };
  // The time of day the night plans read (T4): the game's, unless a view holds one (signals.clock).
  let clockMinute: number | null = null;
  let gameMinute: number | null = null;
  const originalSetTime = deps.control.setTimeOfDay.bind(deps.control);
  deps.control.setTimeOfDay = (minute: number | null) => {
    gameMinute = minute;
    originalSetTime(clockMinute ?? minute);
  };

  const signalsApi = {
    /**
     * Hold every controller's clock at the middle of `step` of approach `approachId`'s plan (an
     * index, or the first step whose main lamp for its group is green / yellow / red, or that lights
     * an arrow). Returns the step held, or why not.
     */
    hold(approachId: number, step: number | "green" | "yellow" | "red" | "arrow") {
      const ap = deps.control.approaches.find((a) => a.id === approachId);
      const c = ap?.controller;
      if (!ap || !c) return { error: `no signal approach ${approachId}` };
      const steps = c.plan.plan.steps;
      const wanted = { green: "G", yellow: "Y", red: "R" } as const;
      const k =
        typeof step === "number"
          ? step
          : steps.findIndex((s) =>
              step === "arrow" ? (s.arrows[ap.group] ?? []).length > 0 : s.main[ap.group] === wanted[step],
            );
      const isMissing = k < 0 || k >= steps.length;
      if (isMissing) return { error: `approach ${approachId}'s plan has no step ${String(step)}` };
      // The run says when that step next shows (a ScheduledRun may have moved its offset at a plan
      // change); a push-button run is held on its own clock, as before.
      const from = held?.clockS ?? lastSeconds;
      const clockS =
        "clockFor" in c.run ? c.run.clockFor(k, from) : c.plan.starts[k] + steps[k].s / 2 - c.offset;
      held = { approachId, step: k, clockS };
      originalUpdate(held.clockS);
      return { step: k, main: steps[k].main[ap.group], arrows: steps[k].arrows[ap.group] ?? [] };
    },
    release() {
      held = null;
      return true;
    },
    /**
     * Hold the time of day the signals read at `minute` after midnight (null: the game's again), and
     * run their clock on — up to three minutes, in quarter seconds — so each controller gets into
     * the plan its night window asks for (a plan changes only at a safe step). Call before `hold`.
     */
    clock(minute: number | null, untilChangeOf: number | null = null) {
      clockMinute = minute;
      originalSetTime(minute ?? gameMinute);
      // `untilChangeOf`: stop as soon as that approach's controller changes plan (to shoot the moment
      // of a change, such as the flash's way out), else run the three minutes.
      const c = deps.control.approaches.find((a) => a.id === untilChangeOf)?.controller ?? null;
      const before = c?.plan;
      let t = held?.clockS ?? lastSeconds;
      for (let i = 0; i < 720; i++) {
        originalUpdate((t += 0.25));
        const hasChanged = c !== null && c.plan !== before;
        if (hasChanged) break;
      }
      // The clock stays where the run got to: going back would read the plan from before the change.
      if (held) held = { ...held, clockS: t };
      return { minute, template: c?.plan.plan.template ?? null };
    },
  };

  /** Whether the world around has finished streaming in (the runner waits for this, not a clock). */
  const settled = () => {
    const s = deps.loadState();
    const isSettled = !s.isRoadsLoading && s.hasRoads && s.buildingsProgress >= 0.999;
    return { isSettled, ...s, buildingsProgress: round(s.buildingsProgress, 3) };
  };

  return { camera: cameraApi, targets, signals: signalsApi, settled };
}
