import RAPIER from "@dimforge/rapier3d-compat";
import {
  CanvasTexture,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Scene,
} from "three";
import type { TurnRule } from "../world/regulations";
import type { GameClock } from "../world/ruleTime";
import { laneOffset, leftOf, speedLimit, type RoadGraph, type Segment } from "../world/roads";
import type { TrafficControl } from "../world/trafficControl";
import { createCarModel, type CarModel } from "./carModel";
import { planRoute, progressOn, type Route } from "./navigation";

/**
 * 自動運転タクシー (robotaxi) called from the phone. Level-4 driverless operation (特定自動運行,
 * 道路交通法 第75条の12 ff., in force since 2023-04): nobody sits at the wheel, so the car itself
 * must keep every rule — it drives the legal route (one-way streets and 指定方向外進行禁止 in
 * force), keeps left in its lane at or under the limit, slows for turns, stops at the stop line
 * for red and yellow and at 一時停止, and waits for cars and pedestrians ahead.
 */
export type TaxiState = "coming" | "waiting" | "riding" | "arrived" | "leaving";

/**
 * Tokyo 特別区・武三地区 普通車 fare from 2026-04-20 (上限 A 運賃): 500 yen for the first 1.0 km,
 * then 100 yen for every 232 m; below 10 km/h, every 1 min 25 s counts as 232 m (時間距離併用).
 */
export const FARE = { first: 500, firstMetres: 1000, step: 100, stepMetres: 232, stepSeconds: 85 };

export function fareFor(metres: number, slowSeconds: number): number {
  const units = metres + (slowSeconds / FARE.stepSeconds) * FARE.stepMetres;
  if (units <= FARE.firstMetres) return FARE.first;
  return FARE.first + FARE.step * Math.ceil((units - FARE.firstMetres) / FARE.stepMetres);
}

const ACCEL = 1.8; // m/s², gentle for passengers
const BRAKE = 4.5;
const TURN_SPEED = 4.2; // m/s (15 km/h) through left/right turns
const STOP_GAP = 3.2; // front bumper this far before a stop line / obstacle
const RIDE_HEIGHT = 0.86;

export type TaxiWorld = {
  graph: RoadGraph;
  control: TrafficControl;
  turnRules: TurnRule[];
  clock: GameClock;
  /** Things to keep clear of: traffic cars, the player's car, pedestrians in the road. */
  obstacles: Vector3[];
};

