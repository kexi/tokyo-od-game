import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as i18n from "../i18n";
import { warn } from "../log";
import { animateHuman, disposeHuman, type HumanModel } from "../world/human";
import { createOfficer, dressFor, loadOfficerModels, type OfficerKind } from "../world/officer";
import { leftOf } from "../world/roads";
import type { StoryPanel } from "./arrestStory";
import { ART_H, ART_W, drawPanel, type ArtWords } from "./storyArt";
import type { ChoiceId, GuideStep, Tone } from "./trafficStop";
import { sharedDraco } from "../render/draco";

/**
 * What the pursuit and its aftermath look like (pursuitDirector.ts decides what happens): the
 * police helicopter overhead with its searchlight at night, the 検問 set up ahead (cones, a patrol
 * car across the lane, an officer waving a light, the 「検問中」 board), the officer walking up to
 * the driver's window, the camera shots of the roadside stop, and the panels on screen — the
 * pull-over guide, the conversation at the window, the police radio and the story panels.
 *
 * Models: scripts/blender/police_heli.py and checkpoint.py (no real force's markings or emblem),
 * the officers of police.py and police_bike.py (world/officer.ts).
 */
/**
 * Where the helicopter keeps station: ahead of the car on its heading, swaying from side to side,
 * low enough to be in the picture. Why not circle overhead as a real police helicopter does (a few
 * hundred metres up): from the chase camera (looking 11° down, 31° half-height) and the driver's
 * seat, anything more than about 15° above the horizon is off the top of the screen. 80 m up and
 * 340 m ahead is about 13° from the chase camera. Tall buildings still hide it now and then.
 */
export const HELI = {
  alt: 80, // m above the ground under it
  ahead: 340, // m ahead of the car
  sway: 90, // m to either side
  swayRate: 0.12, // rad/s
  speed: 50, // m/s at most
  from: 650, // m further ahead (and up) when it is called in
  arrive: 40, // m from its station: on station
} as const;
const ROTOR_HZ = 4.6; // main rotor revolutions a second (the tail turns 5× as fast)
const SPOT_RADIUS = 7; // m: the searchlight's pool on the street

type HeliParts = {
  root: Group;
  mainRotor: Object3D | null;
  tailRotor: Object3D | null;
  searchlight: Object3D | null;
  anti: MeshStandardMaterial[];
  strobe: MeshStandardMaterial[];
  nav: MeshStandardMaterial[];
  lens: MeshStandardMaterial[];
};

let heliTemplate: Object3D | null = null;
let propTemplates: Map<string, Object3D> | null = null;

/** Loads the helicopter, the 検問 props and the officers once (each may fail on its own). */
export async function loadPursuitModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
  const heli = loader
    .loadAsync(`${import.meta.env.BASE_URL}models/police_heli.glb`)
    .then((g) => {
      g.scene.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
      });
      heliTemplate = g.scene;
    })
    .catch((error: unknown) => warn("heli_model_failed", { error: String(error) }));
  const props = loader
    .loadAsync(`${import.meta.env.BASE_URL}models/checkpoint.glb`)
    .then((g) => {
      const map = new Map<string, Object3D>();
      for (const name of ["Cone", "ConeBar", "Baton", "Sign", "Lamp"]) {
        const o = g.scene.getObjectByName(name);
        if (o) map.set(name, o);
      }
      propTemplates = map;
    })
    .catch((error: unknown) => warn("checkpoint_model_failed", { error: String(error) }));
  await Promise.all([heli, props, loadOfficerModels()]);
}

