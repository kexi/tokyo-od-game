import RAPIER from "@dimforge/rapier3d-compat";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
  type Scene,
} from "three";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import { warn } from "../log";

/**
 * 歩道 from PLATEAU 道路モデル LOD2 (2025, PDL1.0): TrafficArea polygons whose tran:function is
 * 歩道部, plus the raised 島 (traffic islands) of AuxiliaryTrafficArea. Each ward publishes its
 * own MVT (z16, extent 65536, CORS *); LOD2 covers most of 千代田・中央・台東 and parts of the
 * other wards, so outside it the game keeps its plain pavement-less streets.
 * The polygons are drawn as paving raised by a kerb and given a trimesh collider.
 */
const ASSETS = "https://assets.cms.plateau.reearth.io/assets";
const WARD_TILES: Record<string, string> = {
  千代田区: "70/2b93ce-79cf-4a0d-8601-b94f9d02d893/13101_chiyoda-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  中央区: "08/7afd12-0930-4e50-b82e-8153f0671fb3/13102_chuo-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  港区: "ca/8a14d7-0136-4bba-a7c3-d8034631b70f/13103_minato-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  新宿区: "8d/d50b37-dda9-410d-9200-542c48fe6c8e/13104_shinjuku-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  文京区: "3d/63a07d-af76-4780-8a64-f32edef6379d/13105_bunkyo-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  台東区: "ea/1c5b31-884f-4b3e-b04f-b2637a9857df/13106_taito-ku_city_2025_citygml_1_op_tran_mvt_lod2",
  墨田区: "55/644202-0dbc-4072-ae61-869865d7e460/13107_sumida-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  江東区: "33/cd84fc-f2db-49f3-84f4-32b8977bff3b/13108_koto-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  品川区: "c5/454d00-96db-4835-a886-abe47f8fb7f4/13109_shinagawa-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  目黒区: "eb/00113a-ed50-4ce0-860c-42b3f7965ec3/13110_meguro-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  大田区: "d5/9f3755-3271-44d4-85d0-2da9398df70c/13111_ota-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  世田谷区: "db/f7ed59-bbbd-43e5-9f6f-e185e1ebe68b/13112_setagaya-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  渋谷区: "5d/acf25e-5ef2-454c-8b44-aaab5faeb3f9/13113_shibuya-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  中野区: "12/829a50-f2b0-4fcc-9bf7-4c4be8758ff4/13114_nakano-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  杉並区: "e4/191a01-f3de-41d1-b4d1-718d52ff3722/13115_suginami-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  豊島区: "8c/25b272-188f-4743-bed6-54ef2fe0713f/13116_toshima-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  北区: "23/82a52b-8ef8-4872-8a2c-d259e136fe29/13117_kita-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  荒川区: "86/65d09f-b98e-47bf-87e9-5fac70e1869e/13118_arakawa-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  板橋区: "0e/73c074-767c-4ad8-b834-3b8de56e6af2/13119_itabashi-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  練馬区: "e7/77644e-4000-4a7d-bf3f-883f9346390d/13120_nerima-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  足立区: "9e/b86e17-fe5d-4def-809a-13fac0939420/13121_adachi-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  葛飾区: "0b/0e9894-84a5-44c6-9fa7-71aef41d8aaf/13122_katsushika-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
  江戸川区: "66/a420a9-0992-4546-a076-2b243c1a94f6/13123_edogawa-ku_pref_2025_citygml_1_op_tran_mvt_lod2",
};
const ZOOM = 16;
/** Kerb height. PLATEAU LOD2 has no heights across the road; 15 cm is the usual 歩道 kerb. */
export const KERB = 0.15;
const EDGE_STEP = 4; // m between vertices along a ring, so the paving follows the terrain

export type PavementKind = "sidewalk" | "island";
/** One polygon in lon/lat: outer ring first, then holes; each ring [lon, lat, lon, lat, …]. */
export type PavementPolygon = { kind: PavementKind; rings: number[][] };

export class PavementTiles {
  private readonly cache = new Map<string, Promise<PavementPolygon[]>>();

  /** The 3×3 z16 tiles around a point, from each ward in `wards` that has LOD2 roads. */
  async around(lat: number, lon: number, wards: string[]): Promise<PavementPolygon[]> {
    const cx = Math.floor(lonToTileX(lon, ZOOM));
    const cy = Math.floor(latToTileY(lat, ZOOM));
    const jobs: Promise<PavementPolygon[]>[] = [];
    for (const ward of wards) {
      const base = WARD_TILES[ward];
      if (!base) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) jobs.push(this.tile(base, cx + dx, cy + dy));
    }
    return (await Promise.all(jobs)).flat();
  }

  private tile(base: string, x: number, y: number): Promise<PavementPolygon[]> {
    const key = `${base}/${x}/${y}`;
    let p = this.cache.get(key);
    if (!p) {
      p = fetchTile(base, x, y).catch((error: unknown) => {
        warn("pavement_tile_failed", { key, error: String(error) });
        this.cache.delete(key);
        return [];
      });
      this.cache.set(key, p);
    }
    return p;
  }
}

