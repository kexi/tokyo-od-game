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
//   just measure-tile-memory label base [args]
//   pnpm exec tsx scripts/qa/memory-tiles.ts --label L [--base URL] [--start lat,lon] [--view far] [--drop-tables]
//
// Output: one JSON line on stdout and .qa/memory-tiles/<label>.json.
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
const start = flag("start") ?? "35.6812,139.7671";
const view = flag("view") ?? "far";
const url = `${base}?start=${start}&time=day&weather=clear&seed=20261115`;
const preload = `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}`;
/** The tiles stop streaming for this long before the count (perf-buildings.ts waits the same). */
const QUIET_MS = 5000;
const QUIET_MAX_MS = 60_000;

/** Page-side: every loaded near tile, array by array (see the header). */
const CENSUS = `(() => {
  const b = __game.buildings; const tiles = b.tiles; const lru = tiles.lruCache;
  const sum = { tiles: 0, buildings: 0, lruBytes: 0, meshes: 0, attributes: {}, attributeBuffers: 0, index: 0, indexBuffers: 0,
    textures: 0, tableBuffers: 0, tableJsonChars: 0, colliders: 0, vertices: 0, triangles: 0 };
  const seenBuffers = new Set(); const seenTextures = new Set(); const seenTableBuffers = new Set();
  const addBuffer = (buffer) => { if (!buffer || seenBuffers.has(buffer)) return 0; seenBuffers.add(buffer); return buffer.byteLength; };
  const perTile = [];
  // itemSet is a Map (tile → when it was added): its keys are the tiles.
  for (const tile of lru.itemSet.keys()) {
    const scene = tile.engineData?.scene;
    if (!scene) continue;
    const t = { lruBytes: lru.bytesMap.get(tile) || 0, attributes: 0, buffers: 0, index: 0, tables: 0, tableJson: 0, buildings: 0 };
    sum.tiles++; sum.lruBytes += t.lruBytes;
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
    for (const table of [scene.batchTable, scene.featureTable]) {
      if (!table) continue;
      if (table.buffer && !seenTableBuffers.has(table.buffer)) { seenTableBuffers.add(table.buffer); sum.tableBuffers += table.buffer.byteLength; t.tables += table.buffer.byteLength; }
      try { const n = JSON.stringify(table.header).length; sum.tableJsonChars += n; t.tableJson += n; } catch {}
    }
    t.buildings = scene.featureTable?.header?.BATCH_LENGTH ?? scene.batchTable?.count ?? 0;
    sum.buildings += t.buildings;
    if (b.models?.get(scene)?.collider) sum.colliders++;
    perTile.push(t);
  }
  perTile.sort((x, y) => y.lruBytes - x.lruBytes);
  return { sum, nearHeldMb: Math.round(lru.cachedBytes / 1e5) / 10, nearItems: lru.itemSet.size,
    farHeldMb: b.far ? Math.round(b.far.lruCache.cachedBytes / 1e5) / 10 : null, visible: tiles.visibleTiles.size,
    sample: perTile.slice(0, 5), perTileCount: perTile.length };
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
let out: Record<string, unknown> = { label, base, url, view };
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
  writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  await b.close();
}
