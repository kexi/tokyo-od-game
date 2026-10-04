import {
  CanvasTexture,
  type Light,
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
import { QUALITY } from "../device";
import { warn } from "../log";
import { RainGlass, WIPER_BLADES } from "./rainGlass";

/**
 * 車内視点: the right-hand-drive cockpit (scripts/blender/cockpit.py) inside the player's car.
 * The gauges read the car (speedometer 0–180 km/h, tachometer, tell-tales), the wheel turns with
 * the steering (about 15:1), the mirrors show what is behind (one of them re-rendered per frame),
 * and in rain drops gather on the windscreen until the wipers sweep them off (game/rainGlass.ts).
 * Node names, pivots and angles follow knowledge/cockpit-blender.md.
 */
const DEG = Math.PI / 180;
/** The render layer of the interior (drawn in a second pass with a near plane of a few cm). */
export const INTERIOR_LAYER = 1;
// The needles are modelled pointing at their zero marks (clock angle −120°, the small gauges
// −45°), so rotation.z is only the swing from zero, clockwise as the driver sees it.
const SPEED_RATE = (4 / 3) * DEG; // per km/h
const TACHO_RATE = 0.03 * DEG; // per rpm
const SMALL_SWEEP = 90 * DEG; // fuel E→F, temperature C→H
const STEERING_RATIO = 15;
const WIPER_LO = 40 / 60; // cycles per second
const WIPER_HI = 60 / 60;
const WIPER_REST = 4; // s between 間欠 sweeps
const MIRRORS = ["Rear", "SideR", "SideL"] as const;

type Mirror = { surface: Mesh; centre: Object3D; target: WebGLRenderTarget; camera: PerspectiveCamera };

export class Cockpit {
  root: Object3D | null = null;
  private eye: Object3D | null = null;
  private needleSpeed: Object3D | null = null;
  private needleTacho: Object3D | null = null;
  private wheel: Object3D | null = null;
  private wipers: Array<{ node: Object3D; sweep: number }> = [];
  private readonly lamps = new Map<string, MeshStandardMaterial>();
  private readonly mirrors: Mirror[] = [];
  private mirrorTurn = 0;
  private wiperPhase = 0;
  private readonly rain = new RainGlass({ isMobile: QUALITY.isMobile });
  /** Parts of the exterior model hidden from inside (its simple dashboard and seats). */
  private hiddenExterior: Object3D[] = [];
  private glass: Array<{ m: Material & { opacity: number }; opacity: number }> = [];
  active = false;
  private displayTexture: CanvasTexture | null = null;

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
      for (const w of WIPER_BLADES) {
        const node = this.root.getObjectByName(w.name);
        if (node) this.wipers.push({ node, sweep: w.sweep });
      }
      this.root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const m = o.material as Material;
        if (m.name.startsWith("Lamp_") && m instanceof MeshStandardMaterial) {
          m.emissiveIntensity = 0;
          this.lamps.set(m.name, m);
        }
        // Rain on the glass: the pane is drawn by the rain shader, after the scene.
        if (o.name === "Windshield" || o.parent?.name === "Windshield") this.rain.addPane(o);
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
    // The display's UVs come from glTF (origin top left), like the textures GLTFLoader loads.
    texture.flipY = false;
    this.displayTexture = texture;
    display.traverse((o) => {
      if (o instanceof Mesh) o.material = new MeshBasicMaterial({ map: texture });
    });
  }

  /** Put the cockpit inside the car model (same frame as car.glb). */
  attach(car: Object3D): void {
    if (!this.root) return;
    car.add(this.root);
    // The interior is drawn in its own pass (see render), so it lives on its own layer.
    this.root.traverse((o) => o.layers.set(INTERIOR_LAYER));
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
    /** Rainfall, mm/h (0 when dry). */
    rainMmH: number;
    /** 0 by day, 1 at night: how much the drops catch nearby lights. */
    night: number;
    renderer: WebGLRenderer;
    scene: Scene;
  }): void {
    if (!this.active || !this.root) return;
    const kmh = Math.min(180, Math.abs(opts.kmh));
    if (this.needleSpeed) this.needleSpeed.rotation.z = kmh * SPEED_RATE;
    // A plausible engine speed: idle, then each gear's band (automatic, shifting near 2,500 rpm).
    const gearKmh = [0, 20, 40, 60, 85, 120];
    const gear = gearKmh.findIndex((g) => kmh < g) - 1;
    const lo = gearKmh[Math.max(0, gear)] ?? 85;
    const hi = gearKmh[Math.max(1, gear + 1)] ?? 180;
    const rpm = 750 + ((kmh - lo) / Math.max(1, hi - lo)) * 1800 + opts.throttle * 600;
    if (this.needleTacho) this.needleTacho.rotation.z = rpm * TACHO_RATE;
    // A tank about three-quarters full; the coolant sits mid-scale once the engine is warm.
    const fuel = this.root.getObjectByName("Needle_Fuel");
    if (fuel) fuel.rotation.z = 0.72 * SMALL_SWEEP;
    const temp = this.root.getObjectByName("Needle_Temp");
    if (temp) temp.rotation.z = 0.5 * SMALL_SWEEP;
    if (this.wheel) this.wheel.rotation.z = -opts.steerAngle * STEERING_RATIO;
    const blink = Math.floor(opts.now / 380) % 2 === 0;
    this.lamp("Lamp_TurnL", opts.left && blink);
    this.lamp("Lamp_TurnR", opts.right && blink);
    this.lamp("Lamp_HighBeam", opts.highBeam);
    this.lamp("Lamp_Parking", opts.parkingBrake);
    this.updateWipers(opts.dt, opts.wipers, opts.rainMmH, opts.kmh / 3.6);
    this.rain.glow = opts.night;
    if (this.displayTexture) this.displayTexture.needsUpdate = true;
    this.updateMirror(opts.renderer, opts.scene);
  }

  private lamp(name: string, isOn: boolean): void {
    const m = this.lamps.get(name);
    if (m) m.emissiveIntensity = isOn ? 2 : 0;
  }

  /** Wipers sweep (間欠 / LO / HI); the rain simulation runs with the blades where they are. */
  private updateWipers(dt: number, mode: number, rainMmH: number, speed: number): void {
    // Cycles per second: 間欠 is one LO sweep then a rest; LO 40 and HI 60 a minute, as cars have
    // (FMVSS 104 asks HI ≥ 45, LO 20–55 and 15 apart). Faster looked frantic in the driver's seat.
    const intCycle = 1 / WIPER_LO + WIPER_REST;
    const cycles = [0, 1 / intCycle, WIPER_LO, WIPER_HI][mode] ?? 0;
    if (mode > 0) this.wiperPhase = (this.wiperPhase + dt * cycles) % 1;
    else this.wiperPhase = this.wiperPhase > 0 ? Math.min(1, this.wiperPhase + dt) % 1 : 0;
    // 間欠: rest at the bottom for a while between sweeps.
    const t = mode === 1 ? Math.min(1, this.wiperPhase * intCycle * WIPER_LO) : this.wiperPhase;
    const swing = Math.sin(t * Math.PI); // 0 → 1 → 0 over a sweep
    for (const w of this.wipers) w.node.rotation.z = swing * w.sweep;
    const blades = WIPER_BLADES.map((b) => b.park + swing * b.sweep);
    this.rain.sim.step(dt, { rainMmH, speed, blades });
  }

  /**
   * Draw the frame. From the driver's seat the windscreen's water refracts the frame itself, so
   * the scene goes first and the glass over it (see RainGlass.render).
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    if (!this.active || !this.root) {
      renderer.render(scene, camera);
      return;
    }
    // Two passes, as games draw what is held close to the eye: the world with the camera's own
    // near plane (0.5 m), then, over a cleared depth buffer, the interior with one of 2 cm. Why not
    // a smaller near plane for everything: depth precision 4 km away would fall apart (road paint
    // and kerbs flicker); with 0.5 m the roof lining, the upper windscreen, the pillars and the door
    // trims (30–60 cm from the eye) were cut away, showing the sky and the car's own tyres.
    this.lightInterior(scene);
    const near = this.nearCamera;
    near.position.copy(camera.position);
    near.quaternion.copy(camera.quaternion);
    near.fov = camera.fov;
    near.aspect = camera.aspect;
    near.updateProjectionMatrix();
    near.updateMatrixWorld();
    const drawInterior = () => {
      const autoClear = renderer.autoClear;
      const shadows = renderer.shadowMap.autoUpdate;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.clearDepth();
      renderer.render(scene, near);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadows;
    };
    this.rain.render(renderer, scene, camera, this.root, drawInterior, near);
  }

  /** The interior pass's camera: the eye's pose, a near plane of 2 cm, the interior layer only. */
  private readonly nearCamera = (() => {
    const c = new PerspectiveCamera(62, 1, 0.02, 30);
    c.layers.set(INTERIOR_LAYER);
    return c;
  })();
  private lightsCheckedAt = 0;

  /** Lights reach the interior layer too (checked now and then: lamps come and go). */
  private lightInterior(scene: Scene): void {
    const now = performance.now();
    if (now - this.lightsCheckedAt < 1000) return;
    this.lightsCheckedAt = now;
    scene.traverse((o) => {
      if ((o as Light).isLight) o.layers.enable(INTERIOR_LAYER);
    });
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
