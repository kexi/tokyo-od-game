import type RAPIER from "@dimforge/rapier3d-compat";
import {
  CanvasTexture,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from "three";
import { Vehicle, type DriveInput } from "../physics/vehicle";
import type { RoadGraph, Segment } from "../world/roads";
import { AutoDriver, type DriveWorld } from "./autoDriver";
import { progressOn } from "./navigation";
import type { CarModel } from "./carModel";

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

const RIDE_HEIGHT = 0.86;
/** Seconds a robotaxi that gave up (stuck, or blocked where it may not pass) waits before trying again. */
const RETRY_AFTER = 10;
const IDLE: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false, brakeOnly: true };

/** The world the taxi drives in (see AutoDriver). */
export type TaxiWorld = DriveWorld;

export class RoboTaxi {
  state: TaxiState = "coming";
  readonly model: CarModel;
  /** A real car on the same physics as the player's: the program only turns the wheel and pedals. */
  readonly car: Vehicle;
  private readonly driver = new AutoDriver();
  private input: DriveInput = IDLE;
  /** A map pin over the car while it comes and waits, so the caller can spot it down the street. */
  private readonly pin: Sprite;
  private vacancy: MeshStandardMaterial | null = null;
  /** Seconds since the driver gave up (see update). */
  private stalled = 0;
  // Meter
  metres = 0;
  slowSeconds = 0;
  destinationName = "";

  constructor(
    private readonly scene: Scene,
    world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    this.car = new Vehicle(world, { taxi: true });
    this.model = this.car.model;
    scene.add(this.car.object);
    this.pin = makePin();
    this.car.object.add(this.pin);
    this.model.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const m = o.material as MeshStandardMaterial;
      if (m.name === "Vacancy") this.vacancy = m;
    });
    this.setDisplay("迎車");
  }

  get position(): Vector3 {
    return this.model.root.position;
  }

  get route() {
    return this.driver.route;
  }

  get speed(): number {
    return this.driver.speed;
  }

  /** Metres of route still to drive. */
  get remaining(): number {
    return this.driver.remaining;
  }

  /** The route ahead of the car (for the map), every few points. */
  routeAhead(): Vector3[] {
    const route = this.driver.route;
    if (!route) return [];
    const from = progressOn(route, this.car.position()).index;
    const pts = route.points.slice(Math.max(0, from - 1));
    return pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1);
  }

  get fare(): number {
    return fareFor(this.metres, this.slowSeconds);
  }

  /** Start somewhere on the streets around `near` and drive to `pickup`. */
  dispatch(graph: RoadGraph, world: TaxiWorld, near: Vector3, pickup: Vector3): boolean {
    const start = this.spawnPoint(graph, near);
    if (!start) return false;
    this.state = "coming";
    this.setDisplay("迎車");
    const { pos, dir } = graph.sample(start.seg, start.s);
    const travel = dir.multiplyScalar(start.dir);
    const yaw = Math.atan2(travel.x, travel.z);
    const left = new Vector3(travel.z, 0, -travel.x).multiplyScalar(start.seg.line.width * 0.25);
    const at = pos.clone().add(left);
    at.y = (this.groundAt(at.x, at.z) ?? pos.y) + RIDE_HEIGHT;
    this.car.setCoasting(true);
    this.car.teleport(at, yaw);
    this.car.syncVisuals();
    this.driver.place(at, yaw);
    return this.driver.plan(world, pickup, { seg: start.seg, s: start.s, dir: start.dir });
  }

  /**
   * The passenger gets in: drive to the destination with the meter running. The way is planned
   * first: with none (a closed-off forecourt, a one-way knot), the car stays waiting and false
   * comes back — an empty route would otherwise count as arrived on the spot.
   */
  board(world: TaxiWorld, destination: Vector3, name: string): boolean {
    if (!this.driver.plan(world, destination)) return false;
    this.state = "riding";
    this.metres = 0;
    this.slowSeconds = 0;
    this.destinationName = name;
    this.setDisplay("賃走");
    return true;
  }

  /** After the passenger leaves: drive off a little way, then the game removes the car. */
  leave(world: TaxiWorld): void {
    this.state = "leaving";
    this.setDisplay("回送");
    this.driver.plan(world, this.position.clone().add(this.driver.heading().multiplyScalar(250)));
  }

  /** Re-anchoring: shift the car and its route rigidly. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    this.driver.transform(offset, yawDelta);
    this.car.transform(offset, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawDelta));
  }

  dispose(): void {
    this.scene.remove(this.car.object);
    this.car.dispose();
  }

  /** One physics step with the wheel and pedals the program last chose (before world.step). */
  step(timestep: number): void {
    if (!this.car.isCoasting) this.car.update(timestep, this.input);
  }

  /**
   * Look at the road and set the wheel and pedals; returns true when the car has stopped at the end
   * of its route. Without a ground collider under it (far from the player) the car runs on the
   * kinematic model instead of the physics.
   */
  update(dt: number, world: TaxiWorld, ground: { hasCollider: boolean; night: boolean }): boolean {
    this.car.setCoasting(!ground.hasCollider);
    const pose = { position: this.car.position(), yaw: this.car.yaw(), speed: this.car.forwardSpeed() };
    const { input, moved, done, gaveUp } = this.driver.update(dt, world, pose);
    this.input = input;
    // Stuck or blocked for good: no one at the wheel to take over, so after a pause it starts
    // again from where it stands (as a remote operator of 特定自動運行 would have it do).
    this.stalled = gaveUp ? this.stalled + dt : 0;
    if (this.stalled > RETRY_AFTER) {
      this.stalled = 0;
      this.driver.retry(world);
    }
    if (!ground.hasCollider) this.car.coast(dt, input, this.groundAt);
    if (this.state === "riding") {
      this.metres += moved;
      if (this.driver.speed < 10 / 3.6) this.slowSeconds += dt;
    }
    this.car.syncVisuals();
    this.pin.visible = this.state === "coming" || this.state === "waiting";
    this.car.lightOverride = {
      brake: this.driver.braking,
      left: this.driver.signal === "left",
      right: this.driver.signal === "right",
      reverse: this.driver.reversing,
    };
    this.car.updateLights(ground.night);
    return done;
  }

  /** A street 250–500 m from `near`, so the ride in takes a minute or so. */
  private spawnPoint(graph: RoadGraph, near: Vector3): { seg: Segment; s: number; dir: 1 | -1 } | null {
    const candidates = graph.segments.filter((seg) => {
      if (!isDrivable(seg) || seg.line.width < 5.5 || seg.length < 30 || seg.closed) return false;
      const d = graph.sample(seg, seg.length / 2).pos.distanceTo(near);
      return d > 250 && d < 500;
    });
    const seg = candidates[Math.floor(Math.random() * candidates.length)];
    if (!seg) return null;
    const dir: 1 | -1 = seg.oneway !== 0 ? (seg.oneway as 1 | -1) : Math.random() < 0.5 ? 1 : -1;
    return { seg, s: seg.length / 2, dir };
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

/** Yellow map pin drawn at a fixed screen size, above the roof. */
function makePin(): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffd23c";
    ctx.strokeStyle = "#1d2a4a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(32, 32, 26, Math.PI * 0.85, Math.PI * 2.15);
    ctx.lineTo(32, 92);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d2a4a";
    ctx.beginPath();
    ctx.arc(32, 32, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false }));
  sprite.scale.set(0.035, 0.0525, 1);
  sprite.center.set(0.5, 0);
  sprite.position.set(0, 1.6, 0);
  sprite.renderOrder = 10;
  return sprite;
}
