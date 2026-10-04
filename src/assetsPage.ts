import {
  AmbientLight,
  Box3,
  DirectionalLight,
  GridHelper,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  MeshBasicMaterial,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * アセット管理: every Blender model and generated texture with a preview, and a review in the
 * style of crit — mark each asset OK or 要修正, pin notes on the image or the model, and send the
 * review to Claude. The dev server writes it to .review/pending/ and the asset-review skill
 * applies the changes through each asset's generator script.
 */
type Kind = "model" | "texture";
type Asset = {
  id: string;
  kind: Kind;
  category: string;
  name: string;
  url: string;
  generators: string[];
};
type Pin = {
  n: number;
  note: string;
  u?: number;
  v?: number;
  object?: string;
  point?: [number, number, number];
};
type Review = { verdict: "ok" | "changes" | null; comment: string; pins: Pin[]; snapshot?: string };
type Response = { asset: string; at: string; summary: string };

const TEXTURES = import.meta.glob<string>("../assets/*/textures/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const READMES = import.meta.glob<string>("../assets/*/textures/README.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Which scripts make each family of assets (the review hands them to Claude).
const FAMILIES: Record<string, { label: string; model?: string; blender?: string; textures?: string }> = {
  car: {
    label: "自車・タクシー",
    model: "car.glb",
    blender: "scripts/blender/car.py",
    textures: "scripts/textures/car_textures.py",
  },
  signs: {
    label: "道路標識",
    model: "signs.glb",
    blender: "scripts/blender/signs.py",
    textures: "scripts/textures/sign_textures.py",
  },
  human: {
    label: "歩行者",
    model: "human.glb",
    blender: "scripts/blender/human.py",
    textures: "scripts/textures/human_textures.py",
  },
  signals: {
    label: "信号機",
    model: "signals.glb",
    blender: "scripts/blender/signals.py",
    textures: "scripts/textures/signal_textures.py",
  },
  ambulance: {
    label: "救急車",
    model: "ambulance.glb",
    blender: "scripts/blender/ambulance.py",
    textures: "scripts/textures/ambulance_textures.py",
  },
  buildings: { label: "建物の外壁", textures: "scripts/textures/building_textures.py" },
};

const base = import.meta.env.BASE_URL;
const assets: Asset[] = [];
for (const [key, fam] of Object.entries(FAMILIES)) {
  if (fam.model) {
    assets.push({
      id: `models/${fam.model}`,
      kind: "model",
      category: key,
      name: fam.model,
      url: `${base}models/${fam.model}`,
      generators: [fam.blender, fam.textures].filter(Boolean) as string[],
    });
  }
}
for (const [path, url] of Object.entries(TEXTURES).sort()) {
  const [, category, , file] = path.replace("../assets/", "").match(/^([^/]+)\/(textures)\/(.+)$/) ?? [];
  if (!category) continue;
  const fam = FAMILIES[category];
  assets.push({
    id: `assets/${category}/textures/${file}`,
    kind: "texture",
    category,
    name: file,
    url,
    generators: fam?.textures ? [fam.textures] : [],
  });
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const DRAFT_KEY = "tokyo-od-game:asset-review";
const reviews = new Map<string, Review>();
try {
  const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, Review>;
  for (const [k, v] of Object.entries(saved)) reviews.set(k, v);
} catch {
  // A private window or blocked storage: start with an empty draft.
}
const saveDraft = () => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(reviews)));
  } catch {
    // Drafts are a convenience only.
  }
  refreshSummary();
};
const reviewOf = (id: string): Review => {
  let r = reviews.get(id);
  if (!r) {
    r = { verdict: null, comment: "", pins: [] };
    reviews.set(id, r);
  }
  return r;
};
const isDev = import.meta.env.DEV;
// The dev server only takes reviews that carry the token it put in this page.
const reviewToken = document.querySelector<HTMLMetaElement>('meta[name="asset-review-token"]')?.content ?? "";
const reviewHeaders = { "X-Asset-Review-Token": reviewToken };
let responses: Response[] = [];

// ---------------------------------------------------------------- list

function renderList(activeId: string | null): void {
  const nav = $("#list");
  nav.replaceChildren();
  for (const [key, fam] of Object.entries(FAMILIES)) {
    const items = assets.filter((a) => a.category === key);
    if (!items.length) continue;
    const h = document.createElement("h2");
    h.textContent = fam.label;
    nav.append(h);
    for (const a of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `item${a.id === activeId ? " active" : ""}`;
      if (a.kind === "texture") {
        const img = document.createElement("img");
        img.src = a.url;
        img.loading = "lazy";
        img.alt = "";
        b.append(img);
      } else {
        const g = document.createElement("span");
        g.className = "glyph";
        g.textContent = "▣";
        b.append(g);
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = a.name;
      b.append(name);
      const r = reviews.get(a.id);
      const answered = responses.some((x) => x.asset === a.id);
      if (r?.verdict || answered) {
        const badge = document.createElement("span");
        badge.className = `badge ${answered && !r?.verdict ? "done" : r?.verdict === "ok" ? "ok" : "ng"}`;
        badge.textContent = answered && !r?.verdict ? "対応済" : r?.verdict === "ok" ? "OK" : "要修正";
        b.append(badge);
      }
      b.addEventListener("click", () => select(a.id));
      nav.append(b);
    }
  }
}

function refreshSummary(): void {
  const models = assets.filter((a) => a.kind === "model").length;
  $("#summary").textContent = `モデル ${models}・テクスチャ ${assets.length - models}`;
  const marked = [...reviews.values()].filter((r) => r.verdict || r.comment || r.pins.length).length;
  const changes = [...reviews.values()].filter((r) => r.verdict === "changes").length;
  $("#review-state").textContent = isDev
    ? `レビュー ${marked} 件（要修正 ${changes}）`
    : "レビューの送信は開発サーバーでのみ";
  ($("#submit") as HTMLButtonElement).disabled = !isDev || marked === 0;
}

// ---------------------------------------------------------------- 3D viewer

class ModelView {
  readonly canvas = document.createElement("canvas");
  private readonly renderer = new WebGLRenderer({
    canvas: this.canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.01, 500);
  private readonly controls = new OrbitControls(this.camera, this.canvas);
  private readonly loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${base}draco/`),
  );
  private readonly markers: Mesh[] = [];
  root: Object3D | null = null;
  private wire = false;
  get isWire(): boolean {
    return this.wire;
  }

  constructor() {
    this.canvas.className = "view";
    this.renderer.outputColorSpace = SRGBColorSpace;
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);
    this.scene.add(new GridHelper(20, 40, 0x888888, 0x444444));
    const loop = () => {
      this.resize();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async load(url: string): Promise<void> {
    if (this.root) this.scene.remove(this.root);
    for (const m of this.markers) this.scene.remove(m);
    this.markers.length = 0;
    const gltf = await this.loader.loadAsync(url);
    this.root = gltf.scene;
    this.scene.add(this.root);
    const box = new Box3().setFromObject(this.root);
    const size = box.getSize(new Vector3()).length();
    const centre = box.getCenter(new Vector3());
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).add(new Vector3(0.8, 0.5, 1).normalize().multiplyScalar(size * 1.1));
    this.camera.near = size / 200;
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    this.setWire(this.wire);
  }

  setWire(on: boolean): void {
    this.wire = on;
    this.root?.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Material[]) {
        (m as MeshStandardMaterial).wireframe = on;
      }
    });
  }

  /** Part under a click: name and point, for a pin. */
  pick(e: MouseEvent): { object: string; point: [number, number, number] } | null {
    if (!this.root) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.root, true).find((h) => h.object.visible);
    if (!hit) return null;
    let o: Object3D | null = hit.object;
    while (o && !o.name && o.parent) o = o.parent;
    const p = hit.point;
    return { object: o?.name || hit.object.name || "?", point: [round(p.x), round(p.y), round(p.z)] };
  }

  showPins(pins: Pin[]): void {
    for (const m of this.markers) this.scene.remove(m);
    this.markers.length = 0;
    const size = this.root ? new Box3().setFromObject(this.root).getSize(new Vector3()).length() : 1;
    for (const pin of pins) {
      if (!pin.point) continue;
      const m = new Mesh(
        new SphereGeometry(size * 0.012, 12, 8),
        new MeshBasicMaterial({ color: 0xff3b2f, depthTest: false }),
      );
      m.position.set(...pin.point);
      m.renderOrder = 10;
      this.scene.add(m);
      this.markers.push(m);
    }
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/jpeg", 0.85);
  }

  /** Objects with their triangle counts, for the parts list. */
  parts(): Array<{ object: Object3D; tris: number }> {
    const out: Array<{ object: Object3D; tris: number }> = [];
    for (const child of this.root?.children ?? []) {
      let tris = 0;
      child.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      out.push({ object: child, tris });
    }
    return out;
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
let viewer: ModelView | null = null;
let current: Asset | null = null;

// ---------------------------------------------------------------- stage and detail

async function select(id: string): Promise<void> {
  const a = assets.find((x) => x.id === id);
  if (!a) return;
  current = a;
  location.hash = encodeURIComponent(id);
  renderList(id);
  const stage = $("#stage");
  stage.replaceChildren();
  const review = reviewOf(a.id);
  const info: Array<[string, string]> = [
    ["種類", a.kind === "model" ? "3D モデル（glb）" : "テクスチャ（PNG）"],
    ["パス", a.kind === "model" ? `public/${a.id}` : a.id],
    ["生成", a.generators.join("\n") || "—"],
  ];
  const size = await fetch(a.url)
    .then((r) => r.blob())
    .then((b) => b.size)
    .catch(() => 0);
  info.push(["サイズ", `${(size / 1024).toFixed(1)} KB`]);

  if (a.kind === "model") {
    viewer ??= new ModelView();
    stage.append(viewer.canvas);
    const bar = toolbar([
      ["ワイヤーフレーム", () => viewer?.setWire(!viewer.isWire)],
      ["視点を戻す", () => void viewer?.load(a.url)],
    ]);
    stage.append(bar, hint("ドラッグで回転・ホイールで拡大。Shift+クリックで部品に指摘ピンを置く"));
    await viewer.load(a.url);
    viewer.showPins(review.pins);
    viewer.canvas.onclick = (e) => {
      if (!e.shiftKey || !viewer) return;
      const hit = viewer.pick(e);
      if (!hit) return;
      review.pins.push({ n: review.pins.length + 1, note: "", ...hit });
      review.verdict ??= "changes";
      review.snapshot = viewer.snapshot();
      viewer.showPins(review.pins);
      saveDraft();
      renderDetail(a, info);
    };
    const parts = viewer.parts();
    info.push(["三角形", parts.reduce((n, p) => n + p.tris, 0).toLocaleString()]);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "image";
    const frame = document.createElement("div");
    frame.className = "frame";
    const img = document.createElement("img");
    img.src = a.url;
    img.alt = a.name;
    frame.append(img);
    wrap.append(frame);
    stage.append(wrap, hint("クリックで画像に指摘ピンを置く"));
    await img.decode().catch(() => undefined);
    info.push(["寸法", `${img.naturalWidth} × ${img.naturalHeight}`]);
    const drawPins = () => {
      for (const p of frame.querySelectorAll(".pin")) p.remove();
      for (const pin of review.pins) {
        if (pin.u === undefined || pin.v === undefined) continue;
        const dot = document.createElement("div");
        dot.className = "pin";
        dot.textContent = String(pin.n);
        dot.style.left = `${pin.u * 100}%`;
        dot.style.top = `${pin.v * 100}%`;
        frame.append(dot);
      }
    };
    drawPins();
    img.onclick = (e) => {
      const r = img.getBoundingClientRect();
      review.pins.push({
        n: review.pins.length + 1,
        note: "",
        u: round((e.clientX - r.left) / r.width),
        v: round((e.clientY - r.top) / r.height),
      });
      review.verdict ??= "changes";
      saveDraft();
      drawPins();
      renderDetail(a, info);
    };
  }
  renderDetail(a, info);
}

function renderDetail(a: Asset, info: Array<[string, string]>): void {
  const aside = $("#detail");
  aside.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = a.name;
  const dl = document.createElement("dl");
  for (const [k, v] of info) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  aside.append(h, dl);

  if (a.kind === "model" && viewer) {
    const parts = document.createElement("div");
    parts.className = "parts";
    for (const { object, tris } of viewer.parts()) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = object.visible;
      cb.onchange = () => (object.visible = cb.checked);
      label.append(cb, `${object.name || "(名前なし)"} — ${Math.round(tris).toLocaleString()} 三角形`);
      parts.append(label);
    }
    aside.append(parts);
  }

  const review = reviewOf(a.id);
  const verdict = document.createElement("div");
  verdict.className = "verdict";
  for (const [value, text, cls] of [
    ["ok", "OK", "ok"],
    ["changes", "要修正", "ng"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.className = `${cls}${review.verdict === value ? " on" : ""}`;
    b.onclick = () => {
      review.verdict = review.verdict === value ? null : value;
      saveDraft();
      renderList(a.id);
      renderDetail(a, info);
    };
    verdict.append(b);
  }
  const comment = document.createElement("textarea");
  comment.placeholder = "修正の指示（例：救急車の赤帯をもう少し太く、窓の位置を下げる）";
  comment.value = review.comment;
  comment.oninput = () => {
    review.comment = comment.value;
    if (review.comment && !review.verdict) review.verdict = "changes";
    saveDraft();
  };
  aside.append(verdict, comment);

  if (review.pins.length) {
    const ol = document.createElement("ol");
    ol.className = "pins";
    for (const pin of review.pins) {
      const li = document.createElement("li");
      const input = document.createElement("input");
      input.value = pin.note;
      input.placeholder = pin.object ? `${pin.object} への指摘` : "この位置への指摘";
      input.oninput = () => {
        pin.note = input.value;
        saveDraft();
      };
      li.append(input);
      ol.append(li);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "ピンを消す";
    clear.onclick = () => {
      review.pins = [];
      review.snapshot = undefined;
      saveDraft();
      void select(a.id);
    };
    aside.append(ol, clear);
  }

  for (const r of responses.filter((x) => x.asset === a.id).slice(-3)) {
    const div = document.createElement("div");
    div.className = "response";
    div.textContent = `Claude（${r.at.slice(0, 16).replace("T", " ")}）: ${r.summary}`;
    aside.append(div);
  }

  const readme = READMES[`../assets/${a.category}/textures/README.md`];
  if (readme) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "テクスチャの README";
    const pre = document.createElement("pre");
    pre.textContent = readme;
    d.append(s, pre);
    aside.append(d);
  }
}

function toolbar(buttons: Array<[string, () => void]>): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "toolbar";
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = fn;
    bar.append(b);
  }
  return bar;
}

function hint(text: string): HTMLElement {
  const p = document.createElement("div");
  p.className = "hint";
  p.textContent = text;
  return p;
}

// ---------------------------------------------------------------- submit

$("#submit").addEventListener("click", async () => {
  const items = assets
    .map((a) => ({ a, r: reviews.get(a.id) }))
    .filter(({ r }) => r && (r.verdict || r.comment || r.pins.length))
    .map(({ a, r }) => ({
      asset: a.id,
      kind: a.kind,
      generators: a.generators,
      verdict: r?.verdict ?? "changes",
      comment: r?.comment ?? "",
      pins: r?.pins ?? [],
      snapshot: r?.snapshot,
    }));
  if (!items.length) return;
  const button = $("#submit") as HTMLButtonElement;
  button.disabled = true;
  const res = await fetch(`${base}__asset-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...reviewHeaders },
    body: JSON.stringify({ submittedAt: new Date().toISOString(), items }),
  }).catch(() => null);
  if (!res?.ok) {
    $("#review-state").textContent = "送信できませんでした（開発サーバーで開いてください）";
    button.disabled = false;
    return;
  }
  const { file } = (await res.json()) as { file: string };
  reviews.clear();
  saveDraft();
  $("#review-state").textContent = `送信しました: ${file}（Claude が対応します）`;
  renderList(current?.id ?? null);
});

async function loadResponses(): Promise<void> {
  if (!isDev) return;
  responses = await fetch(`${base}__asset-review/responses`, { headers: reviewHeaders })
    .then((r) => (r.ok ? (r.json() as Promise<Response[]>) : []))
    .catch(() => []);
}

await loadResponses();
refreshSummary();
const first = decodeURIComponent(location.hash.slice(1)) || assets[0]?.id;
renderList(first ?? null);
if (first) void select(first);
setInterval(() => {
  void loadResponses().then(() => {
    renderList(current?.id ?? null);
  });
}, 15_000);
