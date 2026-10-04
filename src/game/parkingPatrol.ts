import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import { animateHuman, createHuman, disposeHuman, type HumanModel } from "../world/human";

/**
 * 駐車監視員 (parking enforcement officers) as Tokyo runs them since 2006: officers of a private
 * body entrusted by the police station walk in pairs, in a green uniform and cap. Finding a car left on a street where parking is prohibited with
 * no driver able to move it (放置車両 — no minimum time applies), they photograph it, enter the
 * plate and place on a handheld terminal and stick the yellow 放置車両確認標章 on it.
 * The game's patrol turns up a little while after the car is abandoned; if the driver comes back
 * before the sticker goes on, the car is no longer 放置 and they leave.
 */
type Officer = { model: HumanModel; phase: number };
type State = "idle" | "approaching" | "confirming" | "leaving";
export type PatrolEvent = "ticketed" | "aborted" | "photo" | null;

const WALK = 1.25; // m/s
const SPAWN_DISTANCE = 70;
const PHOTO_TIMES = [3, 8, 13]; // seconds into the check; three shots as the terminal requires
const STICKER_AT = 17;

const UNIFORM = 0x9be3c4; // peppermint green
const capMaterial = new MeshStandardMaterial({ color: 0x7fd0ae, roughness: 0.7 });
const terminalMaterial = new MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5 });

export class ParkingPatrol {
  private officers: Officer[] = [];
  private state: State = "idle";
  private due: number | null = null;
  private checkStart = 0;
  private photosTaken = 0;
  private readonly target = new Vector3();
  private readonly exit = new Vector3();
  private readonly flash = new PointLight(0xffffff, 0, 6);
  private readonly flashBulb = new Mesh(
    new SphereGeometry(0.06, 8, 6),
    new MeshBasicMaterial({ color: 0xffffff }),
  );

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    this.flashBulb.visible = false;
    scene.add(this.flash, this.flashBulb);
  }

  get busy(): boolean {
    return this.state !== "idle";
  }

  /**
   * `abandoned`: the car stands on a no-parking street with its driver away. `kerb` is the
   * pavement spot beside the car and `along` the street direction there.
   */
  update(
    dt: number,
    now: number,
    car: Vector3,
    kerb: Vector3 | null,
    along: Vector3 | null,
    abandoned: boolean,
  ): PatrolEvent {
    if (this.state === "idle") {
      if (!abandoned || !kerb || !along) {
        this.due = null;
        return null;
      }
      // Patrols pass every so often; somewhere between half a minute and a minute and a half.
      this.due ??= now + 30_000 + Math.random() * 60_000;
      if (now < this.due) return null;
      this.spawn(kerb, along);
      return null;
    }
    let event: PatrolEvent = null;
    if (this.state === "approaching" || this.state === "confirming") {
      if (!abandoned) {
        event = this.state === "confirming" ? "aborted" : null;
        this.leave(along ?? new Vector3(1, 0, 0));
      }
    }
    if (this.state === "approaching") {
      const arrived = this.walkTo(dt, this.target, 0.6);
      if (arrived) {
        this.state = "confirming";
        this.checkStart = now;
        this.photosTaken = 0;
      }
    } else if (this.state === "confirming") {
      const t = (now - this.checkStart) / 1000;
      const lead = this.officers[0];
      // Face the car while photographing.
      for (const o of this.officers) {
        o.model.root.rotation.y = Math.atan2(
          car.x - o.model.root.position.x,
          car.z - o.model.root.position.z,
        );
        animateHuman(o.model, o.phase, 0, false);
      }
      if (this.photosTaken < PHOTO_TIMES.length && t >= PHOTO_TIMES[this.photosTaken]) {
        this.photosTaken++;
        this.flash.position.copy(lead.model.root.position).add(new Vector3(0, 1.3, 0));
        this.flashBulb.position.copy(this.flash.position);
        this.flash.intensity = 40;
        this.flashBulb.visible = true;
        event = "photo";
      }
      if (t >= STICKER_AT) {
        event = "ticketed";
        this.leave(along ?? new Vector3(1, 0, 0));
      }
    } else if (this.state === "leaving") {
      if (this.walkTo(dt, this.exit, 1)) this.clear();
    }
    // Flash decays within a fraction of a second.
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 400);
    this.flashBulb.visible = this.flash.intensity > 5;
    return event;
  }

  /** Re-anchoring: shift the officers rigidly. */
  transform(offset: (p: Vector3) => Vector3): void {
    for (const o of this.officers) offset(o.model.root.position);
    offset(this.target);
    offset(this.exit);
  }

  clear(): void {
    for (const o of this.officers) {
      this.scene.remove(o.model.root);
      disposeHuman(o.model);
    }
    this.officers = [];
    this.state = "idle";
    this.due = null;
  }

  private spawn(kerb: Vector3, along: Vector3): void {
    const side = Math.random() < 0.5 ? 1 : -1;
    const start = kerb.clone().addScaledVector(along, side * SPAWN_DISTANCE);
    for (const k of [0, 1]) {
      const model = createHuman(
        {
          shirt: UNIFORM,
          pants: 0x2d3640,
          skin: k ? 0xe8c3a0 : 0xd9b08c,
          hair: 0x1a1612,
          umbrella: 0x223355,
        },
        0.98,
        k,
      );
      // Cap (with the uniform's colour) and the handheld terminal.
      // Hair spans y 1.62–1.795 (human.glb); the crown sits down over it.
      const cap = new Mesh(new CylinderGeometry(0.112, 0.119, 0.1, 14), capMaterial);
      cap.position.set(0, 1.765, 0);
      const brim = new Mesh(
        new CylinderGeometry(0.12, 0.12, 0.012, 14, 1, false, -Math.PI / 2, Math.PI),
        capMaterial,
      );
      brim.position.set(0, 1.72, 0.06);
      const terminal = new Mesh(new CylinderGeometry(0.035, 0.035, 0.16, 6), terminalMaterial);
      terminal.position.set(0, -0.26, 0.05);
      model.forearms[0].add(terminal);
      model.root.add(cap, brim);
      model.root.position.copy(start).addScaledVector(along, -side * k * 1.2);
      this.scene.add(model.root);
      this.officers.push({ model, phase: k * 1.7 });
    }
    this.target.copy(kerb);
    this.state = "approaching";
  }

  private leave(along: Vector3): void {
    this.state = "leaving";
    this.exit.copy(this.officers[0]?.model.root.position ?? this.target).addScaledVector(along, 45);
  }

  /** Walk both officers toward `goal` (the second one a pace behind); true once there. */
  private walkTo(dt: number, goal: Vector3, within: number): boolean {
    let arrived = true;
    this.officers.forEach((o, k) => {
      const root = o.model.root;
      const aim = goal.clone();
      if (k === 1) aim.add(new Vector3(0.9, 0, 0.9));
      const d = new Vector3(aim.x - root.position.x, 0, aim.z - root.position.z);
      const dist = d.length();
      if (dist > within) {
        arrived = false;
        d.normalize();
        root.position.addScaledVector(d, Math.min(dist, WALK * dt));
        root.rotation.y = Math.atan2(d.x, d.z);
        o.phase += dt * WALK * 4.2;
        animateHuman(o.model, o.phase, WALK, false);
      } else animateHuman(o.model, o.phase, 0, false);
      const g = this.groundAt(root.position.x, root.position.z);
      if (g !== null) root.position.y = g;
    });
    return arrived;
  }
}
