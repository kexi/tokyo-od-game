// Build-time table of river water levels for the water layer (public/data/water-levels.json):
// the typical level of every 水位観測所 in the 23 wards, so river surfaces stand where the water is
// observed rather than where the laser survey happened to catch it.
//
// - 東京都 水防災総合情報システム: station list and gauge datum from its pages, 10-minute levels from
//   its daily CSVs (no CORS, so read here). Its numbers are free to use with the source named
//   (https://www.kasen-suibo.metro.tokyo.lg.jp/im/other/tsim0107g.html).
// - Not 国土交通省 水文水質データベース (荒川・中川・旧江戸川): the site prohibits fetching with tools,
//   and those open tidal reaches stand within 0.15 m of the bay's mean (JMA) anyway.
// - 気象庁 潮位表 東京 (TK): the bay's mean and daily range on the same days, to compare with.
// - 国土地理院 DEM5A and 地理院ベクトルタイル: the surveyed water surface at each gauge, so the game
//   can shift the survey by (typical − surveyed) around the gauge.
//
// Run: node scripts/water-levels.ts   (about two minutes: one request a second to the 都 site)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

const OUT = join(import.meta.dirname, "..", "public", "data", "water-levels.json");
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
const SUIBO = "https://www.kasen-suibo.metro.tokyo.lg.jp/im";
/** A.P. ±0 in T.P. (国土交通省 zeroHighFix −1.1344 m for A.P. gauges). */
const AP = -1.1344;
/** 潮位表基準面 of 東京 (TK) in T.P. m. */
const TK_DATUM = -1.141;

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 404) return null;
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      log("fetch_retry", { url, attempt, error: String(error) });
      await sleep(2000 * attempt);
    }
  }
  return null;
}

type Gauge = {
  name: string;
  river: string;
  lat: number;
  lon: number;
  level: number;
  range: number;
  tidal: boolean;
  surveyed: number | null;
};

// ---------- 東京都 水防災総合情報システム ----------

type Station = {
  kbn: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  city: string;
  tg: string;
};

const dms = (d: string, m: string, s: string) => Number(d) + Number(m) / 60 + Number(s) / 3600;

/** The map page declares its stations as parallel JS arrays (`var arrry… = ['…', …];`). */
function parseStations(html: string): Station[] {
  const arrays = new Map<string, string[]>();
  for (const m of html.matchAll(/var\s+(arr\w+)\s*=\s*\[([^\]]*)\]/g)) {
    arrays.set(
      m[1],
      [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1]),
    );
  }
  const col = (name: string) => arrays.get(name) ?? [];
  const latD = col("arrayIdoFun"); // sic: the degrees array is named …Fun on the page
  const latM = col("arrryIdoFun");
  const latS = col("arrryIdoByo");
  const lonD = col("arrryKeidoDo");
  const lonM = col("arrryKeidoFun");
  const lonS = col("arrryKeidoByo");
  const kbn = col("arrryKansokujoKbn");
  const code = col("arrryKansokujoCd");
  const name = col("arrryKansokujoNm");
  const city = col("arrryShikuchosonCd");
  const tg = col("arrryTougouCd");
  return code.map((c, i) => ({
    kbn: kbn[i],
    code: c,
    name: name[i],
    lat: Number(dms(latD[i], latM[i], latS[i]).toFixed(5)),
    lon: Number(dms(lonD[i], lonM[i], lonS[i]).toFixed(5)),
    city: city[i],
    tg: tg[i],
  }));
}

/**
 * A station page shows the latest level twice, above the gauge's zero and in A.P., with the
 * distance down from the bank top (天端下り): zero = A.P. − level, crest = A.P. + 天端下り.
 */
function parseStationPage(html: string): { river: string; zeroTP: number; crestTP: number } | null {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const river = text.match(/\d{4}\/\d\d\/\d\d \d\d:\d\d 時点 (\S+)/)?.[1];
  const m = text.match(/現在の水位\(m\)\s+(\S+)\s+A\.P\.\(m\)\s+(\S+)\s+天端下り\(m\)\s+(\S+)/);
  if (!river || !m) return null;
  const [gauge, ap, down] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const isReading = [gauge, ap, down].every(Number.isFinite);
  if (!isReading) return null;
  return { river, zeroTP: ap - gauge + AP, crestTP: ap + down + AP };
}

