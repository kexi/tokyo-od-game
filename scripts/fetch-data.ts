// Build-time data pipeline: downloads Tokyo open data, verifies each dataset's licence via the
// catalogue API, normalises POIs for the 23 wards and writes compact JSON into public/data.
// Run: node scripts/fetch-data.ts   (Node >= 23 strips TypeScript types natively)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BusStopFileSchema,
  GeoidGridSchema,
  PoiFileSchema,
  type Category,
  type PoiFile,
  type Source,
} from "../src/data/schema.ts";
import { AreaIndex, encodeRing, type AreaFile } from "../src/geo/areas.ts";
import { readDbf, readPolygons, simplifyRing, unzip } from "./shapefile.ts";
import {
  decodeJapanese,
  findColumn,
  parseCsv,
  toNumber,
  wardFromAddress,
  wardFromCode,
  WARD_NAMES,
} from "./csv.ts";
import { log } from "../src/log.ts";

const OUT = join(import.meta.dirname, "..", "public", "data");
const CKAN = "https://catalog.data.metro.tokyo.lg.jp/api/3/action";
const ODPT = "https://api-public.odpt.org/api/v4";
const ALLOWED_LICENSES = new Set(["CC-BY-4.0"]);
// 23-ward bounding box (with a little margin) used to discard Tama/island rows early.
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };

type CsvSource = {
  kind: "csv";
  datasetId: string;
  url: string;
  category: string;
  name: string[];
  lat?: string[];
  lon?: string[];
  /** Some ward files store lon in "X座標" and lat in "Y座標". */
  xy?: { x: string; y: string };
  ward?: { fixed?: string; code?: string[]; address?: string[] };
  /** Drop rows whose given column is non-empty (e.g. 稼働停止 = out of service). */
  excludeIfSet?: string;
  /** Publisher-specific attribution found on the publisher's own site (not in CKAN notes). */
  note?: string;
};

const CATEGORIES: Category[] = [
  { id: "culture", label: "都指定文化財", color: "#c38bff", points: 30 },
  { id: "landmark", label: "名所・百景", color: "#ff6fb5", points: 30 },
  { id: "nightview", label: "夜景スポット", color: "#ffd34d", points: 50 },
  { id: "facility", label: "都立施設・公園", color: "#4dd2ff", points: 25 },
  { id: "sports", label: "都立スポーツ施設", color: "#7dff9a", points: 20 },
  { id: "station", label: "都営交通の駅", color: "#3ccf6e", points: 15 },
  { id: "water", label: "水飲みスポット", color: "#59b8ff", points: 10 },
  { id: "waterbase", label: "災害時給水拠点", color: "#2f6dff", points: 15 },
  { id: "shelter", label: "避難場所", color: "#ff8a3d", points: 10 },
];

const CSV_SOURCES: CsvSource[] = [
  {
    kind: "csv",
    datasetId: "t000021d0000000017",
    url: "https://www.opendata.metro.tokyo.lg.jp/suisyoudataset/130001_cultural_property.csv",
    category: "culture",
    name: ["名称"],
    ward: { address: ["住所"] },
  },
  {
    kind: "csv",
    datasetId: "t131091d0000000005",
    url: "https://www.opendata.metro.tokyo.lg.jp/shinagawa/kankojoho-shinagawa100kei.csv",
    category: "landmark",
    name: ["名称"],
    ward: { fixed: "品川区" },
  },
  {
    kind: "csv",
    datasetId: "t131067d0000000251",
    url: "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/sisetu_30.csv",
    category: "landmark",
    name: ["名称"],
    xy: { x: "X座標", y: "Y座標" },
    ward: { fixed: "台東区" },
    // https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html
    note: "台東区のデータを利用しています。",
  },
  {
    kind: "csv",
    datasetId: "t131083d0000000045",
    url: "https://www.opendata.metro.tokyo.lg.jp/koto/131083_221_night_view_spot.csv",
    category: "nightview",
    name: ["スポット名"],
    ward: { fixed: "江東区" },
  },
  {
    kind: "csv",
    datasetId: "t000029d0000000030",
    url: "https://www.opendata.metro.tokyo.lg.jp/suisyoudataset/130001_public_facility.csv",
    category: "facility",
    name: ["名称"],
    ward: { address: ["住所"] },
  },
  {
    kind: "csv",
    datasetId: "t000056d0000000002",
    url: "https://www.opendata.metro.tokyo.lg.jp/sports/130001sports_facilities.csv",
    category: "sports",
    name: ["名称"],
    ward: { address: ["住所"] },
  },
  {
    kind: "csv",
    datasetId: "t000019d0000000003",
    url: "https://www.opendata.metro.tokyo.lg.jp/suidou/R8/tokyowaterdrinkingstation_260227.csv",
    category: "water",
    name: ["施設名"],
    ward: { address: ["所在地"] },
    excludeIfSet: "稼働停止",
  },
  {
    kind: "csv",
    datasetId: "t000019d0000000001",
    url: "https://www.opendata.metro.tokyo.lg.jp/suidou/R7/kyoten_20251211.csv",
    category: "waterbase",
    name: ["施設名"],
    ward: { address: ["所在地"] },
    note: "給水拠点等の最新情報は東京都水道局の公式サイトでご確認ください。",
  },
  {
    kind: "csv",
    datasetId: "t000003d0000000093",
    url: "https://www.opendata.metro.tokyo.lg.jp/soumu/130001_evacuation_area.csv",
    category: "shelter",
    name: ["施設名"],
    ward: { code: ["区市町村コード"], address: ["区市町村", "所在地住所"] },
  },
];

