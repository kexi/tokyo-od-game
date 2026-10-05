import {
  AddEquation,
  CanvasTexture,
  Color,
  CustomBlending,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OneFactor,
  Sprite,
  type SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
} from "three";
import { type Node, SpriteNodeMaterial } from "three/webgpu";
import { materialColor, materialOpacity, sRGBTransferEOTF, sRGBTransferOETF, vec4 } from "three/tsl";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LocalFrame } from "../geo/frame";
import { log, warn } from "../log";
import { PROP_GROUPS } from "../physics/groups";
import { untonemapped, UntonemappedBasicMaterial } from "../render/untonemapped";
import { isExpresswayClass, parseOrbis, type OrbisEntry, type OrbisSign } from "./orbisData";
import { dayKey, planPortable, type GameDay, type School } from "./portableOrbis";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";
import { sharedDraco } from "../render/draco";

/**
 * 速度違反自動取締装置 (オービス) on the streets: OSM speed cameras (public/data/police.json, built by
 * scripts/orbis.ts) stood where they are as the gantry or pole of scripts/blender/orbis.py, facing
 * the direction they enforce, with their 予告看板 up the road. A car crossing a device's line in
 * that direction, in a lane it covers, 30 km/h or more over the limit (40 on an expressway) is
 * photographed: the strobe over that lane flashes and the caller books the notice by post.
 * 可搬式 units (src/world/portableOrbis.ts) stand on residential kerbs for the game day, with no
 * 予告看板, and take 15 km/h or more over the limit through the same crossing test.
 */

const RANGE = 1300; // m from the frame origin: the road graph's reach
const MATCH = 30; // a device further than this from any matching road is not placed
const SIGN_MATCH = 25;
const LANE_W = 3.25; // lane width when only the carriageway width is known
const SPEED_OVER = 30; // 一般道: the 赤切符 range fixed cameras are set for
const SPEED_OVER_EXPRESSWAY = 40;
const COOLDOWN_MS = 15000;
const FLASH_MS = 420;

export type OrbisSite = {
  entry: OrbisEntry;
  seg: Segment;
  /** Along-distance of the camera line on the segment. */
  s: number;
  /** Travel along the segment's coordinates (1) or against them (−1). */
  dir: 1 | -1;
  /** Centreline point of the camera line (y = 0). */
  line: Vector3;
  /** Unit travel direction the device enforces. */
  travel: Vector3;
  /** Fixed gantry or pole (OSM), or a 可搬式 unit the game set up for the day. */
  kind: "gantry" | "pole" | "portable";
  lanes: number;
  /** Lateral (left of travel) of the kerb the lanes are counted from, and their width. */
  kerb: number;
  laneWidth: number;
  expressway: boolean;
  /** Limit and the excess that fires the camera (km/h). */
  limit: number;
  threshold: number;
  /** Where a portable unit's tripod stands (y = 0), off the carriageway at the left kerb. */
  stand?: Vector3;
};

/** What the 可搬式 units need from the game: its date, and the 小学校 for school routes. */
export type PortableContext = {
  day: GameDay;
  schools: readonly School[];
  /** Height to add where the tripod stands on a raised pavement (the kerb). */
  kerbAt?: (x: number, z: number) => number;
};

export type OrbisWarning = { pos: Vector3; travel: Vector3; seg: Segment; before: number; entry: OrbisEntry };

export type OrbisHit = { site: OrbisSite; lane: number; limit: number; excess: number };

const bearingVector = (deg: number) =>
  new Vector3(Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180));

/**
 * The road a point belongs to: the nearest accepted segment within `radius` that runs along
 * `bearing` (either way) when one is given, so a device at a junction is not given the crossing
 * street.
 */
function matchRoad(
  graph: RoadGraph,
  p: Vector3,
  radius: number,
  accept: (seg: Segment) => boolean,
  bearing: Vector3 | null,
): { seg: Segment; s: number; lateral: number; dir: Vector3 } | null {
  let best: { seg: Segment; s: number; lateral: number; dir: Vector3 } | null = null;
  let bestD = radius;
  for (const seg of graph.segments) {
    if (!accept(seg)) continue;
    const r = graph.nearestOn(seg, p);
    if (r.dist >= bestD) continue;
    const dir = graph.sample(seg, r.s).dir.clone();
    const isAligned = bearing === null || Math.abs(dir.dot(bearing)) >= 0.7;
    if (!isAligned) continue;
    bestD = r.dist;
    best = { seg, s: r.s, lateral: r.lateral, dir };
  }
  return best;
}

