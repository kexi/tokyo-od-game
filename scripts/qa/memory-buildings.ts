// The PLATEAU buildings' memory over time: the near town's LRU (held and used bytes, full frames,
// tiles loaded and disposed), the far skyline's LRU and the JS heap after a forced GC with the array
// storage outside it, either moving the car along a route by warps (default) or on the title
// screen's slow pan (--title). How: every sample the car warps STEP metres on along the route
// (debug.roads.warp), then after EVERY seconds the page is read; the used bytes and full frames are
// counted every frame in the page. Why warps, not 自動運転: the autopilot stopped for reasons of its
// own (a turn at 東京駅 on main, `autopilot_gave_up: stuck` by the moat at 皇居外苑 on X0), and a
// warp loop passes the same points on every build, so runs compare step by step.
//
//   just measure-buildings-memory label base [args]
//   pnpm exec tsx scripts/qa/memory-buildings.ts --label L [--base URL] [--seconds S]
//     [--route wards|lat,lon;lat,lon;…] [--step 300] [--every 10] [--sample-every S] [--title] [--start lat,lon]
//     [--view near|medium|far] [--mobile] [--heap-limit MB] [--sample held,used,heap,backing]
//     [--shots all|200,230] [--counts] [--alloc FROM,TO] [--snapshot-at T1,T2] [--census-at T1,T2] [--trace-removals]
//
// --sample-every reads the page every S seconds (default: every warp) while the warps go on every
// EVERY seconds: a forced GC takes seconds, so a warp each second cannot be read each second. Why not
// read less (no GC) in between: the heap before a GC swings by hundreds of MB and says nothing.
// --heap-limit caps V8's old space (--js-flags=--max-old-space-size), as on a machine with less
// memory; a tab that crashes ends the run with `crashed` and the second it happened.
// Output: one JSON line a sample on stdout and .qa/memory-buildings/<label>.json (screenshots in
// .qa/memory-buildings/<label>/). The JSON carries `slopes` (memorySlopes.ts): the heap, array-storage
// and total slopes over all samples from 60 s, from the near LRU's plateau, and over the full samples
// only (held ≥ 95 % of its upper bound), with the share of full samples and the rules used.
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";
import { slopeSummary, type MemorySample } from "./memorySlopes.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const isTitle = argv.includes("--title");
const isMobile = argv.includes("--mobile");
const view = flag("view");
const heapLimit = flag("heap-limit");
const seconds = Number(flag("seconds") ?? (isTitle ? 300 : 600));
const every = Number(flag("every") ?? (isTitle ? 5 : 10));
const stepM = Number(flag("step") ?? 300);
const sampleEvery = Number(flag("sample-every") ?? every);
/** What to read each sample (all by default): the LRU's held bytes, its used bytes, the GC heap, the array storage. */
const SAMPLE_KINDS = ["held", "used", "heap", "backing"] as const;
type SampleKind = (typeof SAMPLE_KINDS)[number];
const sampled = new Set<SampleKind>(
  (flag("sample")?.split(",") as SampleKind[] | undefined) ?? [...SAMPLE_KINDS],
);
/** Named routes: the loop through the dense wards the X0 limits were measured on (2026-11-15). */
const ROUTES: Record<string, Array<[number, number]>> = {
  wards: [
    [35.6812, 139.7671], // 東京駅
    [35.6896, 139.7006], // 新宿
    [35.658, 139.7016], // 渋谷
    [35.7295, 139.7109], // 池袋
    [35.7138, 139.7773], // 上野
    [35.6812, 139.7671],
  ],
};
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

/** The route's corners: a name from ROUTES or "lat,lon;lat,lon;…". */
function routeCorners(spec: string): Array<[number, number]> {
  const named = ROUTES[spec];
  if (named) return named;
  return spec.split(";").map((p) => p.split(",").map(Number) as [number, number]);
}

