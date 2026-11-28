// What one near building tile holds, counted array by array (M2: the near LRU counts 1 MB where
// about 6 MB are used): at a start (default 東京駅), once the town and the far skyline have settled
// and the tiles stopped streaming for 5 s, the page walks every loaded near tile and adds up its
// geometry attributes by name (position, normal, uv, the batch id, our façade attribute…), its
// index, its textures, and the b3dm's batch and feature tables (the buffer they keep, and the size of
// their parsed JSON), next to what the LRU counts for it; the heap after a forced GC and the array
// storage outside it are read once. How the views are told apart: an attribute's own bytes are its
// array's byteLength; the buffer under it is counted once per ArrayBuffer, so a view into a larger
// buffer (the file's body kept alive) shows as buffer bytes over the attributes' own.
// Why not a heap snapshot: the game's never arrived in 20 minutes (knowledge/memory-growth.md).
//
// --time-parse (M3, #10・#16・#27): every tile's parse, its load-model and the landmark cut-outs,
// timed from before the first tile: the page's preload catches window.__game as main.ts sets it
// (a setter on window), before the first frame asks for a tile. Per parse: the whole of it (it
// waits on the Draco worker), its synchronous prefix (main thread only: the b3dm's header, its
// feature and batch tables, the glTF's JSON chunk), and the JSON.parse calls inside that prefix,
// told apart by what they return (a glTF has `asset`, a feature table `BATCH_LENGTH`, the rest is
// the batch table). load-model by the tiles' dispatchEvent (the listeners are closures), the cut by
// Buildings.cutFootprints (TS-private, a plain method at run time).
// Why not wrap at "ready" as before: the near town loads under the loading screen, so that wrap saw
// 158–162 parses of 415–427 near tiles (memory-growth.md M3).
//
//   just measure-tile-memory label base [args]
//   pnpm exec tsx scripts/qa/memory-tiles.ts --label L [--base URL] [--start lat,lon] [--view far] [--drop-tables] [--probe-holders] [--time-parse]
//
// Output: one JSON line on stdout and .qa/memory-tiles/<label>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";
import { waitQuiet } from "./quietWatch.ts";
import { servedBuild, servedRecord, warnIfNotSame } from "./servedBuild.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const start = flag("start") ?? "35.6812,139.7671";
const view = flag("view") ?? "far";
const url = `${base}?start=${start}&time=day&weather=clear&seed=20261115`;
const isTimed = argv.includes("--time-parse");
/** Page-side (--time-parse): the timers of the header, installed as main.ts sets window.__game. */
const TIME_PARSE = `(() => {
  const T = (window.__tp = { parses: [], loads: [], cuts: [], installedAt: null, error: null, inSync: false, cur: null });
  const nativeParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const isInPrefix = T.inSync && T.cur !== null;
    if (!isInPrefix) return nativeParse.call(JSON, text, reviver);
    const t0 = performance.now();
    const r = nativeParse.call(JSON, text, reviver);
    const ms = performance.now() - t0;
    const isObject = r !== null && typeof r === "object";
    const isGltf = isObject && "asset" in r;
    if (isGltf) { T.cur.gltf += ms; return r; }
    T.cur.table += ms; T.cur.tableChars += String(text).length;
    return r;
  };
  const timeLoads = (tiles, who) => {
    const isWrapped = !tiles || tiles.__tpTimed;
    if (isWrapped) return;
    const dispatch = tiles.dispatchEvent.bind(tiles);
    tiles.dispatchEvent = (e) => {
      const isLoad = e?.type === "load-model";
      if (!isLoad) return dispatch(e);
      const t0 = performance.now();
      try { return dispatch(e); } finally { T.loads.push([t0, performance.now() - t0, who]); }
    };
    tiles.__tpTimed = true;
  };
  const install = (game) => {
    const b = game?.buildings;
    const isInstalled = !b || T.installedAt !== null;
    if (isInstalled) return;
    T.installedAt = performance.now();
    const proto = Object.getPrototypeOf(b.tiles);
    const parse = proto.parseTile;
    proto.parseTile = function (...args) {
      const who = this === b.tiles ? "near" : this === b.far ? "far" : "other";
      const row = { table: 0, gltf: 0, tableChars: 0 };
      const t0 = performance.now();
      T.inSync = true; T.cur = row;
      let pending;
      try { pending = parse.apply(this, args); } finally { T.inSync = false; T.cur = null; }
      const syncMs = performance.now() - t0;
      return Promise.resolve(pending).finally(() =>
        T.parses.push([t0, performance.now() - t0, who, syncMs, row.table, row.gltf, row.tableChars]));
    };
    const cut = b.cutFootprints;
    b.cutFootprints = function (...args) {
      const t0 = performance.now();
      try { return cut.apply(this, args); } finally { T.cuts.push([t0, performance.now() - t0]); }
    };
    const watch = () => { timeLoads(b.tiles, "near"); timeLoads(b.far, "far"); };
    watch();
    setInterval(watch, 200);
  };
  let game;
  Object.defineProperty(window, "__game", { configurable: true, enumerable: true,
    get: () => game,
    set: (v) => { game = v; try { install(v); } catch (e) { T.error = String(e); } } });
})();`;
const preload = `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}
${isTimed ? TIME_PARSE : ""}`;

