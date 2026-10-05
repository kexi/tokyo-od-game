import { Group, Mesh, type Material, type Object3D, type Scene } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { LocalFrame } from "../geo/frame";
import { haversineMeters } from "../geo/ellipsoid";
import { warn } from "../log";
import { sharedDraco } from "../render/draco";

/**
 * Hero models of Tokyo's landmarks (scripts/blender/landmarks.py → public/data/landmarks.json):
 * Tokyo Tower, Tokyo Skytree and Tokyo Station at their real places and heights, with their
 * night illumination switched by each operator's published schedule (Skytree's 粋・雅・幟 cycle,
 * Tokyo Tower's ランドマークライト and the Monday/Thursday ダイヤモンドヴェール). Far away only a
 * light silhouette model is drawn, in the same haze as the far skyline and ground it stands on
 * (farGround.ts, buildings.ts): its top, in thinner air, stays clear while its foot fades with the
 * streets around it, and lit at night its lights show through the haze (atmosphere.ts LIGHT_FLOOR).
 */
type Rule = {
  mode: string;
  fromDate?: string;
  toDate?: string;
  weekdays?: number[];
  from?: string;
  to?: string;
};
export type LandmarkEntry = {
  id: string;
  name: string;
  model: string;
  farModel: string;
  lon: number;
  lat: number;
  heading: number;
  baseHeight: number;
  farDistance: number;
  footprint: Array<[number, number]>;
  plateau?: Array<{ gmlId: string; hide: boolean }>;
  lightSchedule: {
    on: string;
    off: string;
    rules?: Rule[];
    cycle?: { modes: string[]; epoch: string };
    after: string;
  };
  lightModes: Array<{ id: string }>;
};
type Loaded = {
  entry: LandmarkEntry;
  root: Group;
  near: Object3D | null;
  far: Object3D | null;
  materials: Map<string, Material>;
  mode: string | null;
  isLoadingNear: boolean;
};

/**
 * m: beyond this not even the silhouette is drawn — the camera's far plane (main.ts), so a tower is
 * seen from anywhere in the 23 wards (corner to corner is close to 30 km; the 20 km of before hid
 * the Skytree from Setagaya, Nerima and Haneda).
 */
const FAR_LIMIT = 40_000;
/**
 * m: from here the silhouette widens with distance (not taller), keeping its apparent width: a
 * 634 m tower 50 m across is under 3 px wide at 25 km and its upper shaft and mast fall between
 * pixels, so it flickered out. The eye does see it as a thin line on the skyline there.
 */
const WIDEN_FROM = 15_000;

