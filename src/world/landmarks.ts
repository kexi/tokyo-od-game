import { Group, Mesh, type Material, type Object3D, type Scene } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { LocalFrame } from "../geo/frame";
import { haversineMeters } from "../geo/ellipsoid";
import { warn } from "../log";

/**
 * Hero models of Tokyo's landmarks (scripts/blender/landmarks.py → public/data/landmarks.json):
 * Tokyo Tower, Tokyo Skytree and Tokyo Station at their real places and heights, with their
 * night illumination switched by each operator's published schedule (Skytree's 粋・雅・幟 cycle,
 * Tokyo Tower's ランドマークライト and the Monday/Thursday ダイヤモンドヴェール). Far away only a
 * light silhouette model is drawn, outside the fog: a 634 m tower stands above the haze from
 * kilometres off, and lit at night it is the city's landmark.
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

const FAR_LIMIT = 20_000; // m: beyond this not even the silhouette is drawn

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
    this.loader = new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
    );
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
        // Above the haze: a silhouette kilometres away is still drawn crisply (and lit at night).
        far.scene.traverse((o) => {
          if (o instanceof Mesh)
            for (const m of [o.material].flat() as Material[]) (m as Material & { fog: boolean }).fog = false;
        });
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
        if (lit && part === l.far) (lit as Material & { fog: boolean }).fog = false;
      });
    }
  }

  private place(l: Loaded): void {
    const e = l.entry;
    const p = this.frame.toLocal(e.lat, e.lon, this.ellipsoidal(e.lat, e.lon, e.baseHeight));
    l.root.position.copy(p);
    // The model's +Z faces `heading` (degrees clockwise from north); local −Z is north.
    l.root.rotation.set(0, Math.PI - (e.heading * Math.PI) / 180, 0);
  }
}