export class RoboTaxi {
  state: TaxiState = "coming";
  readonly model: CarModel;
  route: Route | null = null;
  private at = 0;
  private hint = 0;
  speed = 0;
  private body: RAPIER.RigidBody;
  private served = -1; // 一時停止 approach already stopped at
  private waited = 0;
  private target = new Vector3();
  private graph: RoadGraph | null = null;
  private vacancy: MeshStandardMaterial | null = null;
  // Meter
  metres = 0;
  slowSeconds = 0;
  destinationName = "";

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    this.model = createCarModel({ taxi: true });
    // The player's car hangs its wheels on the physics body; here they ride on the model.
    for (const w of this.model.wheels) this.model.root.add(w);
    scene.add(this.model.root);
    this.model.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const m = o.material as MeshStandardMaterial;
      if (m.name === "Vacancy") this.vacancy = m;
    });
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.6, 2.2), this.body);
    this.setDisplay("迎車");
  }

  get position(): Vector3 {
    return this.model.root.position;
  }

  get fare(): number {
    return fareFor(this.metres, this.slowSeconds);
  }

  /** Start somewhere on the streets around `near` and drive to `pickup`. */
  dispatch(graph: RoadGraph, world: TaxiWorld, near: Vector3, pickup: Vector3): boolean {
    const start = this.spawnPoint(graph, near);
    if (!start) return false;
    this.graph = graph;
    this.state = "coming";
    this.setDisplay("迎車");
    const { pos, dir } = graph.sample(start.seg, start.s);
    this.place(pos, dir.multiplyScalar(start.dir));
    return this.plan(world, pickup, { seg: start.seg, s: start.s, dir: start.dir });
  }

  /** The passenger is in: drive to the destination with the meter running. */
  board(world: TaxiWorld, destination: Vector3, name: string): boolean {
    this.state = "riding";
    this.metres = 0;
    this.slowSeconds = 0;
    this.destinationName = name;
    this.setDisplay("賃走");
    return this.plan(world, destination);
  }

  /** After the passenger leaves: drive off a little way, then the game removes the car. */
  leave(world: TaxiWorld): void {
    this.state = "leaving";
    this.setDisplay("回送");
    const ahead = this.position.clone().add(this.heading().multiplyScalar(250));
    this.plan(world, ahead);
  }

  /** Re-anchoring: shift the car and its route rigidly. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    offset(this.model.root.position);
    this.model.root.rotation.y += yawDelta;
    offset(this.target);
    if (this.route) for (const p of this.route.points) offset(p);
  }

  dispose(): void {
    this.scene.remove(this.model.root);
    this.world.removeRigidBody(this.body);
  }

  /** Advance the car; returns true when it has reached the end of its route. */
  update(dt: number, world: TaxiWorld): boolean {
    // A new road graph (area change, re-anchoring): plan again from where the car is.
    if (world.graph !== this.graph && this.route) this.plan(world, this.target);
    const route = this.route;
    if (!route) return false;
    const remaining = route.length - this.at;
    const isAtEnd = remaining < 0.5;
    let want = isAtEnd ? 0 : this.cruise(route, world);
    // Ease to a stop at the kerb at the end of the route.
    want = Math.min(want, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, remaining - 0.3)));
    const block = this.blockAhead(route, world, dt);
    if (block < Infinity) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, block - STOP_GAP)));
    this.speed += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, want - this.speed));
    if (this.speed < 0.05 && want < 0.05) this.speed = 0;
    const step = this.speed * dt;
    this.at = Math.min(route.length, this.at + step);
    if (this.state === "riding") {
      this.metres += step;
      if (this.speed < 10 / 3.6) this.slowSeconds += dt;
    }
    this.pose(route);
    this.model.setLights({
      brake: want < this.speed - 0.2 || this.speed < 0.1,
      reverse: false,
      left: false,
      right: false,
      night: false,
    });
    // The road map only covers ~1 km round the car: at its edge, wait for the next one.
    return isAtEnd && this.speed === 0 && route.reachesTarget;
  }

  // ---------------------------------------------------------------- planning

  private plan(world: TaxiWorld, target: Vector3, from?: { seg: Segment; s: number; dir: 1 | -1 }): boolean {
    this.graph = world.graph;
    this.target.copy(target);
    let start = from;
    if (!start) {
      const hit = world.graph.nearest(this.position, 25, isDrivable);
      if (!hit) return false;
      start = { seg: hit.seg, s: hit.s, dir: hit.dir.dot(this.heading()) >= 0 ? 1 : -1 };
    }
    const route = planRoute(world.graph, start, target, world.clock, world.turnRules);
    if (!route) return false;
    this.route = route;
    this.at = 0;
    this.hint = 0;
    this.served = -1;
    return true;
  }

  /** A street 250–500 m from `near`, so the ride in takes a minute or so. */
  private spawnPoint(graph: RoadGraph, near: Vector3): { seg: Segment; s: number; dir: 1 | -1 } | null {
    const candidates = graph.segments.filter((seg) => {
      if (!isDrivable(seg) || seg.line.width < 5.5 || seg.length < 30) return false;
      const d = graph.sample(seg, seg.length / 2).pos.distanceTo(near);
      return d > 250 && d < 500;
    });
    const seg = candidates[Math.floor(Math.random() * candidates.length)];
    if (!seg) return null;
    const dir: 1 | -1 = seg.oneway !== 0 ? (seg.oneway as 1 | -1) : Math.random() < 0.5 ? 1 : -1;
    return { seg, s: seg.length / 2, dir };
  }

  // ---------------------------------------------------------------- driving

  /** Speed to aim for on this stretch: the limit, less for the next turn. */
  private cruise(route: Route, world: TaxiWorld): number {
    const k = this.stepIndex(route);
    const seg = route.steps[k].seg;
    let v = Math.max(5, speedLimit(seg) / 3.6 - 1.5);
    const next = route.maneuvers.find((m) => m.at > this.at - 2);
    if (next) {
      const d = Math.max(0, next.at - this.at - 6);
      const vTurn = next.turn === "slightLeft" || next.turn === "slightRight" ? 7 : TURN_SPEED;
      v = Math.min(v, Math.sqrt(vTurn * vTurn + 2 * 2.5 * d));
    }
    void world;
    return v;
  }

  /** Distance to the nearest reason to stop ahead: a stop line, a car, a person. */
  private blockAhead(route: Route, world: TaxiWorld, dt: number): number {
    let block = Infinity;
    const k = this.stepIndex(route);
    const st = route.steps[k];
    const travel = route.stepEntry[k] + (this.at - route.stepStart[k]);
    const next = world.control.nextStop(st.seg, st.dir, travel);
    if (next) {
      const { approach, dist } = next;
      if (approach.kind === "signal") {
        const state = world.control.state(approach);
        // 施行令 第2条: on yellow, stop unless too close to stop safely.
        const canStop = dist > (this.speed * this.speed) / (2 * BRAKE);
        if (state === "red" || (state === "yellow" && canStop)) block = dist;
      } else if (this.served !== approach.id) {
        // 一時停止: a full stop at the line, then on.
        const isStanding = dist < STOP_GAP + 0.6 && this.speed < 0.1;
        this.waited = isStanding ? this.waited + dt : 0;
        if (this.waited > 1.5) {
          this.served = approach.id;
          this.waited = 0;
        } else block = dist;
      }
    }
    const pos = this.position;
    const dir = this.heading();
    for (const o of world.obstacles) {
      const dx = o.x - pos.x;
      const dz = o.z - pos.z;
      const ahead = dx * dir.x + dz * dir.z;
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      if (ahead > 0 && ahead < 40 && lateral < 1.7) block = Math.min(block, ahead - 2.4);
    }
    return block;
  }

  private stepIndex(route: Route): number {
    const p = progressOn(route, this.position, this.hint);
    this.hint = p.index;
    // The point just ahead decides which street the car is on.
    let i = this.hint;
    while (i < route.cum.length - 1 && route.cum[i] < this.at) i++;
    return route.stepOf[Math.min(i, route.stepOf.length - 1)] ?? 0;
  }

  /** Lane position at the current distance, heading toward a point a few metres on. */
  private pose(route: Route): void {
    const here = this.pointAt(route, this.at);
    const look = this.pointAt(route, Math.min(route.length, this.at + 4));
    const dir = look.clone().sub(here).setY(0);
    if (dir.lengthSq() > 1e-4) {
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      const r = this.model.root.rotation;
      const d = Math.atan2(Math.sin(yaw - r.y), Math.cos(yaw - r.y));
      r.y += d * 0.35;
    }
    const g = this.groundAt(here.x, here.z) ?? this.model.root.position.y - RIDE_HEIGHT;
    this.model.root.position.set(here.x, g + RIDE_HEIGHT, here.z);
    this.body.setNextKinematicTranslation(this.model.root.position);
    this.body.setNextKinematicRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.model.root.rotation.y),
    );
    for (const w of this.model.wheels) (w.children[0] as Group).rotation.x += (this.speed / 0.33) * 0.016;
  }

  /** Route point at distance `d`, moved into the left lane of the street it is on. */
  private pointAt(route: Route, d: number): Vector3 {
    let i = 1;
    while (i < route.cum.length - 1 && route.cum[i] < d) i++;
    const a = route.points[i - 1];
    const b = route.points[i];
    const t = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
    const p = a.clone().lerp(b, Math.min(1, Math.max(0, t)));
    const seg = route.steps[route.stepOf[i]]?.seg;
    const lane = laneOffset(seg);
    const dir = b.clone().sub(a).setY(0);
    if (dir.lengthSq() > 1e-6) p.add(leftOf(dir.normalize(), lane));
    return p;
  }

  private place(pos: Vector3, dir: Vector3): void {
    const g = this.groundAt(pos.x, pos.z) ?? pos.y;
    this.model.root.position.set(pos.x, g + RIDE_HEIGHT, pos.z);
    this.model.root.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    this.body.setTranslation(this.model.root.position, true);
  }

  private heading(): Vector3 {
    const y = this.model.root.rotation.y;
    return new Vector3(Math.sin(y), 0, Math.cos(y));
  }

  /** The roof-side LED display: 迎車 / 賃走 / 支払 / 回送. */
  private setDisplay(text: string): void {
    if (!this.vacancy) return;
    this.vacancy.map = displayTexture(text);
    this.vacancy.emissiveMap = this.vacancy.map;
    this.vacancy.needsUpdate = true;
  }
}