/** The days sampled: the 15th of each of the last 11 months, and the 1st, 8th and 22nd of the last. */
function sampleDays(today: Date): string[] {
  const days: Date[] = [];
  for (let k = 1; k <= 11; k++)
    days.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, 15)));
  for (const d of [1, 8, 22])
    days.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, d)));
  return days.map((d) => d.toISOString().slice(0, 10).replaceAll("-", ""));
}

/** 10-minute levels (cm above the gauge zero) by station name, per day; empty cells are missing. */
function parseLevels(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const line of text.split("\n")) {
    const [time, name, cm] = line.trim().split(",");
    const isValue = time && name && cm !== undefined && cm.trim() !== "";
    if (!isValue) continue;
    const list = out.get(name) ?? [];
    list.push(Number(cm));
    out.set(name, list);
  }
  return out;
}

const median = (v: number[]) => {
  const s = v.toSorted((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------- 気象庁 潮位表 ----------

async function bayOn(days: string[]): Promise<{ mean: number; range: number }> {
  const years = new Map<number, string[]>();
  for (const year of new Set(days.map((d) => Number(d.slice(0, 4))))) {
    const res = await get(`https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/TK.txt`);
    years.set(year, res ? (await res.text()).split("\n").filter((l) => l.length >= 80) : []);
  }
  const all: number[] = [];
  const ranges: number[] = [];
  for (const d of days) {
    const lines = years.get(Number(d.slice(0, 4))) ?? [];
    const line = lines.find(
      (l) =>
        Number(l.slice(74, 76)) === Number(d.slice(4, 6)) &&
        Number(l.slice(76, 78)) === Number(d.slice(6, 8)),
    );
    if (!line) continue;
    const hourly = Array.from(
      { length: 24 },
      (_, h) => Number(line.slice(h * 3, h * 3 + 3)) / 100 + TK_DATUM,
    );
    all.push(...hourly);
    ranges.push(Math.max(...hourly) - Math.min(...hourly));
  }
  const mean = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  return { mean: round(mean), range: round(ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length)) };
}

// ---------- the surveyed surface (DEM5A on GSI water polygons) ----------

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const demTiles = new Map<string, Promise<Float32Array | null>>();
const waterTiles = new Map<string, Promise<number[][][]>>();

function demTile(x: number, y: number): Promise<Float32Array | null> {
  const key = `${x}/${y}`;
  let p = demTiles.get(key);
  if (!p) {
    p = get(`https://cyberjapandata.gsi.go.jp/xyz/dem5a/15/${x}/${y}.txt`).then(async (res) => {
      if (!res) return null;
      const out = new Float32Array(256 * 256).fill(Number.NaN);
      (await res.text())
        .trim()
        .split("\n")
        .forEach((line, j) =>
          line.split(",").forEach((v, i) => {
            if (i < 256 && j < 256) out[j * 256 + i] = v === "e" ? Number.NaN : Number(v);
          }),
        );
      return out;
    });
    demTiles.set(key, p);
  }
  return p;
}

/** waterarea rings of a z16 tile in global z16 units. */
function waterTile(x: number, y: number): Promise<number[][][]> {
  const key = `${x}/${y}`;
  let p = waterTiles.get(key);
  if (!p) {
    p = get(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/16/${x}/${y}.pbf`).then(async (res) => {
      if (!res) return [];
      const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.waterarea;
      const out: number[][][] = [];
      if (!layer) return out;
      for (let i = 0; i < layer.length; i++) {
        const rings = layer.feature(i).loadGeometry();
        out.push(
          rings.map((ring) => ring.flatMap((pt) => [x + pt.x / layer.extent, y + pt.y / layer.extent])),
        );
      }
      return out;
    });
    waterTiles.set(key, p);
  }
  return p;
}

async function isWater(lat: number, lon: number): Promise<boolean> {
  const gx = lon2x(lon, 16);
  const gy = lat2y(lat, 16);
  let inside = false;
  for (const poly of await waterTile(Math.floor(gx), Math.floor(gy))) {
    for (const ring of poly) {
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi, xj, yj] = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
        if (yi > gy !== yj > gy && gx < ((xj - xi) * (gy - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** 20th percentile of DEM5A on water within 60 m (the game's level sampling, wider). */
async function surveyedAt(lat: number, lon: number): Promise<number | null> {
  const values: number[] = [];
  const mLat = 111_000;
  const mLon = 111_000 * Math.cos((lat * Math.PI) / 180);
  for (let dy = -60; dy <= 60; dy += 5) {
    for (let dx = -60; dx <= 60; dx += 5) {
      if (dx * dx + dy * dy > 3600) continue;
      const la = lat + dy / mLat;
      const lo = lon + dx / mLon;
      if (!(await isWater(la, lo))) continue;
      const gx = lon2x(lo, 15) * 256;
      const gy = lat2y(la, 15) * 256;
      const tile = await demTile(Math.floor(gx / 256), Math.floor(gy / 256));
      const h = tile?.[(Math.floor(gy) % 256) * 256 + (Math.floor(gx) % 256)];
      if (h !== undefined && Number.isFinite(h)) values.push(h);
    }
  }
  if (values.length < 3) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return round(sorted[Math.round(0.2 * (sorted.length - 1))]);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ---------- main ----------

async function main(): Promise<void> {
  const top = await get(`${SUIBO}/uryosuii/tsim0102g.html`);
  if (!top) throw new Error("station list unavailable");
  const all = parseStations(await top.text());
  // kbn 02 = 水位 (01 雨量, 03 調節池, 04/05 水門潮位 (graphs only), 07/09 cameras).
  const levelStations = all.filter((s) => s.kbn === "02");
  const inWards = levelStations.filter((s) => s.city.startsWith("131"));
  const nameCount = new Map<string, number>();
  for (const s of levelStations) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
  log("stations", { all: all.length, level: levelStations.length, wards: inWards.length });

  const pages = new Map<string, { river: string; zeroTP: number; crestTP: number }>();
  for (const s of inWards) {
    const res = await get(`${SUIBO}/uryosuii/tsim0105g_${s.tg}.html?tgid=${s.tg}`);
    const page = res ? parseStationPage(await res.text()) : null;
    if (page) pages.set(s.code, page);
    else log("station_page_unreadable", { code: s.code, name: s.name });
    await sleep(1000);
  }

  const days = sampleDays(new Date());
  const byDay: Array<Map<string, number[]>> = [];
  for (const day of days) {
    const res = await get(`${SUIBO}/other/Tokyo_Suii_${day}.csv`);
    if (!res) {
      log("levels_missing", { day });
      continue;
    }
    byDay.push(parseLevels(new TextDecoder("shift_jis").decode(await res.arrayBuffer())));
    await sleep(1000);
  }

  const gauges: Gauge[] = [];
  for (const s of inWards) {
    const page = pages.get(s.code);
    // Names are the only key in the CSV: a name used twice cannot be told apart.
    const isAmbiguous =
      (nameCount.get(s.name) ?? 0) > 1 || byDay.some((d) => (d.get(s.name)?.length ?? 0) > 144);
    if (!page || isAmbiguous) continue;
    const levels: number[] = [];
    const ranges: number[] = [];
    for (const day of byDay) {
      const cm = day.get(s.name);
      if (!cm || cm.length < 120) continue;
      const tp = cm.map((v) => page.zeroTP + v / 100);
      levels.push(...tp);
      ranges.push(Math.max(...tp) - Math.min(...tp));
    }
    if (ranges.length < 5) continue;
    const range = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    gauges.push({
      name: s.name,
      river: page.river,
      lat: s.lat,
      lon: s.lon,
      level: round(median(levels)),
      range: round(range),
      // A gauge low enough for the sea that swings more than half a metre a day is tidal: those
      // on held water (behind weirs, 四ノ橋 0.46 m) or far up a river (田島橋) swing less.
      tidal: range > 0.5 && page.zeroTP < 1,
      surveyed: await surveyedAt(s.lat, s.lon),
    });
  }
  const bay = await bayOn(days);

  const file = {
    generatedAt: new Date().toISOString(),
    days,
    bay,
    sources: [
      {
        id: "tokyo-suibo",
        title: "東京都水防災総合情報システム 水位観測所（10分値）",
        url: "https://www.kasen-suibo.metro.tokyo.lg.jp/",
        note: "観測所ページの水位と A.P. から零点高を求め、上記の日の 10 分値の中央値を典型水位とした",
      },
      {
        id: "jma-tide",
        title: "気象庁 潮位表（東京）",
        url: "https://www.data.jma.go.jp/kaiyou/db/tide/suisan/",
      },
    ],
    gauges,
  };
  await writeFile(OUT, `${JSON.stringify(file, null, 1)}\n`);
  log("written", { path: OUT, gauges: gauges.length, tidal: gauges.filter((g) => g.tidal).length, bay });
}

await main();
