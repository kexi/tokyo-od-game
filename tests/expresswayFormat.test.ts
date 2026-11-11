import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packTiles, tileOfChunk, tileRunOf } from "../src/expressway/files";
import {
  XW_VERSION,
  type XwChunk,
  type XwEntrance,
  type XwMeta,
  type XwRunSummary,
} from "../src/expressway/format";
import { tileKey } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { onLogLine } from "../src/log";
import { ExpresswayDecks, GRAPH_RADIUS_M } from "../src/world/expresswayDeck";
import { MAX_CHUNK_M } from "../src/expressway/compile";
import { DeckIndex, roleOf } from "../src/world/expresswayMarkings";
import { expresswayRoadInput } from "../src/world/expresswayRoads";
import { expresswayDataDir, readExpresswayFiles } from "../scripts/expresswayFiles";

// Format 6 (P2.7-4): meta.json an index only, the runs the game reads and the entrances in the
// tiles, the build's record in report.json. Checked on the data folder the tests read (XW_DATA_DIR,
// else public/data/expressway), and the run-time reading on the default data.
const files = readExpresswayFiles();
const DIR = expresswayDataDir();
const isDefault = !process.env.XW_DATA_DIR;
const ellipsoidal = (_lat: number, _lon: number, h: number) => h + 36.9;

/** The meta.json fields of format 6: an index, none sized by the runs or the diagnostics. */
const META_FIELDS = [
  "version",
  "features",
  "zoom",
  "tiles",
  "ranges",
  "scope",
  "structures",
  "extract",
  "counts",
  "bytes",
];

describe("format 6: the files", () => {
  it("meta.json is the index only: version 6 and the index fields, nothing per run, diagnostic or entrance", () => {
    expect(files.meta.version).toBe(XW_VERSION);
    expect(XW_VERSION).toBe(6);
    for (const key of Object.keys(files.meta)) expect(META_FIELDS, key).toContain(key);
    expect(files.meta.counts.runs).toBe(files.runs.length);
    expect(files.meta.counts.chunks).toBe(files.chunks.length);
  });

  it("keeps meta.json within 30 KB gzip and every tile within 200 KB raw and 60 KB gzip (the start-up and streaming budgets)", () => {
    const meta = readFileSync(join(DIR, "meta.json"));
    expect(gzipSync(meta).length).toBeLessThanOrEqual(30_000);
    for (const key of files.meta.tiles) {
      const raw = readFileSync(join(DIR, `${key}.json`));
      expect(raw.length, key).toBeLessThanOrEqual(200_000);
      expect(gzipSync(raw).length, key).toBeLessThanOrEqual(60_000);
    }
  });

  it("gives each tile the summaries of exactly the runs of its chunks, each as report.json has it, by id", () => {
    for (const [key, tile] of files.tiles) {
      const ids = [...new Set(tile.chunks.map((c) => c.run))].sort();
      expect(
        tile.runs.map((r) => r.id),
        key,
      ).toEqual(ids);
      for (const r of tile.runs) expect(r, `${key} ${r.id}`).toEqual(tileRunOf(files.runById.get(r.id)!));
    }
  });

  it("puts each entrance in the tile of its street end, once, and carries no tile without chunks or entrances", () => {
    const seen = new Set<string>();
    for (const [key, tile] of files.tiles) {
      for (const e of tile.entrances ?? []) {
        expect(tileKey(e.lon, e.lat, files.meta.zoom), e.run).toBe(key);
        expect(seen.has(e.run), e.run).toBe(false);
        seen.add(e.run);
      }
      const isEmpty = tile.chunks.length === 0 && (tile.entrances ?? []).length === 0;
      expect(isEmpty, key).toBe(false);
    }
    // Every entrance ramp the build wrote has its entrance (the 103・104 need it).
    if (isDefault) expect(files.entrances.length).toBeGreaterThan(0);
  });

  it("report.json carries the runs, diagnostics, closed runs and solver; every block lists its runs with a data hash", () => {
    expect(files.record.version).toBe(1);
    expect(files.record.runs.map((r) => r.id)).toEqual([...files.byRun.keys()].sort());
    const inBlocks = new Set(files.record.blocks.flatMap((b) => b.runs));
    for (const r of files.runs) expect(inBlocks.has(r.id), r.id).toBe(true);
    for (const b of files.record.blocks) expect(b.dataHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the game's code never reads report.json or ledger.json (only tests and tools do)", () => {
    const root = join(import.meta.dirname, "..", "src");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|js)$/.test(name)) sources.push(path);
      }
    };
    walk(root);
    const offenders = sources.filter((path) => {
      // Comments may name the files (the format's own description does): code may not.
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return /(report|ledger)\.json/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

describe("format 6: packing the tiles", () => {
  const files6 = readExpresswayFiles(join(import.meta.dirname, "..", "public", "data", "expressway"));

  it("packs the same tiles byte for byte whatever order the chunks, runs and entrances come in", () => {
    const a = packTiles(files6.chunks, files6.runs, files6.entrances, 14);
    const b = packTiles(
      files6.chunks.toReversed(),
      files6.runs.toReversed(),
      files6.entrances.toReversed(),
      14,
    );
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const key of a.keys()) expect(JSON.stringify(b.get(key))).toBe(JSON.stringify(a.get(key)));
    // And the same as the files written (the tiles are written as packed).
    for (const key of a.keys())
      expect(JSON.stringify(a.get(key))).toBe(readFileSync(join(files6.dir, `${key}.json`), "utf8"));
  });

  it("files a chunk under its middle station, and makes a tile for an entrance whose street end has no chunk", () => {
    const c = files6.chunks[0];
    const far: XwEntrance = { ...files6.entrances[0], lon: 139.9, lat: 35.8 };
    const tiles = packTiles([c], files6.runs, [far], 14);
    expect([...tiles.keys()].sort()).toEqual([tileOfChunk(c, 14), tileKey(far.lon, far.lat, 14)].sort());
    expect(tiles.get(tileKey(far.lon, far.lat, 14))).toEqual({ chunks: [], runs: [], entrances: [far] });
  });
});

/** ExpresswayDecks over the default data folder, fetched from the files (and how many tiles it read). */
function decksOverDefault() {
  const dir = join(import.meta.dirname, "..", "public", "data", "expressway");
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/").pop()!;
    fetched.push(name);
    try {
      const text = readFileSync(join(dir, name), "utf8");
      return { ok: true, json: async () => JSON.parse(text) as unknown };
    } catch {
      return { ok: false, json: async () => null };
    }
  });
  const decks = new ExpresswayDecks(new Scene(), null, ellipsoidal, new LocalFrame(35.65, 139.75, 40), "/");
  return { decks, fetched };
}

