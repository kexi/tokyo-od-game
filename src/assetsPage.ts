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
import manifestJson from "../assets/manifest.yml";
import type { AssetKind, Maker, ResolvedAssetEntry, ResolvedAssetManifest } from "./data/assetManifest";
import { REPO_URL } from "./game/credits";

/**
 * アセット管理: every asset in the register (assets/manifest.yml), grouped by kind, with its name,
 * purpose, generator, origin and licence. Models and textures also get a preview and a review in
 * the style of crit — mark each file OK or 要修正, pin notes on the image or the model, and send
 * the review to Claude. The dev server writes it to .review/pending/ and the asset-review skill
 * applies the changes through each asset's generator script.
 */
type View = "model" | "image";
type FileItem = {
  /** Review id, the form the dev server checks: models/<f>.glb, assets/<set>/textures/<f>, … */
  id: string;
  path: string;
  name: string;
  url: string | null;
  view: View | null;
  entry: ResolvedAssetEntry;
  generators: string[];
  isReviewable: boolean;
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

// The plugin parsed and schema-checked it at build time, so the page only needs the type.
const manifest = manifestJson as ResolvedAssetManifest;

const KIND_LABEL: Record<AssetKind, string> = {
  model: "3D モデル",
  texture: "テクスチャ",
  image: "画像",
  data: "データ",
  font: "フォント",
  audio: "音声",
};
const KINDS = Object.keys(KIND_LABEL) as AssetKind[];
const MAKER_LABEL: Record<Maker, string> = {
  "blender-cli": "Blender CLI（bpy）",
  procedural: "手続き生成（Claude Code）",
  agy: "手続き生成（agy）",
  external: "外部の配布物",
  unknown: "記録なし",
};

const TEXTURES = import.meta.glob<string>("../assets/*/textures/*.{png,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});
const READMES = import.meta.glob<string>("../assets/*/textures/README.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const base = import.meta.env.BASE_URL;
// What the dev server's review endpoint accepts (vite.config.ts assetReview).
const REVIEWABLE = /^(models\/[^/]+\.glb|assets\/[^/]+\/textures\/[^/]+\.(png|jpg))$/;
const REVIEW_SCRIPT = /^scripts\/(blender|textures)\/[^/]+\.py$/;

const entries = manifest.assets;
const entryById = new Map(entries.map((e) => [e.id, e]));

/** Where the page fetches a file: the served copy for public/, Vite's URL for assets/. */
function urlOf(path: string): string | null {
  if (path.startsWith("public/")) return `${base}${path.slice("public/".length)}`;
  return TEXTURES[`../${path}`] ?? null;
}

function viewOf(path: string, url: string | null): View | null {
  if (!url) return null;
  if (path.endsWith(".glb")) return "model";
  return /\.(png|jpe?g|webp)$/.test(path) ? "image" : null;
}

/** Scripts a review hands to Claude: the entry's own and those of the texture sets it is built from. */
function generatorsOf(entry: ResolvedAssetEntry): string[] {
  const own = entry.generator?.scripts ?? [];
  const fromTextures = (entry.inputs ?? [])
    .map((id) => entryById.get(id))
    .filter((e) => e?.kind === "texture")
    .flatMap((e) => e?.generator?.scripts ?? []);
  return [...new Set([...own, ...fromTextures])].filter((s) => REVIEW_SCRIPT.test(s));
}

const files: FileItem[] = entries.flatMap((entry) => {
  const generators = generatorsOf(entry);
  return entry.paths.map((path) => {
    const url = urlOf(path);
    // public/ files are served from the site root, so their ids drop the folder (models/car.glb).
    const id = path.startsWith("public/") ? path.slice("public/".length) : path;
    return {
      id,
      path,
      name: path.split("/").pop() ?? path,
      url,
      view: viewOf(path, url),
      entry,
      generators,
      isReviewable: url !== null && REVIEWABLE.test(id),
    };
  });
});
const fileById = new Map(files.map((f) => [f.id, f]));
const filesOf = (entry: ResolvedAssetEntry) => files.filter((f) => f.entry === entry);
/** Entries built from this one (the models a texture set goes into). */
const builtInto = (entry: ResolvedAssetEntry) => entries.filter((e) => e.inputs?.includes(entry.id));

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

// ---------------------------------------------------------------- small DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A repo path opens on GitHub, a URL as is. */
function link(target: string, label = target): HTMLAnchorElement {
  const a = el("a", "", label);
  a.href = /^https?:\/\//.test(target) ? target : `${REPO_URL}/blob/main/${target}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function lines(nodes: Array<Node | string>): HTMLElement {
  const box = el("div", "lines");
  for (const n of nodes) {
    const row = el("div");
    row.append(n);
    box.append(row);
  }
  return box;
}

function entryButton(id: string): HTMLElement {
  const e = entryById.get(id);
  const b = el("button", "linklike", e?.name ?? id);
  b.type = "button";
  b.addEventListener("click", () => selectEntry(id));
  return b;
}

// ---------------------------------------------------------------- list

let filter = "";
// Small entries (a model and its far LOD) start open; texture sets open on demand.
const openEntries = new Set(entries.filter((e) => e.paths.length <= 3).map((e) => e.id));
let current: FileItem | null = null;
let currentEntry: ResolvedAssetEntry | null = null;

/** Files of an entry the filter keeps (all when the entry itself matches), or null to hide it. */
function visibleFiles(entry: ResolvedAssetEntry): FileItem[] | null {
  const previewable = filesOf(entry).filter((f) => f.view);
  if (!filter) return previewable;
  const text = [entry.id, entry.name, entry.purpose, entry.notes ?? "", entry.source].join(" ");
  const isEntryMatch = text.toLowerCase().includes(filter);
  if (isEntryMatch) return previewable;
  const hits = filesOf(entry).filter((f) => f.path.toLowerCase().includes(filter));
  return hits.length ? hits.filter((f) => f.view) : null;
}

function renderList(): void {
  const list = $("#list");
  list.replaceChildren();
  const isFiltering = filter !== "";
  for (const kind of KINDS) {
    const group = entries.filter((e) => e.kind === kind);
    const shown = group
      .map((entry) => ({ entry, items: visibleFiles(entry) }))
      .filter((x): x is { entry: ResolvedAssetEntry; items: FileItem[] } => x.items !== null);
    if (!shown.length) continue;
    list.append(el("h2", "", `${KIND_LABEL[kind]}（${group.length}）`));
    for (const { entry, items } of shown) list.append(entryNode(entry, items, isFiltering));
  }
  if (!list.childElementCount) list.append(el("p", "empty", "一致するアセットはありません"));
}

function entryNode(entry: ResolvedAssetEntry, items: FileItem[], isFiltering: boolean): HTMLElement {
  const d = el("details", "entry");
  d.open = isFiltering || openEntries.has(entry.id);
  d.addEventListener("toggle", () => {
    if (isFiltering) return;
    if (d.open) openEntries.add(entry.id);
    else openEntries.delete(entry.id);
  });
  const s = el("summary");
  s.title = entry.purpose;
  s.append(el("span", "title", entry.name));
  if (entry.status === "unused") s.append(el("span", "badge unused", "未使用"));
  const flagged = filesOf(entry).filter((f) => reviews.get(f.id)?.verdict === "changes").length;
  if (flagged) s.append(el("span", "badge ng", `要修正 ${flagged}`));
  s.append(el("span", "count", String(entry.paths.length)));
  d.append(s);

  // A single previewable file shows the entry card itself, so it needs no overview row.
  const hasOwnOverview = filesOf(entry).filter((f) => f.view).length !== 1;
  if (hasOwnOverview) {
    const overview = el("button", `item overview${currentEntry === entry ? " active" : ""}`);
    overview.type = "button";
    overview.append(el("span", "glyph", "≡"), el("span", "name", "概要・出典・ライセンス"));
    overview.addEventListener("click", () => selectEntry(entry.id));
    d.append(overview);
  }
  for (const f of items) d.append(fileButton(f));
  return d;
}

function fileButton(f: FileItem): HTMLElement {
  const b = el("button", `item${f.id === current?.id ? " active" : ""}`);
  b.type = "button";
  b.dataset.id = f.id;
  if (f.view === "image" && f.url) {
    const img = el("img");
    img.src = f.url;
    img.loading = "lazy";
    img.alt = "";
    b.append(img);
  } else {
    b.append(el("span", "glyph", "▣"));
  }
  b.append(el("span", "name", f.name));
  const r = reviews.get(f.id);
  const answered = responses.some((x) => x.asset === f.id);
  if (r?.verdict || answered) {
    const isDone = answered && !r?.verdict;
    const cls = isDone ? "done" : r?.verdict === "ok" ? "ok" : "ng";
    b.append(el("span", `badge ${cls}`, isDone ? "対応済" : r?.verdict === "ok" ? "OK" : "要修正"));
  }
  b.addEventListener("click", () => void select(f.id));
  return b;
}

function scrollActiveIntoView(): void {
  $("#list").querySelector(".item.active")?.scrollIntoView({ block: "nearest" });
}

function refreshSummary(): void {
  const counts = KINDS.map((k) => `${KIND_LABEL[k]} ${entries.filter((e) => e.kind === k).length}`);
  const unused = entries.filter((e) => e.status === "unused").length;
  $("#summary").textContent =
    `台帳 ${entries.length} 件（${counts.join("・")}）・ファイル ${files.length}・未使用 ${unused}`;
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

// ---------------------------------------------------------------- entry card (the register)

/** Name, purpose and register fields of an entry, at the top of the detail column. */
function entryCard(entry: ResolvedAssetEntry): HTMLElement {
  const card = el("section", "entry-card");
  const kicker = el("div", "kicker", `${KIND_LABEL[entry.kind]} · ${entry.id}`);
  if (entry.status === "unused") kicker.append(el("span", "badge unused", "未使用"));
  card.append(kicker, el("h3", "", entry.name), el("p", "purpose", entry.purpose));

  const rows: Array<[string, Node | string]> = [
    ["作成", entry.made_by.map((m) => MAKER_LABEL[m]).join("・")],
  ];
  const gen = entry.generator;
  if (gen) {
    const recipe = gen.recipe ? [el("code", "", `just ${gen.recipe}`)] : [];
    rows.push(["生成", lines([...recipe, ...gen.scripts.map((s) => link(s))])]);
  }
  rows.push(["出典", entry.source]);
  rows.push([
    "ライセンス",
    lines(
      entry.license.map((key) => {
        const lic = manifest.licenses[key];
        return lic ? link(lic.url, lic.name) : key;
      }),
    ),
  ]);
  const unloaded =
    entry.status === "unused" ? "—（ゲームはまだ読み込んでいない）" : "—（ほかのアセットに組み込む）";
  rows.push(["読み込み", entry.used_by.length ? lines(entry.used_by.map((u) => link(u))) : unloaded]);
  if (entry.inputs?.length) rows.push(["材料", lines(entry.inputs.map(entryButton))]);
  const into = builtInto(entry);
  if (into.length) rows.push(["組み込み先", lines(into.map((e) => entryButton(e.id)))]);
  if (entry.remote) {
    const hash = entry.remote.sha256 ? [el("code", "", `sha256 ${entry.remote.sha256.slice(0, 16)}…`)] : [];
    rows.push(["取得元", lines([link(entry.remote.url, new URL(entry.remote.url).host), ...hash])]);
  }
  if (entry.docs?.length) rows.push(["資料", lines(entry.docs.map((d) => link(d, docLabel(d))))]);
  if (entry.notes) rows.push(["備考", entry.notes]);
  card.append(infoList(rows));
  return card;
}

/** knowledge/x.md → x.md; a texture README keeps its set (car/textures/README.md). */
function docLabel(path: string): string {
  const isReadme = path.endsWith("/README.md");
  return isReadme ? path.replace(/^assets\//, "") : (path.split("/").pop() ?? path);
}

function infoList(rows: Array<[string, Node | string]>): HTMLElement {
  const dl = el("dl");
  for (const [k, v] of rows) {
    const dd = el("dd");
    dd.append(v);
    dl.append(el("dt", "", k), dd);
  }
  return dl;
}

/** Texture READMEs listed in the entry's docs, inline. */
function appendReadmes(aside: HTMLElement, entry: ResolvedAssetEntry): void {
  for (const doc of entry.docs ?? []) {
    const readme = READMES[`../${doc}`];
    if (!readme) continue;
    const d = el("details");
    const pre = el("pre");
    pre.textContent = readme;
    d.append(el("summary", "", `${doc.split("/").slice(-3, -1).join("/")} の README`), pre);
    aside.append(d);
  }
}

// ---------------------------------------------------------------- entry overview

function selectEntry(id: string): void {
  const entry = entryById.get(id);
  if (!entry) return;
  current = null;
  currentEntry = entry;
  openEntries.add(entry.id);
  location.hash = `entry:${encodeURIComponent(id)}`;
  renderList();
  scrollActiveIntoView();

  const wrap = el("div", "overview");
  wrap.append(
    el("div", "kicker", `${KIND_LABEL[entry.kind]} · ${entry.paths.length} ファイル`),
    el("h2", "", entry.name),
    el("p", "purpose", entry.purpose),
  );
  if (entry.remote) {
    const p = el("p", "remote", "リポジトリには置かず、次から取得する: ");
    p.append(link(entry.remote.url));
    wrap.append(p);
  }
  const tiles = el("div", "tiles");
  for (const f of filesOf(entry)) tiles.append(tile(f));
  wrap.append(tiles);
  $("#stage").replaceChildren(wrap);

  const aside = $("#detail");
  aside.replaceChildren(entryCard(entry));
  appendReadmes(aside, entry);
}

function tile(f: FileItem): HTMLElement {
  const t = el(f.view ? "button" : "div", "tile");
  if (t instanceof HTMLButtonElement) {
    t.type = "button";
    t.addEventListener("click", () => void select(f.id));
  }
  if (f.view === "image" && f.url) {
    const img = el("img");
    img.src = f.url;
    img.loading = "lazy";
    img.alt = "";
    t.append(img);
  } else {
    t.append(el("span", "glyph", f.view === "model" ? "▣" : "◇"));
  }
  t.title = f.path;
  t.append(el("span", "name", f.name));
  return t;
}

// ---------------------------------------------------------------- stage and detail

async function select(id: string): Promise<void> {
  const a = fileById.get(id);
  if (!a) return;
  if (!a.view) return selectEntry(a.entry.id);
  current = a;
  currentEntry = null;
  openEntries.add(a.entry.id);
  location.hash = encodeURIComponent(id);
  renderList();
  scrollActiveIntoView();
  const stage = $("#stage");
  stage.replaceChildren();
  const review = reviewOf(a.id);
  const ext = a.path.split(".").pop()?.toUpperCase() ?? "";
  const info: Array<[string, Node | string]> = [
    ["種類", a.view === "model" ? "3D モデル（glb）" : `画像（${ext}）`],
    ["パス", a.path],
  ];
  if (a.isReviewable) info.push(["レビューで渡す", a.generators.length ? lines(a.generators) : "—"]);
  const size = await fetch(a.url ?? "")
    .then((r) => r.blob())
    .then((b) => b.size)
    .catch(() => 0);
  info.push(["サイズ", `${(size / 1024).toFixed(1)} KB`]);
  // Another file was picked while this one was loading.
  const isStale = () => current !== a;
  if (isStale()) return;

  if (a.view === "model") {
    viewer ??= new ModelView();
    stage.append(viewer.canvas);
    const bar = toolbar([
      ["ワイヤーフレーム", () => viewer?.setWire(!viewer.isWire)],
      ["視点を戻す", () => void viewer?.load(a.url ?? "")],
    ]);
    stage.append(bar, hint("ドラッグで回転・ホイールで拡大。Shift+クリックで部品に指摘ピンを置く"));
    await viewer.load(a.url ?? "");
    if (isStale()) return;
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
    const wrap = el("div", "image");
    const frame = el("div", "frame");
    const img = el("img");
    img.src = a.url ?? "";
    img.alt = a.name;
    frame.append(img);
    wrap.append(frame);
    stage.append(
      wrap,
      hint(a.isReviewable ? "クリックで画像に指摘ピンを置く" : "この画像はレビューの対象外"),
    );
    await img.decode().catch(() => undefined);
    if (isStale()) return;
    info.push(["寸法", `${img.naturalWidth} × ${img.naturalHeight}`]);
    const drawPins = () => {
      for (const p of frame.querySelectorAll(".pin")) p.remove();
      for (const pin of review.pins) {
        if (pin.u === undefined || pin.v === undefined) continue;
        const dot = el("div", "pin", String(pin.n));
        dot.style.left = `${pin.u * 100}%`;
        dot.style.top = `${pin.v * 100}%`;
        frame.append(dot);
      }
    };
    drawPins();
    if (a.isReviewable) {
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
  }
  renderDetail(a, info);
}

function renderDetail(a: FileItem, info: Array<[string, Node | string]>): void {
  const aside = $("#detail");
  aside.replaceChildren(entryCard(a.entry));
  aside.append(el("h3", "file", a.name), infoList(info));

  if (a.view === "model" && viewer) {
    const parts = el("div", "parts");
    for (const { object, tris } of viewer.parts()) {
      const label = el("label");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = object.visible;
      cb.onchange = () => (object.visible = cb.checked);
      label.append(cb, `${object.name || "(名前なし)"} — ${Math.round(tris).toLocaleString()} 三角形`);
      parts.append(label);
    }
    aside.append(parts);
  }

  if (!a.isReviewable) {
    aside.append(
      el("p", "note", "このファイルはレビューの対象外（asset-review が直せるのはモデルとテクスチャだけ）。"),
    );
    appendReadmes(aside, a.entry);
    return;
  }

  const review = reviewOf(a.id);
  const verdict = el("div", "verdict");
  for (const [value, text, cls] of [
    ["ok", "OK", "ok"],
    ["changes", "要修正", "ng"],
  ] as const) {
    const b = el("button", `${cls}${review.verdict === value ? " on" : ""}`, text);
    b.type = "button";
    b.onclick = () => {
      review.verdict = review.verdict === value ? null : value;
      saveDraft();
      renderList();
      renderDetail(a, info);
    };
    verdict.append(b);
  }
  const comment = el("textarea");
  comment.placeholder = "修正の指示（例：救急車の赤帯をもう少し太く、窓の位置を下げる）";
  comment.value = review.comment;
  comment.oninput = () => {
    review.comment = comment.value;
    if (review.comment && !review.verdict) review.verdict = "changes";
    saveDraft();
  };
  aside.append(verdict, comment);

  if (review.pins.length) {
    const ol = el("ol", "pins");
    for (const pin of review.pins) {
      const li = el("li");
      const input = el("input");
      input.value = pin.note;
      input.placeholder = pin.object ? `${pin.object} への指摘` : "この位置への指摘";
      input.oninput = () => {
        pin.note = input.value;
        saveDraft();
      };
      li.append(input);
      ol.append(li);
    }
    const clear = el("button", "", "ピンを消す");
    clear.type = "button";
    clear.onclick = () => {
      review.pins = [];
      review.snapshot = undefined;
      saveDraft();
      void select(a.id);
    };
    aside.append(ol, clear);
  }

  for (const r of responses.filter((x) => x.asset === a.id).slice(-3)) {
    aside.append(el("div", "response", `Claude（${r.at.slice(0, 16).replace("T", " ")}）: ${r.summary}`));
  }
  appendReadmes(aside, a.entry);
}

function toolbar(buttons: Array<[string, () => void]>): HTMLElement {
  const bar = el("div", "toolbar");
  for (const [label, fn] of buttons) {
    const b = el("button", "", label);
    b.type = "button";
    b.onclick = fn;
    bar.append(b);
  }
  return bar;
}

function hint(text: string): HTMLElement {
  return el("div", "hint", text);
}

// ---------------------------------------------------------------- submit

$("#submit").addEventListener("click", async () => {
  const items = files
    .filter((f) => f.isReviewable)
    .map((f) => ({ f, r: reviews.get(f.id) }))
    .filter(({ r }) => r && (r.verdict || r.comment || r.pins.length))
    .map(({ f, r }) => ({
      asset: f.id,
      kind: f.entry.kind,
      generators: f.generators,
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
  renderList();
});

async function loadResponses(): Promise<void> {
  if (!isDev) return;
  responses = await fetch(`${base}__asset-review/responses`, { headers: reviewHeaders })
    .then((r) => (r.ok ? (r.json() as Promise<Response[]>) : []))
    .catch(() => []);
}

$("#filter").addEventListener("input", (e) => {
  filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderList();
});

await loadResponses();
refreshSummary();
const hash = decodeURIComponent(location.hash.slice(1));
const isEntryHash = hash.startsWith("entry:");
const firstFile = files.find((f) => f.view)?.id;
if (isEntryHash) selectEntry(hash.slice("entry:".length));
else void select(fileById.has(hash) ? hash : (firstFile ?? ""));
if (!current && !currentEntry) renderList();
setInterval(() => {
  void loadResponses().then(renderList);
}, 15_000);