/** Lanes the travel direction has on a segment: from OSM, JARTIC 車両通行帯, or the width. */
export function lanesFor(seg: Segment, mapped: number): { lanes: number; span: number } {
  const span = seg.oneway !== 0 ? seg.line.width : seg.line.width / 2;
  // Never narrower than 2.5 m a lane, whatever the source says (GSI widths are coarse).
  const fit = Math.max(1, Math.floor(span / 2.5));
  const given = mapped > 0 ? mapped : seg.lanes > 1 ? seg.lanes : Math.round(span / LANE_W);
  return { lanes: Math.min(Math.max(1, given), fit, 6), span };
}

/**
 * Where each device stands on the current road graph, and which way it looks. Elevated devices
 * (首都高 viaducts) and those with no matching road are left out; expressway devices only match
 * expressway segments and street devices only streets. The enforced direction is OSM's when known,
 * else a JARTIC one-way, else the side of the road the device stands at (left-hand traffic), else
 * both directions.
 */
export function planSites(
  graph: RoadGraph,
  entries: OrbisEntry[],
  frame: LocalFrame,
  range = RANGE,
): OrbisSite[] {
  const sites: OrbisSite[] = [];
  for (const entry of entries) {
    if (entry.elevated) continue;
    const p = frame.toLocal(entry.lat, entry.lon, frame.origin.h).setY(0);
    if (Math.hypot(p.x, p.z) > range) continue;
    const isExpressway = isExpresswayClass(entry.road);
    const accept = (seg: Segment) => (seg.line.kind === "highway") === isExpressway;
    const bearing = entry.bearing === null ? null : bearingVector(entry.bearing);
    const hit = matchRoad(graph, p, MATCH, accept, bearing);
    if (!hit) continue;
    const { seg } = hit;
    const dirs: Array<1 | -1> = bearing
      ? [hit.dir.dot(bearing) >= 0 ? 1 : -1]
      : seg.oneway !== 0
        ? [seg.oneway]
        : Math.abs(hit.lateral) >= 2
          ? [hit.lateral > 0 ? 1 : -1]
          : [1, -1];
    for (const dir of dirs) {
      const { lanes, span } = lanesFor(seg, entry.lanes);
      const s = clearSpot(graph, seg, hit.s, dir);
      const { pos, dir: along } = graph.sample(seg, s);
      sites.push({
        entry,
        seg,
        s,
        dir,
        line: pos.clone(),
        travel: along.clone().multiplyScalar(dir),
        kind: lanes >= 2 ? "gantry" : "pole",
        lanes,
        kerb: seg.line.width / 2,
        laneWidth: span / lanes,
        expressway: isExpressway,
        limit: speedLimit(seg),
        threshold: isExpressway ? SPEED_OVER_EXPRESSWAY : SPEED_OVER,
      });
    }
  }
  return sites;
}

/**
 * The along-distance nearest `s` where the kerb pole is out of every other carriageway (devices
 * mapped at a junction), stepping 3 m either way up to 30 m; `s` itself when none is clear.
 */
function clearSpot(graph: RoadGraph, seg: Segment, s: number, dir: 1 | -1): number {
  const at = (d: number) => {
    const { pos, dir: along } = graph.sample(seg, d);
    return pos.add(leftOf(along.multiplyScalar(dir), seg.line.width / 2 + 1));
  };
  for (const step of [
    0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 21, -21, 24, -24, 27, -27, 30, -30,
  ]) {
    const d = s + step;
    if (d < 1 || d > seg.length - 1) continue;
    if (graph.carriagewaysAt(at(d), 0.3, seg).length === 0) return d;
  }
  return Math.min(Math.max(s, 0), seg.length);
}

/**
 * Walk `distance` metres up the road from (seg, s) against the travel `dir`, taking at each node
 * the segment that flows into it most straight (one-way rules kept). Null when the graph ends or
 * the road turns off (more than 50°) first.
 */
