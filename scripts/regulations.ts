// Build-time traffic regulations: JARTIC 交通規制情報 (police regulations: one-way, speed limits,
// crosswalks, stop lines, stop signs) and OpenStreetMap traffic signals, cut into z14 tiles under
// public/data so the game loads only the area around the player.
// Run: node scripts/regulations.ts   (downloads ~40 MB JARTIC + ~91 MB OSM extract)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { anchors, M_LAT, M_LON, parseCoords, reversed, streamCsv, turnMask } from "./jartic.ts";
import { readTaggedNodes } from "./osm-pbf.ts";
import { unzip } from "./shapefile.ts";

const ROOT = join(import.meta.dirname, "..", "public", "data");
const JARTIC_INDEX = "https://www.jartic.or.jp/d/opendata/opendata.json";
const JARTIC_BASE = "https://www.jartic.or.jp/d/opendata";
const OSM_EXTRACT = "https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf";
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
// 23 wards with a little margin (same box as the POI pipeline).
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const Z = 14;

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

type Tile = {
  speed: Array<[number, ...number[]]>; // [limit, lon0, lat0, lon1, lat1, …]
  speedZone: Array<[number, ...number[]]>; // [limit, polygon ring…]
  oneway: number[][]; // [startMin, endMin, …coords in the PERMITTED travel order]
  crosswalk: number[][]; // [lon1, lat1, lon2, lat2] across the road
  stopLine: number[][]; // [lon, lat]
  stopSign: number[][]; // [lon, lat]
  // Sign posts derived from the regulated sections: [type, value, lon, lat, heading°] where
  // heading is the travel direction of the traffic the sign faces (0 = north, clockwise).
  signs: number[][];
  noOvertake: number[][]; // 追越しのための右側部分はみ出し通行禁止 (yellow centre line): coords
  lanes: number[][]; // 車両通行帯: [lanes (0 = unknown), …coords]
  noLaneChange: number[][]; // 進路変更禁止 (yellow lane lines): coords
};
type SignalTile = number[][]; // [lon, lat]

/** Sign type codes in Tile.signs (the game maps them to 道路標識 designs). */
export const SIGN = {
  speed: 1, // 最高速度 (323), value = km/h
  oneway: 2, // 一方通行 (326)
  noEntry: 3, // 車両進入禁止 (303), at the far end of a one-way street
  noParking: 4, // 駐車禁止 (316)
  noStopping: 5, // 駐停車禁止 (315)
  noUturn: 6, // 転回禁止 (313)
  slow: 7, // 徐行 (329)
  turn: 8, // 指定方向外進行禁止 (311), value = allowed mask (1 left, 2 straight, 4 right)
} as const;

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const toMin = (hhmm: string) => Math.floor(Number(hhmm) / 100) * 60 + (Number(hhmm) % 100);
const tx = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const ty = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};
const inBbox = (lon: number, lat: number) =>
  lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;

function tilesOf(coords: number[]): string[] {
  const keys = new Set<string>();
  for (let i = 0; i < coords.length; i += 2) keys.add(`${tx(coords[i])}-${ty(coords[i + 1])}`);
  return [...keys];
}

/** fetch with backoff: JARTIC intermittently resets connections (ECONNRESET) regardless of UA. */
async function fetchRetry(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      if (attempt >= 5) throw new Error(`${url}: ${String(error)}`, { cause: error });
      log("fetch_retry", { url, attempt, error: String((error as Error).cause ?? error) });
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchRetry(url)).arrayBuffer());
}

