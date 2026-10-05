import { PerspectiveCamera, Vector3, type Mesh, type Object3D, type RenderTarget, type Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { log, warn } from "../log";
import { holdShadows, sceneTarget, type FrameComposer } from "../render/frame";
import { readPixels } from "../render/renderer";
import { jstParts, type SocialPost } from "./social";
import { cameraFor, unitOf, type CameraSpec, type SocialAccount } from "./socialAccounts";
import type { ViolationRecord } from "./traffic";

/**
 * The photo a poster attaches: the scene rendered from where they stood, with their own camera —
 * not the player's screen (that is the driver's view, often the cockpit). Each account shoots with
 * its own device (cameraFor: lens, aspect, tilt, exposure, white balance, noise) from its own spot
 * (viewpointFor: a pedestrian who can see the car, the pavement on either side, a balcony, a bus
 * window, far away with the zoom, or a following/oncoming car's dashcam).
 *
 * One off-screen render of the same scene per post (the main camera, the HUD and the cockpit are
 * left alone), tone-mapped as the screen is and read back when the GPU is done (WebGPU has no
 * synchronous readback); developing it into a JPEG — exposure, grain, tilt, a dashcam's barrel and
 * time stamp — runs then, after the frame.
 */

/** What the shooter needs from the game. */
export type ShotWorld = {
  /** Ground height at a point (null off the map). */
  ground: (x: number, z: number) => number | null;
  /** The player's car: where it is, which way it faces (yaw, radians; forward = (sin, 0, cos)), its speed. */
  subject: () => { position: Vector3; yaw: number; kmh: number };
  /** Feet of the people who can see `at`, nearest first. */
  witnesses: (at: Vector3) => Vector3[];
  /** Things only the player sees (route arrows, the mission arrow): hidden from the bystander. */
  hidden: () => (Object3D | null | undefined)[];
  /** Runs `shoot` with the scene set up for an outside view (the cockpit put away, say). */
  stage: (shoot: () => void) => void;
  /** Open ground (no building) at a point; points off the map count as open. */
  isOpen: (x: number, z: number) => boolean;
  /** An exact eye-to-car test through the solid world, when the game has one (preferred). */
  sight?: (from: Vector3, to: Vector3) => boolean;
  /** The car's model, for the check that it really shows in the picture (skipped without it). */
  subjectObject?: () => Object3D;
  /** Told when post.filmedFrom is set (a moment after shoot: the picture is read back first). */
  filmed?: (post: SocialPost) => void;
};

type Frame = { car: Vector3; fwd: Vector3; witnesses: Vector3[] };
type Photo = { shot: Aimed; across: number; pixels: Promise<Uint8Array> };
type Stand = { view: Viewpoint; eye: Vector3 };
type Aimed = Stand & { focal: number; blur: number; tilt: number; distance: number };

export type Viewpoint =
  | "witness"
  | "pavement"
  | "opposite"
  | "balcony"
  | "bus"
  | "far"
  | "behind"
  | "oncoming";

/** Captures for one violation at most; later posts of it reuse one of those (転載). */
export const MAX_SHOTS_PER_EVENT = 4;
// Rendered this much larger than the photo, then sampled down (antialiasing without MSAA).
const SUPERSAMPLE = 1.5;
// Spots tried with a drawn probe at most, and the probe's size.
const MAX_PROBES = 4;
const PROBE_W = 64;
const PROBE_H = 36;
const EYE = 1.52;

/** Where this post's poster stood (fixed by the account and the post). */
export function viewpointFor(account: SocialAccount, postId: number, hasWitness: boolean): Viewpoint {
  const u = unitOf(`${account.id}/${postId}`, "viewpoint");
  if (cameraFor(account).kind === "dashcam") return u < 0.7 ? "behind" : "oncoming";
  if (hasWitness && u < 0.6) return "witness";
  const v = unitOf(`${account.id}/${postId}`, "spot");
  if (v < 0.35) return "pavement";
  if (v < 0.6) return "opposite";
  if (v < 0.72) return "balcony";
  if (v < 0.82) return "bus";
  return "far";
}

/** The photo's size in pixels: 640 on the long side. */
export function frameSize(aspect: CameraSpec["aspect"]): { w: number; h: number } {
  if (aspect === "4:3") return { w: 640, h: 480 };
  if (aspect === "9:16") return { w: 360, h: 640 };
  return { w: 640, h: 360 };
}

const HALF_DIAGONAL_35MM = Math.hypot(36, 24) / 2;

/**
 * Vertical field of view (degrees) of a 35 mm-equivalent focal length. Phones quote it for the 4:3
 * sensor's diagonal; video crops 16:9 from its width, and a story turns that upright.
 */
export function verticalFov(focal: number, aspect: CameraSpec["aspect"]): number {
  const halfDiagonal = HALF_DIAGONAL_35MM / focal;
  const halfLong = halfDiagonal * 0.8;
  const halfShort = halfDiagonal * 0.6;
  const halfV = aspect === "4:3" ? halfShort : aspect === "16:9" ? (halfLong * 9) / 16 : halfLong;
  return (2 * Math.atan(halfV) * 180) / Math.PI;
}

type Look = CameraSpec & {
  /** Barrel distortion (a dashcam's wide lens). */
  barrel: number;
  /** Softness in pixels (far and zoomed in, hand-held). */
  blur: number;
  /** Panning streak in pixels (following a fast car). */
  streak: number;
  seed: number;
  stamp: string | null;
};

export class WitnessShot {
  private readonly camera = new PerspectiveCamera(60, 16 / 9, 0.3, 40000);
  private readonly targets = new Map<string, RenderTarget>();
  private readonly shots = new WeakMap<ViolationRecord, SocialPost[]>();
  // Where the posters of each violation stood: no two share a spot.
  private readonly spots = new WeakMap<ViolationRecord, Vector3[]>();
  /** Each captured post's development: a later post of the same violation waits for it. */
  private readonly developed = new WeakMap<SocialPost, Promise<void>>();

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly composer: FrameComposer,
    private readonly scene: Scene,
    private readonly world: ShotWorld,
  ) {}

  /** Takes `post`'s photo now (post.photo and filmedFrom are set once developed, a moment later). */
  shoot(post: SocialPost): void {
    const earlier = this.shots.get(post.record) ?? [];
    this.shots.set(post.record, [...earlier, post]);
    if (earlier.length >= MAX_SHOTS_PER_EVENT) {
      // Enough cameras for one moment: this poster shares someone else's clip, once it is developed.
      const source = earlier[post.id % earlier.length];
      void (this.developed.get(source) ?? Promise.resolve()).then(() => {
        post.photo = source.photo;
        post.photoAspect = source.photoAspect;
        post.filmedFrom = source.filmedFrom;
        if (post.filmedFrom) this.world.filmed?.(post);
      });
      return;
    }
    try {
      this.developed.set(post, this.capture(post).catch(failed));
    } catch (error) {
      failed(error);
    }
  }

  /**
   * Everything is drawn at the moment of the violation: a probe of each of the first stands (with
   * and without the car, to see whether a wall or a landmark is in the way of any test short of
   * drawing it) and the photo from the best stand by the cheap test. When the probes come back, the
   * photo stands if that stand sees the car; otherwise the first stand that does shoots again, a
   * moment later, at where the car is then (the poster turns to it). Why not every stand's photo at
   * once: four full renders in the frame of the violation would be the hitch the probes avoid.
   */
  private async capture(post: SocialPost): Promise<void> {
    const spec = cameraFor(post.account);
    const isDashcam = spec.kind === "dashcam";
    const subject = this.world.subject();
    const frame = this.frameAt(subject);
    const taken = this.spots.get(post.record) ?? [];
    const tries = this.stands(post, frame, taken);
    const { w, h } = frameSize(spec.aspect);
    const rw = Math.round(w * SUPERSAMPLE);
    const rh = Math.round(h * SUPERSAMPLE);
    const probes: Array<Promise<boolean>> = [];
    let first: Photo | null = null;
    this.staged(() => {
      for (const stand of tries.slice(0, MAX_PROBES)) {
        this.aim(post, spec, stand, frame);
        probes.push(this.seesCar());
      }
      first = this.photo(post, spec, tries[0], frame, rw, rh);
    });
    // Taken now, so another poster of this violation shooting in the same frame stands elsewhere.
    const spot = tries[0].eye.clone();
    this.spots.set(post.record, [...taken, spot]);
    const seen = await Promise.all(probes);
    const best = seen.indexOf(true);
    let photo = first as Photo | null;
    if (best > 0) {
      const later = this.frameAt(this.world.subject());
      this.staged(() => {
        photo = this.photo(post, spec, tries[best], later, rw, rh);
      });
    }
    if (!photo) return;
    const { shot, across } = photo;
    spot.copy(shot.eye);
    const pixels = await photo.pixels;
    post.filmedFrom = {
      eye: { x: shot.eye.x, y: shot.eye.y, z: shot.eye.z },
      fov: verticalFov(shot.focal, spec.aspect),
      tilt: shot.tilt,
      aspect: spec.aspect,
    };
    this.world.filmed?.(post);
    log("witness_shot", {
      post: post.id,
      account: post.account.id,
      device: spec.kind,
      view: shot.view,
      focal: Math.round(shot.focal),
      aspect: spec.aspect,
      distance: Math.round(shot.distance),
    });
    // A pan following a fast car streaks the frame sideways.
    const streak = isDashcam ? 0 : Math.min(4, (subject.kmh / 25) * across * (shot.focal / 26));
    const look: Look = {
      ...spec,
      tilt: shot.tilt,
      barrel: isDashcam ? 0.22 : shot.focal <= 13 ? 0.08 : 0,
      blur: shot.blur,
      streak,
      seed: post.id * 7919,
      stamp: isDashcam ? dashcamStamp(post.postedAt, subject.kmh, shot.view === "behind") : null,
    };
    post.photo = develop(pixels, rw, rh, w, h, look);
    post.photoAspect = w / h;
  }

  private frameAt(subject: ReturnType<ShotWorld["subject"]>): Frame {
    const car = subject.position.clone();
    const fwd = new Vector3(Math.sin(subject.yaw), 0, Math.cos(subject.yaw));
    return { car, fwd, witnesses: this.world.witnesses(car) };
  }

  /** The photo from `stand` (drawn now, read back later), and how much a pan streaks it. */
  private photo(
    post: SocialPost,
    spec: CameraSpec,
    stand: Stand,
    frame: Frame,
    rw: number,
    rh: number,
  ): Photo {
    const shot = this.aim(post, spec, stand, frame);
    const across = Math.abs(frame.fwd.dot(new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)));
    return { shot, across, pixels: this.draw(rw, rh) };
  }

  /** Points `this.camera` from a stand the way this poster would (zoom, aim, tilt). */
  private aim(post: SocialPost, spec: CameraSpec, stand: Stand, frame: Frame): Aimed {
    const isDashcam = spec.kind === "dashcam";
    const u = (k: string) => unitOf(`${post.account.id}/${post.id}`, k);
    const { car, fwd } = frame;
    const eye = stand.eye.clone();
    const distance = Math.hypot(eye.x - car.x, eye.z - car.z);
    // People zoom in on a car that is not close: about 2.2 mm (35 mm equivalent) a metre frames it
    // at a third of the width. Ultra-wide fans stay wide when it is right in front of them.
    const keepsWide = isDashcam || (spec.focal <= 13 && distance < 9);
    const focal = keepsWide ? spec.focal : Math.min(240, Math.max(spec.focal, 2.2 * distance));
    // Past a phone's longest real lens (about 3×) the zoom is digital, and soft; far away the hand shakes too.
    const blur = Math.min(2.4, Math.max(0, (focal / 77 - 1) * 1.2) + (stand.view === "far" ? 0.6 : 0));
    // Phones point at the car (a little off, as hands do); a dashcam just looks down the road.
    const target = isDashcam
      ? eye
          .clone()
          .addScaledVector(stand.view === "behind" ? fwd : fwd.clone().negate(), 20)
          .setY(eye.y - 0.4)
      : car
          .clone()
          .add(new Vector3((u("ax") - 0.5) * 1.2, 0.7 + (u("ay") - 0.5) * 0.6, (u("az") - 0.5) * 1.2));
    if (stand.view === "witness") {
      // The phone is held out in front of the face, not inside the head.
      eye.addScaledVector(target.clone().sub(eye).setY(0).normalize(), 0.35);
    }
    const tilt = spec.tilt + (u("tilt") - 0.5) * (isDashcam ? 0 : 0.06);
    const cam = this.camera;
    cam.fov = verticalFov(focal, spec.aspect);
    const { w, h } = frameSize(spec.aspect);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.position.copy(eye);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.rotateZ(tilt);
    cam.updateMatrixWorld();
    return { view: stand.view, eye, focal, blur, tilt, distance };
  }

  /**
   * Where the poster could stand, best first: their own spot (viewpointFor), then a few others.
   * Spots another poster of this violation took, or with a building in the way by the cheap test,
   * go to the back (the drawn probe has the last word).
   */
  private stands(post: SocialPost, frame: Frame, taken: Vector3[]): Stand[] {
    const first = viewpointFor(post.account, post.id, frame.witnesses.length > 0);
    const isDashcam = cameraFor(post.account).kind === "dashcam";
    const people: Viewpoint[] = frame.witnesses.length > 0 ? ["witness", "witness"] : [];
    const others: Viewpoint[] = isDashcam
      ? ["behind", "oncoming", "behind", "oncoming"]
      : [...people, "pavement", "opposite", "bus", "pavement", "balcony"];
    const salt = `${post.account.id}/${post.id}`;
    const good: Stand[] = [];
    const rest: Stand[] = [];
    for (const [i, view] of [first, ...others].entries()) {
      const eye = this.spot(view, i === 0 ? salt : `${salt}#${i}`, frame);
      const isTaken = taken.some((t) => t.distanceTo(eye) < 4);
      // People who can see the car were picked as such; a balcony looks over its own building.
      const isSeen = view === "witness" || this.canSee(eye, frame.car, view === "balcony" ? 5 : 1);
      (isSeen && !isTaken ? good : rest).push({ view, eye });
    }
    return [...good, ...rest];
  }

  /**
   * Whether the car shows in the current view: a tiny frame drawn with and without the car's
   * meshes, compared (when both are read back). Why the meshes and not the car: hiding the car
   * would hide its headlights too, and a change in the number of lights recompiles every material.
   */
  private async seesCar(): Promise<boolean> {
    const car = this.world.subjectObject?.();
    if (!car) return true;
    const shownRead = this.draw(PROBE_W, PROBE_H);
    const meshes: Object3D[] = [];
    car.traverse((o) => {
      if ((o as Mesh).isMesh && o.visible) meshes.push(o);
    });
    for (const m of meshes) m.visible = false;
    let goneRead: Promise<Uint8Array>;
    try {
      goneRead = this.draw(PROBE_W, PROBE_H);
    } finally {
      for (const m of meshes) m.visible = true;
    }
    const [shown, gone] = await Promise.all([shownRead, goneRead]);
    let changed = 0;
    for (let i = 0; i < shown.length; i += 4) {
      const d =
        Math.abs(shown[i] - gone[i]) +
        Math.abs(shown[i + 1] - gone[i + 1]) +
        Math.abs(shown[i + 2] - gone[i + 2]);
      if (d > 30) changed++;
    }
    return changed >= PROBE_W * PROBE_H * 0.004;
  }

  /** A viewpoint's eye position (salted, so each poster stands somewhere of their own). */
  private spot(view: Viewpoint, salt: string, { car, fwd, witnesses }: Frame): Vector3 {
    const u = (k: string) => unitOf(salt, k);
    const left = new Vector3(fwd.z, 0, -fwd.x);
    const along = (lateral: number, ahead: number) =>
      car.clone().addScaledVector(left, lateral).addScaledVector(fwd, ahead);
    const side = u("side") < 0.5 ? 1 : -1;
    let eye: Vector3;
    let height = EYE;
    switch (view) {
      case "witness":
        eye = witnesses[Math.floor(u("who") * Math.min(4, witnesses.length))].clone();
        break;
      case "pavement":
        eye = along(4.5 + u("lat") * 3, -8 + u("lon") * 20);
        break;
      case "opposite":
        eye = along(-(8 + u("lat") * 4), -10 + u("lon") * 22);
        break;
      case "balcony":
        eye = along(side * (9 + u("lat") * 5), -14 + u("lon") * 28);
        height = 5 + u("floor") * 8;
        break;
      case "bus":
        eye = along(-3.3, -3 + u("lon") * 7);
        height = 2.7;
        break;
      case "far": {
        const angle = (u("angle") - 0.5) * 2 + (side * Math.PI) / 2;
        const dist = 35 + u("dist") * 25;
        eye = along(Math.sin(angle) * dist, Math.cos(angle) * dist);
        break;
      }
      case "behind":
        eye = along((u("lat") - 0.5) * 1.2, -(6 + u("lon") * 6));
        height = 1.25;
        break;
      case "oncoming":
        eye = along(-(3 + u("lat") * 0.8), 8 + u("lon") * 8);
        height = 1.25;
        break;
    }
    eye.y = (this.world.ground(eye.x, eye.z) ?? car.y) + height;
    return eye;
  }

  /**
   * Whether nothing big stands between the eye and the car: open ground sampled every 2.5 m, two
   * closed samples in a row (5 m and more) being a building (the way the crowd judges it).
   */
  private canSee(from: Vector3, to: Vector3, skip: number): boolean {
    if (this.world.sight) return this.world.sight(from, to);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    let closed = 0;
    for (let s = skip; s < dist - 3; s += 2.5) {
      const isClosed = !this.world.isOpen(from.x + (dx / dist) * s, from.z + (dz / dist) * s);
      closed = isClosed ? closed + 1 : 0;
      if (closed >= 2) return false;
    }
    return true;
  }

  /**
   * Runs `fn` with the scene as a bystander sees it: the player's own markers hidden, the cockpit
   * put away, and the shadow map of the frame kept (Why: redrawing it for every probe would cost
   * more than the probes; the sun has not moved since).
   */
  private staged(fn: () => void): void {
    const hidden = this.world.hidden().filter((o): o is Object3D => !!o && o.visible);
    for (const o of hidden) o.visible = false;
    const before = this.renderer.getRenderTarget();
    try {
      holdShadows(() => this.world.stage(fn));
    } finally {
      this.renderer.setRenderTarget(before);
      for (const o of hidden) o.visible = true;
    }
  }

  /**
   * The scene from `this.camera` at rw×rh, tone-mapped as the screen is, read back as RGBA rows
   * bottom-up. The GPU copy is queued now (the targets can be drawn again at once); the pixels
   * arrive when it is done. The scene target is made like the frame's, so no material builds a
   * pipeline of its own for the photo (WebGPU tone-maps in a separate pass, not in each material).
   */
  private draw(rw: number, rh: number): Promise<Uint8Array> {
    const target = this.target(rw, rh);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    const shown = this.composer.toDisplay(target.texture, rw, rh);
    return readPixels(this.renderer, shown, rw, rh);
  }

  private target(rw: number, rh: number): RenderTarget {
    const key = `${rw}x${rh}`;
    let t = this.targets.get(key);
    if (t) return t;
    t = sceneTarget(this.renderer, rw, rh);
    this.targets.set(key, t);
    return t;
  }
}