export function walkUpstream(
  graph: RoadGraph,
  seg: Segment,
  s: number,
  dir: 1 | -1,
  distance: number,
): { seg: Segment; s: number; dir: 1 | -1 } | null {
  let cur = seg;
  let at = s;
  let d = dir;
  let left = distance;
  for (let steps = 0; steps < 200; steps++) {
    // Upstream is toward the start of the segment when travelling along it.
    const room = d === 1 ? at : cur.length - at;
    if (room >= left) return { seg: cur, s: d === 1 ? at - left : at + left, dir: d };
    left -= room;
    const node = d === 1 ? cur.from : cur.to;
    // Travel direction leaving `node` on the current segment.
    const out = graph.sample(cur, d === 1 ? 0 : cur.length).dir.multiplyScalar(d);
    let best: { seg: Segment; dir: 1 | -1; score: number } | null = null;
    for (const id of graph.nodes.get(node) ?? []) {
      const c = graph.segments[id];
      if (c === cur) continue;
      const arrives: 1 | -1 = c.to === node ? 1 : -1;
      const isAllowed = c.oneway === 0 || c.oneway === arrives;
      if (!isAllowed) continue;
      const inDir = graph.sample(c, arrives === 1 ? c.length : 0).dir.multiplyScalar(arrives);
      const score = inDir.dot(out);
      if (score >= Math.cos((50 * Math.PI) / 180) && (!best || score > best.score))
        best = { seg: c, dir: arrives, score };
    }
    if (!best) return null;
    cur = best.seg;
    d = best.dir;
    at = d === 1 ? cur.length : 0;
  }
  return null;
}

/**
 * 予告看板 for every device: OSM's points where the data has them, else (for a placed site) walked
 * up the graph. A device's far sign is placed even when the device itself is beyond the graph's
 * reach — it is 1.5 km up the road, where the player meets it first. Devices on viaducts, and those
 * within reach that matched no road, get none (their road is not drawn).
 */
export function planWarnings(
  graph: RoadGraph,
  entries: OrbisEntry[],
  sites: OrbisSite[],
  frame: LocalFrame,
  distances = [1500, 200],
  range = RANGE,
): OrbisWarning[] {
  const out: OrbisWarning[] = [];
  const kerbSide = (seg: Segment, s: number, dir: 1 | -1) => {
    const { pos, dir: along } = graph.sample(seg, s);
    const travel = along.clone().multiplyScalar(dir);
    return { pos: pos.add(leftOf(travel, seg.line.width / 2 + 0.9)), travel };
  };
  for (const entry of entries) {
    if (entry.elevated) continue;
    const own = sites.filter((site) => site.entry === entry);
    const device = frame.toLocal(entry.lat, entry.lon, frame.origin.h);
    const isUnmatched = Math.hypot(device.x, device.z) <= range && own.length === 0;
    if (isUnmatched) continue;
    const isFor = (sign: OrbisSign, site: OrbisSite) => bearingVector(sign[4]).dot(site.travel) > 0.5;
    for (const site of own) {
      const hasPoints = entry.signs.some((sg) => isFor(sg, site));
      if (hasPoints) continue;
      for (const before of distances) {
        const at = walkUpstream(graph, site.seg, site.s, site.dir, before);
        if (at) out.push({ ...kerbSide(at.seg, at.s, at.dir), seg: at.seg, before, entry });
      }
    }
    // With the device placed, only the points for the directions it was given.
    const points =
      own.length === 0 ? entry.signs : entry.signs.filter((sg) => own.some((site) => isFor(sg, site)));
    const isExpressway = isExpresswayClass(entry.road);
    const accept = (seg: Segment) => (seg.line.kind === "highway") === isExpressway;
    for (const [lon, lat, bearing, before] of points) {
      const p = frame.toLocal(lat, lon, frame.origin.h).setY(0);
      if (Math.hypot(p.x, p.z) > range) continue;
      const b = bearingVector(bearing);
      const hit = matchRoad(graph, p, SIGN_MATCH, accept, b);
      if (!hit) continue;
      const dir: 1 | -1 = hit.dir.dot(b) >= 0 ? 1 : -1;
      out.push({ ...kerbSide(hit.seg, hit.s, dir), seg: hit.seg, before, entry });
    }
  }
  return out;
}