describe.runIf(isDefault)(
  "format 6 at run time: reading per tile gives what reading every run at once gave",
  () => {
    afterEach(() => vi.unstubAllGlobals());
    const all = readExpresswayFiles(join(import.meta.dirname, "..", "public", "data", "expressway"));
    // The centre of each range, and points just inside the corners of each tile (where the 3 × 3 read
    // around the point reaches least far beyond the chunks near it).
    const points: Array<{ lat: number; lon: number; name: string }> = [
      ...all.meta.ranges.map((r) => ({
        lat: (r.minLat + r.maxLat) / 2,
        lon: (r.minLon + r.maxLon) / 2,
        name: r.name,
      })),
      ...all.meta.tiles.flatMap((key) => {
        const [x, y] = key.split("-").map(Number);
        const lon = (x / 2 ** 14) * 360 - 180;
        const lonE = ((x + 1) / 2 ** 14) * 360 - 180;
        const latOf = (yy: number) =>
          (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / 2 ** 14))) * 180) / Math.PI;
        return [
          { lat: latOf(y) - 0.0005, lon: lon + 0.0005, name: `${key} NW` },
          { lat: latOf(y + 1) + 0.0005, lon: lonE - 0.0005, name: `${key} SE` },
        ];
      }),
    ];

    it("gives the same road-graph input at each point as the chunks with every run summary at once (format 5's reading)", async () => {
      let compared = 0;
      for (const p of points) {
        // A new reader per point: what it knows is only the tiles that point reads (not what earlier
        // points left behind), the worst case of a fresh page.
        const { decks } = decksOverDefault();
        const got = await decks.roadInput(p.lat, p.lon);
        expect(got, p.name).not.toBeNull();
        // In the order the decks handed them (tile by tile, as format 5 did too).
        const chunks = got!.lines.map((l) => all.chunks.find((c) => c.id === l.xid)!);
        const expected = expresswayRoadInput(chunks, all.runs, ellipsoidal);
        expect(got, p.name).toEqual(expected);
        compared += got!.lines.length;
      }
      expect(compared).toBeGreaterThan(0);
    });

    it("makes the same 分合流 roles (roleOf) for every pair of runs of the loaded chunks, each point read by a new reader", async () => {
      const full = new Map(all.runs.map((r) => [r.id, r]));
      let compared = 0;
      for (const p of points) {
        const { decks } = decksOverDefault();
        await decks.roadInput(p.lat, p.lon);
        const index = (decks as unknown as { index: DeckIndex }).index;
        const runs = [...new Set(all.chunks.map((c) => c.run))].filter((r) => index.chunksOf(r).length > 0);
        for (const a of runs)
          for (const b of runs) {
            if (a === b) continue;
            expect(roleOf(index.runs, a, b), `${p.name} ${a}|${b}`).toBe(roleOf(full, a, b));
            compared++;
          }
      }
      expect(compared).toBeGreaterThan(0);
    });

    it("reads far enough: the graph radius, a chunk and half a chunk (a chunk is filed by its middle station) stay inside the 3 × 3 tiles", () => {
      // The 3 × 3 reaches at least one whole z14 tile past the point's own tile on every side; at the
      // universe's northern edge (35.87° N) a tile is about 1,982 m (1,987 m at 35.65° N).
      const tileM = (40_075_016.686 * Math.cos((35.87 * Math.PI) / 180)) / 2 ** 14;
      expect(GRAPH_RADIUS_M + MAX_CHUNK_M + MAX_CHUNK_M / 2).toBeLessThan(tileM);
    });

    it("hands the entrances to its listener as the tiles holding them are read (the 103・104 are planned again)", async () => {
      const { decks } = decksOverDefault();
      const heard: XwEntrance[][] = [];
      decks.onEntrances((list) => heard.push(list));
      expect(heard).toEqual([[]]);
      for (const e of all.entrances) await decks.roadInput(e.lat, e.lon);
      expect(heard.at(-1)).toEqual(all.entrances);
      expect(decks.entrances()).toEqual(all.entrances);
      // Heard once more for each read that added some, never for a read that added none.
      const before = heard.length;
      await decks.roadInput(all.entrances[0].lat, all.entrances[0].lon);
      expect(heard.length).toBe(before);
    });
  },
);

