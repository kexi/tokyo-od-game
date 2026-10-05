// Build-time traffic regulations: JARTIC 交通規制情報 (police regulations: one-way, speed limits,
// crosswalks, stop lines, stop signs) and, from OpenStreetMap, traffic signals with their
// intersection names and footbridges (横断歩道橋), cut into z14 tiles under public/data so the
// game loads only the area around the player.
// Run: pnpm exec tsx scripts/regulations.ts [jartic|signals|police]   (the ~40 MB JARTIC zip and
// the ~520 MB Geofabrik Kanto extract are cached under .cache/jartic and .cache/osm for a week;
// `jartic` alone takes ~11 s and ~1.5 GB of memory on an M2 Max)
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { MAX_CLOSURE_AREA_KM2 } from "../src/world/closures.ts";
import { join } from "node:path";
import { closureUse, M_LAT, M_LON, parseCoords, ruleUse, streamCsv, turnMask } from "./jartic.ts";
import { readNodeCoords, readTaggedNodes, readWays } from "./osm-pbf.ts";
import { buildOrbis } from "./orbis.ts";
import type { OrbisEntry } from "../src/world/orbisData.ts";
import { isAllDay as alwaysOn, writeTime, type RuleTime } from "../src/world/ruleTime.ts";
import { unzip } from "./shapefile.ts";
import { log, warn } from "../src/log.ts";

const ROOT = join(import.meta.dirname, "..", "public", "data");
const JARTIC_INDEX = "https://www.jartic.or.jp/d/opendata/opendata.json";
const JARTIC_BASE = "https://www.jartic.or.jp/d/opendata";
// Geofabrik's Kanto extract covers all 23 wards; BBBike's Tokyo box cut off their western,
// northern and southern edges (~10% of the signals).
const OSM_EXTRACT = "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf";
const OSM_CACHE = join(import.meta.dirname, "..", ".cache", "osm", "kanto-latest.osm.pbf");
const JARTIC_CACHE = join(import.meta.dirname, "..", ".cache", "jartic", "typeD_tokyo.zip");
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
// 23 wards with a little margin (same box as the POI pipeline).
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const Z = 14;

type Tile = {
  speed: Array<[number, ...number[]]>; // [limit, lon0, lat0, lon1, lat1, …]
  speedZone: Array<[number, ...number[]]>; // [limit, polygon ring…]
  oneway: number[][]; // [TIME…, …coords in the PERMITTED travel order] (TIME: src/world/ruleTime.ts)
  crosswalk: number[][]; // [lon1, lat1, lon2, lat2] across the road
  stopLine: number[][]; // [lon, lat]
  stopSign: number[][]; // [lon, lat]
  noOvertake: number[][]; // 追越しのための右側部分はみ出し通行禁止 (yellow centre line): coords
  lanes: number[][]; // 車両通行帯: [lanes (0 = unknown), …coords]
  noLaneChange: number[][]; // 進路変更禁止 (yellow lane lines): coords
  // 進行方向別通行区分 (58, and the 118/119 combinations): [lanes (0 = unknown), …coords], the
  // approach to a junction whose lanes are designated by direction. JARTIC gives no per-lane
  // directions (項目 145 is empty in Tokyo), so the game takes them from OSM turn:lanes or
  // assumes the usual pattern.
  laneArrows: number[][];
  // Restricted sections: [code, bothWays (1/0), TIME…, …coords] with code 115 駐車禁止,
  // 65 駐停車禁止, 51 転回禁止, 61 徐行. Signs and law checks are derived from them in the game.
  sections: number[][];
  // 指定方向外進行禁止: [centreLon, centreLat, entryLon, entryLat, allowed mask, TIME…].
  turns: number[][];
  // 通行禁止: [shape 2 line / 3 area, kind (CLOSURE), TIME…, …coords].
  closures: number[][];
};
type SignalTile = number[][]; // [lon, lat]
type JunctionTile = Array<[number, number, string, string]>; // [lon, lat, 交差点名, English name or ""]
// 横断歩道橋 candidates: [width m (0 = unknown), deck coords, [stair coords from the deck down]…].
type FootbridgeTile = Array<[number, number[], number[][]]>;
// Lanes by direction at a junction approach: [lon, lat of the approach end, travel bearing (deg,
// clockwise from north), turn:lanes value from the left lane, e.g. "left;through|through|right"].
type TurnLaneTile = Array<[number, number, number, string]>;