/**
 * Whether a move prev → cur crosses the site's camera line in its direction, and in which lane
 * (0 = by the kerb): null when going the other way, when the line is not crossed, or outside the
 * lanes the device covers.
 */
export function crossing(site: OrbisSite, prev: Vector3, cur: Vector3): number | null {
  const a0 = (prev.x - site.line.x) * site.travel.x + (prev.z - site.line.z) * site.travel.z;
  const a1 = (cur.x - site.line.x) * site.travel.x + (cur.z - site.line.z) * site.travel.z;
  const isCrossing = a0 < 0 && a1 >= 0;
  if (!isCrossing) return null;
  const mx = cur.x - prev.x;
  const mz = cur.z - prev.z;
  const move = Math.hypot(mx, mz);
  // A respawn or warp is not a drive past; and the car must be heading along the lanes.
  const isHeadingAlong =
    move < 40 && (mx * site.travel.x + mz * site.travel.z) / move >= Math.cos(Math.PI / 4);
  if (!isHeadingAlong) return null;
  const f = -a0 / (a1 - a0);
  const qx = prev.x + mx * f - site.line.x;
  const qz = prev.z + mz * f - site.line.z;
  const left = leftOf(site.travel, 1);
  const lateral = qx * left.x + qz * left.z;
  const fromKerb = site.kerb - lateral;
  const isCovered = fromKerb >= -0.5 && fromKerb <= site.lanes * site.laneWidth + 0.3;
  if (!isCovered) return null;
  return Math.min(site.lanes - 1, Math.max(0, Math.floor(fromKerb / site.laneWidth)));
}

/**
 * The lane photographed when a car moving prev → cur at `kmh` passes the site: it crosses the line
 * in the enforced direction and a covered lane, at least `threshold` km/h over the limit.
 */
export function photographs(site: OrbisSite, prev: Vector3, cur: Vector3, kmh: number): number | null {
  const isOver = kmh - site.limit >= site.threshold;
  if (!isOver) return null;
  return crossing(site, prev, cur);
}

/** Lateral (left of travel) of lane k's centre. */
const laneCentre = (site: OrbisSite, k: number) => site.kerb - (k + 0.5) * site.laneWidth;

type Part = Array<{ geometry: BufferGeometry; material: Material }>;
type Kit = {
  pole: Part;
  beam: Part;
  post: Part;
  unit: Part;
  lens: BufferGeometry;
  /** Centre of the flash window in the lane unit's frame (where the glow goes). */
  lensCentre: Vector3;
  polePost: Part;
  sign: Part;
  beamY: number;
  deckTop: number;
  postSpacing: number;
  poleUnit: [number, number, number];
};
/** The 可搬式 unit (scripts/blender/portable_orbis.py): tripod, head, strobe and ground case. */
type PortableKit = { unit: Part; lens: BufferGeometry; lensCentre: Vector3 };
/** A strobe window instance: the lens mesh it is in and its index there. */
type LensRef = { mesh: InstancedMesh; index: number; centre: Vector3; glow: number };

const LENS_REST = new Color(0x2a0909);
const LENS_WHITE = new Color(0xffffff);
const LENS_RED = new Color(0xff3020);

