import {
  Color,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type RenderTarget,
  type Scene,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { log, warn } from "../log";
import { holdShadows, sceneTarget, type FrameComposer } from "../render/frame";
import { readPixels } from "../render/renderer";
import { UntonemappedBasicMaterial } from "../render/untonemapped";
import type { Darkroom } from "./darkroom";
import { Busy, FrameGate } from "./frameSlices";
import { perf } from "./perf";
import type { Look } from "./photoDevelop";
import { jstParts, postSpan, type SocialPost } from "./social";
import { cameraFor, unitOf, type CameraSpec, type SocialAccount } from "./socialAccounts";
import type { ViolationRecord } from "./traffic";

/**
 * The photo a poster attaches: the scene rendered from where they stood, with their own camera —
 * not the player's screen (that is the driver's view, often the cockpit). Each account shoots with
 * its own device (cameraFor: lens, aspect, tilt, exposure, white balance, noise) from its own spot
 * (viewpointFor: a pedestrian who can see the car, the pavement on either side, a balcony, a bus
 * window, far away with the zoom, or a following/oncoming car's dashcam).
 *
 * Off-screen renders of the same scene (the main camera, the HUD and the cockpit are left alone),
 * at most one a frame (`gate`, ticked by main after each frame), tone-mapped as the screen is and
 * read back when the GPU is done (WebGPU has no synchronous readback); developing the JPEG —
 * exposure, grain, tilt, a dashcam's barrel and time stamp — runs in the darkroom worker.
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
type Subject = ReturnType<ShotWorld["subject"]>;
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
// A probe draws this far past the car (its length and a margin): what is behind cannot hide it.
const PROBE_BEYOND = 8;
const FAR = 40000;
const EYE = 1.52;

/**
 * The car's colour in a probe, as the 8-bit picture shows it (sRGB): a magenta nothing in town is
 * painted. ACES can show it (tests/frameSlices.test.ts), so the probe material outputs the radiance
 * that tone-maps back to it whatever the exposure (UntonemappedBasicMaterial).
 */
export const PROBE_SHOWN = [220, 30, 210] as const;
const PROBE_TOLERANCE = 28;

/**
 * Whether a probe's pixels (RGBA) show the car: at least 0.4 % of them (10 of 64×36) in the probe
 * colour. Pixels on the car's edge, blended with what is behind it, do not count.
 */
export function probeSees(pixels: Uint8Array): boolean {
  let hits = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const isProbe =
      Math.abs(pixels[i] - PROBE_SHOWN[0]) < PROBE_TOLERANCE &&
      Math.abs(pixels[i + 1] - PROBE_SHOWN[1]) < PROBE_TOLERANCE &&
      Math.abs(pixels[i + 2] - PROBE_SHOWN[2]) < PROBE_TOLERANCE;
    if (isProbe) hits++;
  }
  return hits >= Math.max(1, (pixels.length / 4) * 0.004);
}

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

