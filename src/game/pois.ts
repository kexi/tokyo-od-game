import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import { POI_COLLECT_RADIUS, POI_VISIBLE_RADIUS } from "../config";
import type { Category, Poi } from "../data/schema";
import { haversineMeters } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import type { DemStore } from "../world/dem";

const CELL = 0.01; // degrees (~1 km) spatial hash cell
const MAX_VISIBLE = 1500;
const STORAGE_PREFIX = "tokyo-od-game:collected:";

/** Spatial index + rendering + collection state for open-data points of interest. */
export class PoiField {
  private readonly grid = new Map<string, Poi[]>();
  private readonly beams: InstancedMesh;
  private readonly gems: InstancedMesh;
  private readonly colors: Map<string, Color>;
  private visible: Poi[] = [];
  private readonly local = new Map<number, Vector3>();
  readonly collected: Set<number>;
  private spin = 0;
  private enabled: Set<string>;

  constructor(
    scene: Scene,
    readonly pois: Poi[],
    readonly categories: Category[],
    private readonly dem: DemStore,
    private frame: LocalFrame,
    private readonly storageKey = `${STORAGE_PREFIX}default`,
  ) {
    for (const p of pois) {
      const key = cellKey(p.lat, p.lon);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(p);
      else this.grid.set(key, [p]);
    }
    this.colors = new Map(categories.map((c) => [c.id, new Color(c.color)]));
    this.enabled = new Set(categories.map((c) => c.id));
    this.collected = loadCollected(this.storageKey);

    const beamGeo = new CylinderGeometry(1.1, 1.1, 60, 10, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beams = new InstancedMesh(
      beamGeo,
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.28,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: true,
      }),
      MAX_VISIBLE,
    );
    this.gems = new InstancedMesh(
      new OctahedronGeometry(2.2),
      new MeshBasicMaterial({ fog: true }),
      MAX_VISIBLE,
    );
    for (const m of [this.beams, this.gems]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    this.local.clear();
  }

  setEnabledCategories(ids: Iterable<string>): void {
    this.enabled = new Set(ids);
  }

  isEnabled(category: string): boolean {
    return this.enabled.has(category);
  }

  category(id: string): Category | undefined {
    return this.categories.find((c) => c.id === id);
  }

  near(lat: number, lon: number, radius: number): Poi[] {
    const span = Math.ceil(radius / 900);
    const cy = Math.floor(lat / CELL);
    const cx = Math.floor(lon / CELL);
    const out: Poi[] = [];
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = this.grid.get(`${cy + dy}/${cx + dx}`);
        if (!bucket) continue;
        for (const p of bucket) if (haversineMeters(lat, lon, p.lat, p.lon) <= radius) out.push(p);
      }
    }
    return out;
  }

  /** Local position of a POI on the ground (cached until the frame moves). */
  localPosition(p: Poi): Vector3 {
    let v = this.local.get(p.id);
    if (v) return v;
    const ground = this.dem.heightAt(p.lat, p.lon);
    v = this.frame.toLocal(p.lat, p.lon, ground ?? this.frame.origin.h);
    if (ground !== null) this.local.set(p.id, v);
    return v;
  }

  /** Refresh which POIs are drawn; call a few times per second. */
  refresh(lat: number, lon: number): void {
    this.visible = this.near(lat, lon, POI_VISIBLE_RADIUS)
      .filter((p) => this.enabled.has(p.category) && !this.collected.has(p.id))
      .slice(0, MAX_VISIBLE);
  }

  /** Returns POIs the player drove into this frame. */
  collect(player: Vector3): Poi[] {
    const hits: Poi[] = [];
    for (const p of this.visible) {
      const v = this.localPosition(p);
      const dx = v.x - player.x;
      const dz = v.z - player.z;
      const isInside = dx * dx + dz * dz < POI_COLLECT_RADIUS ** 2 && Math.abs(v.y - player.y) < 25;
      if (isInside) hits.push(p);
    }
    if (hits.length === 0) return hits;
    for (const p of hits) this.collected.add(p.id);
    this.visible = this.visible.filter((p) => !this.collected.has(p.id));
    saveCollected(this.storageKey, this.collected);
    return hits;
  }

  update(dt: number, nightFactor: number): void {
    this.spin += dt;
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    const pos = new Vector3();
    const bob = Math.sin(this.spin * 2) * 0.6;
    q.setFromAxisAngle(new Vector3(0, 1, 0), this.spin);
    for (let i = 0; i < this.visible.length; i++) {
      const p = this.visible[i];
      const v = this.localPosition(p);
      const color = this.colors.get(p.category) ?? new Color(0xffffff);
      m.makeTranslation(v.x, v.y, v.z);
      this.beams.setMatrixAt(i, m);
      this.beams.setColorAt(i, color);
      pos.set(v.x, v.y + 4 + bob, v.z);
      m.compose(pos, q, s);
      this.gems.setMatrixAt(i, m);
      this.gems.setColorAt(i, color);
    }
    this.beams.count = this.gems.count = this.visible.length;
    this.beams.instanceMatrix.needsUpdate = this.gems.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    (this.beams.material as MeshBasicMaterial).opacity = 0.22 + nightFactor * 0.25;
  }

  resetProgress(): void {
    this.collected.clear();
    saveCollected(this.storageKey, this.collected);
  }

  visibleList(): readonly Poi[] {
    return this.visible;
  }
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL)}/${Math.floor(lon / CELL)}`;
}

// Collected IDs are a per-viewer convenience; storage may be unavailable (private mode).
export function storageKeyFor(dataVersion: string): string {
  // POI ids are array indices, so progress is scoped to one generated data file.
  return `${STORAGE_PREFIX}${dataVersion}`;
}

function loadCollected(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollected(key: string, ids: Set<number>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore: progress simply won't persist
  }
}
