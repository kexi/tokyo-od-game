import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { warn } from "../log";
import { animateHuman, createHuman, disposeHuman } from "../world/human";
import { hashString, type AvatarSpec, type PictureMotif, type SocialAccount } from "./socialAccounts";

/**
 * The pictures of Y (SOCIAL_APP_NAME): profile images, banners and the photos in everyday posts, painted once
 * and cached as JPEG data URLs. Portraits are the game's own pedestrian model in a small off-screen
 * three.js render (head and shoulders on a backdrop), made lazily a couple per tick and capped;
 * everything else is drawn on a 2D canvas.
 */

const AVATAR_PX = 128;
// Portraits rendered in all; past that, people get an initial (each one is a render and a model clone).
const MAX_PORTRAITS = 60;
const cache = new Map<string, string>();
const waiting = new Map<string, Set<HTMLImageElement>>();
const queue: SocialAccount[] = [];
let portraits = 0;
let isPumping = false;

/** A round profile image of `size` CSS pixels (filled in as soon as it is painted). */
export function avatarElement(account: SocialAccount, size: number): HTMLElement {
  const box = document.createElement("span");
  box.className = "sns-av";
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.style.background = placeholder(account.avatar);
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  box.append(img);
  const url = avatarUrl(account, img);
  if (url) img.src = url;
  return box;
}

function placeholder(spec: AvatarSpec): string {
  if (spec.kind === "portrait") return spec.backdrop[0];
  if (spec.kind === "initial") return spec.background;
  if (spec.kind === "illustration") return `hsl(${spec.hue} 45% 45%)`;
  return "#3e4a56";
}

function avatarUrl(account: SocialAccount, img: HTMLImageElement): string | null {
  const hit = cache.get(account.id);
  if (hit) return hit;
  if (account.avatar.kind !== "portrait") {
    const url = paint(AVATAR_PX, AVATAR_PX, (ctx) => drawAvatar(ctx, account, AVATAR_PX));
    cache.set(account.id, url);
    return url;
  }
  let set = waiting.get(account.id);
  if (!set) {
    set = new Set();
    waiting.set(account.id, set);
    queue.push(account);
    schedule();
  }
  set.add(img);
  return null;
}

function schedule(): void {
  if (isPumping) return;
  isPumping = true;
  // Why not requestAnimationFrame: a hidden tab would never paint them; a timeout still runs.
  setTimeout(pump, 30);
}

function pump(): void {
  isPumping = false;
  for (let i = 0; i < 2 && queue.length > 0; i++) {
    const account = queue.shift();
    if (!account) break;
    const url =
      (portraits < MAX_PORTRAITS ? renderPortrait(account) : null) ??
      paint(AVATAR_PX, AVATAR_PX, (ctx) => drawInitial(ctx, account, AVATAR_PX, placeholder(account.avatar)));
    cache.set(account.id, url);
    for (const img of waiting.get(account.id) ?? []) img.src = url;
    waiting.delete(account.id);
  }
  if (queue.length > 0) schedule();
}

/** A data URL of a `w`×`h` canvas `draw` paints. */
function paint(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  draw(ctx);
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** The banner of a profile page (3:1), or null for the plain grey of an unset one. */
export function bannerUrl(account: SocialAccount): string | null {
  const b = account.banner;
  if (b.kind === "none") return null;
  const key = `banner:${account.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = paint(600, 200, (ctx) => {
    if (b.kind === "gradient") {
      const g = ctx.createLinearGradient(0, 0, 600, 200);
      g.addColorStop(0, b.from);
      g.addColorStop(1, b.to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 600, 200);
      return;
    }
    PAINTERS[b.motif](ctx, 600, 200, b.hue);
  });
  cache.set(key, url);
  return url;
}

/** A photo in an everyday post (a ramen bowl, the sunset …). */
export function pictureUrl(key: string, motif: PictureMotif, hue: number, w = 480, h = 270): string {
  const id = `pic:${key}:${w}x${h}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const url = paint(w, h, (ctx) => PAINTERS[motif](ctx, w, h, hue));
  cache.set(id, url);
  return url;
}

// ---------- portraits (three.js) ----------

let studio: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera } | null | undefined;