/** Its own copies of the named materials (so flashing one copy does not flash another). */
function ownMaterials(root: Object3D, names: readonly string[]): Map<string, MeshStandardMaterial[]> {
  const out = new Map<string, MeshStandardMaterial[]>();
  const copies = new Map<Material, MeshStandardMaterial>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const list = [o.material].flat() as Material[];
    const mapped = list.map((m) => {
      const isWanted = m instanceof MeshStandardMaterial && names.includes(m.name);
      if (!isWanted) return m;
      let c = copies.get(m);
      if (!c) {
        c = m.clone();
        copies.set(m, c);
        out.set(m.name, [...(out.get(m.name) ?? []), c]);
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? mapped : mapped[0];
  });
  return out;
}

function buildHeli(): HeliParts {
  const root = new Group();
  const model = heliTemplate?.clone(true) ?? fallbackHeli();
  root.add(model);
  const mats = ownMaterials(model, ["AntiCollision", "Strobe", "NavRed", "NavGreen", "SearchLens"]);
  return {
    root,
    mainRotor: model.getObjectByName("MainRotor") ?? null,
    tailRotor: model.getObjectByName("TailRotor") ?? null,
    searchlight: model.getObjectByName("Searchlight") ?? null,
    anti: mats.get("AntiCollision") ?? [],
    strobe: mats.get("Strobe") ?? [],
    nav: [...(mats.get("NavRed") ?? []), ...(mats.get("NavGreen") ?? [])],
    lens: mats.get("SearchLens") ?? [],
  };
}

/** A plain stand-in when the model did not load: a white body and a rotor disc. */
function fallbackHeli(): Group {
  const g = new Group();
  const body = new Mesh(
    new ConeGeometry(1.2, 9, 8).rotateX(Math.PI / 2),
    new MeshStandardMaterial({ color: 0xf2f2f2 }),
  );
  body.position.y = 1.8;
  const rotor = new Mesh(
    new CircleGeometry(6.9, 24).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35 }),
  );
  rotor.name = "MainRotor";
  rotor.position.y = 3.6;
  g.add(body, rotor);
  return g;
}