const round = (v: number) => Math.round(v * 1e6) / 1e6;
// Line regulations are matched to centrelines within 6 m, so ~1 m precision is plenty and keeps
// the tiles small; point features (stop lines, crosswalks) keep ~0.1 m.
const coarse = (coords: number[]) => coords.map((v) => Math.round(v * 1e5) / 1e5);
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
  const files = unzip(Buffer.from(await cachedDownload(`${JARTIC_BASE}${tokyo.link}`, JARTIC_CACHE)));
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
        noOvertake: [],
        lanes: [],
        noLaneChange: [],
        laneArrows: [],
        sections: [],
        turns: [],
        closures: [],
      };
      tiles.set(key, t);
    }
    return t;
  };
  /** File one regulation into its tiles; false when it is not usable in the game. */
  const addRegulation = (
    code: string,
    coords: number[],
    time: RuleTime,
    limit: number,
    name: string,
    shape: string,
    extra: {
      side: string;
      lanes: number;
      entry: number[];
      exits: number[];
      target: string;
      exempt: string;
      key: string;
    },
  ): boolean => {
    const at = (i: number) => tile(`${tx(coords[i])}-${ty(coords[i + 1])}`);
    if (code === "11") {
      // Verified against OSM (98 % of 9,126 matched records): coordinates run AGAINST the
      // permitted direction, so reverse them into travel order.
      const travel: number[] = [];
      for (let i = coords.length - 2; i >= 0; i -= 2) travel.push(coords[i], coords[i + 1]);
      for (const key of tilesOf(travel)) tile(key).oneway.push([...writeTime(time), ...coarse(travel)]);
      return true;
    }
    if (code === "1" || code === "4") {
      const use = closureUse(code, shape, coords, extra.target, extra.exempt);
      if ("skip" in use) {
        closureSkipped[use.skip] = (closureSkipped[use.skip] ?? 0) + 1;
        if (use.skip === "area")
          warn("jartic_closure_skipped", {
            reason: use.skip,
            key: extra.key,
            code,
            areaKm2: Math.round(use.areaKm2 * 10) / 10,
            maxKm2: MAX_CLOSURE_AREA_KM2,
            vertices: coords.length / 2,
            at: coords.slice(0, 2),
          });
        return false;
      }
      for (const key of tilesOf(coords))
        tile(key).closures.push([Number(shape), use.kind, ...writeTime(time), ...coarse(coords)]);
      return true;
    }
    if (code === "112" || code === "114") {
      // 「最高速度（自動車道）」 is the elevated 首都高; the game only drives ground roads, and its
      // centreline often lies right above an arterial, which would inherit the wrong limit.
      const isExpressway = name.includes("自動車道");
      if (!limit || isExpressway) return false;
      const isArea = code === "114" || shape === "3";
      for (const key of tilesOf(coords))
        (isArea ? tile(key).speedZone : tile(key).speed).push([limit, ...coarse(coords)]);
      return true;
    }
    const bothWays = extra.side !== "2";
    const isAllDay = alwaysOn(time);
    // Section rules with a sign of their own (and law checks for some). 111 専用通行帯 is split by
    // its name into 1111 普通自転車専用通行帯 and 1112 路線バス等専用通行帯 (different signs).
    // The four original ones also come as areas (駐車禁止の区域); the new ones only as lines.
    const isLine = shape === "2" || ["115", "65", "51", "61"].includes(code);
    if (SECTION_CODES.has(code) && isLine) {
      const sides = code === "61" || bothWays ? 1 : 0;
      const stored = code === "111" ? (name.includes("自転車") ? 1111 : 1112) : Number(code);
      for (const key of tilesOf(coords))
        tile(key).sections.push([stored, sides, ...writeTime(time), ...coarse(coords)]);
      return true;
    }
    if (code === "17") {
      for (const key of tilesOf(coords)) tile(key).noOvertake.push(coarse(coords));
      return true;
    }
    if (code === "20") {
      for (const key of tilesOf(coords)) tile(key).lanes.push([extra.lanes, ...coarse(coords)]);
      return true;
    }
    if (code === "58" || code === "118" || code === "119") {
      for (const key of tilesOf(coords)) tile(key).laneArrows.push([extra.lanes, ...coarse(coords)]);
    }
    if (code === "52" || code === "119") {
      for (const key of tilesOf(coords)) tile(key).noLaneChange.push(coarse(coords));
      return true;
    }
    if (code === "58" || code === "118") return true;
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
      const approach = Math.hypot((coords[0] - extra.entry[0]) * M_LON, (coords[1] - extra.entry[1]) * M_LAT);
      if (approach < 1) return false;
      at(0).turns.push([coords[0], coords[1], extra.entry[0], extra.entry[1], mask, ...writeTime(time)]);
      return true;
    }
    if (code === "85") {
      if (coords.length < 4) return false;
      at(0).crosswalk.push([coords[0], coords[1], coords[coords.length - 2], coords[coords.length - 1]]);
      return true;
    }
    if (code === "92") at(0).stopLine.push([coords[0], coords[1]]);
    else if (code === "63" && isAllDay) at(0).stopSign.push([coords[0], coords[1]]);
    else return false;
    return true;
  };
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  const counts: Record<string, number> = {};
  // Why rows were not used: per code (no condition binds the car, or 対象期間), and per reason for
  // the 通行禁止 records that do bind it.
  const skipped: Record<string, Record<string, number>> = {};
  const closureSkipped: Record<string, number> = {};
  streamCsv(files.get(csvName) as Buffer, (row) => {
    if (!header) {
      header = row;
      col = Object.fromEntries(row.map((h, i) => [h.trim(), i]));
      return;
    }
    const code = row[col["共通規制種別コード"]];
    // 113 (可変速度) is skipped: its value depends on live variable-message signs.
    const isWanted = [
      ...SECTION_CODES,
      "1",
      "4",
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
      "58",
      "118",
      "119",
      "12",
    ].includes(code);
    if (!isWanted) return;
    const cell = (h: string) => (col[h] === undefined ? "" : (row[col[h]] ?? "").trim());
    const isAbolished = cell("意思決定廃止日") !== "";
    if (isAbolished) return;
    const use = ruleUse(cell, code);
    if ("skip" in use) {
      const reasons = (skipped[code] ??= {});
      reasons[use.skip] = (reasons[use.skip] ?? 0) + 1;
      return;
    }
    const coords = parseCoords(row[col["規制場所の経度緯度"]] ?? "");
    if (coords.length < 2 || !inBbox(coords[0], coords[1])) return;
    const kept = addRegulation(
      code,
      coords,
      use.time,
      Number(cell("速度")),
      cell("県別規制種別名称"),
      cell("点・線・面コード"),
      {
        side: cell("片側・両側コード"),
        lanes: Number(cell("車両通行帯数")) || 0,
        entry: parseCoords(cell("進入方向(座標)")),
        exits: parseCoords(cell("指定する方向(座標)")),
        target: use.target,
        exempt: ["A", "B", "C", "D"].map((c) => cell(`除外車両コード1_${c}`)).join("|"),
        key: cell("ユニークキー"),
      },
    );
    if (kept) counts[code] = (counts[code] ?? 0) + 1;
  });
  log("jartic_parsed", { counts, skipped, closureSkipped, tiles: tiles.size });
  return { tiles, month: typeD.targetMonth, release: typeD.releaseDay };
}

