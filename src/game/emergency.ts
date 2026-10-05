import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Pedestrian } from "../world/pedestrians";
import type { SpatialAudio } from "./spatialAudio";
import { leftOf, type RoadGraph, type Segment } from "../world/roads";
import { sharedDraco } from "../render/draco";

export type ResponderKind = "ambulance" | "police";
export type IncidentEvent =
  | { type: "hitAndRun" }
  | { type: "notReported" }
  | { type: "arrived"; kind: ResponderKind }
  | { type: "rescued" }
  | { type: "closed" }
  | { type: "arrested"; later: boolean }
  | null;

type Responder = {
  kind: ResponderKind;
  root: Group;
  beacons: MeshStandardMaterial[];
  light: PointLight;
  path: Vector3[];
  progress: number;
  arrivedAt: number | null;
  /** Sounding (game/spatialAudio.ts places it on the vehicle and shifts it by Doppler). */
  siren: boolean;
};

type Incident = {
  victim: Pedestrian;
  at: Vector3;
  startedAt: number;
  ambulanceCalled: boolean;
  policeCalled: boolean;
  fled: boolean;
  rescued: boolean;
};

const REPORT_LIMIT_MS = 60_000; // time to call 119 before it counts as leaving the victim
const LEAVE_DISTANCE = 80; // metres from the scene
const SPEED: Record<ResponderKind, number> = { ambulance: 11, police: 12 }; // m/s
const APPROACH: Record<ResponderKind, number> = { ambulance: 260, police: 320 };

function sideTexture(text: string, band: string, bg: string, ink: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = band;
    ctx.fillRect(0, 92, c.width, 20);
    ctx.fillStyle = ink;
    ctx.font = "bold 60px 'Hiragino Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, c.width / 2, 70);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function wheels(root: Group, xs: number, zf: number, zr: number, r: number): void {
  const wheel = new CylinderGeometry(r, r, 0.28, 14).rotateZ(Math.PI / 2);
  const tire = new MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  for (const [x, z] of [
    [-xs, zf],
    [xs, zf],
    [-xs, zr],
    [xs, zr],
  ]) {
    const w = new Mesh(wheel, tire);
    w.position.set(x, -0.45, z);
    root.add(w);
  }
}

/**
 * 高規格救急車 modelled in Blender (scripts/blender/ambulance.py → public/models/ambulance.glb)
 * with agy's decals; its BeaconL / BeaconR materials are the two halves of the light bar.
 */
