import {
  CanvasTexture,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  type Scene,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { warn } from "../log";

/**
 * 車内視点: the right-hand-drive cockpit (scripts/blender/cockpit.py) inside the player's car.
 * The gauges read the car (speedometer 0–180 km/h, tachometer, tell-tales), the wheel turns with
 * the steering (about 15:1), the mirrors show what is behind (one of them re-rendered per frame),
 * and in rain drops gather on the windscreen until the wipers sweep them off. Node names, pivots
 * and angles follow knowledge/cockpit-blender.md.
 */
const DEG = Math.PI / 180;
const SPEED_ZERO = -120 * DEG; // the needle at 0 km/h, from 12 o'clock (clockwise positive)
const SPEED_RATE = (4 / 3) * DEG; // per km/h
const TACHO_RATE = 0.03 * DEG; // per rpm
const STEERING_RATIO = 15;
const WIPER_SWEEP = { R: 82 * DEG, L: 84 * DEG };
const WIPER_LO = 40 / 60; // cycles per second
const WIPER_HI = 60 / 60;
const WIPER_REST = 4; // s between 間欠 sweeps
// Windscreen UV of the wiper pivots, the blade reach (UV units: the glass is 1.4706 × 0.8245 m).
const WIPERS = [
  {
    name: "WiperArm_R",
    pivot: [0.9522, -0.0338],
    reach: [0.65 / 1.4706, 0.65 / 0.8245],
    sweep: WIPER_SWEEP.R,
  },
  { name: "WiperArm_L", pivot: [0.5068, -0.0273], reach: [0.4 / 1.4706, 0.4 / 0.8245], sweep: WIPER_SWEEP.L },
] as const;
const MIRRORS = ["Rear", "SideR", "SideL"] as const;
const DROPS_W = 256;
const DROPS_H = 144;

type Mirror = { surface: Mesh; centre: Object3D; target: WebGLRenderTarget; camera: PerspectiveCamera };

export class Cockpit {
  root: Object3D | null = null;
  private eye: Object3D | null = null;
  private needleSpeed: Object3D | null = null;
  private needleTacho: Object3D | null = null;
  private wheel: Object3D | null = null;
  private wipers: Array<{
    node: Object3D;
    sweep: number;
    pivot: readonly number[];
    reach: readonly number[];
  }> = [];
  private readonly lamps = new Map<string, MeshStandardMaterial>();
  private readonly mirrors: Mirror[] = [];
  private mirrorTurn = 0;
  private wiperPhase = 0;
  private readonly drops: HTMLCanvasElement;
  private readonly dropsCtx: CanvasRenderingContext2D | null;
  private readonly dropsTexture: CanvasTexture;
  /** Parts of the exterior model hidden from inside (its simple dashboard and seats). */
  private hiddenExterior: Object3D[] = [];
  private glass: Array<{ m: Material & { opacity: number }; opacity: number }> = [];
  active = false;
  private displayTexture: CanvasTexture | null = null;

  constructor() {
    this.drops = document.createElement("canvas");
    this.drops.width = DROPS_W;
    this.drops.height = DROPS_H;
    this.dropsCtx = this.drops.getContext("2d");
    this.dropsTexture = new CanvasTexture(this.drops);
    this.dropsTexture.colorSpace = SRGBColorSpace;
  }

  async load(): Promise<void> {
    try {
      const loader = new GLTFLoader().setDRACOLoader(
        new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
      );
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/cockpit.glb`);
      this.root = gltf.scene;
      this.root.visible = false;
      this.eye = this.root.getObjectByName("DriverEye") ?? null;
      this.needleSpeed = this.root.getObjectByName("Needle_Speed") ?? null;
      this.needleTacho = this.root.getObjectByName("Needle_Tacho") ?? null;
      this.wheel = this.root.getObjectByName("SteeringWheel") ?? null;
      for (const w of WIPERS) {
        const node = this.root.getObjectByName(w.name);
        if (node) this.wipers.push({ node, sweep: w.sweep, pivot: w.pivot, reach: w.reach });
      }
      this.root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const m = o.material as Material;
        if (m.name.startsWith("Lamp_") && m instanceof MeshStandardMaterial) {
          m.emissiveIntensity = 0;
          this.lamps.set(m.name, m);
        }
        if (o.name === "Windshield" || (o.parent?.name === "Windshield" && o instanceof Mesh)) {
          // Rain on the glass: drops drawn into a canvas, over a nearly clear pane.
          o.material = new MeshBasicMaterial({
            map: this.dropsTexture,
            transparent: true,
            depthWrite: false,
          });
          o.renderOrder = 5;
        }
      });
      for (const name of MIRRORS) {
        const centre = this.root.getObjectByName(`Mirror_${name}`);
        const surface = this.root.getObjectByName(`MirrorSurface_${name}`);
        const mesh =
          surface instanceof Mesh ? surface : surface?.children.find((c): c is Mesh => c instanceof Mesh);
        if (!centre || !mesh) continue;
        const target = new WebGLRenderTarget(name === "Rear" ? 320 : 192, name === "Rear" ? 96 : 128);
        mesh.material = new MeshBasicMaterial({ map: target.texture });
        this.mirrors.push({
          surface: mesh,
          centre,
          target,
          camera: new PerspectiveCamera(name === "Rear" ? 32 : 26, 2, 0.3, 400),
        });
      }
    } catch (error) {
      warn("cockpit_load_failed", { error: String(error) });
    }
  }

  /** カーナビ: a canvas (the map) shown on the centre display. */
  showOnDisplay(canvas: HTMLCanvasElement): void {
    const display = this.root?.getObjectByName("Display_Center");
    if (!display) return;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.displayTexture = texture;
    display.traverse((o) => {
      if (o instanceof Mesh) o.material = new MeshBasicMaterial({ map: texture });
    });
  }

  /** Put the cockpit inside the car model (same frame as car.glb). */
  attach(car: Object3D): void {
    if (!this.root) return;
    car.add(this.root);
    this.hiddenExterior = [];
    car.traverse((o) => {
      if (!(o instanceof Mesh) || o === this.root) return;
      const name = (o.material as Material).name;
      if (name === "Interior" || name === "Seat") this.hiddenExterior.push(o);
      // The exterior glass is tinted for the outside view; from inside it should be clear.
      const m = o.material as Material & { opacity: number };
      if (name === "Glass" && !this.glass.some((g) => g.m === m)) this.glass.push({ m, opacity: m.opacity });
    });
  }

  setActive(active: boolean): void {
    this.active = active && this.root !== null;
    if (this.root) this.root.visible = this.active;
    for (const o of this.hiddenExterior) o.visible = !this.active;
    for (const g of this.glass) g.m.opacity = this.active ? 0.08 : g.opacity;
  }

  /** Camera at the driver's eye, looking ahead (plus a look-aside yaw). */
  placeCamera(camera: PerspectiveCamera, lookYaw: number): void {
    if (!this.eye) return;
    this.eye.updateWorldMatrix(true, false);
    const eye = new Vector3().setFromMatrixPosition(this.eye.matrixWorld);
    camera.position.copy(eye);
    camera.quaternion.setFromRotationMatrix(this.eye.matrixWorld);
    // DriverEye looks along the car's +Z; turn the head for 左右 Ctrl / Z.
    if (lookYaw !== 0) camera.rotateY(lookYaw);
  }

  update(opts: {
    dt: number;
    now: number;
    kmh: number;
    throttle: number;
    steerAngle: number;
    left: boolean;
    right: boolean;
    highBeam: boolean;
    parkingBrake: boolean;
    wipers: number;
    raining: boolean;
    renderer: WebGLRenderer;
    scene: Scene;
  }): void {
    if (!this.active || !this.root) return;
    const kmh = Math.min(180, Math.abs(opts.kmh));
    if (this.needleSpeed) this.needleSpeed.rotation.z = SPEED_ZERO + kmh * SPEED_RATE;
    // A plausible engine speed: idle, then each gear's band (automatic, shifting near 2,500 rpm).
    const gearKmh = [0, 20, 40, 60, 85, 120];
    const gear = gearKmh.findIndex((g) => kmh < g) - 1;
    const lo = gearKmh[Math.max(0, gear)] ?? 85;
    const hi = gearKmh[Math.max(1, gear + 1)] ?? 180;
    const rpm = 750 + ((kmh - lo) / Math.max(1, hi - lo)) * 1800 + opts.throttle * 600;
    if (this.needleTacho) this.needleTacho.rotation.z = SPEED_ZERO + rpm * TACHO_RATE;
    if (this.wheel) this.wheel.rotation.z = -opts.steerAngle * STEERING_RATIO;
    const blink = Math.floor(opts.now / 380) % 2 === 0;
    this.lamp("Lamp_TurnL", opts.left && blink);
    this.lamp("Lamp_TurnR", opts.right && blink);
    this.lamp("Lamp_HighBeam", opts.highBeam);
    this.lamp("Lamp_Parking", opts.parkingBrake);
    this.updateWipers(opts.dt, opts.wipers, opts.raining);
    if (this.displayTexture) this.displayTexture.needsUpdate = true;
    this.updateMirror(opts.renderer, opts.scene);
  }

  private lamp(name: string, isOn: boolean): void {
    const m = this.lamps.get(name);
    if (m) m.emissiveIntensity = isOn ? 2 : 0;
  }

  /** Wipers sweep (間欠 / LO / HI) and clear the drops under the blades. */
  private updateWipers(dt: number, mode: number, raining: boolean): void {
    const ctx = this.dropsCtx;
    if (!ctx) return;
    // New drops while it rains, drawn as small lenses.
    // Drops dry and run off slowly, so the glass settles instead of clogging up.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.35)})`;
    ctx.fillRect(0, 0, DROPS_W, DROPS_H);
    ctx.restore();
    if (raining) {
      for (let i = 0; i < 2; i++) {
        const x = Math.random() * DROPS_W;
        const y = Math.random() * DROPS_H;
        const r = 0.5 + Math.random() * 1.2;
        ctx.fillStyle = "rgba(225,235,245,0.28)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillRect(x - r * 0.3, y - r * 0.4, 1, 1);
      }
    }
    // Cycles per second: 間欠 is one LO sweep then a rest; LO 40 and HI 60 a minute, as cars have
    // (FMVSS 104 asks HI ≥ 45, LO 20–55 and 15 apart). Faster looked frantic in the driver's seat.
    const intCycle = 1 / WIPER_LO + WIPER_REST;
    const speed = [0, 1 / intCycle, WIPER_LO, WIPER_HI][mode] ?? 0;
    const wasPhase = this.wiperPhase;
    if (mode > 0) this.wiperPhase = (this.wiperPhase + dt * speed) % 1;
    else this.wiperPhase = this.wiperPhase > 0 ? Math.min(1, this.wiperPhase + dt) % 1 : 0;
    // 間欠: rest at the bottom for a while between sweeps.
    const t = mode === 1 ? Math.min(1, this.wiperPhase * intCycle * WIPER_LO) : this.wiperPhase;
    const swing = Math.sin(t * Math.PI); // 0 → 1 → 0 over a sweep
    for (const w of this.wipers) {
      w.node.rotation.z = swing * w.sweep;
      if (mode === 0 && wasPhase === 0) continue;
      // Clear the band under the blade: a wedge from the pivot at the current angle.
      const a = Math.PI / 2 + (w.pivot[0] > 0.7 ? 1 : 1) * swing * w.sweep;
      const px = w.pivot[0] * DROPS_W;
      const py = (1 - w.pivot[1]) * DROPS_H;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * w.reach[0] * DROPS_W, py - Math.sin(a) * w.reach[1] * DROPS_H);
      ctx.stroke();
      ctx.restore();
    }
    this.dropsTexture.needsUpdate = true;
  }

  /** One mirror per frame, in turn: a camera at the mirror looking along the reflected view. */
  private updateMirror(renderer: WebGLRenderer, scene: Scene): void {
    if (this.mirrors.length === 0 || !this.eye) return;
    const m = this.mirrors[this.mirrorTurn++ % this.mirrors.length];
    m.centre.updateWorldMatrix(true, false);
    const centre = new Vector3().setFromMatrixPosition(m.centre.matrixWorld);
    const normal = new Vector3(0, 0, 1).transformDirection(m.centre.matrixWorld);
    const eye = new Vector3().setFromMatrixPosition(this.eye.matrixWorld);
    const view = centre.clone().sub(eye).normalize();
    const reflected = view.sub(normal.multiplyScalar(2 * view.dot(normal)));
    m.camera.position.copy(centre);
    m.camera.lookAt(centre.clone().add(reflected));
    const wasVisible = this.root?.visible ?? false;
    if (this.root) this.root.visible = false; // the car's own interior is not in the mirror
    renderer.setRenderTarget(m.target);
    renderer.render(scene, m.camera);
    renderer.setRenderTarget(null);
    if (this.root) this.root.visible = wasVisible;
  }
}