const tenth = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
/** Count, median, 90th percentile, largest and sum of `values` (ms, 0.1 ms). */
function spread(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
  const r = tenth;
  return {
    n: sorted.length,
    median: r(at(0.5)),
    p90: r(at(0.9)),
    max: r(sorted.at(-1) ?? null),
    sum: r(sorted.reduce((a, b) => a + b, 0)),
  };
}
/** The tiles stop streaming for this long before the count (perf-buildings.ts waits the same). */
const QUIET_MS = 5000;
const QUIET_MAX_MS = 60_000;

/** Page-side: every loaded near and far tile, array by array (see the header). */
const CENSUS = `(() => {
  const b = __game.buildings;
  const count = (tiles) => {
    const lru = tiles.lruCache;
    const sum = { tiles: 0, buildings: 0, lruBytes: 0, meshes: 0, attributes: {}, attributeBuffers: 0, index: 0, indexBuffers: 0,
      textures: 0, tableBuffers: 0, tableJsonChars: 0, metadataKept: 0, colliders: 0, vertices: 0, triangles: 0 };
    const seenBuffers = new Set(); const seenTextures = new Set(); const seenTableBuffers = new Set(); const seenTables = new Set();
    const addBuffer = (buffer) => { if (!buffer || seenBuffers.has(buffer)) return 0; seenBuffers.add(buffer); return buffer.byteLength; };
    const perTile = []; const names = [];
    // itemSet is a Map (tile → when it was added): its keys are the tiles.
    for (const tile of lru.itemSet.keys()) {
      const scene = tile.engineData?.scene;
      if (!scene) continue;
      const t = { lruBytes: lru.bytesMap.get(tile) || 0, attributes: 0, buffers: 0, index: 0, tables: 0, tableJson: 0, buildings: 0 };
      sum.tiles++; sum.lruBytes += t.lruBytes;
      names.push(tile.content?.uri || tile.content?.url || "");
      if (tile.engineData.metadata) sum.metadataKept++;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        sum.meshes++;
        const g = o.geometry;
        for (const [name, attr] of Object.entries(g.attributes)) {
          const array = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
          const own = attr.isInterleavedBufferAttribute ? 0 : array.byteLength;
          sum.attributes[name] = (sum.attributes[name] || 0) + own;
          t.attributes += own;
          if (attr.isInterleavedBufferAttribute) sum.attributes.interleaved = (sum.attributes.interleaved || 0) + addBuffer(array.buffer);
          const buf = addBuffer(array.buffer); t.buffers += buf; sum.attributeBuffers += buf;
        }
        // Buildings by the batch ids the mesh uses (the tables that also say so may be gone).
        const ids = g.attributes._batchid ?? g.attributes._feature_id_0;
        if (ids) { let max = -1; for (let i = 0; i < ids.count; i++) { const v = ids.getX(i); if (v > max) max = v; } t.buildings += max + 1; }
        sum.vertices += g.attributes.position?.count || 0;
        if (g.index) {
          sum.index += g.index.array.byteLength; t.index += g.index.array.byteLength;
          sum.triangles += g.index.count / 3;
          const buf = addBuffer(g.index.array.buffer); sum.indexBuffers += buf; t.buffers += buf;
        }
        for (const m of [o.material].flat()) for (const v of Object.values(m)) {
          if (!v || !v.isTexture || seenTextures.has(v)) continue;
          seenTextures.add(v);
          const img = v.image; const w = img?.width || 0; const h = img?.height || 0; const d = img?.depth || 1;
          sum.textures += w * h * d * 4;
        }
      });
      for (const table of [scene.batchTable, scene.featureTable, tile.engineData.metadata?.batchTable, tile.engineData.metadata?.featureTable]) {
        if (!table) continue;
        if (table.buffer && !seenTableBuffers.has(table.buffer)) { seenTableBuffers.add(table.buffer); sum.tableBuffers += table.buffer.byteLength; t.tables += table.buffer.byteLength; }
        // Each table's JSON once: metadata.batchTable is the scene's batchTable, the same object.
        if (!seenTables.has(table)) { seenTables.add(table); try { const n = JSON.stringify(table.header).length; sum.tableJsonChars += n; t.tableJson += n; } catch {} }
      }
      sum.buildings += t.buildings;
      if (b.models?.get(scene)?.collider) sum.colliders++;
      perTile.push(t);
    }
    perTile.sort((x, y) => y.lruBytes - x.lruBytes);
    // The set of tiles loaded, as a short signature (the same set gives the same number).
    let hash = 0; for (const n of names.sort()) for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
    return { sum, heldMb: Math.round(lru.cachedBytes / 1e5) / 10, items: lru.itemSet.size, visible: tiles.visibleTiles.size,
      tileSet: { count: names.length, hash }, sample: perTile.slice(0, 3) };
  };
  const near = count(b.tiles);
  const far = b.far ? count(b.far) : null;
  let cutLines = null;
  try { cutLines = __game.debug.logs.query({ event: "buildings_cut_above_deck" }).length; } catch {}
  return { sum: near.sum, nearHeldMb: near.heldMb, nearItems: near.items, visible: near.visible, tileSet: near.tileSet,
    sample: near.sample, far, farHeldMb: far ? far.heldMb : null, cutLines };
})()`;