async function fetchTile(base: string, x: number, y: number): Promise<PavementPolygon[]> {
  const res = await fetch(`${ASSETS}/${base}/${ZOOM}/${x}/${y}.mvt`);
  // Tiles outside a ward's data are missing (403 from the bucket, or 404).
  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  const out: PavementPolygon[] = [];
  for (const [layerName, wanted, kind] of [
    ["TrafficArea", "歩道部", "sidewalk"],
    ["AuxiliaryTrafficArea", "島", "island"],
  ] as const) {
    const layer = tile.layers[layerName];
    if (!layer) continue;
    const extent = layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3 || f.properties.tran_function !== wanted) continue;
      for (const rings of polygonsOf(f.loadGeometry(), extent)) {
        out.push({
          kind,
          rings: rings.map((ring) =>
            ring.flatMap((pt) => [tileXToLon(x + pt.x / extent, ZOOM), tileYToLat(y + pt.y / extent, ZOOM)]),
          ),
        });
      }
    }
  }
  return out;
}

type Pt = { x: number; y: number };

/**
 * MVT rings → polygons (outer ring, then holes), each clipped to the tile square so the buffer
 * that neighbouring tiles share is not drawn twice. Outer rings are clockwise in tile space
 * (positive shoelace sum with y down), holes anticlockwise.
 */
export function polygonsOf(rings: Pt[][], extent: number): Pt[][][] {
  const polygons: Pt[][][] = [];
  for (const ring of rings) {
    const clipped = clipToSquare(ring, extent);
    if (clipped.length < 3) continue;
    const isOuter = shoelace(ring) > 0;
    if (isOuter || polygons.length === 0) polygons.push([clipped]);
    else polygons[polygons.length - 1].push(clipped);
  }
  return polygons;
}

const shoelace = (ring: Pt[]) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
};

/** Sutherland–Hodgman against [0, extent]². */
function clipToSquare(ring: Pt[], extent: number): Pt[] {
  let pts = ring;
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= extent, (a, b) => lerpAt(a, b, (extent - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= extent, (a, b) => lerpAt(a, b, (extent - a.y) / (b.y - a.y))],
  ];
  for (const [inside, cut] of edges) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) next.push(a);
      if (aIn !== bIn) next.push(cut(a, b));
    }
    pts = next;
    if (pts.length === 0) break;
  }
  // MVT rings repeat the first point at the end; drop it so triangulation sees a clean ring.
  if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  return pts;
}