async function buildJartic(): Promise<{ tiles: Map<string, Tile>; month: string; release: string }> {
  type Entry = {
    type: string;
    targetMonth: string;
    releaseDay: string;
    targetList: Array<{ id: string; link: string }>;
  };
  const index = (await (await fetchRetry(JARTIC_INDEX)).json()) as Entry[];
  const typeD = index.find((e) => e.type === "typeD");
  const tokyo = typeD?.targetList.find((t) => t.id === "R13");
  if (!typeD || !tokyo) throw new Error("JARTIC typeD Tokyo entry not found");
  log("jartic_download", { month: typeD.targetMonth, link: tokyo.link });
  const files = unzip(Buffer.from(await fetchBytes(`${JARTIC_BASE}${tokyo.link}`)));
  const csvName = [...files.keys()].find((k) => k.endsWith(".csv"));
  if (!csvName) throw new Error("no CSV in JARTIC archive");

  const tiles = new Map<string, Tile>();
  const tile = (key: string) => {
    let t = tiles.get(key);
    if (!t) {
      t = {
        speed: [],
        speedZone: [],
        oneway: [],
        crosswalk: [],
        stopLine: [],
        stopSign: [],
        signs: [],
        noOvertake: [],
        lanes: [],
        noLaneChange: [],
      };
      tiles.set(key, t);
    }
    return t;
  };
  const sign = (type: number, value: number, a: [number, number, number]) =>
    tile(`${tx(a[0])}-${ty(a[1])}`).signs.push([type, value, ...a]);
  /** File one regulation into its tiles; false when it is not usable in the game. */
  const addRegulation = (
    code: string,
    coords: number[],
    window: [number, number],
    limit: number,
    name: string,
    shape: string,
    extra: { side: string; lanes: number; entry: number[]; exits: number[] },
  ): boolean => {
    const at = (i: number) => tile(`${tx(coords[i])}-${ty(coords[i + 1])}`);
    // Line regulations apply both ways unless 片側 (side code 2); signs face each direction.
    const signsAlong = (type: number, value: number, spacing: number, bothWays: boolean) => {
      for (const a of anchors(coords, spacing)) sign(type, value, a);
      if (bothWays) for (const a of anchors(reversed(coords), spacing)) sign(type, value, a);
    };
    if (code === "11") {
      // Verified against OSM (98 % of 9,126 matched records): coordinates run AGAINST the
      // permitted direction, so reverse them into travel order.
      const travel: number[] = [];
      for (let i = coords.length - 2; i >= 0; i -= 2) travel.push(coords[i], coords[i + 1]);
      for (const key of tilesOf(travel)) tile(key).oneway.push([...window, ...travel]);
      for (const a of anchors(travel, 150)) sign(SIGN.oneway, 0, a);
      // 車両進入禁止 at the exit end, facing traffic that would enter against the flow.
      const [exit] = anchors(coords, 1e9);
      if (exit) sign(SIGN.noEntry, 0, exit);
      return true;
    }
    if (code === "112" || code === "114") {
      // 「最高速度（自動車道）」 is the elevated 首都高; the game only drives ground roads, and its
      // centreline often lies right above an arterial, which would inherit the wrong limit.
      const isExpressway = name.includes("自動車道");
      if (!limit || isExpressway) return false;
      const isArea = code === "114" || shape === "3";
      for (const key of tilesOf(coords))
        (isArea ? tile(key).speedZone : tile(key).speed).push([limit, ...coords]);
      // Zone limits get their signs at the zone entrances, which needs the road graph (runtime).
      if (!isArea) signsAlong(SIGN.speed, limit, 300, true);
      return true;
    }
    const bothWays = extra.side !== "2";
    if (code === "115") {
      signsAlong(SIGN.noParking, 0, 200, bothWays);
      return true;
    }
    if (code === "65") {
      signsAlong(SIGN.noStopping, 0, 200, bothWays);
      return true;
    }
    if (code === "51") {
      signsAlong(SIGN.noUturn, 0, 300, bothWays);
      return true;
    }
    if (code === "61") {
      signsAlong(SIGN.slow, 0, 200, true);
      return true;
    }
    if (code === "17") {
      for (const key of tilesOf(coords)) tile(key).noOvertake.push(coords);
      return true;
    }
    if (code === "20") {
      for (const key of tilesOf(coords)) tile(key).lanes.push([extra.lanes, ...coords]);
      return true;
    }
    if (code === "52" || code === "119") {
      for (const key of tilesOf(coords)) tile(key).noLaneChange.push(coords);
      return true;
    }
    if (code === "12") {
      // Spec K 2.1: the point is the junction centre, 進入方向 the approach, 指定する方向 the exits.
      const isRightBan = name === "右折禁止";
      const mask =
        extra.entry.length >= 2 && extra.exits.length >= 2
          ? turnMask(coords, extra.entry, extra.exits)
          : isRightBan
            ? 3
            : name === "右折及び直進禁止"
              ? 1
              : 0;
      if (!mask || mask === 7 || extra.entry.length < 2) return false;
      const hx = (coords[0] - extra.entry[0]) * M_LON;
      const hy = (coords[1] - extra.entry[1]) * M_LAT;
      const dist = Math.hypot(hx, hy);
      if (dist < 1) return false;
      // Sign on the approach, ~12 m before the junction centre.
      const back = Math.min(dist, 12) / dist;
      const lon = round(coords[0] - (coords[0] - extra.entry[0]) * back);
      const lat = round(coords[1] - (coords[1] - extra.entry[1]) * back);
      sign(SIGN.turn, mask, [lon, lat, Math.round(((Math.atan2(hx, hy) * 180) / Math.PI + 360) % 360)]);
      return true;
    }
    if (code === "85") {
      if (coords.length < 4) return false;
      at(0).crosswalk.push([coords[0], coords[1], coords[coords.length - 2], coords[coords.length - 1]]);
      return true;
    }
    const isAllDay = window[0] === 0 && window[1] === 1440;
    if (code === "92") at(0).stopLine.push([coords[0], coords[1]]);
    else if (code === "63" && isAllDay) at(0).stopSign.push([coords[0], coords[1]]);
    else return false;
    return true;
  };
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  const counts: Record<string, number> = {};
  streamCsv(files.get(csvName) as Buffer, (row) => {
    if (!header) {
      header = row;
      col = Object.fromEntries(row.map((h, i) => [h.trim(), i]));
      return;
    }
    const code = row[col["共通規制種別コード"]];
    // 113 (可変速度) is skipped: its value depends on live variable-message signs.
    const isWanted = [
      "11",
      "112",
      "114",
      "85",
      "92",
      "63",
      "115",
      "65",
      "51",
      "61",
      "17",
      "20",
      "52",
      "119",
      "12",
    ].includes(code);
    if (!isWanted) return;
    const cell = (h: string) => (col[h] === undefined ? "" : (row[col[h]] ?? "").trim());
    const isAbolished = cell("意思決定廃止日") !== "";
    // Seasonal / weekday-only rules are skipped. Daily time windows are kept: 12,444 of the
    // timed one-ways are "0–2400" (all day) and the rest are evaluated against the game clock.
    const isSeasonal =
      cell("対象期間1_開始") !== "" || cell("規制曜日コード1") !== "" || cell("規制時間2_開始") !== "";
    // 対象コード 1 (車両) and 10 (自動車) both bind ordinary cars; other classes do not.
    const vehicle = cell("対象車両コード1_A");
    const isForCars = vehicle === "" || vehicle === "1" || vehicle === "10";
    if (isAbolished || isSeasonal || !isForCars) return;
    const window: [number, number] = cell("規制時間1_開始")
      ? [toMin(cell("規制時間1_開始")), toMin(cell("規制時間1_終了"))]
      : [0, 1440];
    const coords = parseCoords(row[col["規制場所の経度緯度"]] ?? "");
    if (coords.length < 2 || !inBbox(coords[0], coords[1])) return;
    const kept = addRegulation(
      code,
      coords,
      window,
      Number(cell("速度")),
      cell("県別規制種別名称"),
      cell("点・線・面コード"),
      {
        side: cell("片側・両側コード"),
        lanes: Number(cell("車両通行帯数")) || 0,
        entry: parseCoords(cell("進入方向(座標)")),
        exits: parseCoords(cell("指定する方向(座標)")),
      },
    );
    if (kept) counts[code] = (counts[code] ?? 0) + 1;
  });
  log("jartic_parsed", { counts, tiles: tiles.size });
  return { tiles, month: typeD.targetMonth, release: typeD.releaseDay };
}