const outDir = join(ROOT, ".qa", "memory-tiles");
mkdirSync(outDir, { recursive: true });
const port = await freePort();
const b = await launch("about:blank", { width: 1280, height: 720, port, preload });
const until = async (expr: string, tries = 180): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    const v = await b.evaluate<boolean>(expr).catch(() => false);
    if (v) return true;
    await b.sleep(1000);
  }
  return false;
};
// The tree the page came from, at the start and (below) the end (servedBuild.ts).
const servedAtStart = await servedBuild(base);
let out: Record<string, unknown> = { label, base, url, view, served: servedRecord(servedAtStart, null) };
try {
  await b.send("Page.navigate", { url });
  await until("window.__game?.getState() === 'ready'");
  await b.evaluate("window.__game.start()");
  await until("__game.debug.settled().isSettled", 150);
  // The far skyline starts after the town (or 15 s): wait for it to load and settle too.
  await until("__game.buildings.far && __game.buildings.farLoadProgress() >= 0.999", 90);
  await until("__game.debug.settled().isSettled", 120);
  const { quiet, waitedS } = await waitQuiet(b, QUIET_MS, QUIET_MAX_MS);
  await b.send("HeapProfiler.collectGarbage");
  const usage = (await b.send("Runtime.getHeapUsage")).result;
  const census = await b.evaluate<Record<string, unknown>>(CENSUS);
  out = {
    ...out,
    at: new Date().toISOString(),
    quiet,
    quietWaitS: waitedS,
    heapGcMB: Math.round(Number(usage.usedSize) / 1e6),
    backingMB: Math.round(Number(usage.backingStorageSize) / 1e6),
    census,
  };
  if (isTimed) {
    // Rows: parses [t0, ms, renderer, syncMs, tableJsonMs, gltfJsonMs, tableJsonChars], loads [t0, ms,
    // renderer], cuts [t0, ms] (page ms).
    type Timed = {
      parses: Array<[number, number, string, number, number, number, number]>;
      loads: Array<[number, number, string]>;
      cuts: Array<[number, number]>;
      installedAt: number | null;
      error: string | null;
    };
    const tp = await b.evaluate<Timed>(
      "({ parses: __tp.parses, loads: __tp.loads, cuts: __tp.cuts, installedAt: __tp.installedAt, error: __tp.error })",
    );
    const of = (who: string) => tp.parses.filter((p) => p[2] === who);
    const parseSummary = Object.fromEntries(
      ["near", "far"].map((who) => [
        who,
        {
          parse: spread(of(who).map((p) => p[1])),
          sync: spread(of(who).map((p) => p[3])),
          tableJson: spread(of(who).map((p) => p[4])),
          gltfJson: spread(of(who).map((p) => p[5])),
          loadModel: spread(tp.loads.filter((l) => l[2] === who).map((l) => l[1])),
        },
      ]),
    );
    out.timing = {
      installedAt: tp.installedAt,
      error: tp.error,
      ...parseSummary,
      cuts: spread(tp.cuts.map((c) => c[1])),
    };
    out.parses = tp.parses;
    out.loads = tp.loads;
    out.cuts = tp.cuts;
  }
  // --probe-holders: what else a tile keeps that could hold its file (the loader's result, its
  // parser), on the first tile; dropping only the scene's tables freed nothing (2026-11-17).
  if (argv.includes("--probe-holders")) {
    out.holders = await b.evaluate(`(() => {
      const tile = [...__game.buildings.tiles.lruCache.itemSet.keys()].find((t) => t.engineData?.scene?.batchTable); const e = tile?.engineData || {};
      const keys = (o) => o === null ? "null" : o && typeof o === "object" ? Object.keys(o).slice(0, 30) : typeof o;
      const md = e.metadata;
      return { engineData: keys(e), metadata: keys(md), metadataBatch: !!md?.batchTable, metadataParser: keys(md?.parser),
        parserBuffers: md?.parser ? Object.keys(md.parser.cache?.objects || {}).filter((k) => k.startsWith("buffer")).length : null,
        sceneUserData: keys(e.scene?.userData), sceneBatch: !!e.scene?.batchTable };
    })()`);
  }
  // --drop-tables: let go of every near tile's b3dm batch and feature tables (nothing in the game
  // reads them; the far tiles drop theirs on load) and read the heap and the array storage again:
  // what the tables hold, measured rather than estimated from the JSON's length.
  if (argv.includes("--drop-tables")) {
    await b.evaluate(
      `(() => { for (const tile of __game.buildings.tiles.lruCache.itemSet.keys()) { const s = tile.engineData?.scene; if (s) Object.assign(s, { batchTable: null, featureTable: null }); const md = tile.engineData?.metadata; if (md) Object.assign(md, { batchTable: null, featureTable: null, parser: null }); } })()`,
    );
    await b.send("HeapProfiler.collectGarbage");
    const after = (await b.send("Runtime.getHeapUsage")).result;
    out.droppedTables = {
      heapGcMB: Math.round(Number(after.usedSize) / 1e6),
      backingMB: Math.round(Number(after.backingStorageSize) / 1e6),
    };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
} catch (error) {
  out = { ...out, failure: String(error) };
  process.stdout.write(`${JSON.stringify({ failure: String(error) })}\n`);
} finally {
  const served = servedRecord(servedAtStart, await servedBuild(base));
  out.served = served;
  writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  warnIfNotSame(served, join(outDir, `${label}.json`));
  await b.close();
}
