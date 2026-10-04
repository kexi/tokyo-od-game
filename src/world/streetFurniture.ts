import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import type { LocalFrame } from "../geo/frame";
import { towardEye } from "../render/renderer";
import { SIGN, type PlacedSign } from "./regulations";
import { KERB } from "./pavements";
import { leftOf, type RoadGraph, type Segment } from "./roads";

/**
 * Things along Tokyo's streets that matter to a driver, from OpenStreetMap (public/data/places.json):
 * - 消火栓: the yellow 「消火栓」 lettering and frame painted round an underground hydrant's lid (as
 *   Tokyo's streets have them), the red pillar of an above-ground one, and the red 消火栓 sign on a
 *   post at the kerb. Parking within 5 m of one is prohibited (道路交通法 第45条第1項第5号).
 * - Schools, kindergartens and nurseries: the 208 warning sign (学校、幼稚園、保育所等あり) on the
 *   streets leading to them.
 */
export type Places = { hydrants: number[][]; schools: Array<[number, number, number, string]> };

const RANGE = 1300; // m from the frame origin: the road graph's reach
// Heights above the terrain: the asphalt is laid 0.1 m up (roadSurface LIFT) with its paint
// 0.025 m above that; the paving is a kerb (0.15 m) up. The lettering goes just over either.
const ON_ROAD = 0.1 + 0.025 + 0.01;
const ON_PAVING = KERB + 0.015;

