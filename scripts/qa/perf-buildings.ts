// The PLATEAU buildings' load at a few starts round the 23 wards' edge (X1: the buildings of Kanagawa,
// Saitama and Chiba): frame intervals by day, the tiles the near town and the far skyline loaded,
// the LRU (items, MB), how often it was full and the tiles loaded and disposed while standing, the requests to the
// PLATEAU hosts (count, bytes) and the JS heap. Run it against two dev servers (the change and its
// base on another port) and compare the JSON; each point's request URLs go to a sibling file so the
// two sets can be diffed. Headless Chrome paces frames in steps of 16.7 ms, so only large changes show.
//
//   just measure-buildings-load after http://localhost:5173/tokyo-od-game/
//   pnpm exec tsx scripts/qa/perf-buildings.ts [--label L] [--base URL] [--seconds S] [--points a,b]
//     [--view near|medium|far] [--mobile] [--headed]
//
// The window opens once neither renderer has loaded or disposed a tile for QUIET_MS (a full LRU
// that keeps swapping never gets there: after QUIET_MAX_MS it is measured anyway, `quiet: false`).
// The heap is read after a forced GC (HeapProfiler.collectGarbage, then Runtime.getHeapUsage):
// without it three runs of one point spread by ~350 MB. --headed opens a window, so the GPU paces
// the frames (headless Chrome's come in steps of 16.7 ms).
//
// --view writes the 描画距離 to the page's saved 画質 (localStorage tod.graphics) before it loads;
// --mobile gives the page an Android user agent, so src/device.ts picks the phone's quality (the
// 0.35 GB town cache and the phone's presets).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";
import { waitQuiet } from "./quietWatch.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const seconds = Number(flag("seconds") ?? 12);
const view = flag("view");
const isMobile = argv.includes("--mobile");
const isHeaded = argv.includes("--headed");
/** No tile loaded or disposed for this long: the town and the skyline have stopped streaming. */
const QUIET_MS = 5000;
/** Waiting longer than this for the quiet, measure anyway (and say so). */
const QUIET_MAX_MS = 180_000;
/**
 * Page-side: every frame, the bytes of the near town's tiles the LRU holds as *used* (wanted by the
 * last traversal: never unloaded, and what fills the cache when it is full), and their peak since
 * the town was made, in window.__perfUsed. Why not lruCache.cachedBytes: it also counts the tiles
 * done with, which stay until the cache is above its lower bound (minBytesSize), so after any
 * drive it sits at that bound whatever the town needs.
 */