const isDrivable = (seg: Segment) => seg.line.kind !== "highway" && seg.line.width >= 3;

const displays = new Map<string, CanvasTexture>();
const DISPLAY_COLOUR: Record<string, string> = {
  迎車: "#3cff6a",
  賃走: "#3cff6a",
  支払: "#ffd23c",
  回送: "#ff8a3c",
};

/** LED-matrix style text like the agy 空車 texture (256×64), drawn at runtime per state. */
function displayTexture(text: string): CanvasTexture {
  let t = displays.get(text);
  if (t) return t;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#0a0b0c";
  ctx.fillRect(0, 0, 256, 64);
  // Render the glyphs small, then sample them onto an LED dot grid.
  const glyph = document.createElement("canvas");
  glyph.width = 64;
  glyph.height = 16;
  const g = glyph.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#fff";
  g.font = `bold 15px "Noto Sans JP", "Hiragino Sans", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText([...text].join(" "), 32, 8.5);
  const px = g.getImageData(0, 0, 64, 16).data;
  ctx.fillStyle = DISPLAY_COLOUR[text] ?? "#ff3030";
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 64; x++) {
      if (px[(y * 64 + x) * 4 + 3] < 110) continue;
      ctx.beginPath();
      ctx.arc(x * 4 + 2, y * 4 + 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false; // glTF UVs, like the texture it replaces
  displays.set(text, t);
  return t;
}
