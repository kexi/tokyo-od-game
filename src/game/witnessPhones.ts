import {
  AdditiveBlending,
  Box3,
  CanvasTexture,
  Color,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { warn } from "../log";
import type { Pedestrian, Pedestrians } from "../world/pedestrians";
import { severityOf, type SocialPost } from "./social";
import { SOCIAL_APP_NAME, SOCIAL_LOGO_PATH, SOCIAL_THEME } from "./socialTheme";
import type { ViolationRecord } from "./traffic";

/** Only people this close film (a phone camera's useful reach for a car). */
export const FILM_RANGE = 60;
/** At most this many film one violation: each held phone is a handful of draw calls. */
export const MAX_FILMERS = 8;

export type FilmPlan<T> = { who: T; seconds: number };

/**
 * Who films a violation and for how long. `candidates` are the people who can see the car, nearest
 * first. The share who film grows steeply with how shocking it looked (severity 0.1 for 10 km/h
 * over … 1 for a hit-and-run: 85 % of them then, about 3 % for the mildest); a post means its
 * author filmed it, so there is at least one when anyone could see. Each films 3–10 s; for serious
 * ones (severity ≥ 0.7) every other filmer keeps at it about 2.5 times as long.
 * `rand` returns [0, 1).
 */
export function planFilming<T>(
  candidates: readonly T[],
  severity: number,
  posted: boolean,
  rand: () => number,
): FilmPlan<T>[] {
  const share = 0.85 * Math.max(0, severity) ** 1.5;
  // Stochastic rounding: three people at a 30 % share make one filmer on average, not always zero.
  const drawn = Math.floor(candidates.length * share + rand());
  const isPostedFromHere = posted && candidates.length > 0;
  const count = Math.min(candidates.length, MAX_FILMERS, Math.max(drawn, isPostedFromHere ? 1 : 0));
  return candidates.slice(0, count).map((who, i) => {
    const base = 3 + 5 * severity + 2 * rand();
    const keepsFilming = severity >= 0.7 && i % 2 === 0;
    return { who, seconds: keepsFilming ? base * 2.5 : base };
  });
}

// The phone screen: the つぶやき app in landscape, its camera recording with the post being typed.
const CANVAS_W = 320; // the display's short side (portrait width); 67.4 × 143.4 mm in smartphone.glb
const CANVAS_H = 680;
const REDRAW = 0.2; // s: the clock and the typing are all that change
const TYPE_RATE = 7; // characters a second
const TYPE_DELAY = 1.2; // s before they start typing
const DEFAULT_CASES = ["#2e3138", "#e9e6e0", "#2c3e66", "#e3a6b8", "#9db59c", "#c8352e"];

type Clip = { record: ViolationRecord; post: SocialPost | null; time: number };

/**
 * Bystanders who film the player's violations with their phones (smartphone.glb from
 * scripts/blender/smartphone.py), the game's own SNS 「つぶやき」 open on the screen. All phones show
 * one shared CanvasTexture of the latest clip — the viewfinder with ● REC and its clock, and the
 * post being typed — redrawn a few times a second while anyone films. The screen is emissive, so
 * it reads at night, when every other phone also lights its video light.
 */
export class WitnessPhones {
  private template: Object3D | null = null;
  private caseColors = DEFAULT_CASES;
  private readonly cases = new Map<string, Material>();
  private screen: {
    canvas: HTMLCanvasElement;
    texture: CanvasTexture;
    material: MeshStandardMaterial;
  } | null = null;
  private readonly light = new MeshStandardMaterial({
    name: "PhoneFlash",
    color: 0xf2ecd6,
    emissive: 0xfff4dc,
    emissiveIntensity: 0,
    roughness: 0.35,
  });
  /** Video light: a glow facing out of the back round the flash, seen only from in front. */
  private glow: { mesh: Mesh; at: Vector3 } | null = null;
  private clip: Clip | null = null;
  private redrawIn = 0;
  private seed = 4242;
  private readonly stills = new Map<string, HTMLImageElement>();

  constructor(private readonly pedestrians: Pedestrians) {
    void this.load().catch((e: unknown) => warn("smartphone_load_failed", { error: String(e) }));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
    );
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/smartphone.glb`);
    const phone = gltf.scene.getObjectByName("Smartphone");
    if (!phone) throw new Error("smartphone.glb has no Smartphone");
    phone.removeFromParent();
    this.template = phone;
    let flashAt: Vector3 | null = null;
    phone.traverse((o) => {
      const isFlash = o instanceof Mesh && (o.material as Material).name === "PhoneFlash";
      if (isFlash) flashAt = new Box3().setFromObject(o).getCenter(new Vector3());
    });
    if (flashAt) this.glow = { mesh: this.glowMesh(), at: flashAt };
    const info = gltf.scene.userData.smartphone as { caseColors?: string[] } | undefined;
    if (info?.caseColors?.length) this.caseColors = info.caseColors;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (this.seed >>> 8) / 0x1000000;
  }

  /**
   * A violation at `carPos`: some of the people who can see it get their phones out. `post` is
   * what the feed made of it (null: nobody posted, but people may still film). Returns how many
   * started (or went on) filming — never more than the pedestrians among the post's witnesses.
   */
  react(record: ViolationRecord, post: SocialPost | null, carPos: Vector3): number {
    const candidates = this.pedestrians.witnessesOf(carPos, FILM_RANGE);
    const plan = planFilming(candidates, severityOf(record), post !== null, () => this.rand());
    if (plan.length === 0) return 0;
    this.clip = { record, post, time: 0 };
    this.redrawIn = 0;
    for (const { who, seconds } of plan)
      this.pedestrians.startFilming(who, seconds, () => this.makePhone(who));
    return plan.length;
  }

  /** Runs the shared screen; `nightFactor` (0 day … 1 night) switches the video lights on. */
  update(dt: number, nightFactor: number): void {
    const isFilming = this.pedestrians.filming() > 0;
    if (!isFilming || !this.clip) return;
    this.clip.time += dt;
    const isDark = nightFactor > 0.5;
    this.light.emissiveIntensity = isDark ? 3 : 0;
    // On the shared material, so every phone's copy of the glow follows.
    if (this.glow) (this.glow.mesh.material as Material).visible = isDark;
    this.redrawIn -= dt;
    if (this.redrawIn > 0) return;
    this.redrawIn = REDRAW;
    const screen = this.screenParts();
    drawScreen(screen.canvas, this.clip, this.still(this.clip));
    screen.texture.needsUpdate = true;
  }

  private makePhone(who: Pedestrian): Object3D {
    // Not loaded (yet): empty hands still make the pose read as filming.
    if (!this.template) return new Group();
    const id = who.profile.id;
    const phone = this.template.clone(true);
    const caseColor = this.caseColors[id % this.caseColors.length];
    const hasLight = id % 2 === 0; // half of them switch the video light on after dark
    phone.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.userData.shared = true; // template geometry: disposeHuman must not free it
      o.castShadow = false;
      const name = (o.material as Material).name;
      if (name === "PhoneScreen") o.material = this.screenParts().material;
      else if (name === "PhoneCase")
        o.material = this.caseMaterial(o.material as MeshStandardMaterial, caseColor);
      else if (name === "PhoneFlash" && hasLight) o.material = this.light;
    });
    if (hasLight && this.glow) {
      const glow = this.glow.mesh.clone();
      glow.position.copy(this.glow.at).setZ(this.glow.at.z - 0.002);
      phone.add(glow);
    }
    return phone;
  }

  /**
   * The video light's glow: an additive 30 cm quad facing out of the phone's back (−Z), so the driver
   * sees it and the holder does not. Why not a PointLight: dozens of lights would recompile every
   * material, and a 4 mm flash is under a pixel at street distances without a halo.
   */
  private glowMesh(): Mesh {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,250,235,1)");
      g.addColorStop(0.25, "rgba(255,244,220,0.7)");
      g.addColorStop(0.6, "rgba(255,236,200,0.18)");
      g.addColorStop(1, "rgba(255,230,190,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(0.3, 0.3),
      new MeshBasicMaterial({
        map: texture,
        color: new Color(2.4, 2.3, 2.1), // brighter than white: an LED seen head-on
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        visible: false,
      }),
    );
    mesh.rotation.y = Math.PI;
    mesh.userData.shared = true;
    return mesh;
  }

  private caseMaterial(base: MeshStandardMaterial, color: string): Material {
    let m = this.cases.get(color);
    if (!m) {
      const c = base.clone();
      c.color.set(color);
      m = c;
      this.cases.set(color, m);
    }
    return m;
  }

  private screenParts(): NonNullable<WitnessPhones["screen"]> {
    if (this.screen) return this.screen;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    // glTF UVs have v = 0 at the top of the image (GLTFLoader's own textures are unflipped too).
    texture.flipY = false;
    texture.anisotropy = 4;
    // Lit by itself: black base, the app as emissive (a glossy surface still catches reflections).
    const material = new MeshStandardMaterial({
      name: "PhoneScreen",
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 1.15,
      roughness: 0.12,
    });
    this.screen = { canvas, texture, material };
    return this.screen;
  }

  /**
   * The viewfinder's picture once decoded: the poster's own shot from where they stood
   * (witnessShot.ts), else the driver's view grabbed for the post.
   */
  private still(clip: Clip): HTMLImageElement | null {
    const url = clip.post?.photo ?? clip.post?.image ?? clip.record.context?.snapshot;
    if (!url) return null;
    let img = this.stills.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.stills.clear(); // only the latest clip is ever shown
      this.stills.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

const T = SOCIAL_THEME;
const LOGO = typeof Path2D === "undefined" ? null : new Path2D(SOCIAL_LOGO_PATH);

/** What is being typed: the post's text and tags, or a first line when nobody posted. */
function draftOf(clip: Clip): { text: string; tags: string[]; author: string; handle: string } {
  if (clip.post) {
    const { text, tags, author, handle } = clip.post;
    return { text, tags, author, handle };
  }
  return {
    text: `目の前で${clip.record.label}の車…`,
    tags: ["#危険運転"],
    author: "通りすがり",
    handle: "passerby",
  };
}

/**
 * The screen as the holder sees it, landscape (680 × 320) on the portrait canvas. The canvas's top
 * is the display's top (unflipped texture), and the phone is held with its top to the holder's
 * left, so landscape x runs down the canvas and landscape y runs right to left.
 */
function drawScreen(canvas: HTMLCanvasElement, clip: Clip, still: HTMLImageElement | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = CANVAS_H;
  const H = CANVAS_W;
  ctx.setTransform(0, 1, -1, 0, CANVAS_W, 0);
  ctx.fillStyle = T.background;
  ctx.fillRect(0, 0, W, H);
  const font = (px: number, weight = 400) => `${weight} ${px}px ${T.font}`;
  ctx.textBaseline = "middle";

  // Header: the app's own logo and name, and the post button.
  if (LOGO) {
    ctx.save();
    ctx.translate(14, 7);
    ctx.scale(32 / 24, 32 / 24);
    ctx.fillStyle = T.accent;
    ctx.fill(LOGO, "evenodd");
    ctx.restore();
  }
  ctx.fillStyle = T.text;
  ctx.font = font(22, 700);
  ctx.fillText(SOCIAL_APP_NAME, 54, 24);
  ctx.fillStyle = T.secondary;
  ctx.font = font(15);
  ctx.fillText("動画を撮影中", 160, 25);
  roundRect(ctx, 560, 7, 108, 34, 17);
  ctx.fillStyle = T.accent;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = font(17, 700);
  ctx.textAlign = "center";
  ctx.fillText("投稿する", 614, 25);
  ctx.textAlign = "left";
  ctx.fillStyle = T.hairline;
  ctx.fillRect(0, 48, W, 1.5);

  drawViewfinder(ctx, clip, still, 10, 58, 424, 252, font);
  drawCompose(ctx, clip, 448, 58, 222, 252, font);
}

function drawViewfinder(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  still: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  font: (px: number, weight?: number) => string,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 14);
  ctx.clip();
  if (still) {
    // Cover the frame, drifting slowly as a hand-held camera does.
    const zoom = 1.12 + 0.04 * Math.sin(clip.time * 0.7);
    const s = Math.max(w / still.naturalWidth, h / still.naturalHeight) * zoom;
    const dw = still.naturalWidth * s;
    const dh = still.naturalHeight * s;
    const jx = Math.sin(clip.time * 1.3) * 6;
    const jy = Math.cos(clip.time * 1.1) * 4;
    ctx.drawImage(still, x + (w - dw) / 2 + jx, y + (h - dh) / 2 + jy, dw, dh);
  } else {
    // No still yet: a street at dusk with a car on it.
    const sky = ctx.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, "#3a4d6b");
    sky.addColorStop(0.55, "#8796a8");
    sky.addColorStop(0.56, "#3c3f45");
    sky.addColorStop(1, "#24262a");
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#c9cdd3";
    ctx.fillRect(x, y + h * 0.78, w, 3);
    const cx = x + w * (0.5 + 0.08 * Math.sin(clip.time));
    ctx.fillStyle = "#15171b";
    roundRect(ctx, cx - 62, y + h * 0.5, 124, 44, 10);
    ctx.fill();
    roundRect(ctx, cx - 40, y + h * 0.38, 80, 34, 12);
    ctx.fill();
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(cx - 58, y + h * 0.55, 14, 7);
    ctx.fillRect(cx + 44, y + h * 0.55, 14, 7);
  }
  ctx.restore();

  // Focus brackets round the middle.
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2.5;
  const bx = x + w / 2;
  const by = y + h / 2 + 10;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(bx + sx * 46, by + sy * 22);
    ctx.lineTo(bx + sx * 60, by + sy * 22);
    ctx.lineTo(bx + sx * 60, by + sy * 8);
    ctx.stroke();
  }

  // ● REC and the clip's clock.
  const secs = Math.floor(clip.time);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, x + 12, y + 12, 132, 30, 15);
  ctx.fill();
  const isBlinkOn = clip.time % 1 < 0.6;
  ctx.fillStyle = isBlinkOn ? "#ff3b30" : "rgba(255,59,48,0.35)";
  ctx.beginPath();
  ctx.arc(x + 30, y + 27, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = font(16, 700);
  ctx.fillText(`REC ${clock}`, x + 44, y + 28);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = font(13, 700);
  ctx.fillText("HD · 60fps", x + 14, y + h - 16);
}

function drawCompose(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  x: number,
  y: number,
  w: number,
  h: number,
  font: (px: number, weight?: number) => string,
): void {
  const draft = draftOf(clip);
  // Who is posting: an initial in a circle, the name and the handle.
  ctx.fillStyle = T.surface;
  ctx.beginPath();
  ctx.arc(x + 18, y + 18, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = T.text;
  ctx.font = font(17, 700);
  ctx.textAlign = "center";
  ctx.fillText(draft.author.slice(0, 1), x + 18, y + 19);
  ctx.textAlign = "left";
  ctx.font = font(14, 700);
  ctx.fillText(draft.author, x + 44, y + 10, w - 44);
  ctx.fillStyle = T.secondary;
  ctx.font = font(13);
  ctx.fillText(`@${draft.handle}`, x + 44, y + 28, w - 44);

  // The text being typed, tags in the accent colour, wrapped character by character (Japanese).
  const full = [...draft.text, " ", ...draft.tags.join(" ")];
  const tagFrom = [...draft.text].length + 1;
  const typed = Math.max(0, Math.min(full.length, Math.floor((clip.time - TYPE_DELAY) * TYPE_RATE)));
  ctx.font = font(16);
  const lineH = 23;
  let cx = x;
  let cy = y + 58;
  const bottom = y + h - 42;
  for (let i = 0; i < typed && cy <= bottom; i++) {
    const ch = full[i];
    const cw = ctx.measureText(ch).width;
    if (cx + cw > x + w) {
      cx = x;
      cy += lineH;
      if (cy > bottom) break;
    }
    ctx.fillStyle = i >= tagFrom ? T.accent : T.text;
    ctx.fillText(ch, cx, cy);
    cx += cw;
  }
  const isCaretOn = clip.time % 0.8 < 0.45;
  if (isCaretOn && cy <= bottom) {
    ctx.fillStyle = T.accent;
    ctx.fillRect(cx + 1, cy - 10, 2, 20);
  }

  // Footer: what is left of the length limit, as a ring and a count.
  ctx.fillStyle = T.hairline;
  ctx.fillRect(x, y + h - 30, w, 1.5);
  const used = Math.min(1, typed / 140);
  ctx.lineWidth = 3;
  ctx.strokeStyle = T.hairline;
  ctx.beginPath();
  ctx.arc(x + w - 14, y + h - 12, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = T.accent;
  ctx.beginPath();
  ctx.arc(x + w - 14, y + h - 12, 10, -Math.PI / 2, -Math.PI / 2 + used * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = T.secondary;
  ctx.font = font(13);
  ctx.fillText(`残り ${140 - typed}`, x, y + h - 11);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