function hydrantDecal(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 192;
  const g = c.getContext("2d");
  if (g) {
    g.strokeStyle = "#f2b705";
    g.lineWidth = 10;
    g.strokeRect(10, 10, 236, 172);
    g.fillStyle = "#f2b705";
    g.font = "bold 58px 'Noto Sans JP', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("消火栓", 128, 54);
    // The lid in the middle of the frame.
    g.fillStyle = "#3c3f45";
    g.beginPath();
    g.arc(128, 128, 34, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#f2b705";
    g.lineWidth = 6;
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class StreetFurniture {
  private readonly group = new Group();
  private readonly decal = new MeshStandardMaterial({
    map: hydrantDecal(),
    transparent: true,
    alphaTest: 0.1,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: towardEye(3),
    polygonOffsetUnits: towardEye(3),
  });
  private readonly pillar = new MeshStandardMaterial({ color: 0xc0262d, roughness: 0.5 });
  /** Hydrants near the player in the local frame (for the parking rule). */
  hydrants: Vector3[] = [];
  /** The painted markings with their terrain height, re-snapped as the paving streams in. */
  private markings: Array<{ mesh: Mesh; ground: number; at: Vector3; roadward: Vector3 }> = [];
  private settledAt = -Infinity;

  constructor(
    scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    scene.add(this.group);
  }

  /** Markings, pillars and the signs to add to the sign posts. */
  rebuild(graph: RoadGraph, places: Places | null, frame: LocalFrame): PlacedSign[] {
    for (const c of this.group.children) if (c instanceof Mesh) c.geometry.dispose();
    this.group.clear();
    this.hydrants = [];
    this.markings = [];
    this.settledAt = -Infinity;
    if (!places) return [];
    const signs: PlacedSign[] = [];
    const isStreet = (s: Segment) => s.line.kind !== "highway" && s.line.width >= 4;
    for (const [lon, lat, type] of places.hydrants) {
      const p = frame.toLocal(lat, lon, frame.origin.h).setY(0);
      if (Math.hypot(p.x, p.z) > RANGE) continue;
      this.hydrants.push(p);
      const hit = graph.nearest(p, 25, isStreet);
      const g = this.groundAt(p.x, p.z);
      if (g === null) continue;
      const along = hit?.dir ?? new Vector3(0, 0, 1);
      if (type === 1) {
        // 地上式消火栓: a red pillar.
        const m = new Mesh(new CylinderGeometry(0.13, 0.15, 0.8, 12), this.pillar);
        m.position.set(p.x, g + 0.4, p.z);
        this.group.add(m);
      } else {
        const m = new Mesh(new PlaneGeometry(1.7, 1.28), this.decal);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.atan2(along.x, along.z);
        m.position.set(p.x, g + ON_ROAD, p.z);
        this.group.add(m);
        // Towards the road's centreline: where the paint goes when the lid is at the kerb.
        const centre = hit ? graph.sample(hit.seg, graph.nearestOn(hit.seg, p).s).pos : p;
        const roadward = new Vector3(centre.x - p.x, 0, centre.z - p.z);
        if (roadward.lengthSq() > 1e-6) roadward.normalize();
        this.markings.push({ mesh: m, ground: g, at: p.clone(), roadward });
      }
      // The red 消火栓 sign at the kerb next to it, facing the traffic on that side.
      if (hit) {
        const side = hit.lateral >= 0 ? 1 : -1;
        const travel = hit.dir.clone().multiplyScalar(side);
        const s = graph.nearestOn(hit.seg, p).s;
        signs.push({
          type: SIGN.hydrant,
          value: 0,
          pos: graph
            .sample(hit.seg, s)
            .pos.clone()
            .add(leftOf(travel, hit.seg.line.width / 2 + 0.6)),
          travel,
          seg: hit.seg,
          s,
          dir: side as 1 | -1,
        });
      }
    }
    // 208 学校、幼稚園、保育所等あり: on each street within 60 m of the school, about 60 m before it.
    for (const [lon, lat] of places.schools) {
      const p = frame.toLocal(lat, lon, frame.origin.h).setY(0);
      if (Math.hypot(p.x, p.z) > RANGE) continue;
      const hit = graph.nearest(p, 60, (s) => isStreet(s) && s.line.width >= 5.5);
      if (!hit) continue;
      const seg = hit.seg;
      for (const dir of [1, -1] as const) {
        const oneway = seg.oneway;
        if (oneway !== 0 && oneway !== dir) continue;
        const s = hit.s - dir * 60;
        if (s < 5 || s > seg.length - 5) continue;
        const { pos, dir: d } = graph.sample(seg, s);
        const travel = d.clone().multiplyScalar(dir);
        signs.push({
          type: SIGN.school,
          value: 0,
          pos: pos.clone().add(leftOf(travel, seg.line.width / 2 + 0.7)),
          travel,
          seg,
          s,
          dir,
        });
      }
    }
    return signs;
  }

  /**
   * Lift the markings that lie on paving to its top (the paving around the player streams in after
   * the road network is built). Checked every 2 s.
   */
  update(now: number, isPaving: (x: number, z: number) => boolean): void {
    if (now - this.settledAt < 2000) return;
    this.settledAt = now;
    // The marking's footprint, as a centre and a ring of points 0.85 m out (half its long side).
    const touchesPaving = (x: number, z: number) =>
      isPaving(x, z) ||
      Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4).some((a) =>
        isPaving(x + Math.cos(a) * 0.85, z + Math.sin(a) * 0.85),
      );
    for (const { mesh, ground, at, roadward } of this.markings) {
      // Lids at the kerb get their paint on the carriageway side: slide out up to 3 m.
      const offset = [0, 0.5, 1, 1.5, 2, 2.5, 3].find(
        (d) => !touchesPaving(at.x + roadward.x * d, at.z + roadward.z * d),
      );
      if (offset === undefined) {
        mesh.position.set(at.x, ground + ON_PAVING, at.z);
        continue;
      }
      mesh.position.set(at.x + roadward.x * offset, ground + ON_ROAD, at.z + roadward.z * offset);
    }
  }

  /** Whether a point is within `metres` of a hydrant (parking prohibited within 5 m). */
  nearHydrant(p: Vector3, metres = 5): boolean {
    return this.hydrants.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < metres);
  }
}