/** A soft round pool of light (the searchlight on the street), as a texture. */
function spotTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(255,250,235,1)");
    g.addColorStop(0.6, "rgba(255,245,220,0.5)");
    g.addColorStop(1, "rgba(255,245,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The station for a car at `car` heading `forward` (horizontal), `t` seconds into the chase. */
export function heliStation(
  car: Vector3,
  forward: Vector3,
  ground: number,
  t: number,
  out = new Vector3(),
): Vector3 {
  const f = new Vector3(forward.x, 0, forward.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
  f.normalize();
  const side = HELI.sway * Math.sin(t * HELI.swayRate);
  return out.set(
    car.x + f.x * HELI.ahead + f.z * side,
    ground + HELI.alt,
    car.z + f.z * HELI.ahead - f.x * side,
  );
}

/**
 * One step of the flight toward `desired`: the velocity eases toward a speed proportional to the
 * distance left (capped at HELI.speed), so it slows into its station. Returns the distance left.
 */
export function stepHeli(pos: Vector3, velocity: Vector3, desired: Vector3, dt: number): number {
  const toGo = desired.clone().sub(pos);
  const want = toGo.clone().multiplyScalar(0.6);
  if (want.length() > HELI.speed) want.setLength(HELI.speed);
  velocity.lerp(want, Math.min(1, dt * 1.5));
  pos.addScaledVector(velocity, dt);
  return desired.distanceTo(pos);
}

/** The police helicopter: flies in, keeps station ahead of the car, lights it at night, flies off. */
class Heli {
  readonly parts: HeliParts;
  state: "off" | "in" | "orbit" | "out" = "off";
  private readonly beam: Mesh;
  private readonly spot: Mesh;
  private t = 0;
  private readonly velocity = new Vector3();
  private readonly away = new Vector3();
  private readonly desired = new Vector3();
  /** Where it turned for home: gone once far enough from there. */
  private readonly leftFrom = new Vector3();

  constructor(private readonly scene: Scene) {
    this.parts = buildHeli();
    this.parts.root.visible = false;
    scene.add(this.parts.root);
    const beamMaterial = new MeshBasicMaterial({
      color: 0xfff1d6,
      transparent: true,
      opacity: 0.09,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    // Apex at the origin, the open base one unit down −Y: scaled to the length and the pool's size.
    this.beam = new Mesh(new ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0), beamMaterial);
    this.beam.visible = false;
    this.beam.renderOrder = 3;
    const spotMaterial = new MeshBasicMaterial({
      map: spotTexture(),
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.spot = new Mesh(new CircleGeometry(1, 32).rotateX(-Math.PI / 2), spotMaterial);
    this.spot.scale.setScalar(SPOT_RADIUS);
    this.spot.visible = false;
    this.spot.renderOrder = 2;
    scene.add(this.beam, this.spot);
  }

  get root(): Object3D {
    return this.parts.root;
  }

  get active(): boolean {
    return this.state !== "off";
  }

  /** Called in: appears HELI.from beyond its station (ahead of the car) and flies to it, head-on. */
  enter(target: Vector3, forward: Vector3, ground: number): void {
    // A helicopter still flying off from the last chase turns back.
    this.t = 0;
    const station = heliStation(target, forward, ground, 0);
    const f = new Vector3(forward.x, 0, forward.z).normalize();
    if (this.state === "off") {
      this.parts.root.position
        .copy(station)
        .addScaledVector(f, HELI.from)
        .setY(station.y + 40);
      this.velocity.set(0, 0, 0);
    }
    this.state = "in";
    this.parts.root.visible = true;
  }

  /** Leaves (the pursuit is over): flies off and disappears. */
  leave(): void {
    if (!this.active) return;
    this.state = "out";
    const v = new Vector3(this.velocity.x, 0, this.velocity.z);
    this.away.copy(v.lengthSq() > 1 ? v.normalize() : new Vector3(1, 0, 0));
    this.leftFrom.copy(this.parts.root.position);
  }

  /** Metres from its station (or from the car, flying off), and its height above the ground there. */
  describe(target: Vector3 | null, ground: number): { state: string; toStation: number; height: number } {
    const p = this.parts.root.position;
    return {
      state: this.state,
      toStation: target ? Math.round(this.desired.distanceTo(p)) : -1,
      height: Math.round(p.y - ground),
    };
  }

  transform(offset: (p: Vector3) => Vector3): void {
    offset(this.parts.root.position);
  }

  update(
    dt: number,
    now: number,
    car: { position: Vector3; forward: Vector3 } | null,
    groundAt: (x: number, z: number) => number | null,
    night: boolean,
  ): void {
    const root = this.parts.root;
    if (this.state === "off") return;
    this.t += dt;
    const target = car?.position ?? null;
    const isLeaving = this.state === "out" || !car;
    if (isLeaving) {
      this.desired.copy(root.position).addScaledVector(this.away, 400);
      this.desired.y = root.position.y + 30;
    } else {
      const ground = groundAt(car.position.x, car.position.z) ?? car.position.y;
      heliStation(car.position, car.forward, ground, this.t, this.desired);
    }
    const left = stepHeli(root.position, this.velocity, this.desired, dt);
    const isArrived = this.state === "in" && left < HELI.arrive;
    if (isArrived) this.state = "orbit";
    const isGone = this.state === "out" && root.position.distanceTo(this.leftFrom) > 800;
    if (isGone) this.hide();
    // Nose along the way it flies when fast, toward the car when on station; a little nose-down with speed.
    const flat = Math.hypot(this.velocity.x, this.velocity.z);
    const look = flat > 8 || !target ? this.velocity : target.clone().sub(root.position);
    root.rotation.set(Math.min(0.18, flat / 250), Math.atan2(look.x, look.z), 0, "YXZ");
    // Rotors, lamps: the red anti-collision beacon about once a second, the white strobe double-flashing.
    if (this.parts.mainRotor) this.parts.mainRotor.rotation.y += dt * ROTOR_HZ * Math.PI * 2;
    if (this.parts.tailRotor) this.parts.tailRotor.rotation.x += dt * ROTOR_HZ * 5 * Math.PI * 2;
    const beacon = now % 1000 < 120 ? 3 : 0;
    const strobe = now % 1300 < 60 || (now % 1300 > 180 && now % 1300 < 240) ? 4 : 0;
    for (const m of this.parts.anti) m.emissiveIntensity = beacon;
    for (const m of this.parts.strobe) m.emissiveIntensity = strobe;
    for (const m of this.parts.nav) m.emissiveIntensity = 1.5;
    this.light(target, night && this.state === "orbit", groundAt);
  }

  /** The searchlight on the car at night: the lamp turned to it, a faint beam and a pool on the street. */
  private light(
    target: Vector3 | null,
    on: boolean,
    groundAt: (x: number, z: number) => number | null,
  ): void {
    for (const m of this.parts.lens) m.emissiveIntensity = on ? 6 : 0;
    this.beam.visible = on && target !== null;
    this.spot.visible = this.beam.visible;
    if (!on || !target) return;
    const lamp = this.parts.searchlight;
    lamp?.lookAt(target);
    const from = lamp ? lamp.getWorldPosition(new Vector3()) : this.parts.root.position.clone();
    const ground = groundAt(target.x, target.z) ?? target.y;
    const to = new Vector3(target.x, ground, target.z);
    const dir = to.clone().sub(from);
    const length = dir.length();
    this.beam.position.copy(from);
    this.beam.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
    this.beam.scale.set(SPOT_RADIUS * 0.8, length, SPOT_RADIUS * 0.8);
    this.spot.position.set(to.x, ground + 0.12, to.z);
  }

  private hide(): void {
    this.state = "off";
    this.parts.root.visible = false;
    this.beam.visible = false;
    this.spot.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.parts.root, this.beam, this.spot);
  }
}

/** The board's face: 「検問中」 as a Japanese board says it (it stands in Tokyo, it is not UI). */
function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 384;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#f6f6f2";
    ctx.fillRect(0, 0, 256, 384);
    ctx.strokeStyle = "#c8262c";
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 236, 364);
    ctx.fillStyle = "#c8262c";
    ctx.font = '900 92px "Noto Sans JP", "Hiragino Sans", sans-serif';
    ctx.textAlign = "center";
    for (const [i, ch] of [..."検問中"].entries()) ctx.fillText(ch, 128, 120 + i * 104);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  // The board's UVs run up the face (v up); the canvas's rows run down.
  t.flipY = false;
  return t;
}

/** The 検問: cones tapering the lane, a board, red lamps and an officer waving a light. */
class Checkpoint {
  readonly group = new Group();
  officer: HumanModel | null = null;
  private baton: Object3D | null = null;
  private lights: MeshStandardMaterial[] = [];
  private lamps: MeshStandardMaterial[] = [];
  readonly at = new Vector3();
  readonly along = new Vector3(0, 0, 1);
  halfWidth = 3;
  private t = 0;

  constructor(private readonly scene: Scene) {
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.group.visible;
  }

  /**
   * Set up across the travel half of the road at `at` (the centreline), for traffic coming along
   * `along`; `halfWidth` is the half of the road the car drives in.
   */
  place(
    at: Vector3,
    along: Vector3,
    halfWidth: number,
    month: number,
    groundAt: (x: number, z: number) => number | null,
  ): void {
    this.clear();
    this.at.copy(at);
    this.along.copy(along).setY(0).normalize();
    this.halfWidth = halfWidth;
    const props = propTemplates;
    const put = (name: string, a: number, l: number, yaw: number): Object3D | null => {
      const t = props?.get(name);
      if (!t) return null;
      const o = t.clone(true);
      const p = this.point(a, l);
      o.position.set(p.x, groundAt(p.x, p.z) ?? p.y, p.z);
      o.rotation.set(0, yaw, 0);
      this.group.add(o);
      return o;
    };
    const facing = Math.atan2(-this.along.x, -this.along.z);
    // The bar's length runs along its local X: turned so X points across the lane (to the left).
    const left = leftOf(this.along, 1);
    const across = Math.atan2(-left.z, left.x);
    // A taper of cones from the kerb toward the middle, ending at the patrol car's nose.
    for (let k = 0; k < 5; k++) put("Cone", -16 + k * 3, halfWidth - 0.5 - k * ((halfWidth - 1.4) / 4), 0);
    put("Cone", -1.8, 0.6, 0);
    put("Cone", -1.8, 2.4, 0);
    const bar = put("ConeBar", -1.8, 1.5, across);
    if (bar) bar.position.y += 0.66;
    const sign = put("Sign", -30, halfWidth - 0.6, facing);
    if (sign) {
      sign.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const list = [o.material].flat() as Material[];
        const mapped = list.map((m) => {
          if (m.name !== "SignFace") return m;
          return new MeshStandardMaterial({ map: signTexture(), roughness: 0.6 });
        });
        o.material = Array.isArray(o.material) ? mapped : mapped[0];
      });
    }
    for (const a of [-3, 6]) put("Lamp", a, halfWidth - 0.3, facing);
    const lit = ownMaterials(this.group, ["LampRed", "BatonLight"]);
    this.lamps = lit.get("LampRed") ?? [];
    // The officer: the traffic dress (vest, white cap cover), facing the cars that come.
    const officer = createOfficer("foot", dressFor(month, true));
    if (officer) {
      const p = this.point(-5, Math.max(0.8, halfWidth * 0.35));
      officer.root.position.set(p.x, groundAt(p.x, p.z) ?? p.y, p.z);
      officer.root.rotation.y = facing;
      this.group.add(officer.root);
      this.officer = officer;
      const baton = props?.get("Baton")?.clone(true) ?? null;
      if (baton) {
        // Held in the right hand, the light pointing on along the forearm.
        baton.position.set(0, -0.3, 0.02);
        baton.rotation.set(Math.PI, 0, 0);
        officer.forearms[0].add(baton);
        this.baton = baton;
        this.lights = ownMaterials(baton, ["BatonLight"]).get("BatonLight") ?? [];
      }
    }
    this.group.visible = true;
  }

  /** The point `a` m along the traffic and `l` m left of the centreline. */
  point(a: number, l: number): Vector3 {
    return this.at.clone().addScaledVector(this.along, a).add(leftOf(this.along, l));
  }

  /** Where the patrol car stands across the lane, and its heading. */
  carSpot(): { at: Vector3; yaw: number } {
    const at = this.point(1.5, Math.max(1.2, this.halfWidth * 0.45));
    const side = leftOf(this.along, 1);
    return { at, yaw: Math.atan2(side.x, side.z) };
  }

  /** The car is in the 検問's zone: from 25 m before it to just past it, on this side of the road. */
  contains(p: Vector3): boolean {
    if (!this.active) return false;
    const d = p.clone().sub(this.at);
    const a = d.dot(this.along);
    const l = d.dot(leftOf(this.along, 1));
    return a > -25 && a < 4 && l > -1 && l < this.halfWidth + 1.5;
  }

  officerPosition(): Vector3 | null {
    return this.officer ? this.officer.root.position.clone() : null;
  }

  update(dt: number, now: number, night: boolean): void {
    if (!this.active) return;
    this.t += dt;
    const o = this.officer;
    if (o) {
      animateHuman(o, 0, 0, false);
      // Waving the light: the right arm swings out and up across the body and back.
      o.arms[0].rotation.set(-0.5, 0, -(0.75 + 0.55 * Math.sin(this.t * 3.2)));
      o.forearms[0].rotation.set(-0.35, 0, 0);
    }
    const blink = Math.floor(now / 500) % 2 === 0;
    for (const m of this.lamps) m.emissiveIntensity = blink ? 3 : 0.3;
    for (const m of this.lights) m.emissiveIntensity = night ? 4 : 2;
    if (this.baton) this.baton.visible = true;
  }

  transform(offset: (p: Vector3) => Vector3): void {
    offset(this.at);
    for (const c of this.group.children) offset(c.position);
  }

  clear(): void {
    if (this.officer) disposeHuman(this.officer);
    this.officer = null;
    this.baton = null;
    this.group.clear();
    this.group.visible = false;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}

/** The officer of the roadside stop: out of the patrol car, along the car's right, to the window. */
class StopOfficer {
  model: HumanModel | null = null;
  private from = new Vector3();
  private to = new Vector3();
  private phase = 0;
  private walked = 0;
  private length = 0;
  private faceYaw = 0;
  state: "walk" | "stand" | "back" | "gone" = "gone";

  constructor(private readonly scene: Scene) {}

  start(kind: OfficerKind, month: number, from: Vector3, to: Vector3, faceYaw: number): void {
    this.clear();
    this.model = createOfficer(kind, dressFor(month, false));
    if (!this.model) return;
    this.from.copy(from);
    this.to.copy(to);
    this.length = from.distanceTo(to);
    this.walked = 0;
    this.faceYaw = faceYaw;
    this.state = "walk";
    this.model.root.position.copy(from);
    this.scene.add(this.model.root);
  }

  setVisible(visible: boolean): void {
    if (this.model) this.model.root.visible = visible;
  }

  /** Back to the patrol car (and gone when there). */
  back(to: Vector3): void {
    if (!this.model) return;
    this.from.copy(this.model.root.position);
    this.to.copy(to);
    this.length = this.from.distanceTo(to);
    this.walked = 0;
    this.state = "back";
  }

  get position(): Vector3 | null {
    return this.model ? this.model.root.position.clone() : null;
  }

  /** The head, for the window shot. */
  head(): Vector3 | null {
    return this.model ? this.model.root.position.clone().add(new Vector3(0, 1.62, 0)) : null;
  }

  update(dt: number, groundAt: (x: number, z: number) => number | null, writing: boolean): void {
    const m = this.model;
    if (!m || this.state === "gone") return;
    const isWalking = this.state === "walk" || this.state === "back";
    if (isWalking) {
      this.walked = Math.min(this.length, this.walked + dt * 1.3);
      const k = this.length > 0 ? this.walked / this.length : 1;
      const p = this.from.clone().lerp(this.to, k);
      p.y = groundAt(p.x, p.z) ?? p.y;
      m.root.position.copy(p);
      const dir = this.to.clone().sub(this.from);
      m.root.rotation.y = Math.atan2(dir.x, dir.z);
      this.phase += dt * 5.2;
      animateHuman(m, this.phase, 1.3, false);
      const isThere = this.walked >= this.length - 0.01;
      if (isThere && this.state === "walk") {
        this.state = "stand";
        m.root.rotation.y = this.faceYaw;
      }
      if (isThere && this.state === "back") this.clear();
      return;
    }
    animateHuman(m, 0, 0, false);
    // At the window: a little bent toward it; writing, the right hand comes up with the pad.
    m.body.rotation.x = 0.12;
    if (writing) {
      m.arms[0].rotation.set(-0.7, 0, 0);
      m.forearms[0].rotation.set(-1.2, 0, 0);
      m.arms[1].rotation.set(-0.5, 0, 0);
      m.forearms[1].rotation.set(-1.3, 0, 0);
    }
  }

  transform(offset: (p: Vector3) => Vector3): void {
    offset(this.from);
    offset(this.to);
    if (this.model) offset(this.model.root.position);
  }

  clear(): void {
    if (this.model) {
      this.scene.remove(this.model.root);
      disposeHuman(this.model);
    }
    this.model = null;
    this.state = "gone";
  }
}

/** The camera shots of the roadside stop. */
export type Shot = "patrol" | "walk" | "window" | null;
export type ShotSubjects = {
  car: Vector3;
  carQuat: Quaternion;
  patrol: Vector3 | null;
  officer: Vector3 | null;
};

/** One dialogue line on screen: who, what, the moment's picture, the choices. */
export type DialogueView = {
  speaker: string;
  line: string;
  tone: Tone;
  snapshot?: string;
  choices: Array<{ id: ChoiceId; label: string }>;
};

export class PursuitScene {
  readonly heli: Heli;
  readonly checkpoint: Checkpoint;
  readonly officer: StopOfficer;
  shot: Shot = null;
  private shotStart = 0;
  private readonly panels: {
    guide: HTMLElement;
    guideList: HTMLOListElement;
    dialogue: HTMLElement;
    speaker: HTMLElement;
    line: HTMLElement;
    shotImg: HTMLImageElement;
    choices: HTMLElement;
    radio: HTMLElement;
    radioList: HTMLOListElement;
    story: HTMLElement;
    canvas: HTMLCanvasElement;
    caption: HTMLElement;
    counter: HTMLElement;
    next: HTMLButtonElement;
    skip: HTMLButtonElement;
  };
  private onChoice: ((id: ChoiceId) => void) | null = null;
  private storyWords: ArtWords | null = null;
  private storyPanel: StoryPanel | null = null;
  onStoryNext: (() => void) | null = null;
  onStorySkip: (() => void) | null = null;

  constructor(scene: Scene, hud: HTMLElement) {
    this.heli = new Heli(scene);
    this.checkpoint = new Checkpoint(scene);
    this.officer = new StopOfficer(scene);
    this.panels = buildPanels(hud);
    this.panels.next.addEventListener("click", () => this.onStoryNext?.());
    this.panels.skip.addEventListener("click", () => this.onStorySkip?.());
  }

  // ---------- camera ----------

  setShot(shot: Shot): void {
    if (shot === this.shot) return;
    this.shot = shot;
    this.shotStart = performance.now();
  }

  /**
   * Places the camera for the current shot; false when there is none (the chase camera goes on).
   * The patrol car seen from just behind the player's car; the officer walking along its right
   * side toward a camera ahead of it; the two-shot at the driver's window.
   */
  placeCamera(camera: PerspectiveCamera, s: ShotSubjects): boolean {
    if (!this.shot) return false;
    const local = (x: number, y: number, z: number) =>
      new Vector3(x, y, z).applyQuaternion(s.carQuat).add(s.car);
    const t = (performance.now() - this.shotStart) / 1000;
    if (this.shot === "patrol") {
      const eye = local(-0.7, 1.45, -3.1 - t * 0.15);
      camera.position.copy(eye);
      camera.lookAt(s.patrol ? s.patrol.clone().add(new Vector3(0, 0.9, 0)) : local(0, 1, -10));
      return true;
    }
    if (this.shot === "walk") {
      camera.position.copy(local(-2.7, 1.55, 4.4));
      const at = s.officer ? s.officer.clone().add(new Vector3(0, 1.3, 0)) : local(-1.2, 1.2, -2);
      camera.lookAt(at);
      return true;
    }
    const window = local(-0.85, 1.15, 0.3);
    const head = s.officer ? s.officer.clone().add(new Vector3(0, 1.55, 0)) : local(-1.6, 1.6, 0.3);
    camera.position.copy(local(-3.6, 1.7, 2.2));
    camera.lookAt(window.lerp(head, 0.5));
    return true;
  }

  // ---------- guide ----------

  /** The pull-over guide; `hint` names the key in リアル (簡単操作 says the car does it). */
  showGuide(steps: Array<GuideStep & { hint?: string }> | null): void {
    const p = this.panels;
    p.guide.hidden = steps === null;
    if (!steps) return;
    const items = steps.map((s) => {
      const li = document.createElement("li");
      li.className = s.done ? "done" : "";
      const how = s.auto
        ? i18n.t("stop.guide.auto")
        : s.hint
          ? i18n.t("stop.guide.key", { key: s.hint })
          : "";
      // English puts a space before the bracket; Japanese and Chinese full-width brackets do not.
      const gap = how && i18n.getLocale() === "en" ? " " : "";
      li.textContent = `${s.done ? "✓" : "○"} ${i18n.t(s.key)}${gap}${how}`;
      return li;
    });
    const text = items.map((li) => li.textContent).join("|");
    if (p.guideList.dataset.text === text) return;
    p.guideList.dataset.text = text;
    p.guideList.replaceChildren(...items);
  }

  // ---------- the window ----------

  showDialogue(view: DialogueView | null, onChoice: ((id: ChoiceId) => void) | null = null): void {
    const p = this.panels;
    p.dialogue.hidden = view === null;
    this.onChoice = onChoice;
    if (!view) return;
    p.dialogue.dataset.tone = view.tone;
    p.speaker.textContent = view.speaker;
    p.line.textContent = view.line;
    p.shotImg.hidden = !view.snapshot;
    if (view.snapshot) p.shotImg.src = view.snapshot;
    p.choices.replaceChildren(
      ...view.choices.map((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = i === 0 ? `${c.label}（Enter）` : c.label;
        b.addEventListener("click", () => this.choose(c.id));
        b.dataset.choice = c.id;
        return b;
      }),
    );
  }

  /** Enter: the first choice of the line on screen. */
  choosePrimary(): boolean {
    const first = this.panels.choices.querySelector<HTMLButtonElement>("button");
    if (this.panels.dialogue.hidden || !first) return false;
    first.click();
    return true;
  }

  private choose(id: ChoiceId): void {
    const fn = this.onChoice;
    this.onChoice = null;
    fn?.(id);
  }

  // ---------- the radio ----------

  radio(line: string | null): void {
    const p = this.panels;
    if (line === null) {
      p.radio.hidden = true;
      p.radioList.replaceChildren();
      return;
    }
    p.radio.hidden = false;
    const li = document.createElement("li");
    li.textContent = line;
    p.radioList.append(li);
    while (p.radioList.children.length > 3) p.radioList.firstElementChild?.remove();
  }

  // ---------- the story ----------

  showStory(
    panel: StoryPanel | null,
    index: number,
    count: number,
    words: ArtWords | null,
    caption: string,
  ): void {
    const p = this.panels;
    p.story.hidden = panel === null;
    this.storyPanel = panel;
    this.storyWords = words;
    if (!panel) return;
    p.caption.textContent = caption;
    p.counter.textContent = `${index + 1} / ${count}`;
  }

  /** Redraw the story's canvas (its slow push-in). */
  drawStory(progress: number): void {
    const panel = this.storyPanel;
    const words = this.storyWords;
    const ctx = this.panels.canvas.getContext("2d");
    if (!panel || !words || !ctx) return;
    drawPanel(ctx, panel.art, progress, words);
  }

  get storyShown(): boolean {
    return !this.panels.story.hidden;
  }

  /** Static labels again in the language in force (the buttons and headers are set once). */
  relabel(): void {
    const p = this.panels;
    i18n.setI18nText(p.next, "story.next");
    i18n.setI18nText(p.skip, "story.skip");
  }

  transform(offset: (p: Vector3) => Vector3): void {
    this.heli.transform(offset);
    this.checkpoint.transform(offset);
    this.officer.transform(offset);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

/** The panels, made once under #hud (so the replay hides them with the rest of the HUD). */
function buildPanels(hud: HTMLElement) {
  const guide = el("section", { id: "stop-guide", className: "panel", hidden: true });
  const guideTitle = el("header");
  i18n.setI18nText(guideTitle, "stop.guide.title");
  const guideList = el("ol");
  guide.append(guideTitle, guideList);

  const dialogue = el("section", { id: "stop-dialogue", className: "panel", hidden: true });
  dialogue.setAttribute("aria-live", "polite");
  const speaker = el("div", { className: "stop-speaker" });
  const line = el("p", { className: "stop-line" });
  const shotImg = el("img", { className: "stop-shot", hidden: true, alt: "" });
  const choices = el("div", { className: "stop-choices" });
  dialogue.append(speaker, line, shotImg, choices);

  const radio = el("section", { id: "police-radio", className: "panel", hidden: true });
  const radioTitle = el("header");
  i18n.setI18nText(radioTitle, "radio.title");
  const radioList = el("ol");
  radio.append(radioTitle, radioList);

  const story = el("section", { id: "pursuit-story", hidden: true });
  story.setAttribute("aria-live", "polite");
  const canvas = el("canvas", { width: ART_W, height: ART_H });
  const caption = el("p", { className: "story-caption" });
  const bar = el("div", { className: "story-bar" });
  const counter = el("span", { className: "sub" });
  const next = el("button", { type: "button" });
  const skip = el("button", { type: "button" });
  i18n.setI18nText(next, "story.next");
  i18n.setI18nText(skip, "story.skip");
  bar.append(counter, next, skip);
  story.append(canvas, caption, bar);
  hud.append(guide, dialogue, radio, story);
  return {
    guide,
    guideList,
    dialogue,
    speaker,
    line,
    shotImg,
    choices,
    radio,
    radioList,
    story,
    canvas,
    caption,
    counter,
    next,
    skip,
  };
}