/** The landmark list (small; read before the buildings stream so their copies can be left out). */
export async function fetchLandmarks(): Promise<LandmarkEntry[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/landmarks.json`);
    return res.ok ? ((await res.json()) as LandmarkEntry[]) : [];
  } catch {
    return [];
  }
}

/** Footprints (lon/lat rings) of the PLATEAU buildings the hero models replace. */
export function replacedFootprints(entries: readonly LandmarkEntry[]): Array<Array<[number, number]>> {
  return entries.filter((e) => e.plateau?.some((p) => p.hide)).map((e) => e.footprint);
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m ?? 0);
};

/** The light mode in force (null: unlit day look) for the game's date, time and darkness. */
export function lightMode(
  entry: LandmarkEntry,
  date: { m: number; d: number; weekday: number; minutes: number; y: number },
  isDark: boolean,
): string | null {
  const s = entry.lightSchedule;
  if (!isDark) return null;
  const off = minutesOf(s.off);
  // After the switch-off (and before dawn) only the aviation lights stay on.
  if (date.minutes >= off || date.minutes < 4 * 60) return s.after;
  if (s.cycle) {
    const [ey, em, ed] = s.cycle.epoch.split("-").map(Number);
    const epoch = Date.UTC(ey, em - 1, ed);
    const days = Math.round((Date.UTC(date.y, date.m - 1, date.d) - epoch) / 86_400_000);
    const n = s.cycle.modes.length;
    return s.cycle.modes[((days % n) + n) % n];
  }
  const md = `${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  let mode: string | null = null;
  for (const r of s.rules ?? []) {
    if (r.weekdays) {
      const isTime =
        r.from && r.to ? date.minutes >= minutesOf(r.from) && date.minutes < minutesOf(r.to) : true;
      if (r.weekdays.includes(date.weekday) && isTime) mode = r.mode; // overrides the seasonal one
      continue;
    }
    if (r.fromDate && r.toDate) {
      const inRange =
        r.fromDate <= r.toDate ? md >= r.fromDate && md <= r.toDate : md >= r.fromDate || md <= r.toDate;
      if (inRange && mode === null) mode = r.mode;
    }
  }
  return mode ?? entry.lightModes[0]?.id ?? null;
}

export class Landmarks {
  private readonly loaded: Loaded[] = [];
  private readonly loader: GLTFLoader;

  constructor(
    private readonly scene: Scene,
    private frame: LocalFrame,
    private readonly ellipsoidal: (lat: number, lon: number, orthometric: number) => number,
    entries: readonly LandmarkEntry[],
  ) {
    this.loader = new GLTFLoader().setDRACOLoader(sharedDraco());
    void this.load(entries);
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    for (const l of this.loaded) this.place(l);
  }

  /** LOD by distance and the lighting for the moment. */
  update(
    lat: number,
    lon: number,
    date: { y: number; m: number; d: number; weekday: number; minutes: number },
    isDark: boolean,
  ): void {
    for (const l of this.loaded) {
      const d = haversineMeters(lat, lon, l.entry.lat, l.entry.lon);
      const wantsNear = d < l.entry.farDistance;
      if (wantsNear && !l.near && !l.isLoadingNear) void this.loadNear(l);
      if (l.near) l.near.visible = wantsNear;
      if (l.far) l.far.visible = !(wantsNear && l.near) && d < FAR_LIMIT;
      const widen = Math.max(1, d / WIDEN_FROM);
      if (l.far) l.far.scale.set(widen, 1, widen);
      const mode = lightMode(l.entry, date, isDark);
      if (mode !== l.mode) {
        l.mode = mode;
        this.applyMode(l);
      }
    }
  }

  private async load(entries: readonly LandmarkEntry[]): Promise<void> {
    try {
      for (const entry of entries) {
        const root = new Group();
        root.name = entry.id;
        const l: Loaded = {
          entry,
          root,
          near: null,
          far: null,
          materials: new Map(),
          mode: null,
          isLoadingNear: false,
        };
        this.loaded.push(l);
        this.place(l);
        this.scene.add(root);
        const far = await this.loadGltf(entry.farModel, l);
        if (!far) continue;
        // In the haze, as the city in front of it. Why not out of the fog, as before: with nothing
        // drawn under it, a crisp tower over the fog-coloured edge of the streamed world floated.
        l.far = far.scene;
        root.add(far.scene);
        l.mode = null;
      }
    } catch (error) {
      warn("landmarks_load_failed", { error: String(error) });
    }
  }

  private async loadNear(l: Loaded): Promise<void> {
    l.isLoadingNear = true;
    const near = await this.loadGltf(l.entry.model, l);
    if (!near) return;
    l.near = near.scene;
    l.root.add(near.scene);
    this.applyMode(l);
  }

  /** Loads a model and indexes all its materials by name (Day_* and every Light_<mode>_*). */
  private async loadGltf(path: string, l: Loaded): Promise<GLTF | null> {
    try {
      const gltf = await this.loader.loadAsync(`${import.meta.env.BASE_URL}${path}`);
      const materials = (await gltf.parser.getDependencies("material")) as Material[];
      for (const m of materials) l.materials.set(`${path}|${m.name}`, m);
      gltf.scene.userData.path = path;
      gltf.scene.traverse((o) => {
        if (o instanceof Mesh) o.userData.dayMaterial = o.material;
      });
      return gltf;
    } catch (error) {
      warn("landmark_model_failed", { path, error: String(error) });
      return null;
    }
  }

  /** Day_<part> → Light_<mode>_<part> where the model has one. */
  private applyMode(l: Loaded): void {
    for (const part of [l.near, l.far]) {
      if (!part) continue;
      const path = part.userData.path as string;
      part.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const day = o.userData.dayMaterial as Material;
        const lit = l.mode
          ? l.materials.get(`${path}|${day.name.replace(/^Day_/, `Light_${l.mode}_`)}`)
          : undefined;
        o.material = lit ?? day;
      });
    }
  }

  private place(l: Loaded): void {
    landmarkPose(l.entry, this.frame, this.ellipsoidal, l.root);
  }
}

/**
 * Where a landmark's model stands in the game frame: its base at the entry's T.P. height plus the
 * geoid (`ellipsoidal`), through ECEF as the ground is (so the curvature drop, ~25 m at 18 km, is
 * the ground's own), and turned to its heading. The model's +Z faces `heading` (degrees clockwise
 * from north); local −Z is north.
 */
export function landmarkPose(
  e: Pick<LandmarkEntry, "lat" | "lon" | "baseHeight" | "heading">,
  frame: LocalFrame,
  ellipsoidal: (lat: number, lon: number, orthometric: number) => number,
  into: Object3D,
): Object3D {
  into.position.copy(frame.toLocal(e.lat, e.lon, ellipsoidal(e.lat, e.lon, e.baseHeight)));
  into.rotation.set(0, Math.PI - (e.heading * Math.PI) / 180, 0);
  return into;
}