/** A download, from the local cache when that is less than a week old. */
async function cachedDownload(url: string, file: string): Promise<Uint8Array> {
  const age = await stat(file).then(
    (st) => Date.now() - st.mtimeMs,
    () => Infinity,
  );
  if (age < CACHE_MAX_AGE_MS) {
    log("cache_hit", { file, ageH: Math.round(age / 3600_000) });
    return new Uint8Array(await readFile(file));
  }
  log("download", { url });
  const bytes = await fetchBytes(url);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

const osmExtract = () => cachedDownload(OSM_EXTRACT, OSM_CACHE);

const tileOf = (lon: number, lat: number) => `${tx(lon)}-${ty(lat)}`;
/**
 * Section regulations kept as [code, bothWays, TIME…, coords]: 115 駐車禁止, 65 駐停車禁止,
 * 51 転回禁止, 61 徐行, 14 歩行者横断禁止, 21 車両通行区分, 24 路線バス等優先通行帯, 50 車両横断禁止,
 * 53 追越し禁止, 70・71・116 駐車可・停車可, 72 時間制限駐車区間, 77 警笛鳴らせ, 81 普通自転車歩道通行可,
 * 111 専用通行帯. Each has its sign in the game; JARTIC point records of these are not used.
 */
const SECTION_CODES = new Set([
  "115",
  "65",
  "51",
  "61",
  "14",
  "21",
  "24",
  "50",
  "53",
  "70",
  "71",
  "72",
  "77",
  "81",
  "111",
  "116",
]);
function push<T>(tiles: Map<string, T[]>, key: string, item: T): void {
  const list = tiles.get(key) ?? [];
  list.push(item);
  tiles.set(key, list);
}

type OsmTiles = {
  signals: Map<string, SignalTile>;
  junctions: Map<string, JunctionTile>;
  footbridges: Map<string, FootbridgeTile>;
  turnlanes: Map<string, TurnLaneTile>;
};

let places: { hydrants: number[][]; schools: Array<[number, number, number, string]> } | null = null;
type Police = {
  stations: Array<[number, number, string]>;
  centres: Array<[number, number, string]>;
  orbis: OrbisEntry[];
};
let police: Police | null = null;

/**
 * 警察署 (where notices to appear send the driver), the 運転免許試験場 (where a licence is handed
 * in for a 免許停止) and the オービス: small enough for one file (public/data/police.json).
 */
function buildPolice(file: Uint8Array): Police {
  const stations = readTaggedNodes(file, (t) => t.amenity === "police" && (t.name ?? "").endsWith("警察署"))
    .filter((n) => inBbox(n.lon, n.lat))
    .map((n) => [round(n.lon), round(n.lat), n.tags.name ?? ""] as [number, number, string]);
  const centreWays = readWays(file, (t) => /^(鮫洲|江東|府中)運転免許試験場$/.test(t.name ?? ""));
  const centreCoords = readNodeCoords(file, new Set(centreWays.flatMap((w) => w.refs)));
  const centres = centreWays.map((w) => {
    const pts = w.refs.map((r) => centreCoords.get(r)).filter((c): c is [number, number] => !!c);
    const lon = pts.reduce((a, c) => a + c[0], 0) / pts.length;
    const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length;
    return [round(lon), round(lat), w.tags.name ?? ""] as [number, number, string];
  });
  // 速度違反自動取締装置 (オービス): OSM speed cameras with the direction each enforces, its
  // lanes and the 予告看板 points up the road (scripts/orbis.ts).
  const orbis = buildOrbis(file, inBbox);
  return { stations, centres, orbis };
}

async function buildOsm(): Promise<OsmTiles> {
  const file = await osmExtract();
  const signals = new Map<string, SignalTile>();
  const junctions = new Map<string, JunctionTile>();
  for (const n of readTaggedNodes(file, (t) => t.highway === "traffic_signals")) {
    if (!inBbox(n.lon, n.lat)) continue;
    push(signals, tileOf(n.lon, n.lat), [round(n.lon), round(n.lat)]);
    // 交差点名: OSM puts the name of a signalled junction on its signal node.
    const name = n.tags.name;
    if (name)
      push(junctions, tileOf(n.lon, n.lat), [round(n.lon), round(n.lat), name, n.tags["name:en"] ?? ""]);
  }

  // Footbridges: pedestrian ways on a bridge (the deck) and the stairs that join them.
  const isFoot = (t: Record<string, string>) =>
    ["footway", "path", "pedestrian", "cycleway"].includes(t.highway ?? "") &&
    !!t.bridge &&
    t.bridge !== "no";
  const decks = readWays(file, isFoot).filter((w) => Number(w.tags.layer ?? 1) >= 1);
  const deckNodes = new Set(decks.flatMap((w) => w.refs));
  const stairs = readWays(file, (t) => t.highway === "steps").filter((w) =>
    w.refs.some((r) => deckNodes.has(r)),
  );
  const coords = readNodeCoords(file, new Set([...deckNodes, ...stairs.flatMap((w) => w.refs)]));
  const line = (refs: number[]) =>
    refs.flatMap((r) => {
      const c = coords.get(r);
      return c ? [round(c[0]), round(c[1])] : [];
    });
  const footbridges = new Map<string, FootbridgeTile>();
  let kept = 0;
  for (const deck of decks) {
    const d = line(deck.refs);
    if (d.length < 4 || !inBbox(d[0], d[1])) continue;
    const onDeck = new Set(deck.refs);
    const steps = stairs
      .filter((w) => w.refs.some((r) => onDeck.has(r)))
      .map((w) => {
        // From the deck end down to the ground.
        const refs = onDeck.has(w.refs[0]) ? w.refs : [...w.refs].reverse();
        return line(refs);
      })
      .filter((c) => c.length >= 4);
    const width = Number.parseFloat(deck.tags.width ?? "") || 0;
    push(footbridges, tileOf(d[0], d[1]), [width, d, steps]);
    kept++;
  }
  // turn:lanes applies where the way ends in its direction of travel: the end for oneway and
  // :forward, the start for :backward.
  const isRoad = (t: Record<string, string>) =>
    /^(trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$/.test(t.highway ?? "") &&
    Object.keys(t).some((k) => k.startsWith("turn:lanes"));
  const laneWays = readWays(file, isRoad);
  const ends = new Set(laneWays.flatMap((w) => [w.refs[0], w.refs[1], w.refs.at(-2), w.refs.at(-1)]));
  const endCoords = readNodeCoords(file, new Set([...ends].filter((r): r is number => r !== undefined)));
  const bearing = (a: [number, number], b: [number, number]) => {
    const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
    const dy = b[1] - a[1];
    return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360);
  };
  const turnlanes = new Map<string, TurnLaneTile>();
  let laneCount = 0;
  for (const w of laneWays) {
    const isOneway = w.tags.oneway === "yes" || w.tags.oneway === "1";
    const forward = w.tags["turn:lanes:forward"] ?? (isOneway ? w.tags["turn:lanes"] : undefined);
    const backward = w.tags["turn:lanes:backward"];
    const at = (refs: number[], value: string | undefined) => {
      if (!value || refs.length < 2) return;
      const end = endCoords.get(refs[refs.length - 1]);
      const before = endCoords.get(refs[refs.length - 2]);
      if (!end || !before || !inBbox(end[0], end[1])) return;
      push(turnlanes, tileOf(end[0], end[1]), [round(end[0]), round(end[1]), bearing(before, end), value]);
      laneCount++;
    };
    at(w.refs, forward);
    at([...w.refs].reverse(), backward);
  }
  police = buildPolice(file);
  // 消火栓 (駐車禁止 within 5 m, 第45条第1項第5号) and schools / kindergartens / nurseries (the 208
  // warning sign and school zones): nodes, and the centres of mapped school grounds.
  const hydrantType: Record<string, number> = { underground: 0, pillar: 1, wall: 2 };
  const hydrants = readTaggedNodes(file, (t) => t.emergency === "fire_hydrant")
    .filter((n) => inBbox(n.lon, n.lat))
    .map((n) => [round(n.lon), round(n.lat), hydrantType[n.tags["fire_hydrant:type"] ?? "underground"] ?? 0]);
  const isSchool = (t: Record<string, string>) =>
    ["school", "kindergarten", "childcare"].includes(t.amenity ?? "");
  const schoolKind = (t: Record<string, string>) =>
    ({ school: 0, kindergarten: 1, childcare: 2 })[t.amenity ?? ""] ?? 0;
  const schools: Array<[number, number, number, string]> = readTaggedNodes(file, isSchool)
    .filter((n) => inBbox(n.lon, n.lat))
    .map((n) => [round(n.lon), round(n.lat), schoolKind(n.tags), n.tags.name ?? ""]);
  const schoolWays = readWays(file, isSchool);
  const schoolCoords = readNodeCoords(file, new Set(schoolWays.flatMap((w) => w.refs)));
  for (const w of schoolWays) {
    const pts = w.refs.map((r) => schoolCoords.get(r)).filter((c): c is [number, number] => !!c);
    if (pts.length < 3) continue;
    const lon = pts.reduce((a, c) => a + c[0], 0) / pts.length;
    const lat = pts.reduce((a, c) => a + c[1], 0) / pts.length;
    if (inBbox(lon, lat)) schools.push([round(lon), round(lat), schoolKind(w.tags), w.tags.name ?? ""]);
  }
  places = { hydrants, schools };
  log("osm_parsed", {
    police: police.stations.length,
    orbis: police.orbis.length,
    centres: police.centres.map((c) => c[2]),
    signals: [...signals.values()].reduce((a, t) => a + t.length, 0),
    named: [...junctions.values()].reduce((a, t) => a + t.length, 0),
    footbridges: kept,
    stairs: stairs.length,
    turnlanes: laneCount,
  });
  return { signals, junctions, footbridges, turnlanes };
}

const ODBL_NOTICE = `Traffic signal positions in this folder are extracted from OpenStreetMap.
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database is made available under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Source extract: ${OSM_EXTRACT} (Geofabrik). Filters within the 23 wards:
- signals/: node["highway"="traffic_signals"]
- junctions/: the same nodes' "name" and "name:en" (intersection names)
- footbridges/: way[highway~"footway|path|pedestrian|cycleway"][bridge!="no"] (layer >= 1) and
  the way["highway"="steps"] that share a node with them
- turnlanes/: way[highway~"trunk|primary|secondary|tertiary|unclassified|residential"] with
  turn:lanes, turn:lanes:forward or turn:lanes:backward, at the end of the way they apply to
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
// Only police.json (stations, 試験場, オービス), leaving the OSM tiles as they are.
if (only === "police") {
  police = buildPolice(await osmExtract());
  await writeFile(join(ROOT, "police.json"), JSON.stringify(police));
  log("police_written", {
    stations: police.stations.length,
    orbis: police.orbis.length,
    // Counts per source (Object.groupBy is ES2024; the project targets ES2023).
    bySource: police.orbis.reduce<Record<string, number>>((n, o) => {
      n[o.source] = (n[o.source] ?? 0) + 1;
      return n;
    }, {}),
  });
}
if (!only || only === "signals") {
  const osm = await buildOsm();
  for (const [name, tiles] of Object.entries(osm) as Array<[string, Map<string, unknown[]>]>) {
    const dir = join(ROOT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [key, list] of tiles) await writeFile(join(dir, `${key}.json`), JSON.stringify(list));
    await writeFile(join(dir, "LICENSE.txt"), ODBL_NOTICE);
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify({ zoom: Z, tiles: [...tiles.keys()], fetchedAt: new Date().toISOString() }),
    );
  }
  // From OpenStreetMap too (ODbL; the credit line in the game covers it).
  if (police) await writeFile(join(ROOT, "police.json"), JSON.stringify(police));
  if (places) await writeFile(join(ROOT, "places.json"), JSON.stringify(places));
}