const two = (n: number) => String(n).padStart(2, "0");
const failed = (error: unknown) => warn("witness_shot_failed", { error: String(error) });

/** 2026/10/05 11:30:12  42km/h, burnt into a dashcam's frame. */
function dashcamStamp(ms: number, kmh: number, isFollowing: boolean): string {
  const d = jstParts(ms);
  // The dashcam's own car: following the player at about its speed, or passing the other way.
  const own = Math.max(0, Math.round(isFollowing ? kmh * 0.9 : 30 + (ms % 20)));
  return `${d.year}/${two(d.month)}/${two(d.day)} ${two(d.hour)}:${two(d.minute)}:${two(d.second)}  ${own}km/h`;
}

/**
 * The phone's processing: tilt (zoomed to fill the corners), barrel, auto exposure (dark scenes
 * are lifted, and get grainier for it), white balance, grain, vignette; then softness, the pan
 * streak and a dashcam's time stamp. Returns a JPEG data URL.
 */
function develop(src: Uint8Array, rw: number, rh: number, w: number, h: number, look: Look): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  let luma = 0;
  let samples = 0;
  for (let i = 0; i < src.length; i += 4 * 53) {
    luma += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
    samples++;
  }
  const mean = luma / Math.max(1, samples) / 255;
  const auto = Math.min(2.2, Math.max(0.85, 0.42 / Math.max(0.03, mean)));
  const gain = auto * look.exposure;
  const gr = gain * (1 + look.warmth);
  const gb = gain * (1 - look.warmth);
  const grain = look.noise * (5 + 16 * (auto - 0.85));
  const cos = Math.cos(look.tilt);
  const sin = Math.sin(look.tilt);
  const long = Math.max(w, h) / Math.min(w, h);
  const zoom = Math.abs(cos) + long * Math.abs(sin);
  const corner = 1 + (h / w) ** 2;
  const out = ctx.createImageData(w, h);
  const o = out.data;
  const half = w / 2;
  const scale = rw / w;
  let seed = look.seed >>> 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - half) / half;
      const v = (y + 0.5 - h / 2) / half;
      const r2 = u * u + v * v;
      // The barrel magnifies the middle and squeezes the edges (corners stay put).
      const b = (1 + look.barrel * r2) / (1 + look.barrel * corner);
      // Image y runs down, so the roll turns the other way round on screen.
      const su = ((u * cos + v * sin) / zoom) * b;
      const sv = ((-u * sin + v * cos) / zoom) * b;
      const sx = Math.min(rw - 1.001, Math.max(0, rw / 2 + su * half * scale - 0.5));
      // GL rows run bottom-up.
      const sy = Math.min(rh - 1.001, Math.max(0, rh / 2 - sv * half * scale - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * rw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + rw * 4;
      const i11 = i01 + 4;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 8) / 0x1000000 - 0.5) * grain;
      const vignette = 1 - 0.22 * r2;
      const k = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        const g = c === 0 ? gr : c === 2 ? gb : gain;
        o[k + c] = (top * (1 - fy) + bottom * fy) * g * vignette + n;
      }
      o[k + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  if (look.blur > 0) soften(ctx, canvas, look.blur);
  if (look.streak > 0.5) {
    ctx.globalAlpha = 0.3;
    ctx.drawImage(canvas, look.streak, 0);
    ctx.drawImage(canvas, -look.streak, 0);
    ctx.globalAlpha = 1;
  }
  if (look.stamp) {
    ctx.font = `700 ${Math.round(w / 40)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.fillStyle = "#f4f4f4";
    ctx.strokeText(look.stamp, 12, h - 10);
    ctx.fillText(look.stamp, 12, h - 10);
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Box-softens the picture by drawing it smaller and back (cheap, like an out-of-focus zoom). */
function soften(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, px: number): void {
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width / (1 + px)));
  small.height = Math.max(1, Math.round(canvas.height / (1 + px)));
  small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}