export class WitnessShot {
  /**
   * One off-screen render a frame for all the shots: main ticks it once after each frame.
   * Open (every turn at once) does everything as soon as it can, as before the slicing.
   */
  readonly gate = new FrameGate();
  // Shots in flight, from the request to the developed photo.
  private readonly busy = new Busy();
  private readonly camera = new PerspectiveCamera(60, 16 / 9, 0.3, FAR);
  private readonly targets = new Map<string, RenderTarget>();
  private readonly shots = new WeakMap<ViolationRecord, SocialPost[]>();
  // Where the posters of each violation stood: no two share a spot.
  private readonly spots = new WeakMap<ViolationRecord, Vector3[]>();
  /** Each post's shot until its photo is in: a later post of the same violation waits for it. */
  private readonly developed = new WeakMap<SocialPost, Promise<void>>();
  private readonly probeMaterial = new UntonemappedBasicMaterial({
    name: "WitnessProbe",
    color: new Color().setRGB(
      PROBE_SHOWN[0] / 255,
      PROBE_SHOWN[1] / 255,
      PROBE_SHOWN[2] / 255,
      SRGBColorSpace,
    ),
    fog: false,
  });

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly composer: FrameComposer,
    private readonly scene: Scene,
    private readonly world: ShotWorld,
    private readonly darkroom: Darkroom,
  ) {}

  /**
   * Starts `post`'s photo: drawn over the next frames, developed off the main thread (post.photo
   * and filmedFrom are set when it is in). Asking again for the same post does nothing, so the game
   * can start it when the post is drafted and the feed ask again when it is published.
   */
  shoot(post: SocialPost): void {
    if (this.developed.has(post)) return;
    const earlier = this.shots.get(post.record) ?? [];
    this.shots.set(post.record, [...earlier, post]);
    if (earlier.length >= MAX_SHOTS_PER_EVENT) {
      // Enough cameras for one moment: this poster shares someone else's clip, once it is developed.
      const source = earlier[post.id % earlier.length];
      const shared = (this.developed.get(source) ?? Promise.resolve()).then(() => {
        post.photo = source.photo;
        post.photoAspect = source.photoAspect;
        post.filmedFrom = source.filmedFrom;
        if (post.filmedFrom) this.world.filmed?.(post);
      });
      this.developed.set(post, shared);
      return;
    }
    const work = this.capture(post).catch((error: unknown) => failed(error, post));
    this.developed.set(post, work);
    void this.busy.track(work);
  }

  /** Resolves once no shot is being drawn, read back or developed (at once when none is). */
  idle(): Promise<void> {
    return this.busy.idle();
  }

  /**
   * Over the frames after the violation, one off-screen render a frame (this.gate): the stands
   * are chosen; probed one at a time — a tiny frame clipped just past the car, the car in one flat
   * colour, read back — until one sees the car (mostly the first); then the photo from that stand,
   * aimed at where the car is by then (a few frames on: about a metre at 50 km/h); read back and
   * developed in the darkroom worker.
   * Why the frames right after, not the posting seconds later from a record of the moment (the car
   * put back where it was): the frame's shadow map, kept for the shot, would show the car's shadow
   * where it is now and none under it, and the street (a light that turned, the people now holding
   * their phones) has moved on. Why one stand at a time: the first stand mostly sees the car, so it
   * is one probe and one photo, where the probes of four stands (each drawn with and without the
   * car) and a photo on a guess, all in the violation's frame, were nine renders in that frame.
   */
  private async capture(post: SocialPost): Promise<void> {
    const spec = cameraFor(post.account);
    const isDashcam = spec.kind === "dashcam";
    // The moment it was seen (a drafted post's time; publishing later moves postedAt on).
    const seenAt = post.postedAt;
    await this.gate.turn();
    const subject = this.world.subject();
    const plan = perf.time("shot.plan", () => {
      const frame = this.frameAt(subject);
      const taken = this.spots.get(post.record) ?? [];
      const tries = this.stands(post, frame, taken);
      // Taken now, so another poster of this violation shooting meanwhile stands elsewhere.
      const spot = tries[0].eye.clone();
      this.spots.set(post.record, [...taken, spot]);
      return { frame, tries, spot };
    });
    const { frame, tries, spot } = plan;
    // None seeing it: the first stand, as people film what they can.
    let best = 0;
    const probes = Math.min(MAX_PROBES, tries.length);
    for (let i = 0; i < probes; i++) {
      if (i > 0) await this.gate.turn();
      const read = perf.time("shot.probe", () => this.probe(post, spec, tries[i], this.follow(frame)));
      const isSeen = await perf.span("shot.probe.read", read);
      if (!isSeen) continue;
      best = i;
      break;
    }
    await this.gate.turn();
    const { w, h } = frameSize(spec.aspect);
    const rw = Math.round(w * SUPERSAMPLE);
    const rh = Math.round(h * SUPERSAMPLE);
    const photo = perf.time("shot.photo", () =>
      this.staged(() => this.photo(post, spec, tries[best], this.follow(frame), rw, rh)),
    );
    const { shot, across } = photo;
    spot.copy(shot.eye);
    const pixels = await perf.span("shot.photo.read", photo.pixels);
    post.filmedFrom = {
      eye: { x: shot.eye.x, y: shot.eye.y, z: shot.eye.z },
      fov: verticalFov(shot.focal, spec.aspect),
      tilt: shot.tilt,
      aspect: spec.aspect,
    };
    this.world.filmed?.(post);
    log(
      "witness_shot",
      {
        postId: post.id,
        account: post.account.id,
        device: spec.kind,
        view: shot.view,
        focalMm: Math.round(shot.focal),
        aspect: spec.aspect,
        distanceM: Math.round(shot.distance),
        probes: best + 1,
      },
      postSpan(post),
    );
    // A pan following a fast car streaks the frame sideways.
    const streak = isDashcam ? 0 : Math.min(4, (subject.kmh / 25) * across * (shot.focal / 26));
    const look: Look = {
      exposure: spec.exposure,
      warmth: spec.warmth,
      noise: spec.noise,
      tilt: shot.tilt,
      barrel: isDashcam ? 0.22 : shot.focal <= 13 ? 0.08 : 0,
      blur: shot.blur,
      streak,
      seed: post.id * 7919,
      stamp: isDashcam ? dashcamStamp(seenAt, subject.kmh, shot.view === "behind") : null,
    };
    // Inline (the old way, or no worker) it is all done in the call: main-thread time, not a wait.
    const url = await (this.darkroom.inline
      ? perf.time("shot.develop.inline", () => this.darkroom.develop(pixels, rw, rh, w, h, look))
      : perf.span("shot.develop", this.darkroom.develop(pixels, rw, rh, w, h, look)));
    if (!url) return;
    post.photo = url;
    post.photoAspect = w / h;
  }

  /**
   * Builds, before play, what the first shot would otherwise build in its frame: the probe
   * material's pipeline for each mesh of the car (one per vertex layout), the 8-bit pass a shot is
   * tone-mapped through and the read-back's buffers. Into `frameTarget`'s format: the shots'
   * targets are made the same way (sceneTarget), so they share its pipelines.
   */
  async precompile(frameTarget: RenderTarget): Promise<void> {
    const car = this.world.subjectObject?.();
    if (!car) return;
    const s = this.world.subject();
    const cam = this.camera;
    cam.fov = 50;
    cam.aspect = PROBE_W / PROBE_H;
    cam.far = FAR;
    cam.updateProjectionMatrix();
    cam.position.copy(s.position).add(new Vector3(-Math.sin(s.yaw) * 7, 2, -Math.cos(s.yaw) * 7));
    cam.up.set(0, 1, 0);
    cam.lookAt(s.position);
    cam.updateMatrixWorld();
    // Staged as a shot is: from the driver's seat some of the car's outside is hidden, and what is
    // hidden is not compiled.
    const compiled = this.staged(() => {
      const unpaint = this.paint(car);
      try {
        this.renderer.setRenderTarget(frameTarget);
        // compileAsync collects what it builds before it returns: the car can be repainted at once.
        return this.renderer.compileAsync(car, cam, this.scene);
      } finally {
        unpaint();
      }
    });
    await compiled;
    // One probe drawn for real, now that its pipelines are there: the 8-bit pass and the read-back.
    await this.staged(() => {
      const repaint = this.paint(car);
      try {
        return this.draw(PROBE_W, PROBE_H);
      } finally {
        repaint();
      }
    });
  }

  private frameAt(subject: Subject): Frame {
    const car = subject.position.clone();
    const fwd = new Vector3(Math.sin(subject.yaw), 0, Math.cos(subject.yaw));
    return { car, fwd, witnesses: this.world.witnesses(car) };
  }

  /** `frame` with the car where it is now: the stands stay those of the moment, the aim follows. */
  private follow(frame: Frame): Frame {
    const now = this.world.subject();
    return {
      car: now.position.clone(),
      fwd: new Vector3(Math.sin(now.yaw), 0, Math.cos(now.yaw)),
      witnesses: frame.witnesses,
    };
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

  /**
   * Whether the car shows from `stand`: a PROBE_W×PROBE_H frame clipped a few metres past the car
   * (what is behind it cannot hide it, and the rest of the town is not drawn), with the car's
   * meshes in the flat probe colour; it shows if enough pixels come back in that colour.
   * Why a flat colour and not the frame with and without the car (as before): one render, not two,
   * and nothing that moves between two frames can pass for the car. Why its materials and not
   * hiding the car: hiding it would take its headlights out of the lights, and a change in the
   * number of lights rebuilds every material.
   */
  private probe(post: SocialPost, spec: CameraSpec, stand: Stand, frame: Frame): Promise<boolean> {
    const car = this.world.subjectObject?.();
    if (!car) return Promise.resolve(true);
    return this.staged(() => {
      const shot = this.aim(post, spec, stand, frame);
      const cam = this.camera;
      cam.far = shot.eye.distanceTo(frame.car) + PROBE_BEYOND;
      cam.updateProjectionMatrix();
      const unpaint = this.paint(car);
      try {
        return this.draw(PROBE_W, PROBE_H).then(probeSees);
      } finally {
        unpaint();
        cam.far = FAR;
        cam.updateProjectionMatrix();
      }
    });
  }

  /**
   * Gives the car's shown meshes the probe material; returns what puts theirs back. Slots that are
   * hidden (a material with visible off, such as an unlit lamp's glow) stay as they are.
   */
  private paint(car: Object3D): () => void {
    const painted: Array<[Mesh, Material | Material[]]> = [];
    const probe = this.probeMaterial;
    car.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const own = mesh.material;
      painted.push([mesh, own]);
      mesh.material = Array.isArray(own)
        ? own.map((m) => (m.visible ? probe : m))
        : own.visible
          ? probe
          : own;
    });
    return () => {
      for (const [mesh, own] of painted) mesh.material = own;
    };
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
   * Runs `fn` with the scene as a bystander sees it: the player's own markers hidden, the cockpit
   * put away, and the shadow map of the frame kept (Why: redrawing it for every probe would cost
   * more than the probes; the sun has not moved since).
   */
  private staged<T>(fn: () => T): T {
    const hidden = this.world.hidden().filter((o): o is Object3D => !!o && o.visible);
    for (const o of hidden) o.visible = false;
    const before = this.renderer.getRenderTarget();
    let out: T | undefined;
    try {
      holdShadows(() =>
        this.world.stage(() => {
          out = fn();
        }),
      );
    } finally {
      this.renderer.setRenderTarget(before);
      for (const o of hidden) o.visible = true;
    }
    return out as T;
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
const failed = (error: unknown, post: SocialPost) =>
  warn("witness_shot_failed", { postId: post.id, error: String(error) }, postSpan(post));

/** 2026/10/05 11:30:12  42km/h, burnt into a dashcam's frame. */
function dashcamStamp(ms: number, kmh: number, isFollowing: boolean): string {
  const d = jstParts(ms);
  // The dashcam's own car: following the player at about its speed, or passing the other way.
  const own = Math.max(0, Math.round(isFollowing ? kmh * 0.9 : 30 + (ms % 20)));
  return `${d.year}/${two(d.month)}/${two(d.day)} ${two(d.hour)}:${two(d.minute)}:${two(d.second)}  ${own}km/h`;
}
