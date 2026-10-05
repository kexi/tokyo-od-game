import RAPIER from "@dimforge/rapier3d-compat";
import { reanchorBody } from "../physics/reanchor";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Frustum,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Plane,
  type RenderTarget,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  type Scene,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { holdShadows, sceneTarget } from "../render/frame";
import { clipNearTo, depthRange } from "../render/obliqueClip";
import { TERRAIN_ZOOM } from "../config";
import { GRAPHICS, QUALITY } from "../device";
import { haversineMeters } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import { warn } from "../log";
import { FrameWork } from "../game/frameWork";
import { SerialWork } from "../game/serialWork";
import { roadGeometrySteps } from "./roadGeometrySteps";
import { updateRoadGeometry } from "./roadGeometry";
import type { DemStore } from "./dem";
import type { Environment } from "./environment";
import { gsiVectorTile } from "./gsiVectorTiles";
import type { RoadGraph, Segment } from "./roads";
import { meshHeightAt, type GroundWater } from "./terrain";
import type { Tide } from "./tide";
import { createWaterMaterial } from "./waterMaterial";
import { WaterCompute } from "./waterCompute";
import {
  applyGauges,
  chooseLevel,
  DECK_CLEARANCE,
  deckHeights,
  fillUnknown,
  GAUGE_REACH,
  isClipEdge,
  triangulate,
  WATER_ZOOM,
  waterPolygons,
  type Bay,
  type Gauge,
  type LevelChoice,
  type LevelSamples,
  type WaterPolygon,
} from "./waterGeometry";

/** Raster resolution per z16 tile (~497 m): ~1 m on desktop, ~2 m on phones. */
const RASTER = QUALITY.isMobile ? 256 : 512;
/** z16 tiles around the player: the roads' 3×3, plus a ring beyond it on desktop for the view. */
const INNER = 1;
const OUTER = QUALITY.isMobile ? 1 : 2;
/** Metres between vertices along a shore (levels and walls follow the ground between them). */
const SHORE_STEP = 6;
/** Radius and spacing (m) of the DEM samples that set the level at a shore vertex. */
const SAMPLE_RADIUS = 30;
const SAMPLE_STEP = 5;
/** Shore walls reach this far below the still level (the tide falls ~1 m below the mean). */
const WALL_DEPTH = 3;
/** 胸壁 (parapet) along shores that stand well above the water: height and thickness (m). */
const PARAPET = 0.9;
const PARAPET_THICK = 0.22;
const PARAPET_ABOVE = 1.5;
/** A bridge deck: sidewalks either side of the carriageway, the girder depth, the 高欄 height. */
const DECK_SIDEWALK = 2.5;
const DECK_DEPTH = 1.3;
const RAILING = 1.0;
const DECK_STEP = 2;
/** How far beyond the water's edge a bridge looks for the top of its embankment (m). */
const BANK_REACH = 12;
/** Reflections are drawn only for water this close (m), and at this fraction of the frame size. */
const REFLECT_RANGE = 1500;
const REFLECT_SCALE = 0.5;
const REFLECT_EVERY = 2;
const REFLECT_FAR = 1800;