function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.18, "rgba(255,190,170,0.9)");
    r.addColorStop(0.45, "rgba(255,40,20,0.35)");
    r.addColorStop(1, "rgba(255,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The strobe's glow: an additive sprite (colour × the glow texture, faded by opacity) that shows as
 * the WebGL version's did over a dark scene, whatever the exposure. WebGL drew it untonemapped onto
 * the 8-bit canvas with the blend src·alpha + dst, adding the encoded colour × alpha; here the
 * sprite adds the radiance that the frame's ACES shows as that much over black
 * (render/untonemapped.ts). Over a lit scene it adds in radiance, so it brightens less than on the
 * canvas (ACES compresses the sum), as light does.
 * How the blend adds that radiance as it is: CustomBlending One + One for the colour (the
 * AdditiveBlending of an unpremultiplied material would multiply it by alpha again, and its
 * premultiplied form multiplies in the shader); the alpha adds as AdditiveBlending's does.
 */
function glowMaterial(): SpriteNodeMaterial {
  const material = new SpriteNodeMaterial({
    map: glowTexture(),
    depthWrite: false,
    transparent: true,
    // An additive layer mixed toward the haze would add the haze's colour; a 5 m glow needs no fog.
    fog: false,
  });
  // colour × map (three's materialColor is a vec4 with a map; the cast only quiets the vec3 in its
  // type, as in streetLights.ts), and its alpha × the fading opacity.
  const base = vec4(materialColor as unknown as Node<"vec4">);
  const alpha = base.a.mul(materialOpacity);
  const encoded = sRGBTransferOETF(base.rgb) as Node<"vec3">;
  const overBlack = sRGBTransferEOTF(encoded.mul(alpha)) as Node<"vec3">;
  // The map's alpha: three multiplies colorNode's alpha by the opacity (setupDiffuseColor), so the
  // output alpha is `alpha`, as the sprite's was.
  material.colorNode = vec4(untonemapped(overBlack), base.a);
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

/** Scene objects for the sites around the player; rebuilt with the road network. */
export class OrbisDevices {
  sites: OrbisSite[] = [];
  /** 可搬式 units out today (kept apart from `sites`: the カーナビ knows only the fixed ones). */
  portable: OrbisSite[] = [];
  warnings: OrbisWarning[] = [];
  private kit: Kit | null = null;
  private portableKit: PortableKit | null = null;
  private entries: OrbisEntry[] | null = null;
  private last: { graph: RoadGraph; frame: LocalFrame } | null = null;
  /** The game day the portable units were placed for, and when it was last looked at. */
  private portableDay = "";
  private dayCheckedAt = -Infinity;
  private meshes: InstancedMesh[] = [];
  /** Lens of each site's lanes, fixed sites first, then the portable ones: lensOf[site][lane]. */
  private lensOf: LensRef[][] = [];
  private flashes: Array<{ lens: LensRef; at: number; glow: Sprite; material: SpriteNodeMaterial }> = [];
  private fired = new Map<number, number>();
  private body: RAPIER.RigidBody | null = null;
  // The lens shows its instance colour as it is (the WebGL `toneMapped: false`, which
  // WebGPURenderer ignores: render/untonemapped.ts).
  private readonly lensMaterial = new UntonemappedBasicMaterial();
  private readonly glowMaterial = glowMaterial();

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
    /** The game's date and schools for the 可搬式 units; none are placed without it. */
    private readonly portableContext: () => PortableContext | null = () => null,
  ) {
    // Model and data load on their own; the first rebuild after both arrive places the devices.
    // The portable model is optional: the fixed cameras work without it.
    void Promise.all([this.loadModel(), this.loadData(), this.loadPortableModel()])
      .then(() => {
        if (this.last) this.rebuild(this.last.graph, this.last.frame);
      })
      .catch((error: unknown) => warn("orbis_load_failed", { error: String(error) }));
  }

  private loader(): GLTFLoader {
    return new GLTFLoader().setDRACOLoader(sharedDraco());
  }

  private async loadModel(): Promise<void> {
    const gltf = await this.loader().loadAsync(`${import.meta.env.BASE_URL}models/orbis.glb`);
    const part = partsOf(gltf.scene, "orbis.glb");
    const extras = gltf.scene.getObjectByName("Orbis")?.userData ?? {};
    const sign = part("WarningSign");
    for (const { material } of sign) {
      // Retroreflective sheeting, as the road signs: a little self-illumination at night.
      const isFace = material instanceof MeshStandardMaterial && material.map !== null;
      if (!isFace) continue;
      material.emissive.set(0xffffff);
      material.emissiveMap = material.map;
      material.emissiveIntensity = 0.18;
    }
    const lens = part("StrobeLens")[0].geometry;
    lens.computeBoundingBox();
    this.kit = {
      pole: part("GantryPole"),
      beam: part("GantryBeam"),
      post: part("GantryPost"),
      unit: part("LaneUnit"),
      lens,
      lensCentre: lens.boundingBox?.getCenter(new Vector3()) ?? new Vector3(0.3, 0.39, 0.2),
      polePost: part("PolePost"),
      sign,
      beamY: Number(extras.beamY ?? 5.6),
      deckTop: Number(extras.deckTop ?? 0.11),
      postSpacing: Number(extras.postSpacing ?? 2),
      poleUnit: (extras.poleUnit as [number, number, number] | undefined) ?? [1.15, 4.78, 0],
    };
  }

  private async loadPortableModel(): Promise<void> {
    try {
      const gltf = await this.loader().loadAsync(`${import.meta.env.BASE_URL}models/portable_orbis.glb`);
      const part = partsOf(gltf.scene, "portable_orbis.glb");
      const lens = part("PortableLens")[0].geometry;
      lens.computeBoundingBox();
      this.portableKit = {
        unit: part("PortableUnit"),
        lens,
        lensCentre: lens.boundingBox?.getCenter(new Vector3()) ?? new Vector3(0.1, 1.6, 0.2),
      };
    } catch (error: unknown) {
      warn("portable_orbis_load_failed", { error: String(error) });
    }
  }

  private async loadData(): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}data/police.json`);
    const data = res.ok ? ((await res.json()) as { orbis?: unknown }) : {};
    this.entries = parseOrbis(data.orbis);
  }

  /** Place the devices and their signs on a new road graph (also after re-anchoring the frame). */
  rebuild(graph: RoadGraph, frame: LocalFrame): void {
    this.last = { graph, frame };
    this.clear();
    if (!this.kit || !this.entries) return;
    this.sites = planSites(graph, this.entries, frame);
    this.warnings = planWarnings(graph, this.entries, this.sites, frame);
    const context = this.portableKit ? this.portableContext() : null;
    this.portableDay = context ? dayKey(context.day) : "";
    this.portable = context ? planPortable(graph, frame, context.day, context.schools) : [];
    this.build(this.kit, context);
    log("orbis_placed", {
      sites: this.sites.map((s) => ({ siteId: s.entry.id, kind: s.kind, lanes: s.lanes, limitKmh: s.limit })),
      signs: this.warnings.length,
      portable: this.portable.map((s) => ({
        at: [s.entry.lat, s.entry.lon],
        bearingDeg: s.entry.bearing,
        limitKmh: s.limit,
        key: s.entry.origin,
      })),
    });
  }

  /**
   * Devices photographing the move prev → cur at `kmh` (km/h): the ones whose line it crosses in
   * their direction and lanes, over their threshold, not fired in the last 15 s. Each flashes.
   */
  check(prev: Vector3 | null, cur: Vector3, kmh: number, now: number): OrbisHit[] {
    if (!prev) return [];
    const hits: OrbisHit[] = [];
    [...this.sites, ...this.portable].forEach((site, i) => {
      // On the ground plane: the line is at y = 0, the car at the terrain's height.
      if (Math.hypot(site.line.x - cur.x, site.line.z - cur.z) > 60) return;
      const lane = photographs(site, prev, cur, kmh);
      const isCooling = now - (this.fired.get(site.entry.id) ?? -Infinity) < COOLDOWN_MS;
      if (lane === null || isCooling) return;
      const excess = kmh - site.limit;
      this.fired.set(site.entry.id, now);
      this.flash(i, lane, now);
      hits.push({ site, lane, limit: site.limit, excess });
    });
    return hits;
  }

  /** Fire a lane's strobe (also used to stage screenshots); portable sites follow the fixed ones. */
  flash(siteIndex: number, lane: number, now = performance.now()): void {
    const lens = this.lensOf[siteIndex]?.[lane];
    if (!lens) return;
    const m = new Matrix4();
    lens.mesh.getMatrixAt(lens.index, m);
    const material = this.glowMaterial.clone();
    // three's types take a SpriteMaterial only; WebGPURenderer draws a sprite with its node form.
    const glow = new Sprite(material as unknown as SpriteMaterial);
    // Just in front of the window, so the burst is not hidden inside the housing.
    glow.position
      .copy(lens.centre)
      .add(new Vector3(0, 0, 0.15))
      .applyMatrix4(m);
    glow.scale.setScalar(lens.glow);
    glow.renderOrder = 10;
    this.scene.add(glow);
    this.flashes.push({ lens, at: now, glow, material });
  }

  /** Strobe animation (a white burst fading through red, with a glow), and the day's units. */
  update(now: number): void {
    this.followDay(now);
    if (this.flashes.length === 0) return;
    const c = new Color();
    const touched = new Set<InstancedMesh>();
    this.flashes = this.flashes.filter((f) => {
      const t = (now - f.at) / FLASH_MS;
      const isOver = t >= 1;
      touched.add(f.lens.mesh);
      if (isOver) {
        f.lens.mesh.setColorAt(f.lens.index, LENS_REST);
        this.scene.remove(f.glow);
        f.material.dispose();
        return false;
      }
      // White for the first fifth, then red fading back to the resting dark red.
      if (t < 0.2) c.copy(LENS_WHITE);
      else c.copy(LENS_RED).lerp(LENS_REST, (t - 0.2) / 0.8);
      f.lens.mesh.setColorAt(f.lens.index, c);
      f.material.opacity = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
      f.material.color.copy(t < 0.2 ? LENS_WHITE : LENS_RED);
      return true;
    });
    for (const mesh of touched) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * A new game day moves the portable units (the end of the day, or midnight on the clock):
   * looked at every 5 s, and the devices rebuilt on the same graph when the date has changed.
   */
  private followDay(now: number): void {
    if (now - this.dayCheckedAt < 5000 || !this.last || !this.portableKit) return;
    this.dayCheckedAt = now;
    const context = this.portableContext();
    const today = context ? dayKey(context.day) : "";
    const isNewDay = today !== this.portableDay;
    if (isNewDay) this.rebuild(this.last.graph, this.last.frame);
  }

  clear(): void {
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes = [];
    this.lensOf = [];
    for (const f of this.flashes) this.scene.remove(f.glow);
    this.flashes = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
    this.sites = [];
    this.portable = [];
    this.warnings = [];
  }

  private build(k: Kit, context: PortableContext | null): void {
    const ground = (p: Vector3) => this.groundAt(p.x, p.z) ?? 0;
    const up = new Vector3(0, 1, 0);
    const lists = {
      pole: [] as Matrix4[],
      beam: [] as Matrix4[],
      post: [] as Matrix4[],
      unit: [] as Matrix4[],
      polePost: [] as Matrix4[],
      sign: [] as Matrix4[],
      portable: [] as Matrix4[],
    };
    const poles: Array<{ pos: Vector3; height: number; radius: number }> = [];
    /** Lens instance of each fixed site's lanes, in `lists.unit`. */
    const unitIndex: number[][] = [];
    /** +X across the road (right of travel), +Y up, +Z back at the oncoming traffic. */
    const basis = (travel: Vector3, at: Vector3, scaleX = 1) => {
      const right = leftOf(travel, -1);
      return new Matrix4()
        .makeBasis(right.clone().multiplyScalar(scaleX), up, travel.clone().negate())
        .setPosition(at);
    };
    for (const site of this.sites) {
      const left = leftOf(site.travel, 1);
      const lanesAt: Matrix4[] = [];
      if (site.kind === "gantry") {
        const base = site.line.clone().addScaledVector(left, site.kerb + 1);
        base.y = ground(base);
        lists.pole.push(basis(site.travel, base));
        poles.push({ pos: base, height: 7.1, radius: 0.2 });
        // Across to half a metre past the last lane; a second pole on a one-way carriageway's far
        // kerb when the span is long (on a two-way road the far side is the oncoming traffic).
        const far = site.kerb - site.lanes * site.laneWidth - 0.5;
        const length = site.kerb + 1 - far;
        const beamAt = base.clone().setY(base.y + k.beamY);
        lists.beam.push(basis(site.travel, beamAt, length));
        const right = leftOf(site.travel, -1);
        for (let x = 0.3; x < length - 0.3; x += k.postSpacing)
          lists.post.push(basis(site.travel, beamAt.clone().addScaledVector(right, x)));
        lists.post.push(basis(site.travel, beamAt.clone().addScaledVector(right, length - 0.05)));
        const isPortal = site.seg.oneway !== 0 && length > 12;
        if (isPortal) {
          const farBase = site.line.clone().addScaledVector(left, -site.kerb - 1);
          farBase.y = base.y;
          lists.pole.push(basis(site.travel.clone().negate(), farBase));
          poles.push({ pos: farBase, height: 7.1, radius: 0.2 });
        }
        for (let lane = 0; lane < site.lanes; lane++) {
          const at = site.line
            .clone()
            .addScaledVector(left, laneCentre(site, lane))
            .setY(base.y + k.beamY + k.deckTop);
          lanesAt.push(basis(site.travel, at));
        }
      } else {
        const base = site.line.clone().addScaledVector(left, site.kerb + 0.8);
        base.y = ground(base);
        const m = basis(site.travel, base);
        lists.polePost.push(m);
        poles.push({ pos: base, height: 5, radius: 0.1 });
        const [ux, uy, uz] = k.poleUnit;
        lanesAt.push(m.clone().multiply(new Matrix4().makeTranslation(ux, uy, uz)));
      }
      lists.unit.push(...lanesAt);
      unitIndex.push(lanesAt.map((_, i) => lists.unit.length - lanesAt.length + i));
    }
    for (const site of this.portable) {
      const at = (site.stand ?? site.line).clone().setY(0);
      at.y = ground(at) + (context?.kerbAt?.(at.x, at.z) ?? 0);
      lists.portable.push(basis(site.travel, at));
      poles.push({ pos: at, height: 1.7, radius: 0.3 });
    }
    for (const w of this.warnings) {
      const at = w.pos.clone().setY(0);
      at.y = ground(at);
      lists.sign.push(basis(w.travel, at));
      poles.push({ pos: at, height: 6.1, radius: 0.08 });
    }
    this.instanced(k.pole, lists.pole);
    this.instanced(k.beam, lists.beam);
    this.instanced(k.post, lists.post);
    this.instanced(k.unit, lists.unit);
    this.instanced(k.polePost, lists.polePost);
    this.instanced(k.sign, lists.sign);
    if (lists.unit.length > 0) {
      const lenses = this.lensMesh(k.lens, lists.unit);
      this.lensOf = unitIndex.map((lanes) =>
        lanes.map((index) => ({ mesh: lenses, index, centre: k.lensCentre, glow: 5 })),
      );
    }
    const pk = this.portableKit;
    if (pk && lists.portable.length > 0) {
      this.instanced(pk.unit, lists.portable);
      const lenses = this.lensMesh(pk.lens, lists.portable);
      // A smaller strobe than the gantry's: a smaller burst.
      for (let i = 0; i < lists.portable.length; i++)
        this.lensOf[this.sites.length + i] = [{ mesh: lenses, index: i, centre: pk.lensCentre, glow: 3 }];
    }
    // Poles are solid for cars and people (not for ground probes), as the signal poles are.
    if (poles.length === 0) return;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const { pos, height, radius } of poles) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(height / 2, radius)
          .setTranslation(pos.x, pos.y + height / 2, pos.z)
          .setCollisionGroups(PROP_GROUPS),
        this.body,
      );
    }
  }

  /** Strobe windows at the given matrices, resting dark red until a camera fires. */
  private lensMesh(geometry: BufferGeometry, matrices: Matrix4[]): InstancedMesh {
    const lenses = this.instancedOne(geometry, this.lensMaterial, matrices, false);
    for (let i = 0; i < matrices.length; i++) lenses.setColorAt(i, LENS_REST);
    return lenses;
  }

  private instanced(part: Part, matrices: Matrix4[]): void {
    if (matrices.length === 0) return;
    for (const { geometry, material } of part) this.instancedOne(geometry, material, matrices, true);
  }

  private instancedOne(
    geometry: BufferGeometry,
    material: Material,
    matrices: Matrix4[],
    castShadow: boolean,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false; // instances span the whole area
    mesh.castShadow = castShadow;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }
}

/** The meshes under a named node of a loaded glb, baked into the scene's coordinates. */
function partsOf(root: Object3D, file: string): (name: string) => Part {
  root.updateMatrixWorld(true);
  return (name) => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`${file} has no ${name}`);
    const out: Part = [];
    o.traverse((m) => {
      const mesh = m as Mesh;
      if (!mesh.isMesh) return;
      out.push({
        geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
        material: mesh.material as Material,
      });
    });
    return out;
  };
}
