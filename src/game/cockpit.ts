import {
  CanvasTexture,
  DoubleSide,
  type Light,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  type RenderTarget,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GRAPHICS, QUALITY } from "../device";
import { warn } from "../log";
import { holdShadows, sceneTarget, type FrameComposer } from "../render/frame";
import { withSceneMatrices } from "../render/sceneMatrices";
import { RainGlass, WIPER_BLADES } from "./rainGlass";
import { sharedDraco } from "../render/draco";
import { MirrorUpdates } from "./mirrorUpdates";

/**
 * 車内視点: the right-hand-drive cockpit (scripts/blender/cockpit.py) inside the player's car.
 * The gauges read the car (speedometer 0–180 km/h, tachometer, tell-tales), the wheel turns with
 * the steering (about 15:1), the mirrors show what is behind (one of them re-rendered per frame),
 * skipping mirrors outside the view. In rain drops gather on the windscreen until the wipers
 * sweep them off (game/rainGlass.ts).
 * Node names, pivots and angles follow knowledge/cockpit-blender.md.
 */
const DEG = Math.PI / 180;
/**
 * How far the steering column is tilted up from the model (m). 0: cockpit.glb places the wheel for
 * its DriverEye (the meters show through the wheel's upper opening), and raising it would put the
 * rim's top above UN R125's V2 eye point (knowledge/cockpit-blender.md).
 */
const COLUMN_RAISE = 0;
/**
 * The wheel's opacity from the driver's seat: the rim and the spokes cover much of the meter
 * cluster from the eye, so they are drawn see-through and the gauges read through them. Why not
 * move the wheel or the eye: COLUMN_RAISE and the seat already sit where the law's eye point and
 * the model put them, and any wheel in front of the cluster hides some of it.
 */
const WHEEL_OPACITY = 0.6;
/** Where the dash clock goes if cockpit.glb has no ClockAnchor (the cluster's top centre). */
const CLOCK_FALLBACK = new Vector3(-0.372, 0.125, 0.638);
/** The render layer of the interior (drawn in a second pass with a near plane of a few cm). */
export const INTERIOR_LAYER = 1;
/**
 * The wiper arms: close to the eye like the interior (drawn with its near camera), but outside the
 * glass — so drawn before the street is copied for the water on the windscreen, which then lies
 * over them. Why not on the interior layer: the glass, drawn last from that copy, painted over them
 * in the rain, the one time they are needed.
 */
export const OUTSIDE_LAYER = 2;
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

type Mirror = {
  surface: Mesh;
  centre: Object3D;
  size: readonly [number, number];
  target: RenderTarget | null;
  camera: PerspectiveCamera;
};

export class Cockpit {
  root: Object3D | null = null;
  private eye: Object3D | null = null;
  private needleSpeed: Object3D | null = null;
  private needleTacho: Object3D | null = null;
  private wheel: Object3D | null = null;
  private wipers: Array<{ node: Object3D; sweep: number }> = [];
  private readonly lamps = new Map<string, MeshStandardMaterial>();
  private readonly mirrors: Mirror[] = [];
  private readonly mirrorUpdates = new MirrorUpdates();
  private readonly mirrorSurfaces: Mesh[] = [];
  private wiperPhase = 0;
  private readonly rain = new RainGlass({ isMobile: QUALITY.isMobile });
  /** Parts of the exterior model hidden from inside (its simple dashboard, seats and parked wipers). */
  private hiddenExterior: Object3D[] = [];
  private glass: Array<{ m: Material & { opacity: number }; opacity: number }> = [];
  active = false;
  private displayTexture: CanvasTexture | null = null;