/** Metres per global z16 unit at a latitude (Web Mercator is conformal: same in x and y). */
const metresPerUnit = (lat: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** WATER_ZOOM;

type ShoreRing = {
  /** Densified ring, global z16 units, flat [x, y, …]. */
  pts: number[];
  /** Still level (T.P. m) at each point, and how much of the bay's tide it follows (0 … 1.2). */
  level: Float32Array;
  tide: Float32Array;
};

type WaterTile = {
  x: number;
  y: number;
  /** Bumped when the polygons or levels change (the ground's cut-out follows it). */
  version: number;
  polygons: WaterPolygon[];
  raster: Uint8Array;
  /** The ground's cut-out: anti-aliased water (0–255) grown by a pixel (see dilate). */
  cut: Uint8Array;
  shores: ShoreRing[][] | null;
  surface: Mesh<BufferGeometry> | null;
  walls: Mesh<BufferGeometry> | null;
  /** Local bounding sphere of the surface, for view tests. */
  sphere: Sphere;
  /** Every few surface vertices (local x, y, z, tide share, T.P. level), to find the water nearest a point. */
  probe: Float32Array;
};

type Span = {
  seg: Segment;
  s0: number;
  s1: number;
  /** Deck height (local y) every DECK_STEP from s0. */
  heights: number[];
  half: number;
};

/**
 * Rivers, canals and the bay from GSI's vector tiles (`waterarea`, 2,500-level 水域 polygons),
 * streamed with the roads around the player. Each z16 tile becomes a triangulated surface at the
 * level the data gives (waterGeometry.chooseLevel: the tide for tidal water, DEM5A's surveyed
 * surface for the rest), shore walls down from the drawn ground, and the ground cut out and made
 * non-solid under it (GroundWater). Roads crossing water get bridge decks with colliders, since
 * the DEM under a bridge is the riverbed.
 */
export class WaterLayer implements GroundWater {
  private readonly tiles = new Map<string, WaterTile>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly masks = new WaterCompute();
  private disposed = false;
  /** Water-level gauges (東京都・国土交通省), baked by scripts/water-levels.ts. */
  private readonly gauges: Promise<Gauge[]>;
  private gaugeList: Gauge[] = [];
  private bay: Bay;
  private readonly material = createWaterMaterial(QUALITY.isMobile ? 2 : 4);
  private readonly wallMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.92,
    side: DoubleSide,
  });
  private readonly deckMaterial = new MeshStandardMaterial({
    color: 0x9b9890,
    roughness: 0.9,
    side: DoubleSide,
  });
  private readonly tileWork = new SerialWork();
  private frame: LocalFrame;
  private centre = { x: 0, y: 0 };
  private spans: Span[] = [];
  private spanGrid = new Map<number, number[]>();
  private deckMesh: Mesh | null = null;
  private deckBody: RAPIER.RigidBody | null = null;
  private shoreBody: RAPIER.RigidBody | null = null;
  private graph: RoadGraph | null = null;
  private deckToCurrent = new Matrix4();
  private currentToDeck = new Matrix4();
  private reflection: RenderTarget | null = null;
  private readonly mirror = new PerspectiveCamera();
  private planeY: number | null = null;
  private planeCheckedAt = 0;
  private reflectFrame = 0;
  /** The camera the reflection was drawn for; other views (mirrors, phone shots) get the sky. */
  private reflectedFor: PerspectiveCamera | null = null;
  private reflectionOn = 0;
  private culled: Object3D[] = [];
  private cullCheckedAt = -Infinity;
  private readonly frustum = new Frustum();
  private readonly tmpMatrix = new Matrix4();

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly dem: DemStore,
    private readonly tide: Tide,
    frame: LocalFrame,
  ) {
    this.frame = frame;
    this.bay = { mean: tide.meanLevel, range: BAY_RANGE, still: tide.meanLevel };
    this.gauges = fetch(`${import.meta.env.BASE_URL}data/water-levels.json`)
      .then((r) => (r.ok ? (r.json() as Promise<GaugeFile>) : null))
      .then((file) => {
        this.gaugeList = file?.gauges ?? [];
        if (file) this.bay = { mean: file.bay.mean, range: file.bay.range, still: tide.meanLevel };
        return this.gaugeList;
      })
      .catch((error: unknown) => {
        warn("water_levels_failed", { error: String(error) });
        return [];
      });
  }

  /** Water in the tiles around a point; resolves once the roads' 3×3 is in (the ring follows). */
  async around(lat: number, lon: number): Promise<void> {
    if (this.disposed) return;
    const cx = Math.floor(lonToTileX(lon, WATER_ZOOM));
    const cy = Math.floor(latToTileY(lat, WATER_ZOOM));
    this.centre = { x: cx, y: cy };
    const inner: Promise<void>[] = [];
    for (let dy = -OUTER; dy <= OUTER; dy++) {
      for (let dx = -OUTER; dx <= OUTER; dx++) {
        const job = this.load(cx + dx, cy + dy);
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= INNER) inner.push(job);
      }
    }
    for (const [key, tile] of this.tiles) {
      const isFar = Math.max(Math.abs(tile.x - cx), Math.abs(tile.y - cy)) > OUTER + 1;
      if (!isFar) continue;
      this.disposeTile(tile);
      this.tiles.delete(key);
    }
    await Promise.all(inner);
  }

  /** The local frame moved (floating origin): everything is placed again from lon/lat. */
  setFrame(frame: LocalFrame): void {
    const matrix = frame.transformFrom(this.frame);
    const rotation = frame.rotationFrom(this.frame);
    this.frame = frame;
    this.deckToCurrent.premultiply(matrix);
    this.currentToDeck.copy(this.deckToCurrent).invert();
    this.deckMesh?.applyMatrix4(matrix);
    for (const body of [this.deckBody, this.shoreBody]) {
      if (body) reanchorBody(body, matrix, rotation);
    }
    const point = new Vector3();
    for (const tile of this.tiles.values()) {
      tile.surface?.applyMatrix4(matrix);
      tile.walls?.applyMatrix4(matrix);
      tile.sphere.applyMatrix4(matrix);
      for (let i = 0; i < tile.probe.length; i += 5) {
        point.fromArray(tile.probe, i).applyMatrix4(matrix);
        point.toArray(tile.probe, i);
      }
    }
  }

  /** The river of the nearest water-level gauge within `metres`, and the gauge's name (often a bridge). */
  riverNear(lat: number, lon: number, metres: number): { river: string; gauge: string } | null {
    let best: { river: string; gauge: string; d: number } | null = null;
    for (const g of this.gaugeList) {
      const d = haversineMeters(lat, lon, g.lat, g.lon);
      const isCloser = d < metres && (!best || d < best.d);
      if (isCloser) best = { river: g.river, gauge: g.name, d };
    }
    return best && { river: best.river, gauge: best.gauge };
  }

  // ---------- GroundWater (the terrain's cut-out and non-solid riverbed) ----------

  versionAt(x: number, y: number): number {
    let v = 0;
    for (const t of this.quarters(x, y)) v += t ? t.version * 4 + 1 : 0;
    return v;
  }

  maskAt(x: number, y: number): { data: Uint8Array; size: number } | null {
    const quarters = this.quarters(x, y);
    const hasWater = quarters.some((t) => t && t.polygons.length > 0);
    if (!hasWater) return null;
    const size = RASTER * 2;
    const data = new Uint8Array(size * size);
    quarters.forEach((t, q) => {
      if (!t || t.polygons.length === 0) return;
      const ox = (q % 2) * RASTER;
      const oy = Math.floor(q / 2) * RASTER;
      for (let j = 0; j < RASTER; j++)
        data.set(t.cut.subarray(j * RASTER, (j + 1) * RASTER), (oy + j) * size + ox);
    });
    return { data, size };
  }

  /** The four z16 tiles of a z15 chunk (NW, NE, SW, SE). */
  private quarters(x: number, y: number): Array<WaterTile | undefined> {
    const k = WATER_ZOOM - TERRAIN_ZOOM;
    const n = 2 ** k;
    const out: Array<WaterTile | undefined> = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) out.push(this.tiles.get(`${x * n + i}/${y * n + j}`));
    return out;
  }

  /** Is the global z16 point on water (as far as the loaded tiles know)? */
  isWater(gx: number, gy: number): boolean {
    const tile = this.tiles.get(`${Math.floor(gx)}/${Math.floor(gy)}`);
    if (!tile || tile.polygons.length === 0) return false;
    const i = Math.min(RASTER - 1, Math.floor((gx - tile.x) * RASTER));
    const j = Math.min(RASTER - 1, Math.floor((gy - tile.y) * RASTER));
    return tile.raster[j * RASTER + i] === 1;
  }

  /** Has the water of the tile under a local point been loaded (it may have none)? */
  isKnownLocal(x: number, z: number): boolean {
    const g = this.frame.toGeodetic(new Vector3(x, 0, z));
    return this.tiles.has(
      `${Math.floor(lonToTileX(g.lon, WATER_ZOOM))}/${Math.floor(latToTileY(g.lat, WATER_ZOOM))}`,
    );
  }

  /** Is the local point on water? */
  isWaterLocal(x: number, z: number): boolean {
    const g = this.frame.toGeodetic(new Vector3(x, 0, z));
    return this.isWater(lonToTileX(g.lon, WATER_ZOOM), latToTileY(g.lat, WATER_ZOOM));
  }

  /** Is a local point well inside the water (2 m from any shore) and off every bridge deck? */
  isAdrift(p: Vector3): boolean {
    if (this.deckAt(p.x, p.z) !== null) return false;
    return [
      [0, 0],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ].every(([dx, dz]) => this.isWaterLocal(p.x + dx, p.z + dz));
  }

  // ---------- bridges ----------

  /**
   * Bridge decks for the streets crossing water, rebuilt with the road network. Afterwards
   * `deckAt` answers for the ground height on a bridge, and the shore walls are rebuilt so they
   * stop under the decks.
   */
  setRoads(graph: RoadGraph): void {
    for (const _ of this.roadSteps(graph)) {
      /* synchronous compatibility path */
    }
  }

  setRoadsAsync(graph: RoadGraph, work: FrameWork): Promise<void> {
    return work.run(this.roadSteps(graph));
  }

  private *roadSteps(graph: RoadGraph): Generator<void> {
    const spans: Span[] = [];
    const grid = new Map<number, number[]>();
    for (const seg of graph.segments) {
      if (seg.line.kind === "highway") continue;
      for (const span of this.spansOf(graph, seg)) this.addSpan(span, graph, spans, grid);
      yield;
    }
    // Keep the old deck and its collider during the scan; replace both before physics runs again.
    this.graph = graph;
    this.clearDecks();
    this.spans = spans;
    this.spanGrid = grid;
    this.deckToCurrent.identity();
    this.currentToDeck.identity();
    this.buildDecks();
    yield;
    for (const tile of this.tiles.values()) {
      yield* this.wallSteps(tile);
      yield;
    }
    this.buildShoreColliders();
  }

  /** Height (local y) of a bridge deck at the point, or null off bridges. */
  deckAt(x: number, z: number): number | null {
    const p = new Vector3(x, 0, z).applyMatrix4(this.currentToDeck);
    const ids = this.spanGrid.get(gridKey(p.x, p.z));
    if (!ids) return null;
    let best: number | null = null;
    for (const id of ids) {
      const span = this.spans[id];
      const hit = nearestOnSegment(span.seg, p);
      const isOnDeck = hit.dist <= span.half && hit.s >= span.s0 && hit.s <= span.s1;
      if (!isOnDeck) continue;
      const h = new Vector3(p.x, profileAt(span, hit.s), p.z).applyMatrix4(this.deckToCurrent).y;
      if (best === null || h > best) best = h;
    }
    return best;
  }

  /** Where along the segment the street is on water, as spans with their deck heights. */
  private spansOf(graph: RoadGraph, seg: Segment): Span[] {
    const n = Math.max(1, Math.ceil(seg.length / DECK_STEP));
    const wet: boolean[] = [];
    const pos = new Vector3();
    for (let k = 0; k <= n; k++) {
      graph.sample(seg, (k / n) * seg.length, pos);
      wet.push(this.isWaterLocal(pos.x, pos.z));
    }
    const out: Span[] = [];
    let k = 0;
    while (k <= n) {
      if (!wet[k]) {
        k++;
        continue;
      }
      const first = k;
      while (k <= n && wet[k]) k++;
      const last = k - 1;
      const sa = (first / n) * seg.length;
      const sb = (last / n) * seg.length;
      // GSI marks bridges (ftCode 2703); on other streets a short wet run is a bank road brushing
      // the polygon, not a crossing.
      const isCrossing = seg.line.bridge === true || sb - sa >= 15 || first === 0 || last === n;
      if (!isCrossing) continue;
      const span = this.spanFor(graph, seg, sa, sb);
      if (span) out.push(span);
    }
    return out;
  }

  /**
   * The deck over one wet run [sa, sb] of a segment. A bridge is often several segments (split at
   * tile edges and junctions), so the banks are found by walking on along the straightest street
   * from each end that is still on water; every piece then takes its share of one profile.
   */
  private spanFor(graph: RoadGraph, seg: Segment, sa: number, sb: number): Span | null {
    // Each bank is the highest ground within BANK_REACH of the water along the street: the DEM
    // right at the water's edge is pulled down by the channel (両国橋: 1.3 m at the east edge, 4.1 m
    // a few metres on), and the deck should land on the embankment, not dip to the edge. A bridge is
    // often several segments (split at tile edges and junctions), so the search walks on along the
    // straightest street; every piece then takes its share of one profile.
    const before = this.bankFrom(graph, seg, sa, -1);
    const after = this.bankFrom(graph, seg, sb, 1);
    const mid = graph.sample(seg, (sa + sb) / 2).pos;
    const water = this.levelLocal(mid.x, mid.z);
    const high = water.y + water.tide * this.tide.amplitude;
    // A street that ends on the water (its continuation lies outside the loaded tiles) gets a
    // level deck at its known bank's height, or just clear of the water if neither end is known.
    const bankA = before?.height ?? after?.height ?? high + DECK_CLEARANCE;
    const bankB = after?.height ?? bankA;
    // Profile from bank A to bank B, in this segment's s (beyond its ends where the bridge goes on).
    const startS = before ? sa - before.dist : Math.min(0, sa);
    const endS = after ? sb + after.dist : Math.max(seg.length, sb);
    const heights = deckHeights(endS - startS, DECK_STEP, bankA, bankB, high);
    // Keep this segment's part.
    const s0 = Math.max(0, startS);
    const s1 = Math.min(seg.length, endS);
    const from = Math.round((s0 - startS) / DECK_STEP);
    const to = Math.round((s1 - startS) / DECK_STEP);
    const part = heights.slice(from, to + 1);
    if (part.length < 2) return null;
    return {
      seg,
      s0: startS + from * DECK_STEP,
      s1: startS + (from + part.length - 1) * DECK_STEP,
      heights: part,
      half: seg.line.width / 2 + DECK_SIDEWALK,
    };
  }

  /**
   * Walk the street from `s` on `seg` away from the water (way −1 toward seg.from, +1 toward seg.to,
   * on through nodes along the straightest street) to the first land, then on BANK_REACH: the
   * highest ground there and how far along it is; null if the street never reaches land.
   */
  private bankFrom(
    graph: RoadGraph,
    seg: Segment,
    s: number,
    way: 1 | -1,
  ): { dist: number; height: number } | null {
    let cur = seg;
    let at = s;
    let dir = way;
    let walked = 0;
    let best: { dist: number; height: number } | null = null;
    let dryAt = -1;
    const pos = new Vector3();
    for (let hops = 0; walked < 1500 && hops < 16;) {
      let next = at + dir * DECK_STEP;
      const isPastEnd = next < 0 || next > cur.length;
      if (isPastEnd) {
        const node = dir > 0 ? cur.to : cur.from;
        const over = dir > 0 ? next - cur.length : -next;
        const arriving = leavingDir(cur, node).negate();
        let follow: Segment | null = null;
        let bestDot = 0.7;
        for (const id of graph.nodes.get(node) ?? []) {
          const cand = graph.segments[id];
          if (cand === cur || cand.line.kind === "highway") continue;
          const d = leavingDir(cand, node).dot(arriving);
          if (d > bestDot) {
            bestDot = d;
            follow = cand;
          }
        }
        if (!follow) break;
        hops++;
        dir = follow.from === node ? 1 : -1;
        next = dir > 0 ? Math.min(over, follow.length) : Math.max(0, follow.length - over);
        cur = follow;
      }
      at = next;
      walked += DECK_STEP;
      graph.sample(cur, at, pos);
      const isWet = this.isWaterLocal(pos.x, pos.z);
      if (dryAt < 0 && isWet) continue;
      if (dryAt >= 0 && (isWet || walked > dryAt + BANK_REACH)) break;
      if (dryAt < 0) dryAt = walked;
      const h = this.groundLocal(pos.x, pos.z);
      if (h !== null && (best === null || h > best.height)) best = { dist: walked, height: h };
    }
    return best;
  }

  private addSpan(span: Span, graph: RoadGraph, spans: Span[], grid: Map<number, number[]>): void {
    const id = spans.length;
    spans.push(span);
    const cells = new Set<number>();
    const pos = new Vector3();
    for (let s = span.s0; s <= span.s1 + 1e-6; s += DECK_STEP / 2) {
      graph.sample(span.seg, s, pos);
      const r = span.half + 1;
      for (const [ox, oz] of [
        [-r, -r],
        [r, -r],
        [-r, r],
        [r, r],
        [0, 0],
      ])
        cells.add(gridKey(pos.x + ox, pos.z + oz));
    }
    for (const c of cells) {
      const list = grid.get(c) ?? [];
      list.push(id);
      grid.set(c, list);
    }
  }

  /** Deck slabs, girders and 高欄 for every span, with one fixed collider for them all. */
  private buildDecks(): void {
    const graph = this.graph;
    if (!graph || this.spans.length === 0) return;
    const pos: number[] = [];
    const idx: number[] = [];
    const cPos: number[] = [];
    const cIdx: number[] = [];
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, solid: boolean) => {
      const k = pos.length / 3;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      if (!solid) return;
      const q = cPos.length / 3;
      cPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
      cIdx.push(q, q + 1, q + 2, q, q + 2, q + 3);
    };
    const p = new Vector3();
    const dir = new Vector3();
    for (const [id, span] of this.spans.entries()) {
      const edges: Array<{ l: Vector3; r: Vector3; y: number; railL: boolean; railR: boolean }> = [];
      span.heights.forEach((y, k) => {
        graph.sample(span.seg, span.s0 + k * DECK_STEP, p, dir);
        const side = new Vector3(dir.z, 0, -dir.x);
        const l = p.clone().addScaledVector(side, span.half);
        const r = p.clone().addScaledVector(side, -span.half);
        // No 高欄 where a parallel carriageway's deck continues the bridge sideways.
        const railL = !this.otherDeckAt(l.clone().addScaledVector(side, 1.2), id);
        const railR = !this.otherDeckAt(r.clone().addScaledVector(side, -1.2), id);
        edges.push({ l: l.setY(y - 0.03), r: r.setY(y - 0.03), y, railL, railR });
      });
      for (let k = 1; k < edges.length; k++) {
        const a = edges[k - 1];
        const b = edges[k];
        const down = (v: Vector3) => v.clone().setY(v.y - DECK_DEPTH);
        const up = (v: Vector3) => v.clone().setY(v.y + RAILING);
        quad(a.l, b.l, b.r, a.r, true); // deck top (the road is drawn on it by the road layer)
        quad(down(a.r), down(b.r), down(b.l), down(a.l), false); // soffit
        quad(down(a.l), down(b.l), b.l, a.l, false); // girder faces
        quad(a.r, b.r, down(b.r), down(a.r), false);
        if (a.railL && b.railL) quad(a.l, b.l, up(b.l), up(a.l), true);
        if (a.railR && b.railR) quad(up(a.r), up(b.r), b.r, a.r, true);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.deckMesh = new Mesh(g, this.deckMaterial);
    this.deckMesh.receiveShadow = true;
    this.deckMesh.castShadow = true;
    this.deckMesh.name = "bridge-decks";
    this.scene.add(this.deckMesh);
    if (cIdx.length === 0) return;
    this.deckBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(cPos), new Uint32Array(cIdx)).setFriction(1.0),
      this.deckBody,
    );
  }

  private otherDeckAt(p: Vector3, except: number): boolean {
    for (const id of this.spanGrid.get(gridKey(p.x, p.z)) ?? []) {
      if (id === except) continue;
      const span = this.spans[id];
      const hit = nearestOnSegment(span.seg, p);
      if (hit.dist <= span.half && hit.s >= span.s0 && hit.s <= span.s1) return true;
    }
    return false;
  }

  private clearDecks(): void {
    this.spans = [];
    this.spanGrid.clear();
    if (this.deckMesh) {
      this.scene.remove(this.deckMesh);
      this.deckMesh.geometry.dispose();
      this.deckMesh = null;
    }
    if (this.deckBody) this.world.removeRigidBody(this.deckBody);
    this.deckBody = null;
  }

  // ---------- tiles ----------

  private load(x: number, y: number): Promise<void> {
    const key = `${x}/${y}`;
    if (this.tiles.has(key)) return Promise.resolve();
    let job = this.loading.get(key);
    if (job) return job;
    job = this.fetchTile(x, y)
      .catch((error: unknown) => {
        if (this.disposed) return;
        warn("water_tile_failed", { key, error: String(error) });
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, job);
    return job;
  }

  private async fetchTile(x: number, y: number): Promise<void> {
    const vt = await gsiVectorTile(WATER_ZOOM, x, y);
    if (!this.isCurrentTile(x, y)) return;
    const layer = vt?.layers.waterarea;
    const polygons: WaterPolygon[] = [];
    const features = layer ? Array.from({ length: layer.length }, (_unused, i) => layer.feature(i)) : [];
    for (const f of features) {
      if (f.type !== 3 || !layer) continue;
      polygons.push(...waterPolygons(f.loadGeometry(), x, y, layer.extent));
    }
    const { raster, cut } = await this.masks.rasterize(polygons, x, y, RASTER);
    if (!this.isCurrentTile(x, y)) return;
    const tile: WaterTile = {
      x,
      y,
      version: 1,
      polygons,
      raster,
      cut,
      shores: null,
      surface: null,
      walls: null,
      sphere: new Sphere(),
      probe: new Float32Array(0),
    };
    this.tiles.set(`${x}/${y}`, tile);
    if (polygons.length === 0) return;
    // Levels and walls read the DEM around the tile: its z15 parent, and the parents' neighbours on
    // the sides this quarter touches (samples reach 30 m across the border).
    const k = WATER_ZOOM - TERRAIN_ZOOM;
    const [px, py] = [x >> k, y >> k];
    const sx = x % 2 === 0 ? -1 : 1;
    const sy = y % 2 === 0 ? -1 : 1;
    const jobs: Promise<unknown>[] = [];
    for (const [cx, cy] of [
      [px, py],
      [px + sx, py],
      [px, py + sy],
      [px + sx, py + sy],
    ]) {
      jobs.push(this.dem.load(cx, cy), this.dem.loadSurveyed(cx, cy));
    }
    jobs.push(this.gauges);
    await Promise.all(jobs);
    if (this.tiles.get(`${x}/${y}`) !== tile) return;
    await this.tileWork.run(async () => {
      const isCurrent = this.tiles.get(`${x}/${y}`) === tile;
      if (!isCurrent) return;
      const work = new FrameWork();
      const shores: ShoreRing[][] = [];
      for (const poly of tile.polygons) {
        const rings: ShoreRing[] = [];
        for (const ring of poly) rings.push(await work.run(this.shoreRingSteps(ring)));
        shores.push(rings);
      }
      const stillCurrent = this.tiles.get(`${x}/${y}`) === tile;
      if (!stillCurrent) return;
      tile.shores = shores;
      tile.version++;
      await work.run(this.surfaceSteps(tile));
      await work.yield();
      await work.run(this.wallSteps(tile));
    });
  }

  private isCurrentTile(x: number, y: number): boolean {
    return !this.disposed && Math.max(Math.abs(x - this.centre.x), Math.abs(y - this.centre.y)) <= OUTER + 1;
  }

  /** A ring densified to SHORE_STEP with the still level at each point. */
  private *shoreRingSteps(ring: number[]): Generator<void, ShoreRing> {
    const n = ring.length / 2;
    const lat0 = tileYToLat(ring[1], WATER_ZOOM);
    const step = SHORE_STEP / metresPerUnit(lat0);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2];
      const ay = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2];
      const by = ring[((i + 1) % n) * 2 + 1];
      const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let p = 0; p < parts; p++) pts.push(ax + ((bx - ax) * p) / parts, ay + ((by - ay) * p) / parts);
    }
    const m = pts.length / 2;
    const level = new Float32Array(m);
    const tide = new Float32Array(m);
    const raw: LevelChoice[] = [];
    for (let i = 0; i < m; i++) {
      raw.push(this.levelAt(pts[i * 2], pts[i * 2 + 1]));
      const checkpoint = i % 8 === 0;
      if (checkpoint) yield;
    }
    const choices = fillUnknown(raw, this.bay.still);
    for (const [i, choice] of choices.entries()) {
      level[i] = choice.level;
      tide[i] = choice.tide;
    }
    // A running median of five along the shore irons out single odd samples (a boat, a pier).
    const smoothed = level.slice();
    for (let i = 0; i < m; i++) {
      if (tide[i] > 0) continue;
      const w: number[] = [];
      for (let d = -2; d <= 2; d++) {
        const j = (i + d + m) % m;
        if (tide[j] === 0) w.push(level[j]);
      }
      w.sort((a, b) => a - b);
      smoothed[i] = w[Math.floor(w.length / 2)];
    }
    return { pts, level: smoothed, tide };
  }

  /** Level at a global z16 point: the DEM's, corrected by the gauges within GAUGE_REACH. */
  private levelAt(gx: number, gy: number): LevelChoice {
    const choice = chooseLevel(this.samplesAt(gx, gy), this.bay.still);
    if (choice.source === "unknown") return choice;
    const lat = tileYToLat(gy, WATER_ZOOM);
    const lon = tileXToLon(gx, WATER_ZOOM);
    const near: Array<{ gauge: Gauge; metres: number }> = [];
    for (const gauge of this.gaugeList) {
      const metres = haversineMeters(lat, lon, gauge.lat, gauge.lon);
      if (metres < GAUGE_REACH) near.push({ gauge, metres });
    }
    return applyGauges(choice, near, this.bay);
  }

  /** DEM samples within SAMPLE_RADIUS of a global z16 point, split into water and land. */
  private samplesAt(gx: number, gy: number): LevelSamples {
    const unit = metresPerUnit(tileYToLat(gy, WATER_ZOOM));
    const surveyed: number[] = [];
    const filled: number[] = [];
    const land: number[] = [];
    const k = 2 ** (TERRAIN_ZOOM - WATER_ZOOM) * 256; // global z16 units → global z15 pixels
    for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy += SAMPLE_STEP) {
      for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx += SAMPLE_STEP) {
        if (dx * dx + dy * dy > SAMPLE_RADIUS * SAMPLE_RADIUS) continue;
        const px = gx + dx / unit;
        const py = gy + dy / unit;
        const h = this.dem.surveyedAt(px * k, py * k);
        if (this.isWater(px, py)) {
          if (Number.isFinite(h)) surveyed.push(h);
          filled.push(this.dem.sampleGlobal(px * k, py * k));
        } else if (Number.isFinite(h)) {
          land.push(h);
        }
      }
    }
    return { surveyed, filled, land };
  }

  /** Still level (local y, without the tide) near a local point, and its share of the tide. */
  private levelLocal(x: number, z: number): { y: number; tide: number } {
    const g = this.frame.toGeodetic(new Vector3(x, 0, z));
    const judged = this.levelAt(lonToTileX(g.lon, WATER_ZOOM), latToTileY(g.lat, WATER_ZOOM));
    // Mid-river with no shore in reach: the nearest shore vertex's level.
    const choice = judged.source === "unknown" ? this.nearestShore(x, z) : judged;
    return {
      y: this.frame.toLocal(g.lat, g.lon, this.dem.ellipsoidal(g.lat, g.lon, choice.level)).y,
      tide: choice.tide,
    };
  }

  /** Level of the surface vertex nearest a local point (the mean tide when there is none). */
  private nearestShore(x: number, z: number): LevelChoice {
    let best: LevelChoice = { level: this.bay.still, tide: 1, source: "tide", surveyed: null };
    let bestD = Infinity;
    for (const tile of this.tiles.values()) {
      const p = tile.probe;
      for (let i = 0; i < p.length; i += 5) {
        const d = Math.hypot(p[i] - x, p[i + 2] - z);
        if (d >= bestD) continue;
        bestD = d;
        best = { level: p[i + 4], tide: p[i + 3], source: "dem", surveyed: null };
      }
    }
    return best;
  }

  /** The DEM ground (local y) at a local point, as groundY reads it, or null if not loaded. */
  private groundLocal(x: number, z: number): number | null {
    const g = this.frame.toGeodetic(new Vector3(x, 0, z));
    const h = this.dem.heightAt(g.lat, g.lon);
    return h === null ? null : this.frame.toLocal(g.lat, g.lon, h).y;
  }

  private local(gx: number, gy: number, orthometric: number, target = new Vector3()): Vector3 {
    const lat = tileYToLat(gy, WATER_ZOOM);
    const lon = tileXToLon(gx, WATER_ZOOM);
    return this.frame.toLocal(lat, lon, this.dem.ellipsoidal(lat, lon, orthometric), target);
  }

  private *surfaceSteps(tile: WaterTile): Generator<void> {
    if (!tile.shores) return;
    const frame = this.frame;
    const pos: number[] = [];
    const tidal: number[] = [];
    const levels: number[] = [];
    const idx: number[] = [];
    for (const rings of tile.shores) {
      const base = pos.length / 3;
      for (const ring of rings) {
        for (let i = 0; i < ring.level.length; i++) {
          const v = this.local(ring.pts[i * 2], ring.pts[i * 2 + 1], ring.level[i]);
          pos.push(v.x, v.y, v.z);
          tidal.push(ring.tide[i]);
          levels.push(ring.level[i]);
          const checkpoint = i % 64 === 0;
          if (checkpoint) yield;
        }
      }
      for (const t of triangulate(rings.map((r) => r.pts))) idx.push(base + t);
    }
    if (idx.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("aTidal", new Float32BufferAttribute(tidal, 1));
    g.setIndex(idx);
    yield* roadGeometrySteps(g);
    const isCurrent = this.tiles.get(`${tile.x}/${tile.y}`) === tile;
    if (!isCurrent) {
      g.dispose();
      return;
    }
    const frameChanged = this.frame !== frame;
    if (frameChanged) {
      g.dispose();
      yield* this.surfaceSteps(tile);
      return;
    }
    const mesh = new Mesh(g, this.material);
    mesh.name = `water-${tile.x}-${tile.y}`;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const on = camera === this.reflectedFor ? this.reflectionOn : 0;
      const u = this.material.uniforms.uReflectionOn;
      if (u.value === on) return;
      u.value = on;
      // Shared material: make three upload the changed uniform before this mesh is drawn.
      this.material.uniformsNeedUpdate = true;
    };
    // The tide moves the surface up to ~1 m: keep it inside the culling sphere.
    if (g.boundingSphere) g.boundingSphere.radius += 2;
    tile.sphere.copy(g.boundingSphere ?? new Sphere());
    const probe: number[] = [];
    for (let i = 0; i < tidal.length; i += 4)
      probe.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], tidal[i], levels[i]);
    tile.probe = new Float32Array(probe);
    tile.surface?.removeFromParent();
    tile.surface?.geometry.dispose();
    tile.surface = mesh;
    this.scene.add(mesh);
  }

  /**
   * Shore walls (護岸) down from the drawn ground to below the water, with a 胸壁 where the bank
   * stands high above the water, stopping under bridge decks. Clip edges at the tile square get
   * none: the water goes on in the next tile.
   */
  private *wallSteps(tile: WaterTile): Generator<void> {
    if (!tile.shores) return;
    const frame = this.frame;
    const graph = this.graph;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const concrete = new Color(0x8e8b83);
    const wet = new Color(0x3c4038);
    const push = (v: Vector3, c: Color) => {
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      return pos.length / 3 - 1;
    };
    const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
    for (const rings of tile.shores) {
      for (const ring of rings) {
        const m = ring.level.length;
        // The drawn ground at each shore point, then the highest within two points either side:
        // where the shore runs along a steep bank (神田川's gorge) the ground under a 6 m step
        // jumps by metres, and the wall would end in a saw edge. Never lower, so it meets the ground.
        const ground: number[] = [];
        for (let k = 0; k < m; k++) {
          ground.push(
            meshHeightAt(
              this.dem,
              tileYToLat(ring.pts[k * 2 + 1], WATER_ZOOM),
              tileXToLon(ring.pts[k * 2], WATER_ZOOM),
            ),
          );
          const checkpoint = k % 32 === 0;
          if (checkpoint) yield;
        }
        const crest = ground.map((_, k) =>
          Math.max(...[-2, -1, 0, 1, 2].map((d) => ground[(k + d + m) % m])),
        );
        for (let i = 0; i < m; i++) {
          const checkpoint = i % 16 === 0;
          if (checkpoint) yield;
          const j = (i + 1) % m;
          const ax = ring.pts[i * 2];
          const ay = ring.pts[i * 2 + 1];
          const bx = ring.pts[j * 2];
          const by = ring.pts[j * 2 + 1];
          if (isClipEdge(ax, ay, bx, by, tile.x, tile.y)) continue;
          // GSI splits wide water into several polygons (along ward boundaries mid-river): an edge
          // with water on its land side too is such a seam, not a shore.
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const reach = 2 / metresPerUnit(tileYToLat(ay, WATER_ZOOM)) / len;
          const isSeam = this.isWater((ax + bx) / 2 + (by - ay) * reach, (ay + by) / 2 - (bx - ax) * reach);
          if (isSeam) continue;
          const ends = [
            [ax, ay, i],
            [bx, by, j],
          ] as const;
          // Under a bridge (either end or the middle of the edge on a deck) the wall stops below the
          // deck and has no 胸壁; deciding per edge keeps the wall's top level instead of slanting.
          const mid = this.local((ax + bx) / 2, (ay + by) / 2, 0);
          const decks = [this.deckAt(mid.x, mid.z)];
          const raw = ends.map(([gx, gy, k]) => {
            const still = ring.level[k];
            const high = still + ring.tide[k] * this.tide.amplitude;
            const top = Math.max(crest[k] + 0.03, high + 0.2);
            const at = this.local(gx, gy, top);
            decks.push(this.deckAt(at.x, at.z));
            return { gx, gy, top, still, high };
          });
          const deckYs = decks.filter((d): d is number => d !== null);
          const isUnderDeck = deckYs.length > 0;
          const pieces = raw.map((p) => {
            const capped = isUnderDeck
              ? Math.min(p.top, this.orthometricOf(p.gx, p.gy, Math.min(...deckYs) - 0.4))
              : p.top;
            const hasParapet = !isUnderDeck && p.top - p.still > PARAPET_ABOVE;
            return { ...p, top: capped, bottom: p.still - WALL_DEPTH, hasParapet };
          });
          const [a, b] = pieces;
          const wetLine = (p: (typeof pieces)[number]) => p.high + 0.3;
          // Face: concrete above the tide line, darker and greener where the water wets it.
          const a0 = push(this.local(a.gx, a.gy, a.bottom), wet);
          const b0 = push(this.local(b.gx, b.gy, b.bottom), wet);
          const a1 = push(this.local(a.gx, a.gy, Math.min(a.top, wetLine(a))), wet);
          const b1 = push(this.local(b.gx, b.gy, Math.min(b.top, wetLine(b))), wet);
          const a2 = push(this.local(a.gx, a.gy, a.top), concrete);
          const b2 = push(this.local(b.gx, b.gy, b.top), concrete);
          quad(a0, b0, b1, a1);
          quad(a1, b1, b2, a2);
          if (!a.hasParapet || !b.hasParapet) continue;
          // 胸壁 on the land side of the edge (water is on the edge's right in tile space).
          const unit = metresPerUnit(tileYToLat(a.gy, WATER_ZOOM));
          const nx = ((b.gy - a.gy) / len) * (PARAPET_THICK / unit);
          const ny = (-(b.gx - a.gx) / len) * (PARAPET_THICK / unit);
          const pa = push(this.local(a.gx, a.gy, a.top + PARAPET), concrete);
          const pb = push(this.local(b.gx, b.gy, b.top + PARAPET), concrete);
          const la = push(this.local(a.gx + nx, a.gy + ny, a.top + PARAPET), concrete);
          const lb = push(this.local(b.gx + nx, b.gy + ny, b.top + PARAPET), concrete);
          const ga = push(this.local(a.gx + nx, a.gy + ny, a.top - 0.3), concrete);
          const gb = push(this.local(b.gx + nx, b.gy + ny, b.top - 0.3), concrete);
          quad(a2, b2, pb, pa);
          quad(pa, pb, lb, la);
          quad(la, lb, gb, ga);
        }
      }
    }
    if (idx.length === 0) {
      tile.walls?.removeFromParent();
      tile.walls?.geometry.dispose();
      tile.walls = null;
      return;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    yield* roadGeometrySteps(g);
    const isCurrent = this.tiles.get(`${tile.x}/${tile.y}`) === tile;
    if (!isCurrent) {
      g.dispose();
      return;
    }
    const inputChanged = frame !== this.frame || graph !== this.graph;
    if (inputChanged) {
      g.dispose();
      yield* this.wallSteps(tile);
      return;
    }
    const mesh = tile.walls ?? new Mesh(new BufferGeometry(), this.wallMaterial);
    mesh.geometry = updateRoadGeometry(mesh.geometry, g);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.receiveShadow = true;
    mesh.name = `water-walls-${tile.x}-${tile.y}`;
    tile.walls = mesh;
    this.scene.add(mesh);
  }

  /** The T.P. height whose local y at a global point is `y`. */
  private orthometricOf(gx: number, gy: number, y: number): number {
    const zero = this.local(gx, gy, 0).y;
    return y - zero;
  }

  /** The parapets of the 3×3 tiles around the player as one fixed collider. */
  private buildShoreColliders(): void {
    if (this.shoreBody) this.world.removeRigidBody(this.shoreBody);
    this.shoreBody = null;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const tile of this.tiles.values()) {
      const isNear = Math.max(Math.abs(tile.x - this.centre.x), Math.abs(tile.y - this.centre.y)) <= INNER;
      if (!isNear || !tile.walls) continue;
      const src = tile.walls.geometry.getAttribute("position");
      const index = tile.walls.geometry.getIndex();
      if (!index) continue;
      const base = pos.length / 3;
      for (let i = 0; i < src.count; i++) pos.push(src.getX(i), src.getY(i), src.getZ(i));
      for (let i = 0; i < tile.walls.geometry.drawRange.count; i++) idx.push(base + index.getX(i));
    }
    if (idx.length === 0) return;
    this.shoreBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)),
      this.shoreBody,
    );
  }

  private disposeTile(tile: WaterTile): void {
    for (const mesh of [tile.surface, tile.walls]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    tile.surface = null;
    tile.walls = null;
  }

  // ---------- per frame ----------

  /**
   * Animate the surface: the predicted tide at the game's time, and the sun, sky and rain the
   * environment computed this frame (call after Environment.update).
   */
  update(dt: number, env: Environment): void {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uTide.value = this.tide.at(env.now());
    const day = 1 - env.nightFactor;
    const raining = env.isRaining();
    u.uSunDir.value.copy(env.sun.position).sub(env.sun.target.position).normalize();
    u.uSunColor.value.copy(env.sun.color);
    // The glint is the sun's; the moon's is a faint sheen.
    u.uSunStrength.value = (env.sunElevation > -4 ? env.sun.intensity / 2.8 : 0.08) * (raining ? 0.25 : 1);
    const fog = this.scene.fog;
    if (fog && "color" in fog) u.uSkyHorizon.value.copy(fog.color);
    u.uSkyZenith.value.set(raining ? 0x5c656d : 0x2f5f9e).lerp(NIGHT_ZENITH, env.nightFactor);
    // The river's own colour is lit by the sky: dim at night but for the city's glow.
    u.uAmbient.value = 0.07 + 0.93 * day;
    u.uRough.value = raining ? 1.8 : 1;
  }

  /**
   * One planar reflection per frame for the water level nearest the eye (desktop, with 画質
   * 空の映り込み on: phones and 低 see the sky in the water): the scene drawn from below that plane
   * into a half-size target, sampled by the water shader. Nothing is drawn while no water is in view
   * within REFLECT_RANGE, so towns without water pay nothing.
   */
  renderReflection(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, now: number): void {
    const u = this.material.uniforms;
    const isSkyOnly = QUALITY.isMobile || GRAPHICS.settings.reflections === "off";
    if (isSkyOnly) {
      this.reflectedFor = camera;
      this.reflectionOn = 0;
      return;
    }
    if (now - this.planeCheckedAt > 250) {
      this.planeCheckedAt = now;
      this.planeY = this.nearestLevel(camera);
    }
    const planeY = this.planeY;
    const eye = camera.getWorldPosition(new Vector3());
    const isReflecting = planeY !== null && eye.y > planeY + 0.3;
    this.reflectedFor = camera;
    if (!isReflecting) {
      this.reflectionOn = 0;
      return;
    }
    // Every other frame: the texture keeps the matrix it was drawn with, so a frame-old reflection
    // still lands where it belongs (only a frame of parallax late), at half the cost.
    this.reflectFrame++;
    const isFresh = this.reflectionOn === 1 && Math.abs(u.uPlaneY.value - planeY) < 0.05;
    if (isFresh && this.reflectFrame % REFLECT_EVERY !== 0) return;
    const size = renderer.getDrawingBufferSize(new Vector2()).multiplyScalar(REFLECT_SCALE).floor();
    if (!this.reflection) {
      // The frame's format, samples and depth: the city's pipelines are shared with the frame (a
      // pipeline is built per target format), so the first reflection compiles nothing new.
      this.reflection = sceneTarget(renderer, size.x, size.y);
    } else if (this.reflection.width !== size.x || this.reflection.height !== size.y) {
      this.reflection.setSize(size.x, size.y);
    }
    this.placeMirror(renderer, camera, planeY);
    // Not in the reflection: the water itself, and the small things (people, cars, signs, poles:
    // ~2,000 of the ~2,700 draw calls on a street) that a rippled, half-size mirror would blur
    // away anyway. Why not a layer: the objects belong to other modules, made before the water.
    if (now - this.cullCheckedAt > 1000) {
      this.cullCheckedAt = now;
      this.culled = smallObjects(scene);
    }
    const visible: Object3D[] = [];
    for (const o of this.culled) {
      if (!o.visible) continue;
      o.visible = false;
      visible.push(o);
    }
    for (const tile of this.tiles.values()) {
      if (tile.surface?.visible) {
        tile.surface.visible = false;
        visible.push(tile.surface);
      }
    }
    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    // Cleared as the pass begins (renderer.clear() would be a pass of its own).
    renderer.autoClear = true;
    renderer.setRenderTarget(this.reflection);
    holdShadows(() => renderer.render(scene, this.mirror));
    renderer.setRenderTarget(target);
    renderer.autoClear = autoClear;
    for (const m of visible) m.visible = true;
    u.uReflection.value = this.reflection.texture;
    this.reflectionOn = 1;
    u.uPlaneY.value = planeY;
  }

  /** Level (local y, with the tide) of the water in view nearest the eye, or null if none. */
  private nearestLevel(camera: PerspectiveCamera): number | null {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.tmpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      camera.coordinateSystem,
      camera.reversedDepth,
    );
    const eye = camera.getWorldPosition(new Vector3());
    const tide = this.material.uniforms.uTide.value as number;
    let best: number | null = null;
    let bestD = REFLECT_RANGE;
    for (const tile of this.tiles.values()) {
      if (!tile.surface) continue;
      const isInView = this.frustum.intersectsSphere(tile.sphere);
      if (!isInView || tile.sphere.distanceToPoint(eye) > REFLECT_RANGE) continue;
      const p = tile.probe;
      for (let i = 0; i < p.length; i += 5) {
        const d = Math.hypot(p[i] - eye.x, p[i + 2] - eye.z);
        if (d >= bestD) continue;
        bestD = d;
        best = p[i + 1] + p[i + 3] * tide;
      }
    }
    return best;
  }

  /** The mirror camera below the plane, with its near plane clipped obliquely to the water. */
  private placeMirror(renderer: WebGPURenderer, camera: PerspectiveCamera, planeY: number): void {
    camera.updateMatrixWorld();
    const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const rot = new Matrix4().extractRotation(camera.matrixWorld);
    const look = new Vector3(0, 0, -1).applyMatrix4(rot).add(eye);
    const reflect = (v: Vector3) => v.setY(2 * planeY - v.y);
    const m = this.mirror;
    m.position.copy(reflect(eye.clone()));
    m.up.set(0, 1, 0).applyMatrix4(rot);
    m.up.y = -m.up.y;
    m.lookAt(reflect(look));
    // The camera's lens, but a nearer far plane: past REFLECT_FAR the haze has all but hidden the
    // city, and the tiles beyond are most of the reflection's triangles.
    m.fov = camera.fov;
    m.aspect = camera.aspect;
    m.zoom = camera.zoom;
    m.near = camera.near;
    m.far = Math.min(camera.far, REFLECT_FAR);
    m.layers.mask = camera.layers.mask;
    // The renderer's conventions before the projection is made (the renderer would otherwise make
    // it again on the first render, without the oblique plane): WebGPU's or WebGL's clip space, and
    // the reversed depth (the flag has no setter; Renderer sets it the same way).
    m.coordinateSystem = renderer.coordinateSystem;
    Reflect.set(m, "_reversedDepth", renderer.reversedDepthBuffer);
    m.updateMatrixWorld();
    m.updateProjectionMatrix();
    // Texture matrix: world → [0, 1]² of the reflection target, v = 0 at the top (three samples a
    // render target's row 0 at v = 0 on both backends).
    this.material.uniforms.uReflectionMatrix.value
      .set(0.5, 0, 0, 0.5, 0, -0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix)
      .multiply(m.matrixWorldInverse);
    // Oblique near plane (Lengyel): nothing below the water is drawn into the reflection.
    const plane = new Plane(new Vector3(0, 1, 0), -planeY).applyMatrix4(m.matrixWorldInverse);
    const clip = new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    clipNearTo(m.projectionMatrix, clip, depthRange(m.coordinateSystem, m.reversedDepth));
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();
  }

  /** Is a camera position below the water surface it is over (for an underwater tint / respawn)? */
  surfaceUnder(x: number, z: number): number | null {
    if (!this.isWaterLocal(x, z)) return null;
    const tide = this.material.uniforms.uTide.value as number;
    const water = this.levelLocal(x, z);
    return water.y + water.tide * tide;
  }

  dispose(): void {
    this.disposed = true;
    this.masks.dispose();
    for (const tile of this.tiles.values()) this.disposeTile(tile);
    this.tiles.clear();
    this.clearDecks();
    if (this.shoreBody) this.world.removeRigidBody(this.shoreBody);
    this.reflection?.dispose();
    this.material.dispose();
  }
}