function getStudio(): typeof studio {
  if (studio !== undefined) return studio;
  try {
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(AVATAR_PX, AVATAR_PX, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = ACESFilmicToneMapping;
    // A little brighter than the street: profile photos are taken in good light.
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = SRGBColorSpace;
    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x5a5048, 2.2));
    const key = new DirectionalLight(0xfff4e8, 2.6);
    key.position.set(-1.2, 2.4, 2.2);
    const rim = new DirectionalLight(0xdfe8ff, 1.2);
    rim.position.set(1.5, 1.8, -1.5);
    scene.add(key, rim);
    const camera = new PerspectiveCamera(24, 1, 0.05, 10);
    studio = { renderer, scene, camera };
  } catch (error) {
    // Why a separate small renderer and not the game's: rendering here never disturbs its frame.
    warn("avatar_studio_failed", { error: String(error) });
    studio = null;
  }
  return studio;
}

/** Head and shoulders of the pedestrian model in this account's clothes, or null when it cannot be drawn. */
function renderPortrait(account: SocialAccount): string | null {
  const spec = account.avatar;
  if (spec.kind !== "portrait") return null;
  const s = getStudio();
  if (!s) return null;
  let human: ReturnType<typeof createHuman>;
  try {
    human = createHuman(spec.colors, 1, spec.variant);
  } catch {
    return null; // the model has not loaded (yet)
  }
  animateHuman(human, 0, 0, false);
  human.root.rotation.y = spec.yaw;
  const h = hashString(account.id);
  // Framing varies a little, like selfies do.
  const lift = ((h % 7) - 3) * 0.008;
  s.camera.position.set((((h >> 3) % 5) - 2) * 0.03, 1.7 + lift, 1.12);
  s.camera.lookAt(0, 1.64 + lift, 0);
  s.scene.add(human.root);
  s.renderer.render(s.scene, s.camera);
  s.scene.remove(human.root);
  disposeHuman(human);
  portraits++;
  return paint(AVATAR_PX, AVATAR_PX, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, AVATAR_PX);
    g.addColorStop(0, spec.backdrop[0]);
    g.addColorStop(1, spec.backdrop[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
    // Soft out-of-focus lights behind some of them (a street, a café).
    if (h % 3 === 0) {
      for (let i = 0; i < 6; i++) {
        const x = ((h >> (i + 2)) % 100) / 100;
        const y = ((h >> (i + 5)) % 60) / 100;
        ctx.fillStyle = `rgba(255,255,255,${0.12 + (i % 3) * 0.05})`;
        ctx.beginPath();
        ctx.arc(x * AVATAR_PX, y * AVATAR_PX, 8 + (i % 4) * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.drawImage(s.renderer.domElement, 0, 0);
  });
}

// ---------- canvas pictures ----------

function drawAvatar(ctx: CanvasRenderingContext2D, account: SocialAccount, px: number): void {
  const spec = account.avatar;
  if (spec.kind === "illustration") return PAINTERS[spec.motif](ctx, px, px, spec.hue);
  if (spec.kind === "initial") return drawInitial(ctx, account, px, spec.background, spec.letter);
  drawDefault(ctx, px);
}

/** The first letter of the name (skipping emoji and marks) on a colour. */
function drawInitial(
  ctx: CanvasRenderingContext2D,
  account: SocialAccount,
  px: number,
  bg: string,
  letter?: string,
): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  const first = letter ?? /[\p{L}\p{N}]/u.exec(account.name)?.[0]?.toUpperCase() ?? "?";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(px * 0.46)}px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(first, px / 2, px * 0.53);
}

/** A new account's picture: a plain silhouette, head and shoulders. */
function drawDefault(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.fillStyle = "#3e4a56";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#8d99a6";
  ctx.beginPath();
  ctx.arc(px * 0.5, px * 0.4, px * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px * 0.5, px * 1.02, px * 0.38, px * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, hue: number) => void;

const vgrad = (ctx: CanvasRenderingContext2D, h: number, stops: [number, string][]) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, c] of stops) g.addColorStop(at, c);
  return g;
};