  async load(): Promise<void> {
    try {
      const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/cockpit.glb`);
      this.root = gltf.scene;
      this.root.visible = false;
      this.eye = this.root.getObjectByName("DriverEye") ?? null;
      this.eyeBase = this.eye?.position.clone() ?? null;
      this.setSeat(this.seat.up, this.seat.back);
      this.needleSpeed = this.root.getObjectByName("Needle_Speed") ?? null;
      this.needleTacho = this.root.getObjectByName("Needle_Tacho") ?? null;
      this.wheel = this.root.getObjectByName("SteeringWheel") ?? null;
      // Own copies of its materials: the dashboard's plastics share them and stay solid. No depth
      // written, so the cluster behind is not cut out where the wheel passes in front of it.
      const seeThrough = (m: Material) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = WHEEL_OPACITY;
        c.depthWrite = false;
        return c;
      };
      this.wheel?.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.material = Array.isArray(o.material) ? o.material.map(seeThrough) : seeThrough(o.material);
      });
      // A column tilt, if any, takes the stalks with it.
      for (const name of ["SteeringWheel", "Stalk_Indicator", "Stalk_Wiper"]) {
        const part = this.root.getObjectByName(name);
        if (part) part.position.y += COLUMN_RAISE;
      }
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
        // The target is made with the renderer (its format matches the frame's: see sceneTarget).
        mesh.material = new MeshBasicMaterial();
        this.mirrorSurfaces.push(mesh);
        this.mirrors.push({
          surface: mesh,
          centre,
          size: name === "Rear" ? [320, 96] : [192, 128],
          target: null,
          camera: new PerspectiveCamera(name === "Rear" ? 32 : 26, 2, 0.3, 400),
        });
      }
    } catch (error) {
      warn("cockpit_load_failed", { error: String(error) });
    }
  }

  /**
   * The dash clock: a small seven-segment display at the top of the meter cluster showing the game
   * time ("23:05"), lit at night. Drawn on a canvas only when the minute changes.
   */
  setClock(hhmm: string): void {
    if (hhmm === this.clockShown || !this.root) return;
    this.clockShown = hhmm;
    if (!this.clock) {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 64;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(
        new PlaneGeometry(0.06, 0.02),
        new MeshBasicMaterial({ map: texture, side: DoubleSide }),
      );
      // Top centre of the meter cluster, between the tachometer and the speedometer, on the
      // cluster face (cockpit.glb's ClockAnchor), facing the eye.
      this.root.updateWorldMatrix(true, true);
      const anchor = this.root.getObjectByName("ClockAnchor");
      if (anchor) mesh.position.copy(this.root.worldToLocal(anchor.getWorldPosition(new Vector3())));
      else mesh.position.copy(CLOCK_FALLBACK);
      mesh.layers.set(INTERIOR_LAYER);
      this.root.add(mesh);
      if (this.eye) mesh.lookAt(new Vector3().setFromMatrixPosition(this.eye.matrixWorld));
      this.clock = { canvas, texture };
    }
    drawSegments(this.clock.canvas, hhmm);
    this.clock.texture.needsUpdate = true;
  }

  private clock: { canvas: HTMLCanvasElement; texture: CanvasTexture } | null = null;
  private clockShown = "";

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

  /** The map and TV redraw less often than the scene; upload only their changed pixels. */
  refreshDisplay(): void {
    if (this.displayTexture) this.displayTexture.needsUpdate = true;
  }

  /** Put the cockpit inside the car model (same frame as car.glb). */
  attach(car: Object3D): void {
    if (!this.root) return;
    car.add(this.root);
    // The interior is drawn in its own pass (see render), so it lives on its own layer.
    this.root.traverse((o) => o.layers.set(INTERIOR_LAYER));
    for (const w of this.wipers) w.node.traverse((o) => o.layers.set(OUTSIDE_LAYER));
    this.hiddenExterior = [];
    const own = new Set<Object3D>();
    this.root.traverse((o) => own.add(o));
    car.traverse((o) => {
      // The cockpit's own seats are made of a material called Seat too.
      if (!(o instanceof Mesh) || own.has(o)) return;
      const name = (o.material as Material).name;
      // Wiper: car.glb's parked wipers, which WiperArm_* replace.
      if (name === "Interior" || name === "Seat" || name === "Wiper") this.hiddenExterior.push(o);
      // The exterior glass is tinted for the outside view; from inside it should be clear.
      const m = o.material as Material & { opacity: number };
      if (name === "Glass" && !this.glass.some((g) => g.m === m)) this.glass.push({ m, opacity: m.opacity });
    });
  }

  setActive(active: boolean): void {
    const isLeaving = this.active && !active;
    if (isLeaving) this.mirrorUpdates.reset();
    this.active = active && this.root !== null;
    if (this.root) this.root.visible = this.active;
    for (const o of this.hiddenExterior) o.visible = !this.active;
    for (const g of this.glass) g.m.opacity = this.active ? 0.08 : g.opacity;
  }

  /**
   * 座席の調整: the eye raised or lowered and moved back or forward from the model's DriverEye, as
   * a driver sets the seat (m). The eye node itself moves, so the mirrors follow it.
   */
  setSeat(up: number, back: number): void {
    this.seat = { up, back };
    if (!this.eye || !this.eyeBase) return;
    this.eye.position.set(this.eyeBase.x, this.eyeBase.y + up, this.eyeBase.z - back);
  }

  private eyeBase: Vector3 | null = null;
  private seat = { up: 0, back: 0 };

  /** Camera at the driver's eye, looking ahead (plus a look-aside yaw and a look up / down). */
  placeCamera(camera: PerspectiveCamera, lookYaw: number, lookPitch = 0): void {
    if (!this.eye) return;
    this.eye.updateWorldMatrix(true, false);
    const eye = new Vector3().setFromMatrixPosition(this.eye.matrixWorld);
    camera.position.copy(eye);
    camera.quaternion.setFromRotationMatrix(this.eye.matrixWorld);
    // DriverEye looks along the car's +Z; turn the head for 左右 Ctrl / Z.
    if (lookYaw !== 0) camera.rotateY(lookYaw);
    if (lookPitch !== 0) camera.rotateX(lookPitch);
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
    if (GRAPHICS.settings.rainGlass === "off") return;
    this.rain.sim.step(dt, { rainMmH, speed, blades });
  }

  /**
   * Draw the frame into the composer's target (render/frame.ts). Outside the driver's seat: the
   * world and the street passes. From the driver's seat, as games draw what is held close to the
   * eye, the world with the camera's own near plane (0.5 m), the street passes (the motion blur
   * smears the street, not the dashboard moving with the eye), then over a cleared depth buffer
   * with a near plane of 2 cm: the wiper arms, a copy of that for the windscreen's water (the
   * street and the arms are behind the glass, the interior is not), the interior, and the glass.
   * Why not a smaller near plane for everything: depth precision 4 km away would fall apart (road
   * paint and kerbs flicker); with 0.5 m the roof lining, the upper windscreen, the pillars and the
   * door trims (30–60 cm from the eye) were cut away, showing the sky and the car's own tyres.
   */
  render(
    composer: FrameComposer,
    renderer: WebGPURenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    updateMirrors = true,
  ): void {
    const root = this.root;
    const isCockpitActive = this.active && root !== null;
    if (!isCockpitActive) {
      composer.begin();
      composer.drawWorld(scene, camera);
      composer.street();
      return;
    }
    this.lightInterior(scene);
    withSceneMatrices(scene, () => {
      const near = this.nearCamera;
      near.position.copy(camera.position);
      near.quaternion.copy(camera.quaternion);
      near.fov = camera.fov;
      near.aspect = camera.aspect;
      near.coordinateSystem = camera.coordinateSystem;
      near.updateProjectionMatrix();
      near.updateMatrixWorld();
      if (updateMirrors) this.updateMirror(renderer, scene, near);
      // 画質 フロントガラスの雨粒 なし: the glass stays clear (and its simulation is not run).
      const isGlassWet = GRAPHICS.settings.rainGlass !== "off" && this.rain.isWet();
      // The drops go into their own texture first: binding another target mid-frame would split it.
      if (isGlassWet) this.rain.drawDrops(renderer);
      composer.begin();
      composer.drawWorld(scene, camera);
      composer.street();
      near.layers.set(OUTSIDE_LAYER);
      composer.drawOver(scene, near);
      near.layers.set(INTERIOR_LAYER);
      const glassFrame = isGlassWet ? composer.copyForGlass() : null;
      composer.drawOver(scene, near);
      if (glassFrame) this.rain.drawPanes(composer, glassFrame, camera, root, near);
    });
  }

  /**
   * Build the pipelines of the driver's seat before it is first shown: the interior and the wiper
   * arms from the eye (the cockpit shown only while compileAsync collects what to build), the glass
   * and the drops.
   */
  async precompile(
    renderer: WebGPURenderer,
    composer: FrameComposer,
    scene: Scene,
    aspect: number,
  ): Promise<void> {
    if (!this.root) return;
    const near = this.nearCamera;
    const wasActive = this.active;
    this.setActive(true);
    this.placeCamera(near, 0);
    near.aspect = aspect;
    near.updateProjectionMatrix();
    near.updateMatrixWorld();
    near.layers.enableAll();
    composer.begin();
    const pending = renderer.compileAsync(scene, near);
    this.setActive(wasActive);
    try {
      await pending;
      await this.rain.precompile(renderer, composer.target, near);
    } finally {
      near.layers.set(INTERIOR_LAYER);
    }
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
      if (!(o as Light).isLight) return;
      o.layers.enable(INTERIOR_LAYER);
      o.layers.enable(OUTSIDE_LAYER);
    });
  }

  /** At most one visible mirror per frame, using the interior camera's near plane. */
  private updateMirror(renderer: WebGPURenderer, scene: Scene, viewCamera: PerspectiveCamera): void {
    if (this.mirrors.length === 0 || !this.eye) return;
    const index = this.mirrorUpdates.next(this.mirrorSurfaces, viewCamera);
    if (index === null) return;
    const m = this.mirrors[index];
    if (!m.target) {
      m.target = sceneTarget(renderer, ...m.size);
      const surface = m.surface.material as MeshBasicMaterial;
      surface.map = m.target.texture;
      surface.needsUpdate = true;
    }
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
    const before = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(m.target);
      holdShadows(() => renderer.render(scene, m.camera));
    } finally {
      renderer.setRenderTarget(before);
      if (this.root) this.root.visible = wasVisible;
    }
  }
}

/** Seven-segment digits ("23:05") in amber on black, as dash clocks show them. */
function drawSegments(canvas: HTMLCanvasElement, text: string): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  // a b c d e f g, clockwise from the top, then the middle bar.
  const DIGITS: Record<string, number> = {
    "0": 0b1111110,
    "1": 0b0110000,
    "2": 0b1101101,
    "3": 0b1111001,
    "4": 0b0110011,
    "5": 0b1011011,
    "6": 0b1011111,
    "7": 0b1110000,
    "8": 0b1111111,
    "9": 0b1111011,
  };
  g.fillStyle = "#050505";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const w = 30;
  const h = 48;
  const t = 6;
  let x = 14;
  const y = 8;
  const segment = (on: boolean, sx: number, sy: number, sw: number, sh: number) => {
    g.fillStyle = on ? "#ffb02e" : "rgba(255,176,46,0.08)";
    g.fillRect(sx, sy, sw, sh);
  };
  for (const ch of text) {
    if (ch === ":") {
      g.fillStyle = "#ffb02e";
      g.fillRect(x + 2, y + 14, t, t);
      g.fillRect(x + 2, y + 30, t, t);
      x += 16;
      continue;
    }
    const bits = DIGITS[ch] ?? 0;
    const on = (i: number) => ((bits >> (6 - i)) & 1) === 1;
    segment(on(0), x + t, y, w - 2 * t, t); // a
    segment(on(1), x + w - t, y + t, t, h / 2 - t); // b
    segment(on(2), x + w - t, y + h / 2, t, h / 2 - t); // c
    segment(on(3), x + t, y + h - t, w - 2 * t, t); // d
    segment(on(4), x, y + h / 2, t, h / 2 - t); // e
    segment(on(5), x, y + t, t, h / 2 - t); // f
    segment(on(6), x + t, y + h / 2 - t / 2, w - 2 * t, t); // g
    x += w + 10;
  }
}