const NIGHT_ZENITH = new Color(0x060a14);

/** Meshes smaller than a few metres across, and instanced props, anywhere in the scene. */
function smallObjects(scene: Scene): Object3D[] {
  const out: Object3D[] = [];
  const sphere = new Sphere();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as InstancedMesh).isInstancedMesh) {
      out.push(mesh);
      return;
    }
    const geometry = mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingSphere) return;
    sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (sphere.radius < 3) out.push(mesh);
  });
  return out;
}

/** Mean daily range of the tide at 東京 in the 2026 predictions (m), used until the file says. */
const BAY_RANGE = 1.43;

type GaugeFile = { bay: { mean: number; range: number }; gauges: Gauge[] };

const CELL = 32;
const gridKey = (x: number, z: number) =>
  (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);

/** Unit direction of a segment leaving one of its end nodes. */
function leavingDir(seg: Segment, node: number): Vector3 {
  const isStart = seg.from === node;
  const a = isStart ? seg.pts[0] : seg.pts[seg.pts.length - 1];
  const b = isStart ? seg.pts[1] : seg.pts[seg.pts.length - 2];
  return b.clone().sub(a).setY(0).normalize();
}

function nearestOnSegment(seg: Segment, p: Vector3): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity };
  for (let i = 1; i < seg.pts.length; i++) {
    const a = seg.pts[i - 1];
    const ex = seg.pts[i].x - a.x;
    const ez = seg.pts[i].z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;
    const t = Math.min(len, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len));
    const dist = Math.hypot(a.x + (ex / len) * t - p.x, a.z + (ez / len) * t - p.z);
    if (dist < best.dist) best = { s: seg.cum[i - 1] + t, dist };
  }
  return best;
}

function profileAt(span: Span, s: number): number {
  const f = (s - span.s0) / DECK_STEP;
  const i = Math.min(span.heights.length - 2, Math.max(0, Math.floor(f)));
  const t = Math.min(1, Math.max(0, f - i));
  return span.heights[i] + (span.heights[i + 1] - span.heights[i]) * t;
}