type CkanPackage = {
  name: string;
  title: string;
  license_id: string;
  license_title: string;
  notes?: string;
  organization?: { title: string };
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function ckanPackage(id: string): Promise<CkanPackage> {
  const json = (await (await fetch(`${CKAN}/package_show?id=${id}`)).json()) as { result: CkanPackage };
  return json.result;
}

/** Sentences in the dataset description that impose attribution wording, kept verbatim. */
function attributionNotes(notes: string | undefined): string | undefined {
  if (!notes) return undefined;
  const hits = notes
    .split(/[\n。]/)
    .map((s) => s.trim())
    .filter((s) => /(表示|記載|明記|出典|クレジット)/.test(s) && /(利用|使用)/.test(s));
  return hits.length ? hits.join("。") + "。" : undefined;
}

function inBbox(lat: number, lon: number): boolean {
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;
}

function locateHeader(rows: string[][], wanted: string[]): number {
  const i = rows.findIndex((r) => wanted.every((w) => r.some((h) => h.replace(/\s/g, "").includes(w))));
  return Math.max(0, i);
}

async function loadCsvSource(src: CsvSource, sourceIndex: number): Promise<PoiFile["items"]> {
  const rows = parseCsv(decodeJapanese(await fetchBytes(src.url)));
  const latKeys = src.lat ?? ["緯度"];
  const lonKeys = src.lon ?? ["経度"];
  const coordKeys = src.xy ? [src.xy.x, src.xy.y] : [latKeys[0], lonKeys[0]];
  const h = locateHeader(rows, [...coordKeys, src.name[0]]);
  const header = rows[h];
  const nameCol = findColumn(header, src.name);
  const latCol = src.xy ? findColumn(header, [src.xy.y]) : findColumn(header, latKeys);
  const lonCol = src.xy ? findColumn(header, [src.xy.x]) : findColumn(header, lonKeys);
  const codeCol = src.ward?.code ? findColumn(header, src.ward.code) : -1;
  const addrCols = (src.ward?.address ?? []).map((k) => findColumn(header, [k])).filter((i) => i >= 0);
  const excludeCol = src.excludeIfSet ? findColumn(header, [src.excludeIfSet]) : -1;
  if (nameCol < 0 || latCol < 0 || lonCol < 0) {
    throw new Error(`columns not found in ${src.url}: name=${nameCol} lat=${latCol} lon=${lonCol}`);
  }

  const items: PoiFile["items"] = [];
  let skipped = 0;
  for (const row of rows.slice(h + 1)) {
    const lat = toNumber(row[latCol]);
    const lon = toNumber(row[lonCol]);
    const name = (row[nameCol] ?? "").replace(/\s+/g, " ").trim();
    const isExcluded = excludeCol >= 0 && (row[excludeCol] ?? "").trim() !== "";
    const isUsable =
      !isExcluded && Number.isFinite(lat) && Number.isFinite(lon) && name !== "" && inBbox(lat, lon);
    if (!isUsable) {
      skipped++;
      continue;
    }
    const ward =
      src.ward?.fixed ??
      (codeCol >= 0 ? wardFromCode(row[codeCol] ?? "") : null) ??
      addrCols.map((i) => wardFromAddress(row[i] ?? "")).find((w) => w !== null) ??
      null;
    if (!ward) {
      skipped++;
      continue;
    }
    items.push([src.category, round6(lat), round6(lon), name, ward, sourceIndex]);
  }
  log("source_parsed", { url: src.url, rows: rows.length - h - 1, kept: items.length, skipped });
  return items;
}

type OdptStation = { "dc:title": string; "geo:lat"?: number; "geo:long"?: number; "odpt:railway"?: string };

async function loadToeiStations(sourceIndex: number, areas: AreaIndex): Promise<PoiFile["items"]> {
  const stations = (await (
    await fetch(`${ODPT}/odpt:Station?odpt:operator=odpt.Operator:Toei`)
  ).json()) as OdptStation[];
  const items: PoiFile["items"] = [];
  const seen = new Set<string>();
  for (const s of stations) {
    const lat = s["geo:lat"];
    const lon = s["geo:long"];
    if (lat === undefined || lon === undefined || !inBbox(lat, lon)) continue;
    // The same station appears once per line; keep one marker per name+place.
    const key = `${s["dc:title"]}@${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ward = areas.lookup(lat, lon)?.ward ?? null;
    if (!ward) continue;
    items.push(["station", round6(lat), round6(lon), `${s["dc:title"]}駅`, ward, sourceIndex]);
  }
  log("source_parsed", { url: "odpt:Station Toei", kept: items.length });
  return items;
}

/**
 * EGM2008 geoid undulation around the 23 wards, read with HTTP range requests from the
 * PROJ-data 2.5' grid (NGA EGM2008, public domain). The GSI geoid API was used first, but
 * redistributing values derived from GSI's geoid model needs Survey Act (測量法) approval.
 */
async function buildGeoid(): Promise<void> {
  const { fromUrl } = await import("geotiff");
  const tiff = await fromUrl("https://cdn.proj.org/us_nga_egm08_25.tif");
  const image = await tiff.getImage();
  const [originLon, originLat] = image.getOrigin();
  const [resLon, resLat] = image.getResolution(); // resLat < 0 (north-up raster)
  const col = (lon: number) => Math.floor((lon - originLon) / resLon);
  const row = (lat: number) => Math.floor((lat - originLat) / resLat);
  const window = [col(139.45), row(35.95), col(140.0) + 1, row(35.4) + 1];
  const rasters = (await image.readRasters({ window })) as unknown as ArrayLike<number>[];
  const band = rasters[0];
  const nLon = window[2] - window[0];
  const nLat = window[3] - window[1];
  // Raster rows run north→south; the game's grid runs south→north.
  const values: number[] = [];
  for (let i = nLat - 1; i >= 0; i--) {
    for (let j = 0; j < nLon; j++) values.push(Math.round(band[i * nLon + j] * 1000) / 1000);
  }
  const centre = (index: number, origin: number, res: number) => origin + (index + 0.5) * res;
  const grid = {
    lat0: centre(window[3] - 1, originLat, resLat),
    lon0: centre(window[0], originLon, resLon),
    dLat: -resLat,
    dLon: resLon,
    nLat,
    nLon,
    values,
    source: "EGM2008 (NGA, public domain) via PROJ-data us_nga_egm08_25.tif",
  };
  GeoidGridSchema.parse(grid);
  await writeFile(join(OUT, "geoid.json"), JSON.stringify(grid));
  log("geoid_written", { points: values.length, minM: Math.min(...values), maxM: Math.max(...values) });
}

async function buildBusStops(): Promise<void> {
  type Pole = { "owl:sameAs": string; "geo:lat"?: number; "geo:long"?: number };
  const poles = (await (
    await fetch(`${ODPT}/odpt:BusstopPole?odpt:operator=odpt.Operator:Toei`)
  ).json()) as Pole[];
  const stops: Record<string, [number, number]> = {};
  for (const p of poles) {
    if (p["geo:lat"] === undefined || p["geo:long"] === undefined) continue;
    stops[p["owl:sameAs"]] = [round6(p["geo:lat"]), round6(p["geo:long"])];
  }
  const file = BusStopFileSchema.parse({ generatedAt: new Date().toISOString(), stops });
  await writeFile(join(OUT, "busstops.json"), JSON.stringify(file));
  log("busstops_written", { stops: Object.keys(stops).length });
}

const ESTAT_AREAS =
  "https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=13&coordSys=1&format=shape&downloadType=5&datum=2011";

/**
 * 23-ward 町丁 polygons from the 2020 census small-area boundaries (e-Stat, 政府標準利用規約 2.0).
 * Simplified to ~5 m; also carries population density for crowd sizing.
 */
async function buildAreas(): Promise<void> {
  const files = unzip(Buffer.from(await fetchBytes(ESTAT_AREAS)));
  const base = [...files.keys()].find((k) => k.endsWith(".dbf"))?.replace(/\.dbf$/, "");
  if (!base) throw new Error("e-Stat archive has no dbf");
  const rows = readDbf(files.get(`${base}.dbf`) as Buffer);
  const polys = readPolygons(files.get(`${base}.shp`) as Buffer);
  const file: AreaFile = {
    source: "e-Stat 国勢調査 令和2年 小地域（町丁・字等別）境界データ 東京都（JGD2011）",
    wards: [...WARD_NAMES],
    towns: [],
  };
  rows.forEach((row, i) => {
    const code = Number(row.CITY);
    const isWard = code >= 101 && code <= 123;
    const isLand = row.HCODE === "8101";
    if (!isWard || !isLand || !row.S_NAME) return;
    const rings = polys[i].map((r) => simplifyRing(r, 0.00005)).filter((r) => r.length >= 8);
    if (rings.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rings) {
      for (let k = 0; k < r.length; k += 2) {
        minX = Math.min(minX, r[k]);
        maxX = Math.max(maxX, r[k]);
        minY = Math.min(minY, r[k + 1]);
        maxY = Math.max(maxY, r[k + 1]);
      }
    }
    const areaKm2 = Number(row.AREA) / 1e6;
    file.towns.push({
      w: code - 101,
      n: row.S_NAME,
      d: areaKm2 > 0 ? Math.round(Number(row.JINKO) / areaKm2) : 0,
      b: [minX, minY, maxX, maxY].map((v) => Math.round(v * 1e5)) as [number, number, number, number],
      r: rings.map(encodeRing),
    });
  });
  await writeFile(join(OUT, "areas.json"), JSON.stringify(file));
  log("areas_written", { towns: file.towns.length });
}

async function loadAreaIndex(): Promise<AreaIndex> {
  return new AreaIndex(JSON.parse(await readFile(join(OUT, "areas.json"), "utf8")) as AreaFile);
}

async function buildPois(): Promise<void> {
  const sources: Source[] = [];
  const items: PoiFile["items"] = [];
  const areas = await loadAreaIndex();
  for (const src of CSV_SOURCES) {
    const pkg = await ckanPackage(src.datasetId);
    // Licence gate: never ship data whose catalogue licence we have not explicitly allowed.
    if (!ALLOWED_LICENSES.has(pkg.license_id)) {
      throw new Error(`licence ${pkg.license_id} not allowed for ${src.datasetId} (${pkg.title})`);
    }
    const note = [attributionNotes(pkg.notes), src.note].filter(Boolean).join(" ") || undefined;
    sources.push({
      id: src.datasetId,
      title: pkg.title,
      publisher: pkg.organization?.title ?? "東京都",
      url: `https://catalog.data.metro.tokyo.lg.jp/dataset/${pkg.name}`,
      license: "クリエイティブ・コモンズ・ライセンス 表示4.0国際",
      ...(note ? { note } : {}),
    });
    items.push(...(await loadCsvSource(src, sources.length - 1)));
    log("licence_verified", { dataset: src.datasetId, license: pkg.license_id, note: note ?? null });
  }

  sources.push({
    id: "odpt-toei-station",
    title: "東京都交通局 駅情報",
    publisher: "東京都交通局・公共交通オープンデータ協議会",
    url: "https://ckan.odpt.org/dataset/r_station-toei",
    license: "クリエイティブ・コモンズ・ライセンス 表示4.0国際",
  });
  items.push(...(await loadToeiStations(sources.length - 1, areas)));

  // Source data contains wrong coordinates (e.g. swapped lat/lon, a 江東区 park placed at
  // Tokyo Station). Drop a point only when its stated ward is not within 1 km: stations and
  // "〜一帯" evacuation areas legitimately straddle ward borders.
  const isNearWard = (lat: number, lon: number, ward: string) => {
    if (areas.lookup(lat, lon)?.ward === ward) return true;
    for (const r of [300, 1000]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dLat = (Math.cos(a) * r) / 111_320;
        const dLon = (Math.sin(a) * r) / (111_320 * Math.cos((lat * Math.PI) / 180));
        if (areas.lookup(lat + dLat, lon + dLon)?.ward === ward) return true;
      }
    }
    return false;
  };
  const valid = items.filter((item) => {
    const hit = areas.lookup(item[1], item[2]);
    const isWrong = hit !== null && !isNearWard(item[1], item[2], item[4]);
    if (isWrong) log("poi_dropped_ward_mismatch", { name: item[3], stated: item[4], located: hit.ward });
    return !isWrong;
  });
  items.length = 0;
  items.push(...valid);

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, items.filter((i) => i[0] === c.id).length]));
  const wards = Object.fromEntries(WARD_NAMES.map((w) => [w, items.filter((i) => i[4] === w).length]));
  const file = PoiFileSchema.parse({
    generatedAt: new Date().toISOString(),
    sources,
    categories: CATEGORIES,
    items,
  });
  await writeFile(join(OUT, "pois.json"), JSON.stringify(file));
  log("pois_written", { total: items.length, counts, wards });
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

await mkdir(OUT, { recursive: true });
const only = process.argv[2];
if (!only || only === "areas") await buildAreas();
if (!only || only === "pois") await buildPois();
if (!only || only === "busstops") await buildBusStops();
if (!only || only === "geoid") await buildGeoid();