/** Points STEP metres apart along the corners (each leg split evenly, the last corner left out: a loop's start). */
function routePoints(corners: Array<[number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    const dy = (b[0] - a[0]) * 111_000;
    const dx = (b[1] - a[1]) * 111_000 * Math.cos((a[0] * Math.PI) / 180);
    const n = Math.max(1, Math.round(Math.hypot(dx, dy) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const route = isTitle ? [] : routePoints(routeCorners(flag("route") ?? "wards"), stepM);
const startAt = isTitle ? flag("start") : route[0]?.join(",");
const url = `${base}?time=day&weather=clear&seed=20261115${startAt ? `&start=${startAt}` : ""}`;
const preload = view
  ? `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}`
  : null;
const shotsFlag = flag("shots");
const isEveryShot = shotsFlag === "all";
const shotTimes = isEveryShot ? [] : (shotsFlag ?? "").split(",").filter(Boolean).map(Number);

/**
 * Page-side, every frame: the near LRU's used bytes (wanted by the last traversal, never unloaded)
 * and their peak since the last sample, full frames, and the tiles each renderer loaded and disposed.
 * Why not lruCache.cachedBytes alone: after any drive it sits at the lower bound (minBytesSize),
 * whatever the town needs; the used bytes are what a limit must hold.
 */
const WATCH = `(() => {
  if (window.__mem) return;
  const m = (window.__mem = { usedMb: 0, usedPeakMb: 0, fullFrames: 0, frames: 0, loads: 0, disposes: 0, farLoads: 0, farDisposes: 0, hooked: null, farHooked: null, gaps: [], last: 0, skip: true, pipelines: 0 });
  // Render pipelines the backend builds (three's Pipelines calls it once per new cache key): a
  // pipeline thrown away with its last render object and built again shows here as a hitch would.
  const backend = __game.renderer.backend;
  if (backend && !backend.__counted) {
    const build = backend.createRenderPipeline.bind(backend);
    m.pipelineLog = [];
    backend.createRenderPipeline = (...args) => {
      m.pipelines++;
      // What the pipeline was built for (the census counts them by material and model).
      const ro = args[0]; let top = ro?.object; while (top?.parent) top = top.parent;
      const mesh = ro?.object; const made = mesh ? (mesh.name || (mesh.geometry?.type ?? mesh.type)) : "?";
      m.pipelineLog.push([performance.now(), (ro?.material?.name || ro?.material?.type || "?") + " | " + made + (top?.isScene ? "" : " (floating)")]);
      return build(...args);
    };
    backend.__counted = true;
  }
  // Marks every object given dispose() (the census tells retired objects from ones never retired).
  let proto = Object.getPrototypeOf(__game.scene);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "traverse")) proto = Object.getPrototypeOf(proto);
  if (proto && !proto.__marked) {
    const dispose = proto.dispose;
    proto.dispose = function () { this.__retiredAt = performance.now(); return dispose.call(this); };
    proto.__marked = true;
    // --trace-removals: who took each object out (the first frames of the game's code; the dev
    // server's names are readable), for the census of floating ones.
    const remove = proto.remove;
    proto.remove = function (...objects) {
      if (window.__traceRemovals) {
        const frames = new Error().stack.split("\\n").slice(2).map((s) => s.trim().replace(/^at /, "").replace(/\\?[^:)]*/, "").replace(/https?:\\/\\/[^/]+\\/tokyo-od-game\\//, ""));
        const by = frames.filter((s) => !/node_modules|three|Object3D/.test(s)).slice(0, 3).join(" < ");
        for (const o of objects) o.__removedBy = by;
      }
      return remove.apply(this, objects);
    };
  }
  const tick = (now) => {
    // Frame gaps; the one across the probe's forced GC (skip, set before it) is not the game's.
    if (!m.skip && m.last) m.gaps.push(now - m.last);
    m.skip = false; m.last = now;
    const b = __game.buildings; const c = b.tiles.lruCache;
    if (m.hooked !== b.tiles) { m.hooked = b.tiles; b.tiles.addEventListener("load-model", () => m.loads++); b.tiles.addEventListener("dispose-model", () => m.disposes++); }
    if (b.far && m.farHooked !== b.far) { m.farHooked = b.far; b.far.addEventListener("load-model", () => m.farLoads++); b.far.addEventListener("dispose-model", () => m.farDisposes++); }
    let bytes = 0;
    for (const item of c.usedSet) bytes += c.bytesMap.get(item) || 0;
    m.usedMb = Math.round(bytes / 1e5) / 10;
    if (m.usedMb > m.usedPeakMb) m.usedPeakMb = m.usedMb;
    m.frames++;
    if (c.isFull()) m.fullFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
/** Page-side: the counters since the last sample (the peak and full frames start again). */
const COUNTERS = `(() => {
  const m = window.__mem;
  const dir = __game.camera.getWorldDirection(new __game.camera.position.constructor());
  const gaps = m.gaps.toSorted((a, b) => a - b);
  const at = (q) => gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] * 10) / 10 : null;
  const out = { usedMb: m.usedMb, usedPeakMb: m.usedPeakMb, fullFrames: m.fullFrames, frames: m.frames, loads: m.loads,
    disposes: m.disposes, farLoads: m.farLoads, farDisposes: m.farDisposes, heading: Math.round(Math.atan2(dir.x, dir.z) * 180 / Math.PI),
    frameP50Ms: at(0.5), frameP95Ms: at(0.95), frameMaxMs: at(1) };
  m.usedPeakMb = m.usedMb; m.fullFrames = 0; m.frames = 0; m.gaps = [];
  return out;
})()`;
/** Page-side: both LRUs (held items and MB, the limit), tiles shown, where the car is. */
const STATE = `(() => {
  const b = __game.buildings; const l = (c) => c && { items: c.itemSet.size, mb: Math.round(c.cachedBytes / 1e5) / 10, maxMb: Math.round(c.maxBytesSize / 1e5) / 10, full: c.isFull() };
  const car = __game.vehicle?.position?.(); const f = __game.getFrame?.(); const g = car && f ? f.toGeodetic(car) : null;
  return { near: l(b.tiles.lruCache), far: b.far ? l(b.far.lruCache) : null,
    loaded: b.loadedCount, farLoaded: b.farLoadedCount, visible: b.tiles.visibleTiles.size, farVisible: b.far ? b.far.visibleTiles.size : 0,
    lat: g ? +g.lat.toFixed(5) : null, lon: g ? +g.lon.toFixed(5) : null, state: __game.getState() };
})()`;

/**
 * Page-side (--counts): how many of each thing the game holds, to find one that grows with time while
 * the place keeps changing (M1). Each count is read on its own, null when this build has no such
 * handle. Why counts and not a heap snapshot first: a snapshot of a 1 GB heap takes minutes and
 * stalls the page; a count that grows names its owner at once.
 */
const COUNTS = `(() => {
  const g = __game; const read = (f) => { try { return f(); } catch { return null; } };
  let objects = 0; let lights = 0; const top = [];
  for (const child of g.scene.children) {
    let n = 0; child.traverse((o) => { n++; if (o.isLight && o.visible) lights++; }); objects += n;
    top.push([child.name || child.type, n]);
  }
  top.sort((a, b) => b[1] - a[1]);
  let cars = 0; read(() => g.traffic.forEachCar(() => cars++));
  return { counts: {
    objects, lights, topChildren: top.slice(0, 8),
    geometries: read(() => g.renderer.info.memory.geometries), textures: read(() => g.renderer.info.memory.textures),
    // three's own set of render objects (RenderObjects._renderObjects, 0.186): read here only, never by the game.
    renderObjects: read(() => g.renderer._objects._renderObjects.size),
    pipelines: read(() => window.__mem.pipelines),
    bodies: read(() => g.world.bodies.len()), colliders: read(() => g.world.colliders.len()),
    cars, pedestrians: read(() => g.pedestrians.list.length), licenseLog: read(() => g.law.state.log.length),
  } };
})()`;
const isCounted = argv.includes("--counts");
const isTracingRemovals = argv.includes("--trace-removals");

/**
 * --alloc FROM,TO: the sampling heap profiler between those seconds; what it reports is what was
 * allocated in the window and is still alive at TO, by the place in the code that allocated it.
 * --snapshot-at T1,T2: a full heap snapshot at each (a .heapsnapshot file; scripts/qa/heap-diff.py
 * compares two). Why both: the sampling profile names the code even through closures and arrays a
 * snapshot only shows as "(array)", and the snapshot names who keeps them.
 */
const allocWindow = flag("alloc")?.split(",").map(Number) ?? null;
const snapshotTimes = (flag("snapshot-at") ?? "").split(",").filter(Boolean).map(Number);
/**
 * --census-at T1,T2: once at each of those seconds, the render objects whose object no longer reaches a scene
 * (floating: taken out but still held by the renderer), counted by what the top parent looks like
 * (a person by its part names, a car, anything else), by mesh name and by pass (camera, context).
 * Why the parts' names: a retired model has no other mark, and human.glb's parts are named.
 */
const censusTimes = (flag("census-at") ?? "").split(",").filter(Boolean).map(Number);
const censusesTaken = new Set<number>();
const census: Array<Record<string, unknown>> = [];
const CENSUS = `(() => {
  const set = __game.renderer._objects._renderObjects;
  const topOf = (o) => { while (o.parent) o = o.parent; return o; };
  const kindOf = (root) => {
    let isPerson = false; let isCar = false;
    root.traverse((o) => { const n = o.name || ""; if (/Torso|Head|Thigh|UpperArm/.test(n)) isPerson = true; if (/wheel|tire|body|car|bumper/i.test(n)) isCar = true; });
    return isPerson ? "person" : isCar ? "car" : "other";
  };
  // Unnamed meshes go by their material and geometry (what they are made of is all there is to go by).
  const signature = (root) => { const names = []; let made = ""; root.traverse((c) => { if (names.length < 4 && c.isMesh && c.name) names.push(c.name); if (!made && c.isMesh) made = (c.material?.name || c.material?.type || "?") + "/" + (c.geometry?.type || "?"); }); return (root.name || root.type) + "[" + (names.length ? names.join(",") : made) + "]"; };
  const add = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const byKind = new Map(), byMesh = new Map(), byPass = new Map(), byRoot = new Map(), rootsBy = new Map(), byRemoval = new Map(); const roots = new Set();
  let total = 0, floating = 0;
  for (const ro of set) {
    total++;
    const root = topOf(ro.object);
    if (root.isScene) continue;
    floating++;
    // retired: the object had dispose() (its render object was made again after); never: it did not.
    const mark = ro.object.__retiredAt ? " retired" : " never";
    const kind = kindOf(root) + mark;
    add(byKind, kind); add(byMesh, kind + ":" + (ro.object.name || ro.object.type));
    add(byPass, (ro.camera?.name || ro.camera?.type || "?") + " ctx" + (ro.context?.id ?? "?")); add(byRoot, signature(root) + mark);
    if (!roots.has(root)) { roots.add(root); add(rootsBy, signature(root) + mark); }
    add(byRemoval, signature(root) + " <= " + (root.__removedBy || "(no removal seen)"));
  }
  // Pipelines built since the last census, by what they were for.
  const log = window.__mem.pipelineLog || []; const since = window.__mem.censusAt || 0; const pipelinesBy = new Map();
  for (const [at, key] of log) if (at >= since) add(pipelinesBy, key);
  window.__mem.censusAt = performance.now();
  const top = (m) => [...m].toSorted((a, b) => b[1] - a[1]).slice(0, 12);
  return { total, floating, floatingRoots: roots.size, byKind: top(byKind), byMesh: top(byMesh), byPass: top(byPass), byRoot: top(byRoot), rootsBy: top(rootsBy), byRemoval: [...byRemoval].toSorted((a, b) => b[1] - a[1]).slice(0, 25), pipelinesBy: [...pipelinesBy].toSorted((a, b) => b[1] - a[1]).slice(0, 20) };
})()`;
const snapshotsTaken = new Set<number>();
let isAllocating = false;
type AllocNode = {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: AllocNode[];
};
let allocDone: {
  t: number;
  totalMB: number;
  top: Array<[string, number]>;
  files: Array<[string, number]>;
} | null = null;
/** The profile's self sizes added up by allocating place (function, file, line) and by file, in MB. */
function summariseAlloc(head: AllocNode) {
  const bySite = new Map<string, number>();
  const byFile = new Map<string, number>();
  let total = 0;
  const walk = (n: AllocNode) => {
    const f = n.callFrame;
    const file = f.url.split("/").pop() || "(native)";
    const site = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
    bySite.set(site, (bySite.get(site) ?? 0) + n.selfSize);
    byFile.set(file, (byFile.get(file) ?? 0) + n.selfSize);
    total += n.selfSize;
    for (const c of n.children) walk(c);
  };
  walk(head);
  return { totalMB: Math.round(total / 1e5) / 10, top: largest(bySite, 30), files: largest(byFile, 15) };
}
/** The `n` largest entries, in MB. */
function largest(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => [k, Math.round(v / 1e5) / 10]);
}
/**
 * A heap snapshot to `file` over a second DevTools client on the same page. Why a second client: the
 * snapshot arrives as HeapProfiler.addHeapSnapshotChunk events, which browser.mjs does not hand over.
 */
async function takeSnapshot(debugPort: number, file: string): Promise<void> {
  const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = targets.find((x) => x.type === "page");
  if (!page) throw new Error("no page to snapshot");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const stream = createWriteStream(file);
  await new Promise<void>((resolve) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "HeapProfiler.addHeapSnapshotChunk") stream.write(msg.params.chunk);
      if (msg.id === 2) resolve();
    });
    ws.send(JSON.stringify({ id: 1, method: "HeapProfiler.enable" }));
    ws.send(
      JSON.stringify({ id: 2, method: "HeapProfiler.takeHeapSnapshot", params: { reportProgress: false } }),
    );
  });
  await new Promise((r) => stream.end(r));
  ws.close();
}

const mb = (bytes: unknown) => (bytes == null ? null : Math.round(Number(bytes) / 1e6));
const outDir = join(ROOT, ".qa", "memory-buildings");
const shotDir = join(outDir, label);
mkdirSync(shotDir, { recursive: true });
const port = await freePort();
const extraArgs = heapLimit ? [`--js-flags=--max-old-space-size=${heapLimit}`] : [];
const b = await launch("about:blank", { width: 1280, height: 720, port, preload, extraArgs });
const samples: Array<Record<string, unknown>> = [];
let crashed: string | null = null;
try {
  if (isMobile) await b.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA });
  await b.send("Page.navigate", { url });
  for (let i = 0; i < 180; i++) {
    await b.sleep(1000);
    const isReady = (await b.evaluate("window.__game?.getState()").catch(() => null)) === "ready";
    if (isReady) break;
  }
  if (isTracingRemovals) await b.evaluate("window.__traceRemovals = true");
  await b.evaluate(WATCH);
  if (!isTitle) {
    await b.evaluate("window.__game.start()");
    await b.sleep(8000);
  }
  const t0 = Date.now();
  const taken = new Set<number>();
  let hop = 0;
  let nextSample = sampleEvery;
  while (Date.now() - t0 < seconds * 1000) {
    if (!isTitle) {
      hop++;
      const [lat, lon] = route[hop % route.length];
      await b.evaluate(`__game.debug.roads.warp({ name: "qa", lat: ${lat}, lon: ${lon} })`);
    }
    await b.sleep(every * 1000);
    const t = Math.round((Date.now() - t0) / 1000);
    const due = isEveryShot ? [t] : shotTimes.filter((x) => x <= t && !taken.has(x));
    for (const x of due) {
      taken.add(x);
      await b.screenshot(join(shotDir, `t${x}.jpg`), 85);
    }
    const isSampleDue = t >= nextSample;
    if (!isSampleDue) continue;
    nextSample = t + sampleEvery;
    try {
      const sample: Record<string, unknown> = { t, hop, km: Math.round(hop * stepM) / 1000 };
      const isHeapRead = sampled.has("heap") || sampled.has("backing");
      if (isHeapRead) {
        sample.heapRawMB = mb(await b.evaluate<number>("performance.memory.usedJSHeapSize"));
        await b.evaluate("window.__mem && (window.__mem.skip = true)");
        await b.send("HeapProfiler.collectGarbage");
        const usage = (await b.send("Runtime.getHeapUsage")).result;
        if (sampled.has("heap"))
          Object.assign(sample, { heapGcMB: mb(usage.usedSize), heapTotalMB: mb(usage.totalSize) });
        if (sampled.has("backing"))
          Object.assign(sample, {
            backingMB: mb(usage.backingStorageSize),
            embedderMB: mb(usage.embedderHeapUsedSize),
          });
      }
      const state = await b.evaluate<Record<string, unknown>>(STATE);
      const counters = await b.evaluate<Record<string, unknown>>(COUNTERS);
      if (!sampled.has("held")) delete state.near;
      if (!sampled.has("used")) Object.assign(counters, { usedMb: undefined, usedPeakMb: undefined });
      Object.assign(sample, state, counters);
      if (isCounted) Object.assign(sample, await b.evaluate<Record<string, unknown>>(COUNTS));
      samples.push(sample);
      process.stdout.write(`${JSON.stringify(sample)}\n`);
      const isAllocStartDue =
        allocWindow !== null && !isAllocating && allocDone === null && t >= allocWindow[0];
      if (isAllocStartDue) {
        await b.send("HeapProfiler.enable");
        await b.send("HeapProfiler.startSampling", { samplingInterval: 32768 });
        isAllocating = true;
        process.stdout.write(`${JSON.stringify({ t, alloc: "started" })}\n`);
      }
      const isAllocStopDue = allocWindow !== null && isAllocating && t >= allocWindow[1];
      if (isAllocStopDue) {
        const profile = (await b.send("HeapProfiler.stopSampling")).result.profile as AllocNode & {
          head: AllocNode;
        };
        isAllocating = false;
        writeFileSync(join(outDir, `${label}.heapprofile`), JSON.stringify(profile));
        allocDone = { t, ...summariseAlloc(profile.head) };
        process.stdout.write(`${JSON.stringify({ t, alloc: "stopped", totalMB: allocDone.totalMB })}\n`);
      }
      for (const at of censusTimes.filter((x) => t >= x && !censusesTaken.has(x))) {
        censusesTaken.add(at);
        const counted = { t, ...(await b.evaluate<Record<string, unknown>>(CENSUS)) };
        census.push(counted);
        process.stdout.write(`${JSON.stringify({ census: counted })}\n`);
      }
      for (const at of snapshotTimes.filter((x) => t >= x && !snapshotsTaken.has(x))) {
        snapshotsTaken.add(at);
        const file = join(outDir, `${label}.t${at}.heapsnapshot`);
        await takeSnapshot(port, file);
        process.stdout.write(`${JSON.stringify({ t, snapshot: file })}\n`);
      }
    } catch (error) {
      crashed = `${Math.round((Date.now() - t0) / 1000)} s: ${String(error)}`;
      process.stdout.write(`${JSON.stringify({ crashed })}\n`);
      break;
    }
  }
} finally {
  await b.close();
}
const out = {
  label,
  base,
  url,
  at: new Date().toISOString(),
  isTitle,
  isMobile,
  view: view ?? null,
  heapLimit: heapLimit ?? null,
  stepM,
  every,
  sampleEvery,
  crashed,
  slopes: slopeSummary(samples as MemorySample[]),
  alloc: allocDone,
  census,
  samples,
};
writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