const USED_WATCH = `(() => {
  if (window.__perfUsed) return;
  const u = (window.__perfUsed = { mb: 0, maxMb: 0, items: 0 });
  const tick = () => {
    const c = __game.buildings.tiles.lruCache;
    let bytes = 0;
    for (const item of c.usedSet) bytes += c.bytesMap.get(item) || 0;
    u.mb = Math.round(bytes / 1e5) / 10;
    u.items = c.usedSet.size;
    if (u.mb > u.maxMb) u.maxMb = u.mb;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
/** Runs before the page's scripts on every document (about:blank has no storage: hence the try). */
const preload = view
  ? `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}`
  : null;
/**
 * Starts (lat, lon), each inside the start screen's box (src/game/startPoint.ts BOUNDS). The notes on
 * the prefectures' roots (神奈川の根 …) and `rootRequests` (data/plateau/tileset.json) are for X1, the
 * buildings beyond Tokyo; before it they read 0.
 */
const POINTS = [
  { id: "a-tokyo-station", what: "23 区の中心（行幸通り）", start: [35.68075, 139.76345] },
  { id: "b-ota-tamagawa", what: "大田区の多摩川沿い（神奈川の根）", start: [35.5445, 139.7068] },
  { id: "c-kita-arakawa", what: "北区の荒川沿い（埼玉の根）", start: [35.7818, 139.7228] },
  {
    id: "d-edogawa-kyuedogawa",
    what: "江戸川区の旧江戸川沿い（千葉の根、市川・浦安は無い）",
    start: [35.683, 139.889],
  },
  { id: "e-kawasaki-station", what: "川崎駅のあたり（区外）", start: [35.5313, 139.697] },
  { id: "f-kawaguchi-station", what: "川口駅のあたり（区外）", start: [35.8017, 139.7173] },
] as const;
const only = flag("points")?.split(",");
const points = only ? POINTS.filter((p) => only.some((o) => p.id.startsWith(o))) : POINTS;
const PLATEAU_HOSTS = ["api.plateauview.mlit.go.jp", "assets.cms.plateau.reearth.io"];

/**
 * The window's frame intervals and, over the same frames, how often each renderer's LRU was full
 * and how many tiles each loaded and disposed: tiles coming and going while the car stands still
 * is the far skyline flickering at a full cache. Why not count LRUCache.add refusals: the renderer
 * stops requesting while the cache is full (TilesRendererBase checks isFull first), so add is
 * never refused.
 */
const WINDOW = (ms: number) => `new Promise((resolve) => {
  const b = __game.buildings;
  const ev = { nearLoads: 0, nearDisposes: 0, farLoads: 0, farDisposes: 0, nearFullFrames: 0, farFullFrames: 0 };
  const on = (r, k) => {
    if (!r) return;
    r.addEventListener("load-model", () => ev[k + "Loads"]++);
    r.addEventListener("dispose-model", () => ev[k + "Disposes"]++);
  };
  on(b.tiles, "near");
  on(b.far, "far");
  const xs = []; let last = performance.now(); const end = last + ${ms};
  const tick = (t) => {
    xs.push(t - last); last = t;
    if (b.tiles.lruCache.isFull()) ev.nearFullFrames++;
    if (b.far && b.far.lruCache.isFull()) ev.farFullFrames++;
    if (t < end) { requestAnimationFrame(tick); return; }
    xs.sort((a, b) => a - b);
    const q = (k) => Math.round(xs[Math.min(xs.length - 1, Math.floor(k * xs.length))] * 10) / 10;
    resolve({ frames: xs.length, p50: q(0.5), p95: q(0.95), max: Math.round(xs.at(-1) * 10) / 10,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, ...ev });
  };
  requestAnimationFrame(tick);
})`;

type Frames = { frames: number; p50: number; p95: number; max: number; heapMB: number | null };
type Lru = { items: number; mb: number; maxItems: number; maxMb: number; full: boolean };
type Inner = {
  loadedCount: number;
  farLoadedCount: number;
  visible: number;
  farVisible: number;
  near: Lru;
  far: Lru | null;
  /** Whether the near town and the far skyline share one LRUCache object. */
  sharedLru: boolean;
  /** Near town: MB of the tiles the LRU holds as used now, and their peak since the start. */
  usedMb: number | null;
  usedMaxMb: number | null;
  usedItems: number | null;
  /** The near town's load radius (m): which 描画距離 the page runs with. */
  loadRadius: number | null;
};
type Request = { url: string; bytes: number };

/** Watch the page's network through a second DevTools client on the same target. */
async function watchNetwork(port: number) {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const urls = new Map<string, string>();
  const done: Request[] = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Network.requestWillBeSent") urls.set(msg.params.requestId, msg.params.request.url);
    if (msg.method === "Network.loadingFinished") {
      const url = urls.get(msg.params.requestId);
      if (url) done.push({ url, bytes: msg.params.encodedDataLength });
    }
  });
  ws.send(JSON.stringify({ id: 1, method: "Network.enable", params: {} }));
  await new Promise((r) => setTimeout(r, 200));
  return { done, close: () => ws.close() };
}

const results: Array<Record<string, unknown>> = [];
const outDir = join(ROOT, ".qa", "perf-buildings", label);
mkdirSync(outDir, { recursive: true });
for (const point of points) {
  const url = `${base}?start=${point.start.join(",")}&time=day&weather=clear&seed=20261115`;
  const port = await freePort();
  const b = await launch("about:blank", { width: 1280, height: 720, port, preload, headed: isHeaded });
  const until = async <T>(expr: string, tries = 180): Promise<T> => {
    for (let i = 0; i < tries; i++) {
      const v = await b.evaluate<T>(expr).catch(() => null);
      if (v) return v;
      await b.sleep(1000);
    }
    throw new Error(`timeout: ${expr}`);
  };
  try {
    const net = await watchNetwork(port);
    if (isMobile) await b.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA });
    const t0 = Date.now();
    await b.send("Page.navigate", { url });
    await until("window.__game?.getState() === 'ready'");
    await b.evaluate("window.__game.start()");
    await b.evaluate(USED_WATCH);
    await until("__game.debug.settled().isSettled", 150);
    // The far skyline starts after the town (or 15 s): wait for it to load and settle too.
    await until("__game.buildings.far && __game.buildings.farLoadProgress() >= 0.999", 90).catch(() => null);
    await until("__game.debug.settled().isSettled", 120);
    const { quiet, waitedS: quietWaitS } = await waitQuiet(b, QUIET_MS, QUIET_MAX_MS);
    const settleS = Math.round((Date.now() - t0) / 100) / 10;
    const frames = await b.evaluate<Frames>(WINDOW(seconds * 1000));
    await b.send("HeapProfiler.collectGarbage");
    const usage = await b.send("Runtime.getHeapUsage");
    const heapGcMB = Math.round(Number(usage.result.usedSize) / 1e6);
    // Per renderer, the municipalities (codes from the tileset folder) whose content tiles are in
    // the LRU now: what the near town and the far skyline hold, prefecture by prefecture.
    const inner = await b.evaluate<Inner>(`(() => {
      const b = __game.buildings;
      const lru = (c) => c && ({ items: c.itemSet.size, mb: Math.round(c.cachedBytes / 1e5) / 10,
        maxItems: c.maxSize, maxMb: Math.round(c.maxBytesSize / 1e5) / 10, full: c.isFull() });
      const held = (r) => {
        const out = {};
        if (!r) return out;
        for (const t of r.lruCache.itemSet.keys()) {
          if (t.internal?.renderer !== r || !t.internal?.hasRenderableContent) continue;
          const code = /\\/(\\d{5})_[^/]*(\\/|$)/.exec(t.internal.basePath ?? "")?.[1] ?? "?";
          out[code] = (out[code] ?? 0) + 1;
        }
        return out;
      };
      return { loadedCount: b.loadedCount, farLoadedCount: b.farLoadedCount,
        visible: b.tiles.visibleTiles.size, farVisible: b.far ? b.far.visibleTiles.size : 0,
        near: lru(b.tiles.lruCache), far: b.far ? lru(b.far.lruCache) : null,
        usedMb: window.__perfUsed?.mb ?? null, usedMaxMb: window.__perfUsed?.maxMb ?? null,
        usedItems: window.__perfUsed?.items ?? null,
        sharedLru: Boolean(b.far) && b.far.lruCache === b.tiles.lruCache,
        loadRadius: b.maskRegion?.sphere?.radius ?? null,
        nearHeld: held(b.tiles), farHeld: held(b.far) };
    })()`);
    net.close();
    const plateau = net.done.filter((r) => PLATEAU_HOSTS.some((h) => r.url.includes(h)));
    const root = net.done.filter((r) => r.url.includes("data/plateau/tileset.json"));
    const byHost = Object.fromEntries(
      PLATEAU_HOSTS.map((h) => {
        const rs = plateau.filter((r) => r.url.includes(h));
        return [h, { requests: rs.length, mb: Math.round(rs.reduce((s, r) => s + r.bytes, 0) / 1e4) / 100 }];
      }),
    );
    // Municipality codes of the tileset.json and tiles requested ("14130_…" in the folder name).
    const codes = [
      ...new Set(plateau.map((r) => /\/(\d{5})_[^/]*\//.exec(r.url)?.[1]).filter(Boolean)),
    ].toSorted();
    writeFileSync(
      join(outDir, `${point.id}.urls.txt`),
      `${[...new Set([...plateau, ...root].map((r) => r.url))].toSorted().join("\n")}\n`,
    );
    results.push({
      point: point.id,
      what: point.what,
      start: point.start,
      settleS,
      quiet,
      quietWaitS,
      heapGcMB,
      ...frames,
      ...inner,
      byHost,
      rootRequests: root.length,
      codes,
    });
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  } finally {
    await b.close();
  }
}
const out = {
  label,
  base,
  at: new Date().toISOString(),
  seconds,
  view: view ?? null,
  isMobile,
  isHeaded,
  results,
};
writeFileSync(join(outDir, "perf.json"), `${JSON.stringify(out, null, 2)}\n`);