describe("format 6 at run time: a tile's run summary disagreeing with another's", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps the first summary read and warns (a broken build)", async () => {
    const all = readExpresswayFiles(join(import.meta.dirname, "..", "public", "data", "expressway"));
    const run = all.runs.find(
      (r) => all.meta.tiles.filter((k) => all.tiles.get(k)!.runs.some((x) => x.id === r.id)).length > 1,
    )!;
    const keys = all.meta.tiles.filter((k) => all.tiles.get(k)!.runs.some((x) => x.id === run.id));
    const meta: XwMeta = { ...all.meta };
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!.replace(".json", "");
      if (name === "meta") return { ok: true, json: async () => meta };
      const tile = all.tiles.get(name);
      if (!tile) return { ok: false, json: async () => null };
      const isSecond = name === keys[1];
      const runs = isSecond
        ? tile.runs.map((r) => (r.id === run.id ? { ...r, cls: "street" as const } : r))
        : tile.runs;
      return { ok: true, json: async () => ({ ...tile, runs }) };
    });
    const warnings: string[] = [];
    const stop = onLogLine((line) => warnings.push(line));
    const decks = new ExpresswayDecks(new Scene(), null, ellipsoidal, new LocalFrame(35.65, 139.75, 40), "/");
    const chunkIn = (key: string): XwChunk => all.tiles.get(key)!.chunks.find((c) => c.run === run.id)!;
    for (const key of keys) {
      const c = chunkIn(key);
      await decks.roadInput(c.st[2], c.st[1]);
    }
    stop();
    const index = (decks as unknown as { index: DeckIndex }).index;
    expect((index.runs.get(run.id) as XwRunSummary | undefined)?.cls).toBe(run.cls);
    expect(warnings.some((w) => w.includes("expressway_tile_run_mismatch"))).toBe(true);
  });

  it("treats a tile without its runs (an older file) as a failed read: warned, no chunk of it used", async () => {
    const all = readExpresswayFiles(join(import.meta.dirname, "..", "public", "data", "expressway"));
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!.replace(".json", "");
      if (name === "meta") return { ok: true, json: async () => all.meta };
      const tile = all.tiles.get(name);
      return tile
        ? { ok: true, json: async () => ({ chunks: tile.chunks }) }
        : { ok: false, json: async () => null };
    });
    const warnings: string[] = [];
    const stop = onLogLine((line) => warnings.push(line));
    const decks = new ExpresswayDecks(new Scene(), null, ellipsoidal, new LocalFrame(35.65, 139.75, 40), "/");
    const c = all.chunks[0];
    const got = await decks.roadInput(c.st[2], c.st[1]);
    stop();
    expect(got?.lines).toEqual([]);
    expect(warnings.some((w) => w.includes("expressway_tile_failed") && w.includes("without runs"))).toBe(
      true,
    );
  });
});
