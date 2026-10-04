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
import type { RoadGraph, Segment } from "../world/roads";
import { AutoDriver, type DriveWorld } from "./autoDriver";
import { createCarModel, type CarModel } from "./carModel";

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

/** The world the taxi drives in (see AutoDriver). */
export type TaxiWorld = DriveWorld;

export class RoboTaxi {
  state: TaxiState = "coming";
  readonly model: CarModel;
  private readonly driver: AutoDriver;
  private body: RAPIER.RigidBody;
  private vacancy: MeshStandardMaterial | null = null;
  // Meter
  metres = 0;
  slowSeconds = 0;
  destinationName = "";

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    groundAt: (x: number, z: number) => number | null,
  ) {
    this.driver = new AutoDriver(groundAt);
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

  get route() {
    return this.driver.route;
  }

  get speed(): number {
    return this.driver.speed;
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
    this.driver.place(pos, Math.atan2(travel.x, travel.z));
    this.sync();
    this.body.setTranslation(this.model.root.position, true);
    return this.driver.plan(world, pickup, { seg: start.seg, s: start.s, dir: start.dir });
  }

  /** The passenger is in: drive to the destination with the meter running. */
  board(world: TaxiWorld, destination: Vector3, name: string): boolean {
    this.state = "riding";
    this.metres = 0;
    this.slowSeconds = 0;
    this.destinationName = name;
    this.setDisplay("賃走");
    return this.driver.plan(world, destination);
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
    this.sync();
  }

  dispose(): void {
    this.scene.remove(this.model.root);
    this.world.removeRigidBody(this.body);
  }

  /** Advance the car; returns true when it has reached the end of its route. */
  update(dt: number, world: TaxiWorld): boolean {
    const { moved, done } = this.driver.update(dt, world);
    if (this.state === "riding") {
      this.metres += moved;
      if (this.driver.speed < 10 / 3.6) this.slowSeconds += dt;
    }
    this.sync();
    for (const w of this.model.wheels) (w.children[0] as Group).rotation.x += moved / 0.33;
    this.model.setLights({
      brake: this.driver.braking,
      reverse: false,
      left: false,
      right: false,
      night: false,
    });
    return done;
  }

  /** The model and the body follow the driver's pose. */
  private sync(): void {
    const p = this.driver.position;
    this.model.root.position.set(p.x, p.y + RIDE_HEIGHT, p.z);
    this.model.root.rotation.set(0, this.driver.yaw, 0);
    this.body.setNextKinematicTranslation(this.model.root.position);
    this.body.setNextKinematicRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.driver.yaw),
    );
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