let ambulanceModel: Group | null = null;
export async function loadAmbulanceModel(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/ambulance.glb`);
  ambulanceModel = gltf.scene;
}

/** High-roof ambulance or a black-and-white patrol car, both facing +Z, with red beacons. */
function createResponder(kind: ResponderKind): Omit<Responder, "path" | "progress" | "arrivedAt" | "siren"> {
  const root = new Group();
  const glass = new MeshStandardMaterial({ color: 0x0d141c, roughness: 0.1, metalness: 0.5 });
  const beacons = [0, 1].map(
    () => new MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0 }),
  );
  if (kind === "ambulance" && ambulanceModel) {
    const model = ambulanceModel.clone(true);
    const halves: Record<string, MeshStandardMaterial> = {};
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list)
        if (m.name === "BeaconL" || m.name === "BeaconR") halves[m.name] = m as MeshStandardMaterial;
    });
    for (const [i, name] of ["BeaconL", "BeaconR"].entries()) {
      const m = halves[name];
      if (!m) continue;
      m.emissive.setHex(0xff1010);
      beacons[i] = m;
    }
    root.add(model);
  } else if (kind === "ambulance") {
    const white = new MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.4, metalness: 0.2 });
    const side = new MeshStandardMaterial({
      map: sideTexture("救急", "#d7262e", "#ffffff", "#d7262e"),
      roughness: 0.4,
    });
    const box = new Mesh(new BoxGeometry(2.0, 2.0, 3.8), [side, side, white, white, white, white]);
    box.position.set(0, 0.55, -0.8);
    const cab = new Mesh(new BoxGeometry(1.95, 1.4, 1.8), white);
    cab.position.set(0, 0.25, 1.95);
    const ws = new Mesh(new BoxGeometry(1.8, 0.6, 0.05), glass);
    ws.position.set(0, 0.6, 2.86);
    ws.rotation.x = -0.3;
    root.add(box, cab, ws);
    for (const [i, x] of [-0.6, 0.6].entries()) {
      const b = new Mesh(new BoxGeometry(0.4, 0.15, 0.25), beacons[i]);
      b.position.set(x, 1.62, 0.9);
      root.add(b);
    }
    wheels(root, 0.9, 1.9, -1.8, 0.4);
  } else {
    // Japanese patrol car: black lower body, white upper body and roof, red light bar.
    const black = new MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.5 });
    const white = new MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35, metalness: 0.3 });
    const doors = new MeshStandardMaterial({
      // A generic word like the modelled patrol cars' doors: no real organisation's name (AGENTS.md).
      map: sideTexture("PATROL", "#111111", "#f4f4f4", "#111111"),
      roughness: 0.4,
    });
    const lower = new Mesh(new BoxGeometry(1.8, 0.45, 4.6), black);
    lower.position.y = -0.2;
    const upper = new Mesh(new BoxGeometry(1.8, 0.35, 4.4), [doors, doors, white, white, white, white]);
    upper.position.y = 0.2;
    const cabin = new Mesh(new BoxGeometry(1.6, 0.5, 2.2), glass);
    cabin.position.set(0, 0.62, -0.2);
    const roof = new Mesh(new BoxGeometry(1.55, 0.06, 1.9), white);
    roof.position.set(0, 0.9, -0.25);
    root.add(lower, upper, cabin, roof);
    for (const [i, x] of [-0.35, 0.35].entries()) {
      const b = new Mesh(new BoxGeometry(0.62, 0.14, 0.3), beacons[i]);
      b.position.set(x, 1.0, -0.2);
      root.add(b);
    }
    wheels(root, 0.82, 1.4, -1.4, 0.36);
  }
  const light = new PointLight(0xff2020, 0, 30, 1.5);
  light.position.set(
    0,
    kind === "ambulance" && ambulanceModel ? 2.75 : 2.2,
    kind === "ambulance" ? 1.1 : 0.5,
  );
  root.add(light);
  root.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  root.visible = false;
  return { kind, root, beacons, light };
}

/**
 * Accident response after hitting a pedestrian (道路交通法 第72条第1項: 救護義務・報告義務).
 * The player phones 119 (ambulance) and 110 (police); both drive in along the road network with
 * sirens and red beacons. Leaving without calling 119 is ひき逃げ; never calling 110 is 報告義務違反.
 */
export class EmergencyResponse {
  incident: Incident | null = null;
  /** ひき逃げ: a patrol car chasing the player who left the victim. */
  pursuit: { startedAt: number; closeFor: number } | null = null;
  private readonly responders: Record<ResponderKind, Responder>;

  constructor(
    scene: Scene,
    private readonly audio: Pick<SpatialAudio, "siren">,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    const make = (kind: ResponderKind): Responder => ({
      ...createResponder(kind),
      path: [],
      progress: 0,
      arrivedAt: null,
      siren: false,
    });
    this.responders = { ambulance: make("ambulance"), police: make("police") };
    for (const r of Object.values(this.responders)) scene.add(r.root);
  }

  get active(): boolean {
    return this.incident !== null;
  }

  start(victim: Pedestrian, now: number): void {
    if (this.incident) return;
    this.incident = {
      victim,
      at: victim.object.position.clone(),
      startedAt: now,
      ambulanceCalled: false,
      policeCalled: false,
      fled: false,
      rescued: false,
    };
  }

  isCalled(kind: ResponderKind): boolean {
    const inc = this.incident;
    return inc ? (kind === "ambulance" ? inc.ambulanceCalled : inc.policeCalled) : false;
  }

  /** The operator has enough information: send the vehicle. */
  dispatch(kind: ResponderKind, graph: RoadGraph | null): boolean {
    const inc = this.incident;
    if (!inc || this.isCalled(kind)) return false;
    if (kind === "ambulance") inc.ambulanceCalled = true;
    else inc.policeCalled = true;
    const r = this.responders[kind];
    r.path = approachPath(graph, inc.at, APPROACH[kind], kind === "police" ? 9 : 0);
    r.progress = 0;
    r.arrivedAt = null;
    r.root.visible = true;
    this.startSiren(r);
    return true;
  }

  secondsLeft(now: number): number {
    return this.incident
      ? Math.max(0, Math.ceil((REPORT_LIMIT_MS - (now - this.incident.startedAt)) / 1000))
      : 0;
  }

  eta(kind: ResponderKind): number | null {
    const r = this.responders[kind];
    if (!this.isCalled(kind) || r.arrivedAt !== null) return null;
    return Math.max(0, Math.ceil((pathLength(r.path) - r.progress) / SPEED[kind]));
  }

  /** Re-anchoring: keep the scene and routes glued to the world. */
  transform(offset: (p: Vector3) => Vector3): void {
    if (!this.incident) return;
    offset(this.incident.at);
    for (const r of Object.values(this.responders)) {
      for (const p of r.path) offset(p);
      offset(r.root.position);
    }
  }

  update(
    dt: number,
    now: number,
    player: Vector3,
    playerSpeed: number,
    rescue: (p: Pedestrian) => void,
  ): IncidentEvent {
    const chase = this.updatePursuit(dt, now, player, playerSpeed);
    if (chase) return chase;
    const inc = this.incident;
    if (!inc) return null;
    const blink = Math.floor(now / 250) % 2;
    for (const r of Object.values(this.responders)) {
      r.beacons[0].emissiveIntensity = blink ? 3 : 0.2;
      r.beacons[1].emissiveIntensity = blink ? 0.2 : 3;
      r.light.intensity = r.root.visible ? (blink ? 25 : 8) : 0;
    }

    const isAway = player.distanceTo(inc.at) > LEAVE_DISTANCE;
    if (!inc.ambulanceCalled && !inc.fled && (isAway || now - inc.startedAt > REPORT_LIMIT_MS)) {
      // A bystander calls instead; the driver is booked for leaving the victim.
      inc.fled = true;
      this.dispatch("ambulance", null);
      this.startPursuit(now, player);
      return { type: "hitAndRun" };
    }

    for (const r of Object.values(this.responders)) {
      // The patrol car is driven by updatePursuit while chasing a fleeing driver.
      const isPursuing = r.kind === "police" && this.pursuit !== null;
      if (!this.isCalled(r.kind) || r.arrivedAt !== null || isPursuing || r.path.length < 2) continue;
      r.progress += SPEED[r.kind] * dt;
      const { pos, dir } = pointAlong(r.path, r.progress);
      const g = this.groundAt(pos.x, pos.z) ?? pos.y;
      // The modelled ambulance stands on its wheels at y = 0; the box models are centred.
      const lift = r.kind === "ambulance" ? (ambulanceModel ? 0 : 1.0) : 0.86;
      r.root.position.set(pos.x, g + lift, pos.z);
      r.root.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      this.updateSiren(r);
      if (r.progress >= pathLength(r.path)) {
        r.arrivedAt = now;
        this.stopSiren(r);
        return { type: "arrived", kind: r.kind };
      }
    }

    const amb = this.responders.ambulance;
    if (!inc.rescued && amb.arrivedAt !== null && now - amb.arrivedAt > 5000) {
      inc.rescued = true;
      rescue(inc.victim);
      amb.root.visible = false;
      return { type: "rescued" };
    }
    const pol = this.responders.police;
    const isPoliceDone = pol.arrivedAt !== null && now - pol.arrivedAt > 6000;
    if (inc.rescued && (isPoliceDone || isAway)) {
      const unreported = !inc.policeCalled;
      this.close();
      return unreported ? { type: "notReported" } : { type: "closed" };
    }
    return null;
  }

  get chasing(): boolean {
    return this.pursuit !== null;
  }

  /** The pursuit caught the driver another way (pursuitDirector.ts takes the case): stand down. */
  cancelPursuit(): void {
    if (!this.pursuit) return;
    this.pursuit = null;
    this.close();
  }

  /** A witness reported the plate: a patrol car comes after the fleeing driver. */
  private startPursuit(now: number, player: Vector3): void {
    const pol = this.responders.police;
    this.pursuit = { startedAt: now, closeFor: 0 };
    if (this.incident) this.incident.policeCalled = true;
    const from = player.clone().add(new Vector3(70, 0, 70));
    pol.root.position.copy(from);
    pol.root.visible = true;
    pol.arrivedAt = null;
    pol.path = [];
    this.startSiren(pol);
  }

  private updatePursuit(dt: number, now: number, player: Vector3, playerSpeed: number): IncidentEvent {
    const chase = this.pursuit;
    if (!chase) return null;
    const pol = this.responders.police;
    const to = player.clone().sub(pol.root.position).setY(0);
    const dist = to.length();
    const speed = Math.min(38, Math.max(14, playerSpeed + 6));
    if (dist > 6) {
      to.normalize();
      pol.root.position.addScaledVector(to, Math.min(dist - 5, speed * dt));
      pol.root.rotation.set(0, Math.atan2(to.x, to.z), 0);
    }
    const g = this.groundAt(pol.root.position.x, pol.root.position.z);
    if (g !== null) pol.root.position.y = g + 0.86;
    this.updateSiren(pol);
    chase.closeFor = dist < 8 ? chase.closeFor + dt : 0;
    const isCaught = chase.closeFor > 1.5;
    const isIdentifiedLater = now - chase.startedAt > 90_000;
    if (!isCaught && !isIdentifiedLater) return null;
    this.pursuit = null;
    this.close();
    return { type: "arrested", later: !isCaught };
  }

  private close(): void {
    for (const r of Object.values(this.responders)) {
      this.stopSiren(r);
      r.root.visible = false;
    }
    this.incident = null;
  }

  private startSiren(r: Responder): void {
    r.siren = true;
    this.updateSiren(r);
  }

  /** Asked every frame it moves: the siren rides the vehicle (救急車 ピーポー, パトカー ウー). */
  private updateSiren(r: Responder): void {
    if (!r.siren) return;
    this.audio.siren(r, true, r.root, r.kind);
  }

  private stopSiren(r: Responder): void {
    r.siren = false;
    this.audio.siren(r, false, r.root, r.kind);
  }
}

/** Road route ending at the scene: walk the graph outward, then reverse it. */
function approachPath(graph: RoadGraph | null, scene: Vector3, length: number, stopShort: number): Vector3[] {
  const hit = graph?.nearest(scene, 60);
  if (!graph || !hit) return [scene.clone().add(new Vector3(length * 0.5, 0, 0)), scene.clone()];
  const points: Vector3[] = [];
  let seg: Segment = hit.seg;
  let towardsEnd = true;
  let start = hit.s;
  let node = seg.to;
  let total = 0;
  for (let guard = 0; guard < 24 && total < length; guard++) {
    const span = towardsEnd ? seg.length - start : start;
    const steps = Math.max(2, Math.ceil(span / 8));
    for (let k = 0; k <= steps; k++) {
      const s = towardsEnd ? start + (span * k) / steps : start - (span * k) / steps;
      points.push(graph.sample(seg, s).pos.clone());
    }
    total += span;
    const exits = graph.exits(node, seg.id).filter((x) => x.line.width >= 4);
    if (exits.length === 0) break;
    const next = exits[(guard * 7 + seg.id) % exits.length];
    towardsEnd = next.from === node;
    start = towardsEnd ? 0 : next.length;
    node = towardsEnd ? next.to : next.from;
    seg = next;
  }
  points.reverse();
  const out = points.map((p, i) => {
    const dir = points[Math.min(points.length - 1, i + 1)]
      .clone()
      .sub(points[Math.max(0, i - 1)])
      .setY(0)
      .normalize();
    return p.clone().add(leftOf(dir, 2.5)); // keep left on the way in
  });
  // Police stop a little short of the ambulance.
  if (stopShort > 0 && out.length >= 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    out[out.length - 1] = last.clone().add(
      prev
        .clone()
        .sub(last)
        .setLength(Math.min(stopShort, last.distanceTo(prev))),
    );
    return out;
  }
  out.push(scene.clone());
  return out;
}

function pathLength(path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += path[i].distanceTo(path[i - 1]);
  return total;
}

function pointAlong(path: Vector3[], d: number): { pos: Vector3; dir: Vector3 } {
  let rest = d;
  for (let i = 1; i < path.length; i++) {
    const len = path[i].distanceTo(path[i - 1]);
    if (rest <= len || i === path.length - 1) {
      const t = len > 0 ? Math.min(1, rest / len) : 1;
      return {
        pos: path[i - 1].clone().lerp(path[i], t),
        dir: path[i]
          .clone()
          .sub(path[i - 1])
          .setY(0)
          .normalize(),
      };
    }
    rest -= len;
  }
  return { pos: path[0].clone(), dir: new Vector3(0, 0, 1) };
}