async function buildSignals(): Promise<Map<string, SignalTile>> {
  const nodes = readTaggedNodes(await fetchBytes(OSM_EXTRACT), (t) => t.highway === "traffic_signals");
  const tiles = new Map<string, SignalTile>();
  for (const n of nodes) {
    if (!inBbox(n.lon, n.lat)) continue;
    const key = `${tx(n.lon)}-${ty(n.lat)}`;
    const list = tiles.get(key) ?? [];
    list.push([round(n.lon), round(n.lat)]);
    tiles.set(key, list);
  }
  log("signals_parsed", {
    signals: [...tiles.values()].reduce((a, t) => a + t.length, 0),
    tiles: tiles.size,
  });
  return tiles;
}

const ODBL_NOTICE = `Traffic signal positions in this folder are extracted from OpenStreetMap.
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database is made available under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Source extract: ${OSM_EXTRACT} (BBBike). Filter: node["highway"="traffic_signals"] within the 23 wards.
`;

const only = process.argv[2];
if (!only || only === "jartic") {
  const { tiles, month, release } = await buildJartic();
  const dir = join(ROOT, "regs");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [key, t] of tiles) await writeFile(join(dir, `${key}.json`), JSON.stringify(t));
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({
      source: "「交通規制情報」（公益財団法人日本道路交通情報センター）",
      url: "https://www.jartic.or.jp/service/opendata/",
      targetMonth: month,
      releaseDay: release,
      fetchedAt: new Date().toISOString(),
      zoom: Z,
      tiles: [...tiles.keys()],
    }),
  );
}
if (!only || only === "signals") {
  const tiles = await buildSignals();
  const dir = join(ROOT, "signals");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [key, list] of tiles) await writeFile(join(dir, `${key}.json`), JSON.stringify(list));
  await writeFile(join(dir, "LICENSE.txt"), ODBL_NOTICE);
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ zoom: Z, tiles: [...tiles.keys()], fetchedAt: new Date().toISOString() }),
  );
}