/** A small deterministic random stream for the details of a picture. */
const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const PAINTERS: Record<PictureMotif, Painter> = {
  cat(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${hue} 45% 20%)`],
      [1, `hsl(${(hue + 40) % 360} 50% 48%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff1c2";
    ctx.beginPath();
    ctx.arc(w * 0.72, h * 0.3, m * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 30% 9%)`;
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    const cx = w * 0.42;
    const base = h * 0.86;
    const s = m * 0.55;
    ctx.fillStyle = "#101014";
    ctx.beginPath();
    ctx.ellipse(cx, base - s * 0.3, s * 0.25, s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + s * 0.02, base - s * 0.72, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * (0.02 + dx * 0.15), base - s * 0.78);
      ctx.lineTo(cx + s * (0.02 + dx * 0.13), base - s * 0.98);
      ctx.lineTo(cx + s * (0.02 + dx * 0.03), base - s * 0.86);
      ctx.fill();
    }
    ctx.strokeStyle = "#101014";
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, base - s * 0.06);
    ctx.quadraticCurveTo(cx + s * 0.55, base - s * 0.05, cx + s * 0.5, base - s * 0.45);
    ctx.stroke();
  },
  sunset(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h * 0.62, [
      [0, `hsl(${hue} 55% 32%)`],
      [0.55, "#ff8a5b"],
      [1, "#ffd27a"],
    ]);
    ctx.fillRect(0, 0, w, h * 0.62);
    ctx.fillStyle = "#fff0b5";
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.62, m * 0.17, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = vgrad(ctx, h, [
      [0.62, "#36406b"],
      [1, "#141a33"],
    ]);
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = "rgba(255, 214, 122, 0.65)";
    for (let i = 0; i < 6; i++) {
      const y = h * (0.66 + i * 0.05);
      const half = m * (0.16 - i * 0.022);
      ctx.fillRect(w * 0.5 - half, y, half * 2, Math.max(1, h * 0.012));
    }
  },
  skyline(ctx, w, h, hue) {
    const r = stream(hue * 977 + w);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue % 60) + 220} 55% 16%)`],
      [0.7, `hsl(${(hue % 40) + 280} 45% 40%)`],
      [1, "#f29a6b"],
    ]);
    ctx.fillRect(0, 0, w, h);
    const tower = w * 0.68;
    ctx.fillStyle = "#e8553d";
    ctx.beginPath();
    ctx.moveTo(tower, h * 0.12);
    ctx.lineTo(tower + w * 0.05, h);
    ctx.lineTo(tower - w * 0.05, h);
    ctx.fill();
    ctx.fillStyle = "#f6f1e7";
    ctx.fillRect(tower - w * 0.022, h * 0.45, w * 0.044, h * 0.03);
    ctx.fillRect(tower - w * 0.012, h * 0.3, w * 0.024, h * 0.025);
    let x = 0;
    while (x < w) {
      const bw = w * (0.05 + r() * 0.08);
      const bh = h * (0.18 + r() * 0.42);
      ctx.fillStyle = "#0c1020";
      ctx.fillRect(x, h - bh, bw, bh);
      ctx.fillStyle = "rgba(255, 216, 120, 0.85)";
      for (let wy = h - bh + 4; wy < h - 4; wy += 7)
        for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (r() < 0.35) ctx.fillRect(wx, wy, 2, 3);
      x += bw + 1;
    }
  },
  car(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${hue} 60% 62%)`],
      [1, `hsl(${hue} 55% 48%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.58;
    const L = m * 0.82;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + L * 0.2, L * 0.5, L * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(cx - L / 2, cy - L * 0.08, L, L * 0.22, L * 0.07);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - L * 0.3, cy - L * 0.06);
    ctx.lineTo(cx - L * 0.17, cy - L * 0.24);
    ctx.lineTo(cx + L * 0.16, cy - L * 0.24);
    ctx.lineTo(cx + L * 0.32, cy - L * 0.06);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 40% 26%)`;
    ctx.beginPath();
    ctx.moveTo(cx - L * 0.25, cy - L * 0.07);
    ctx.lineTo(cx - L * 0.15, cy - L * 0.205);
    ctx.lineTo(cx - L * 0.01, cy - L * 0.205);
    ctx.lineTo(cx - L * 0.01, cy - L * 0.07);
    ctx.moveTo(cx + L * 0.02, cy - L * 0.07);
    ctx.lineTo(cx + L * 0.02, cy - L * 0.205);
    ctx.lineTo(cx + L * 0.145, cy - L * 0.205);
    ctx.lineTo(cx + L * 0.26, cy - L * 0.07);
    ctx.fill();
    for (const dx of [-0.3, 0.3]) {
      ctx.fillStyle = "#1c1c20";
      ctx.beginPath();
      ctx.arc(cx + L * dx, cy + L * 0.14, L * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b8bec6";
      ctx.beginPath();
      ctx.arc(cx + L * dx, cy + L * 0.14, L * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  ramen(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue % 30) + 20} 45% 52%)`],
      [1, `hsl(${(hue % 30) + 15} 45% 36%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = m * 0.44;
    ctx.fillStyle = "#b3261e";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e6b267";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f6dd9a";
    ctx.lineWidth = Math.max(1.5, R * 0.035);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      for (let t = -0.62; t <= 0.62; t += 0.04) {
        const x = cx + t * R;
        const y = cy + i * R * 0.11 + Math.sin(t * 18 + i) * R * 0.03;
        if (t === -0.62) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#1f3a26";
    ctx.fillRect(cx + R * 0.35, cy - R * 0.62, R * 0.32, R * 0.5);
    ctx.fillStyle = "#8a5a3b";
    ctx.beginPath();
    ctx.arc(cx - R * 0.35, cy - R * 0.3, R * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fbfaf5";
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.25, cy + R * 0.38, R * 0.2, R * 0.15, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2a516";
    ctx.beginPath();
    ctx.arc(cx + R * 0.25, cy + R * 0.38, R * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fffaf6";
    ctx.beginPath();
    ctx.arc(cx - R * 0.3, cy + R * 0.32, R * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e2558a";
    ctx.lineWidth = Math.max(1, R * 0.025);
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const rr = (a / (Math.PI * 5)) * R * 0.12;
      ctx.lineTo(cx - R * 0.3 + Math.cos(a) * rr, cy + R * 0.32 + Math.sin(a) * rr);
    }
    ctx.stroke();
  },
  flower(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue + 120) % 360} 40% 78%)`],
      [1, `hsl(${(hue + 100) % 360} 35% 62%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = m * 0.3;
    ctx.fillStyle = `hsl(${hue} 70% 72%)`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(a) * R * 0.62,
        cy + Math.sin(a) * R * 0.62,
        R * 0.55,
        R * 0.32,
        a,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = "#f7c948";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2);
    ctx.fill();
  },
  fuji(ctx, w, h) {
    ctx.fillStyle = vgrad(ctx, h, [
      [0, "#6fb6ec"],
      [1, "#dff0fb"],
    ]);
    ctx.fillRect(0, 0, w, h);
    const peak = h * 0.3;
    ctx.fillStyle = "#3d5f93";
    ctx.beginPath();
    ctx.moveTo(w * 0.02, h);
    ctx.lineTo(w * 0.42, peak);
    ctx.lineTo(w * 0.58, peak);
    ctx.lineTo(w * 0.98, h);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(w * 0.42, peak);
    ctx.lineTo(w * 0.58, peak);
    ctx.lineTo(w * 0.66, h * 0.48);
    ctx.lineTo(w * 0.6, h * 0.44);
    ctx.lineTo(w * 0.55, h * 0.5);
    ctx.lineTo(w * 0.5, h * 0.43);
    ctx.lineTo(w * 0.45, h * 0.5);
    ctx.lineTo(w * 0.4, h * 0.44);
    ctx.lineTo(w * 0.34, h * 0.48);
    ctx.fill();
    ctx.fillStyle = "#2f5b3a";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(w * 0.25, h * 0.78, w * 0.5, h * 0.92);
    ctx.quadraticCurveTo(w * 0.75, h * 0.8, w, h * 0.9);
    ctx.lineTo(w, h);
    ctx.fill();
  },
  coffee(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue % 20) + 25} 35% 58%)`],
      [1, `hsl(${(hue % 20) + 22} 38% 44%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = m * 0.4;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.arc(cx + R * 0.05, cy + R * 0.06, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f1ec";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx + R * 0.62, cy - R * 0.14, R * 0.42, R * 0.28, R * 0.12);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.74, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a4522";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f1dfc0";
    const s = R * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.9);
    ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.2, cx, cy - s * 0.45);
    ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.2, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    ctx.fill();
  },
  dog(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${hue} 50% 78%)`],
      [1, `hsl(${(hue + 30) % 360} 45% 62%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `hsl(${(hue + 90) % 360} 30% 45%)`;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    const s = m * 0.6;
    const cx = w * 0.48;
    const base = h * 0.9;
    const coat = "#c9772e";
    const cream = "#f6e7cf";
    // Curled tail behind the back.
    ctx.strokeStyle = coat;
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx + s * 0.25, base - s * 0.5, s * 0.1, Math.PI * 0.9, Math.PI * 2.4);
    ctx.stroke();
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.05, base - s * 0.27, s * 0.24, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cream;
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.05, base - s * 0.25, s * 0.1, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head, ears, the pale muzzle and cheeks.
    const hx = cx - s * 0.04;
    const hy = base - s * 0.66;
    ctx.fillStyle = coat;
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + dx * s * 0.16, hy - s * 0.06);
      ctx.lineTo(hx + dx * s * 0.13, hy - s * 0.27);
      ctx.lineTo(hx + dx * s * 0.02, hy - s * 0.14);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(hx, hy, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cream;
    ctx.beginPath();
    ctx.ellipse(hx, hy + s * 0.07, s * 0.12, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1410";
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + dx * s * 0.07, hy - s * 0.03, s * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(hx, hy + s * 0.04, s * 0.03, s * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  train(ctx, w, h, hue) {
    ctx.fillStyle = vgrad(ctx, h, [
      [0, "#8fc4ec"],
      [1, "#e3f1fb"],
    ]);
    ctx.fillRect(0, 0, w, h);
    const rail = h * 0.78;
    // Viaduct, rails and the poles of the overhead wire.
    ctx.fillStyle = "#9aa3ad";
    ctx.fillRect(0, rail + h * 0.03, w, h * 0.06);
    for (let x = w * 0.08; x < w; x += w * 0.28) ctx.fillRect(x, rail + h * 0.09, w * 0.05, h);
    ctx.fillStyle = "#59616b";
    for (let x = w * 0.04; x < w; x += w * 0.3) ctx.fillRect(x, h * 0.18, w * 0.012, rail - h * 0.18);
    ctx.strokeStyle = "#59616b";
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.24);
    ctx.lineTo(w, h * 0.24);
    ctx.stroke();
    const carW = w * 0.36;
    const carH = h * 0.3;
    for (let i = 0; i < 3; i++) {
      const x = w * 0.02 + i * (carW + w * 0.012);
      const y = rail - carH;
      ctx.fillStyle = "#e9ecef";
      ctx.beginPath();
      ctx.roundRect(x, y, carW, carH, carH * 0.12);
      ctx.fill();
      ctx.fillStyle = `hsl(${hue} 65% 45%)`;
      ctx.fillRect(x, y + carH * 0.68, carW, carH * 0.1);
      ctx.fillStyle = "#3b4a5a";
      for (let k = 0; k < 4; k++)
        ctx.fillRect(x + carW * (0.06 + k * 0.24), y + carH * 0.18, carW * 0.16, carH * 0.32);
      ctx.fillStyle = "#2a2f36";
      for (const dx of [0.15, 0.85]) {
        ctx.beginPath();
        ctx.arc(x + carW * dx, rail + h * 0.005, h * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  bus(ctx, w, h, hue) {
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue + 200) % 360} 40% 80%)`],
      [1, `hsl(${(hue + 200) % 360} 25% 92%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#5c6066";
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
    ctx.fillStyle = "#c8ccd1";
    ctx.fillRect(0, h * 0.78, w, h * 0.03);
    const x = w * 0.08;
    const y = h * 0.28;
    const bw = w * 0.84;
    const bh = h * 0.5;
    ctx.fillStyle = "#f4f4f0";
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, bh * 0.1);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue} 60% 40%)`;
    ctx.fillRect(x, y + bh * 0.62, bw, bh * 0.12);
    ctx.fillStyle = "#33414f";
    for (let k = 0; k < 6; k++)
      ctx.fillRect(x + bw * (0.17 + k * 0.135), y + bh * 0.14, bw * 0.11, bh * 0.36);
    // Front door, the blank destination board, the windscreen.
    ctx.fillRect(x + bw * 0.03, y + bh * 0.14, bw * 0.1, bh * 0.7);
    ctx.fillStyle = "#f1a634";
    ctx.fillRect(x + bw * 0.04, y + bh * 0.03, bw * 0.3, bh * 0.08);
    ctx.fillStyle = "#1f2328";
    for (const dx of [0.17, 0.8]) {
      ctx.beginPath();
      ctx.arc(x + bw * dx, y + bh, bh * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  rainStreet(ctx, w, h, hue) {
    const r = stream(hue * 131 + w);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, "#29323f"],
      [0.55, "#3c4756"],
      [1, "#1d232b"],
    ]);
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.52;
    for (let x = 0; x < w;) {
      const bw = w * (0.08 + r() * 0.1);
      const bh = h * (0.15 + r() * 0.3);
      ctx.fillStyle = "#1a2029";
      ctx.fillRect(x, horizon - bh, bw, bh);
      ctx.fillStyle = "rgba(255, 214, 140, 0.55)";
      for (let wy = horizon - bh + 4; wy < horizon - 3; wy += 7)
        for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (r() < 0.3) ctx.fillRect(wx, wy, 2, 3);
      x += bw + 2;
    }
    // Lights and their long reflections on the wet road.
    const lights = ["#ff4b3e", "#3ee08a", "#ffc061", "#ffc061", "#f4f4f4"];
    for (let i = 0; i < 7; i++) {
      const lx = w * (0.08 + i * 0.13 + (r() - 0.5) * 0.05);
      const ly = horizon - h * (0.05 + r() * 0.12);
      const color = lights[Math.floor(r() * lights.length)];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(2, h * 0.012), 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createLinearGradient(0, horizon, 0, h);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = g;
      ctx.fillRect(lx - w * 0.008, horizon, w * 0.016, h - horizon);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "rgba(200, 215, 235, 0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const x0 = r() * w;
      const y0 = r() * h;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 - h * 0.02, y0 + h * 0.07);
      ctx.stroke();
    }
  },
  nightCity(ctx, w, h, hue) {
    const r = stream(hue * 613 + h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, "#070b1c"],
      [0.65, `hsl(${(hue % 40) + 225} 45% 18%)`],
      [1, "#3b2f4f"],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f6f0d8";
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.2, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 25; i++) ctx.fillRect(r() * w, r() * h * 0.4, 1.2, 1.2);
    for (let x = 0; x < w;) {
      const bw = w * (0.05 + r() * 0.09);
      const bh = h * (0.25 + r() * 0.5);
      ctx.fillStyle = "#0b0f1d";
      ctx.fillRect(x, h - bh, bw, bh);
      ctx.fillStyle = "rgba(255, 220, 140, 0.85)";
      for (let wy = h - bh + 5; wy < h - 4; wy += 7)
        for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (r() < 0.4) ctx.fillRect(wx, wy, 2, 3);
      // Aviation lights on the taller ones.
      if (bh > h * 0.55) {
        ctx.fillStyle = "#ff3b30";
        ctx.fillRect(x + bw / 2 - 1.5, h - bh - 3, 3, 3);
      }
      x += bw + 1;
    }
  },
  river(ctx, w, h, hue) {
    const r = stream(hue * 37 + w);
    ctx.fillStyle = vgrad(ctx, h * 0.5, [
      [0, `hsl(${(hue % 30) + 200} 60% 70%)`],
      [1, "#f3e3c8"],
    ]);
    ctx.fillRect(0, 0, w, h * 0.5);
    for (let x = 0; x < w;) {
      const bw = w * (0.05 + r() * 0.08);
      const bh = h * (0.06 + r() * 0.16);
      ctx.fillStyle = `hsl(215 15% ${45 + r() * 20}%)`;
      ctx.fillRect(x, h * 0.5 - bh, bw, bh);
      x += bw;
    }
    ctx.fillStyle = vgrad(ctx, h, [
      [0.5, "#5b86a8"],
      [1, "#24435e"],
    ]);
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(1, h * 0.006);
    for (let i = 0; i < 18; i++) {
      const y = h * (0.56 + r() * 0.4);
      const x0 = r() * w;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + w * (0.04 + r() * 0.08), y);
      ctx.stroke();
    }
    // An arched bridge across, with its reflection.
    ctx.strokeStyle = `hsl(${hue} 35% 35%)`;
    ctx.lineWidth = h * 0.035;
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, h * 0.47);
    ctx.quadraticCurveTo(w * 0.5, h * 0.3, w * 1.05, h * 0.47);
    ctx.stroke();
    ctx.fillStyle = `hsl(${hue} 30% 30%)`;
    ctx.fillRect(0, h * 0.44, w, h * 0.025);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, h * 0.53);
    ctx.quadraticCurveTo(w * 0.5, h * 0.7, w * 1.05, h * 0.53);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#5f8f4e";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.86);
    ctx.lineTo(w * 0.25, h);
    ctx.fill();
  },
  bento(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${(hue % 40) + 20} 30% 62%)`],
      [1, `hsl(${(hue % 40) + 15} 32% 48%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const bw = m * 1.25;
    const bh = m * 0.78;
    const x = (w - bw) / 2;
    const y = (h - bh) / 2;
    ctx.fillStyle = "#1d1d22";
    ctx.beginPath();
    ctx.roundRect(x - m * 0.03, y - m * 0.03, bw + m * 0.06, bh + m * 0.06, m * 0.06);
    ctx.fill();
    ctx.fillStyle = "#b8272b";
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, m * 0.04);
    ctx.fill();
    // Rice with a pickled plum, and the side dishes.
    ctx.fillStyle = "#fbfaf4";
    ctx.fillRect(x + bw * 0.04, y + bh * 0.06, bw * 0.44, bh * 0.88);
    ctx.fillStyle = "#d1344b";
    ctx.beginPath();
    ctx.arc(x + bw * 0.26, y + bh * 0.5, m * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3d06a";
    ctx.fillRect(x + bw * 0.53, y + bh * 0.08, bw * 0.2, bh * 0.2);
    ctx.fillRect(x + bw * 0.53, y + bh * 0.3, bw * 0.2, bh * 0.2);
    ctx.fillStyle = "#9a5a2c";
    for (const [dx, dy] of [
      [0.85, 0.2],
      [0.88, 0.42],
      [0.62, 0.68],
    ]) {
      ctx.beginPath();
      ctx.arc(x + bw * dx, y + bh * dy, m * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#3f8a3a";
    for (const [dx, dy] of [
      [0.82, 0.74],
      [0.9, 0.8],
      [0.85, 0.86],
    ]) {
      ctx.beginPath();
      ctx.arc(x + bw * dx, y + bh * dy, m * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  snack(ctx, w, h, hue) {
    const m = Math.min(w, h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${hue} 35% 82%)`],
      [1, `hsl(${hue} 30% 68%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const cx = w * 0.42;
    const cy = h * 0.55;
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(cx + m * 0.02, cy + m * 0.04, m * 0.42, m * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f3ea";
    ctx.beginPath();
    ctx.ellipse(cx, cy, m * 0.42, m * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Two pancakes with bean paste between (a generic sweet, no wrapper or brand).
    for (const [dy, color] of [
      [0.02, "#a86a2c"],
      [-0.04, "#5b2a26"],
      [-0.1, "#b97733"],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy + m * dy, m * 0.24, m * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#d9944a";
    ctx.beginPath();
    ctx.ellipse(cx - m * 0.04, cy - m * 0.13, m * 0.12, m * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    // A cup of green tea beside it.
    const tx = w * 0.78;
    const ty = h * 0.5;
    ctx.fillStyle = "#e8e2d6";
    ctx.beginPath();
    ctx.roundRect(tx - m * 0.1, ty - m * 0.12, m * 0.2, m * 0.24, m * 0.04);
    ctx.fill();
    ctx.fillStyle = "#93b450";
    ctx.beginPath();
    ctx.ellipse(tx, ty - m * 0.11, m * 0.085, m * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  park(ctx, w, h, hue) {
    const r = stream(hue * 71 + w);
    ctx.fillStyle = vgrad(ctx, h * 0.6, [
      [0, "#7cc0ee"],
      [1, "#d8eefa"],
    ]);
    ctx.fillRect(0, 0, w, h * 0.6);
    ctx.fillStyle = vgrad(ctx, h, [
      [0.6, "#7fbf5a"],
      [1, "#4f9a3c"],
    ]);
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    ctx.fillStyle = "#e4d3a8";
    ctx.beginPath();
    ctx.moveTo(w * 0.42, h * 0.6);
    ctx.quadraticCurveTo(w * 0.3, h * 0.8, w * 0.55, h);
    ctx.lineTo(w * 0.8, h);
    ctx.quadraticCurveTo(w * 0.52, h * 0.8, w * 0.5, h * 0.6);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const x = w * (0.05 + i * 0.18 + (r() - 0.5) * 0.06);
      const top = h * (0.18 + r() * 0.15);
      const crown = h * (0.14 + r() * 0.06);
      ctx.fillStyle = "#6b4a2f";
      ctx.fillRect(x - w * 0.008, top + crown, w * 0.016, h * 0.62 - top - crown + h * 0.04);
      ctx.fillStyle = `hsl(${105 + r() * 30} 45% ${32 + r() * 12}%)`;
      ctx.beginPath();
      ctx.arc(x, top + crown * 0.6, crown, 0, Math.PI * 2);
      ctx.arc(x - crown * 0.6, top + crown, crown * 0.75, 0, Math.PI * 2);
      ctx.arc(x + crown * 0.6, top + crown, crown * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    // A bench.
    ctx.fillStyle = "#8a5a35";
    ctx.fillRect(w * 0.12, h * 0.74, w * 0.18, h * 0.025);
    ctx.fillRect(w * 0.12, h * 0.69, w * 0.18, h * 0.02);
    ctx.fillStyle = "#333";
    ctx.fillRect(w * 0.13, h * 0.765, w * 0.01, h * 0.05);
    ctx.fillRect(w * 0.28, h * 0.765, w * 0.01, h * 0.05);
  },
  clouds(ctx, w, h, hue) {
    const r = stream(hue * 997 + h);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, `hsl(${205 + (hue % 15)} 70% 52%)`],
      [1, `hsl(${200 + (hue % 15)} 70% 82%)`],
    ]);
    ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h);
    for (let i = 0; i < 5; i++) {
      const cx = w * (0.1 + r() * 0.8);
      const cy = h * (0.2 + r() * 0.6);
      const size = m * (0.08 + r() * 0.1);
      for (let k = 0; k < 6; k++) {
        const dx = (k - 2.5) * size * 0.55;
        const dy = -Math.sin((k / 5) * Math.PI) * size * 0.55;
        ctx.fillStyle = k % 2 === 0 ? "rgba(255,255,255,0.95)" : "rgba(244,247,252,0.95)";
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, size * (0.55 + Math.sin((k / 5) * Math.PI) * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(205,214,228,0.9)";
      ctx.fillRect(cx - size * 1.6, cy + size * 0.2, size * 3.2, size * 0.25);
    }
  },
  crossing(ctx, w, h, hue) {
    const r = stream(hue * 53 + w);
    // From above: asphalt, the stripes, the stop line and people's shadows crossing.
    ctx.fillStyle = "#4d5157";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 300; i++) ctx.fillRect(r() * w, r() * h, 2, 2);
    ctx.fillStyle = "#f2f2ee";
    const stripe = w * 0.045;
    for (let x = w * 0.06; x < w * 0.95; x += stripe * 2) ctx.fillRect(x, h * 0.3, stripe, h * 0.4);
    ctx.fillRect(0, h * 0.82, w, h * 0.025);
    for (let i = 0; i < 4; i++) {
      const x = w * (0.15 + r() * 0.7);
      const y = h * (0.35 + r() * 0.3);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(x + h * 0.03, y + h * 0.05, h * 0.025, h * 0.07, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${Math.floor(r() * 360)} 40% 35%)`;
      ctx.beginPath();
      ctx.arc(x, y, h * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  umbrella(ctx, w, h, hue) {
    const r = stream(hue * 29 + h);
    ctx.fillStyle = "#3a3f46";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(240,240,236,0.75)";
    const stripe = w * 0.05;
    for (let x = w * 0.04; x < w; x += stripe * 2) ctx.fillRect(x, h * 0.25, stripe, h * 0.5);
    // Umbrellas from above: panels in two shades round a tip.
    const m = Math.min(w, h);
    for (let i = 0; i < 7; i++) {
      const x = w * (0.08 + r() * 0.84);
      const y = h * (0.15 + r() * 0.7);
      const R = m * (0.1 + r() * 0.05);
      const base = (hue + i * 47) % 360;
      const clear = r() < 0.25;
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2;
        ctx.fillStyle = clear
          ? `rgba(230,236,240,${k % 2 ? 0.45 : 0.6})`
          : `hsl(${base} 60% ${k % 2 ? 42 : 52}%)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, R, a0, a0 + Math.PI / 4);
        ctx.fill();
      }
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(x, y, R * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(210,225,240,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x0 = r() * w;
      const y0 = r() * h;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 - h * 0.015, y0 + h * 0.06);
      ctx.stroke();
    }
  },
  leaves(ctx, w, h, hue) {
    const r = stream(hue * 401 + w);
    ctx.fillStyle = vgrad(ctx, h, [
      [0, "#f3dcc0"],
      [1, "#c9a27a"],
    ]);
    ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h);
    const colors = ["#c8321e", "#e0611f", "#e9a21b", "#b8231f", "#f2c12e"];
    for (let i = 0; i < 16; i++) {
      const x = r() * w;
      const y = r() * h;
      const s = m * (0.06 + r() * 0.06);
      const turn = r() * Math.PI * 2;
      ctx.fillStyle = colors[Math.floor(r() * colors.length)];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(turn);
      // A maple leaf: five pointed lobes round the stalk.
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const rr = k % 2 === 0 ? s : s * 0.45;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(90,40,20,0.6)";
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, s * 1.1);
      ctx.stroke();
      ctx.restore();
    }
  },
};