const lerpAt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Procedural interlocking paving: 20×10 cm blocks in a running bond, 1 m per texture repeat. */
function pavingTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#8f8a82";
  ctx.fillRect(0, 0, size, size);
  const bw = size / 5;
  const bh = size / 10;
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 10; row++) {
    for (let col = -1; col < 6; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      const shade = 150 + Math.floor(rand() * 40);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      ctx.fillRect(x + 1.5, row * bh + 1.5, bw - 3, bh - 3);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Raised paving with kerbs for the polygons around the player, plus a point test pedestrians use
 * to find the pavement beside a street.
 */
export class Pavements {
  private meshes: Mesh[] = [];
  private body: RAPIER.RigidBody | null = null;
  private polygons: Array<{ rings: Vector2[][]; minX: number; minZ: number; maxX: number; maxZ: number }> =
    [];
  private grid = new Map<string, number[]>();
  private readonly materials: Record<PavementKind, MeshStandardMaterial>;
  private readonly kerbMaterial = new MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85 });

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    this.materials = {
      sidewalk: new MeshStandardMaterial({ map: pavingTexture(), roughness: 0.9 }),
      // 島 are mostly medians and channelising islands: weathered concrete, darker than paving.
      island: new MeshStandardMaterial({ color: 0x7d7b76, roughness: 0.95 }),
    };
  }

  get count(): number {
    return this.polygons.length;
  }

  rebuild(polys: PavementPolygon[], frame: LocalFrame): void {
    this.clear();
    const byKind: Record<PavementKind, { pos: number[]; uv: number[]; idx: number[] }> = {
      sidewalk: { pos: [], uv: [], idx: [] },
      island: { pos: [], uv: [], idx: [] },
    };
    const kerb = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const colliderPos: number[] = [];
    const colliderIdx: number[] = [];
    for (const poly of polys) {
      const rings = poly.rings.map((r) => densify(toLocalRing(r, frame)));
      if (rings[0].length < 3) continue;
      const flat = rings.flat();
      const tris = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const heights = liftedHeights(flat, tris, (x, z) => (this.groundAt(x, z) ?? 0) + KERB);
      // Top surface.
      const b = byKind[poly.kind];
      const base = b.pos.length / 3;
      const cBase = colliderPos.length / 3;
      flat.forEach((p, i) => {
        b.pos.push(p.x, heights[i], p.y);
        b.uv.push(p.x, p.y);
        colliderPos.push(p.x, heights[i], p.y);
      });
      for (const [i, j, k] of tris) {
        // Wind each triangle to face up (+Y) whatever order the triangulator returned.
        const [pa, pb, pc] = [flat[i], flat[j], flat[k]];
        const isUp = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y) > 0;
        const [u, v] = isUp ? [j, k] : [k, j];
        b.idx.push(base + i, base + u, base + v);
        colliderIdx.push(cBase + i, cBase + u, cBase + v);
      }
      // Kerb faces round every ring, from below the road surface up to the paving.
      let offset = 0;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const ia = offset + i;
          const ic = offset + ((i + 1) % ring.length);
          const a = flat[ia];
          const c = flat[ic];
          const ya = heights[ia];
          const yc = heights[ic];
          const k0 = kerb.pos.length / 3;
          kerb.pos.push(a.x, ya, a.y, c.x, yc, c.y, c.x, yc - KERB - 0.05, c.y, a.x, ya - KERB - 0.05, a.y);
          const len = a.distanceTo(c);
          kerb.uv.push(0, 1, len, 1, len, 0, 0, 0);
          kerb.idx.push(k0, k0 + 1, k0 + 2, k0, k0 + 2, k0 + 3, k0, k0 + 2, k0 + 1, k0, k0 + 3, k0 + 2);
          const q = colliderPos.length / 3;
          colliderPos.push(a.x, ya, a.y, c.x, yc, c.y, c.x, yc - KERB, c.y, a.x, ya - KERB, a.y);
          colliderIdx.push(q, q + 1, q + 2, q, q + 2, q + 3, q, q + 2, q + 1, q, q + 3, q + 2);
        }
        offset += ring.length;
      }
      this.index(rings);
    }
    for (const kind of ["sidewalk", "island"] as const) this.addMesh(byKind[kind], this.materials[kind]);
    this.addMesh(kerb, this.kerbMaterial);
    if (colliderIdx.length) {
      this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(new Float32Array(colliderPos), new Uint32Array(colliderIdx)),
        this.body,
      );
    }
  }

  /** Is (x, z) on a pavement polygon? */
  contains(x: number, z: number): boolean {
    for (const i of this.grid.get(cellKey(x, z)) ?? []) {
      const p = this.polygons[i];
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      if (!inRing(p.rings[0], x, z)) continue;
      if (p.rings.slice(1).some((h) => inRing(h, x, z))) continue;
      return true;
    }
    return false;
  }

  clear(): void {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
    this.polygons = [];
    this.grid.clear();
  }

  private index(rings: Vector2[][]): void {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of rings[0]) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    const id = this.polygons.length;
    this.polygons.push({ rings, minX, minZ, maxX, maxZ });
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        const list = this.grid.get(key) ?? [];
        list.push(id);
        this.grid.set(key, list);
      }
    }
  }

  private addMesh(b: { pos: number[]; uv: number[]; idx: number[] }, material: MeshStandardMaterial): void {
    if (b.idx.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    mesh.receiveShadow = true;
    // Above the road surface and its markings where they overlap.
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }
}

const CELL = 32;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

function toLocalRing(ring: number[], frame: LocalFrame): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const v = frame.toLocal(ring[i + 1], ring[i], frame.origin.h);
    out.push(new Vector2(v.x, v.z));
  }
  return out;
}

/**
 * Vertex heights for a triangulated polygon: ground + kerb at each vertex, then raised wherever
 * the ground inside a long triangle (a wide pavement spans tens of metres between ring
 * vertices) would stand above the interpolated paving, so the road surface never shows through.
 * Shared vertices keep the surface watertight.
 */
export function liftedHeights(
  pts: Vector2[],
  tris: number[][],
  heightAt: (x: number, z: number) => number,
): number[] {
  const h = pts.map((p) => heightAt(p.x, p.y));
  for (let pass = 0; pass < 2; pass++) {
    const lift = Array.from({ length: pts.length }, () => 0);
    for (const t of tris) {
      const probes: Array<[number, number, number]> = [
        [1 / 3, 1 / 3, 1 / 3],
        [0.5, 0.5, 0],
        [0, 0.5, 0.5],
        [0.5, 0, 0.5],
      ];
      for (const [wa, wb, wc] of probes) {
        const x = pts[t[0]].x * wa + pts[t[1]].x * wb + pts[t[2]].x * wc;
        const z = pts[t[0]].y * wa + pts[t[1]].y * wb + pts[t[2]].y * wc;
        const deficit = heightAt(x, z) - (h[t[0]] * wa + h[t[1]] * wb + h[t[2]] * wc);
        if (deficit > 0) for (const i of t) lift[i] = Math.max(lift[i], deficit);
      }
    }
    for (let i = 0; i < h.length; i++) h[i] += lift[i];
  }
  return h;
}

/** Extra vertices along long edges so the paving follows the ground. */
function densify(ring: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const n = Math.floor(a.distanceTo(b) / EDGE_STEP);
    for (let k = 1; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

function inRing(ring: Vector2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
