import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  type Scene,
} from "three";
import { laneOffset, leftOf } from "../world/roads";
import { pointAt } from "./junctionView";
import type { Route } from "./navigation";

/**
 * The navigation route painted on the road ahead: a translucent band in the car's lane with
 * chevrons that drift forward, from just in front of the car to a few hundred metres on.
 * Rebuilt about once a second as the car moves (a few hundred vertices).
 */
const AHEAD = 320; // metres drawn ahead of the car
const STEP = 2;
const WIDTH = 1.4;
const LIFT = 0.22; // above the road surface, its markings and the kerb edge of the paving

function chevrons(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "rgba(40, 150, 255, 0.55)";
  ctx.fillRect(0, 0, 64, 128);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(10, 84);
  ctx.lineTo(32, 52);
  ctx.lineTo(54, 84);
  ctx.stroke();
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export class RouteRibbon {
  private mesh: Mesh | null = null;
  private readonly material: MeshBasicMaterial;
  private lastBuild = 0;
  private builtFor: Route | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    this.material = new MeshBasicMaterial({
      map: chevrons(),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** `at` is the car's distance along the route; null hides the band. */
  update(route: Route | null, at: number, now: number): void {
    if (!route) {
      this.clear();
      return;
    }
    // The chevrons drift forward at walking pace to show the way.
    const map = this.material.map;
    if (map) map.offset.y = -(now / 1000) * 0.6;
    if (route === this.builtFor && now - this.lastBuild < 1000) return;
    this.lastBuild = now;
    this.builtFor = route;
    this.build(route, at);
  }

  clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.builtFor = null;
  }

  private build(route: Route, at: number): void {
    this.clear();
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const start = Math.max(0, at + 4);
    const end = Math.min(route.length, at + AHEAD);
    let v = 0;
    for (let d = start; d <= end; d += STEP) {
      const p = pointAt(route, d);
      const q = pointAt(route, Math.min(route.length, d + 1));
      const dir = q.clone().sub(p).setY(0);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      // Keep to the left lane of a two-way street, like the car does.
      let i = 1;
      while (i < route.cum.length - 1 && route.cum[i] < d) i++;
      const seg = route.steps[route.stepOf[i]]?.seg;
      const lane = laneOffset(seg);
      const centre = p.add(leftOf(dir, lane));
      const side = leftOf(dir, WIDTH / 2);
      for (const k of [-1, 1]) {
        const x = centre.x + side.x * k;
        const z = centre.z + side.z * k;
        pos.push(x, (this.groundAt(x, z) ?? 0) + LIFT, z);
        uv.push(k === -1 ? 0 : 1, (d - start) / (WIDTH * 2));
      }
      if (v > 0) {
        const a = v * 2 - 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      v++;
    }
    if (idx.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new Mesh(g, this.material);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
}
