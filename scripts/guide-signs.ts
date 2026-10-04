// Build-time data for the 案内標識 (方面及び方向 108 系): from the OpenStreetMap Kanto extract that
// scripts/regulations.ts caches, the 国道・都道 numbers and street names of the arterials and the
// destinations mapped on them (`destination*`), cut into z14 tiles under public/data/routes; and
// the 表示地名 of 国土交通省「各都道府県において表示される基準地・重要地・主要地一覧表」 (平成30年6月末)
// placed on the map (public/data/guide-places.json). Also writes the characters the boards can
// show (assets/signs/guide/charset.txt), which scripts/textures/guide_fonts.py subsets the fonts to.
// Run: node scripts/guide-signs.ts   (after `node scripts/regulations.ts signals` has cached the PBF)
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import { readNodeCoords, readRelations, readTaggedNodes, readWays, type OsmWay } from "./osm-pbf.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "data");
const OSM_CACHE = join(ROOT, ".cache", "osm", "kanto-latest.osm.pbf");
const CHARSET = join(ROOT, "assets", "signs", "guide", "charset.txt");
// 23 wards with a margin (the box of scripts/regulations.ts), and a wider one for the places the
// streets lead to (横浜, さいたま, 千葉 …).
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const WIDE = { minLat: 35.3, maxLat: 36.0, minLon: 139.2, maxLon: 140.3 };
const Z = 14;
const NEAR_ROUTE = 300; // m: a place "is on" a route whose centreline passes this close

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
const inBox = (box: typeof BBOX, lon: number, lat: number) =>
  lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
const tx = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const ty = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

/**
 * 表示地名 (MLIT list, 平成30年6月末): 東京都 23 区 and the neighbours the 23 wards' arterials lead
 * to. rank 1 重要地, 2 主要地 (基準地 東京 appears only on 確認標識 106, not on 108). English:
 * Hepburn without macrons and with "n" before b/m/p, as 別表第二's own figures write 日本橋
 * "Nihonbashi" and 上馬 "Kamiuma"; names ending in 橋・門・坂 are area names here, romanised whole.
 */
const TOKYO_PLACES: Array<[string, string, 1 | 2]> = [
  // 東京都（23区）重要地
  ["浅草橋", "Asakusabashi", 1],
  ["池袋", "Ikebukuro", 1],
  ["上野", "Ueno", 1],
  ["五反田", "Gotanda", 1],
  ["新宿", "Shinjuku", 1],
  ["渋谷", "Shibuya", 1],
  ["品川", "Shinagawa", 1],
  ["巣鴨", "Sugamo", 1],
  ["日本橋", "Nihonbashi", 1],
  // 東京都（23区）主要地
  ["赤羽", "Akabane", 2],
  ["青戸", "Aoto", 2],
  ["荻窪", "Ogikubo", 2],
  ["赤羽橋", "Akabanebashi", 2],
  ["蒲田", "Kamata", 2],
  ["板橋", "Itabashi", 2],
  ["飯田橋", "Iidabashi", 2],
  ["大森", "Omori", 2],
  ["大原", "Ohara", 2],
  ["王子", "Oji", 2],
  ["羽田", "Haneda", 2],
  ["日比谷", "Hibiya", 2],
  ["東中野", "Higashinakano", 2],
  ["本郷", "Hongo", 2],
  ["馬込", "Magome", 2],
  ["丸子橋", "Marukobashi", 2],
  ["三宅坂", "Miyakezaka", 2],
  ["目白", "Mejiro", 2],
  ["四谷", "Yotsuya", 2],
  ["目黒", "Meguro", 2],
  ["谷原", "Yahara", 2],
  ["六本木", "Roppongi", 2],
  ["信濃町", "Shinanomachi", 2],
  ["砂町", "Sunamachi", 2],
  ["千住", "Senju", 2],
  ["瀬田", "Seta", 2],
  ["高井戸", "Takaido", 2],
  ["辰巳", "Tatsumi", 2],
  ["高田馬場", "Takadanobaba", 2],
  ["戸田橋", "Todabashi", 2],
  ["等々力", "Todoroki", 2],
  ["成増", "Narimasu", 2],
  ["半蔵門", "Hanzomon", 2],
  ["初台", "Hatsudai", 2],
  ["晴海", "Harumi", 2],
  ["亀戸", "Kameido", 2],
  ["上馬", "Kamiuma", 2],
  ["葛西", "Kasai", 2],
  ["亀有", "Kameari", 2],
  ["銀座", "Ginza", 2],
  ["言問橋", "Kototoibashi", 2],
  ["高円寺", "Koenji", 2],
  ["桜田門", "Sakuradamon", 2],
  ["大崎", "Osaki", 2],
  ["三軒茶屋", "Sangenjaya", 2],
  ["新橋", "Shinbashi", 2],
  ["四ツ木", "Yotsugi", 2],
  ["西新井", "Nishiarai", 2],
  ["三ノ輪", "Minowa", 2],
  ["南砂", "Minamisuna", 2],
  ["芝公園", "Shibakoen", 2],
  ["市川橋", "Ichikawabashi", 2],
  ["祝田橋", "Iwaidabashi", 2],
  ["永代橋", "Eitaibashi", 2],
  ["恵比寿", "Ebisu", 2],
  ["大久保", "Okubo", 2],
  ["大手町", "Otemachi", 2],
  ["御徒町", "Okachimachi", 2],
  ["駒形橋", "Komagatabashi", 2],
  ["駒沢", "Komazawa", 2],
  ["笹目橋", "Sasamebashi", 2],
  ["水道橋", "Suidobashi", 2],
  ["溜池", "Tameike", 2],
  ["豊洲", "Toyosu", 2],
];
/** 表示地名 outside the 23 wards that their arterials lead to (same list, same rules). */
const NEIGHBOUR_PLACES: Array<[string, string, 1 | 2]> = [
  // 東京都（23区外）
  ["八王子", "Hachioji", 1],
  ["調布", "Chofu", 2],
  ["三鷹", "Mitaka", 2],
  ["狛江", "Komae", 2],
  ["西東京", "Nishitokyo", 2],
  ["府中", "Fuchu", 2],
  ["立川", "Tachikawa", 2],
  ["町田", "Machida", 2],
  ["小平", "Kodaira", 2],
  ["清瀬", "Kiyose", 2],
  ["東村山", "Higashimurayama", 2],
  // 神奈川県（横浜・川崎）
  ["横浜", "Yokohama", 1],
  ["川崎", "Kawasaki", 1],
  ["小杉", "Kosugi", 2],
  ["登戸", "Noborito", 2],
  ["溝口", "Mizonokuchi", 2],
  ["鶴見", "Tsurumi", 2],
  ["綱島", "Tsunashima", 2],
  // 埼玉県
  ["さいたま", "Saitama", 1],
  ["草加", "Soka", 1],
  ["川越", "Kawagoe", 1],
  ["所沢", "Tokorozawa", 1],
  ["川口", "Kawaguchi", 2],
  ["戸田", "Toda", 2],
  ["和光", "Wako", 2],
  ["三郷", "Misato", 2],
  ["越谷", "Koshigaya", 2],
  ["大宮", "Omiya", 2],
  ["浦和", "Urawa", 2],
  // 千葉県
  ["千葉", "Chiba", 1],
  ["柏", "Kashiwa", 1],
  ["市川", "Ichikawa", 2],
  ["船橋", "Funabashi", 2],
  ["松戸", "Matsudo", 2],
  ["浦安", "Urayasu", 2],
  ["八千代", "Yachiyo", 2],
];

/**
 * Where the list's name is on no OSM junction, place, station or bridge: 四谷 is the 四谷見附
 * crossing, 千住 the 北千住 station area, 砂町 the old town of 北砂, and the bridges are the
 * junctions at their ends (市川橋: 市川広小路 at its east end on 国道14号).
 */
const ALIASES: Record<string, string[]> = {
  四谷: ["四谷見附"],
  千住: ["北千住"],
  砂町: ["北砂"],
  戸田橋: ["戸田橋（東）", "戸田橋（西）"],
  言問橋: ["言問橋西", "言問橋東"],
  駒形橋: ["駒形橋西詰"],
  市川橋: ["市川広小路"],
};

const BORDER_BRIDGES = new Set(["戸田橋", "市川橋"]);

/**
 * 一般地 of the last resort (rank 4): the 23 wards at their 区役所, in the English the wards use
 * ("… City"). Rank 3 is the JR stations (below) and, at runtime, the junction names along the road.
 */
const WARDS: Array<[string, string]> = [
  ["千代田区", "Chiyoda City"],
  ["中央区", "Chuo City"],
  ["港区", "Minato City"],
  ["新宿区", "Shinjuku City"],
  ["文京区", "Bunkyo City"],
  ["台東区", "Taito City"],
  ["墨田区", "Sumida City"],
  ["江東区", "Koto City"],
  ["品川区", "Shinagawa City"],
  ["目黒区", "Meguro City"],
  ["大田区", "Ota City"],
  ["世田谷区", "Setagaya City"],
  ["渋谷区", "Shibuya City"],
  ["中野区", "Nakano City"],
  ["杉並区", "Suginami City"],
  ["豊島区", "Toshima City"],
  ["北区", "Kita City"],
  ["荒川区", "Arakawa City"],
  ["板橋区", "Itabashi City"],
  ["練馬区", "Nerima City"],
  ["足立区", "Adachi City"],
  ["葛飾区", "Katsushika City"],
  ["江戸川区", "Edogawa City"],
];

// Road classes on the boards: 0 一般国道 (国道番号 118-A), 1 主要地方道, 2 一般都道府県道 (都道府県道番号
// 118の2-A), 3 other named streets (通称名 only).
const CLASS: Record<string, number> = { trunk: 0, primary: 1, secondary: 2, tertiary: 3 };

type RoadEntry = [number, string, string, string, ...number[]]; // [class, ref, name, nameEn, …coords]
// Destinations at the start of a way in its travel direction: [lon, lat, bearing°, destination,
// English, destination:ref]. `;` separates several, in the order mapped (left to right on the sign).
type DestEntry = [number, number, number, string, string, string];
// Junction names on junction=yes nodes (not in public/data/junctions): [lon, lat, name, English].
type NameEntry = [number, number, string, string];
type Tile = { roads: RoadEntry[]; dests: DestEntry[]; names: NameEntry[] };

const bearing = (a: [number, number], b: [number, number]) => {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360);
};
const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110540);
};
function distToLine(p: [number, number], line: Array<[number, number]>): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * k;
    const ay = (line[i - 1][1] - p[1]) * 110540;
    const bx = (line[i][0] - p[0]) * k;
    const by = (line[i][1] - p[1]) * 110540;
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2));
    best = Math.min(best, Math.hypot(ax + ex * t, ay + ey * t));
  }
  return best;
}

async function main(): Promise<void> {
  if (!existsSync(OSM_CACHE))
    throw new Error(`${OSM_CACHE} missing: run node scripts/regulations.ts signals`);
  const file = new Uint8Array(await readFile(OSM_CACHE));
  const areas = new AreaIndex(JSON.parse(await readFile(join(OUT, "areas.json"), "utf8")) as AreaFile);
  const inWards = (lon: number, lat: number) => areas.lookup(lat, lon) !== null;
  log("osm_loaded", { bytes: file.length });

  // Which national / prefectural route a way belongs to (route relations), so a trunk-tagged
  // 都道 bypass gets the hexagon and not the 国道 shield.
  const routeOf = new Map<number, { national: boolean; ref: string }>();
  for (const r of readRelations(file, (t) => t.type === "route" && t.route === "road")) {
    const net = r.tags.network ?? "";
    const isNational = net === "JP:national";
    const isPrefectural = net.startsWith("JP:prefectural");
    if ((!isNational && !isPrefectural) || !r.tags.ref) continue;
    for (const m of r.members)
      if (m.type === "way" && (isNational || !routeOf.has(m.ref)))
        routeOf.set(m.ref, { national: isNational, ref: r.tags.ref });
  }

  const isStreetName = (n: string | undefined) => !!n && /(通り|街道|大通|道路|新道)$/.test(n);
  const roadWays = readWays(file, (t) => {
    const cls = CLASS[t.highway ?? ""];
    if (cls === undefined) return false;
    return cls < 3 ? !!(t.ref || t.name) : isStreetName(t.name);
  });
  const destWays = readWays(file, (t) => {
    const isVehicleRoad = /^(trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$/.test(
      t.highway ?? "",
    );
    return isVehicleRoad && Object.keys(t).some((k) => k.startsWith("destination"));
  });
  const ids = new Set<number>();
  for (const w of [...roadWays, ...destWays]) for (const r of w.refs) ids.add(r);
  const coords = readNodeCoords(file, ids);
  log("ways_read", { roads: roadWays.length, dests: destWays.length, nodes: coords.size });

  const tiles = new Map<string, Tile>();
  const tile = (key: string) => {
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { roads: [], dests: [], names: [] }));
    return t;
  };
  const lineOf = (w: OsmWay) =>
    w.refs.map((r) => coords.get(r)).filter((c): c is [number, number] => c !== undefined);
  // Route lines kept for the place index (refs within NEAR_ROUTE of each place).
  const routeLines: Array<{ key: string; line: Array<[number, number]> }> = [];
  const chars = new Set<string>();
  const addChars = (s: string) => {
    for (const c of s) chars.add(c);
  };
  let roadCount = 0;
  for (const w of roadWays) {
    const line = lineOf(w);
    if (line.length < 2 || !line.some(([lon, lat]) => inBox(BBOX, lon, lat))) continue;
    const highway = w.tags.highway ?? "";
    const rel = routeOf.get(w.id);
    // Without a relation, OSM Japan's convention: trunk = 一般国道, primary = 主要地方道,
    // secondary = 一般都道府県道.
    let cls = CLASS[highway];
    if (rel) cls = rel.national ? 0 : cls === 0 ? 1 : Math.min(cls, 2);
    const ref = (w.tags.ref ?? rel?.ref ?? "").replace(/\s+/g, "");
    const name = w.tags.name ?? "";
    const nameEn = w.tags["name:en"] ?? "";
    const flat = line.flatMap(([lon, lat]) => [round5(lon), round5(lat)]);
    const keys = new Set(line.map(([lon, lat]) => `${tx(lon)}-${ty(lat)}`));
    for (const key of keys) tile(key).roads.push([cls, ref, name, nameEn, ...flat]);
    if (ref && cls < 3)
      for (const r of ref.split(";")) routeLines.push({ key: `${cls === 0 ? "N" : "P"}${r}`, line });
    if (isStreetName(name)) addChars(name);
    roadCount++;
  }
  let destCount = 0;
  for (const w of destWays) {
    const line = lineOf(w);
    if (line.length < 2) continue;
    const isOneway = w.tags.oneway === "yes" || w.tags.oneway === "1";
    const en = (k: string) =>
      w.tags[`${k.replace("destination", "destination:lang:en")}`] ?? w.tags[`${k}:en`] ?? "";
    const at = (pts: Array<[number, number]>, key: string) => {
      const dest = w.tags[key];
      // Some ways carry lane notes in destination (「左寄り2車線」「柱の右側」): not places.
      const isLaneNote = !!dest && /(車線|寄り|柱の|右側|左側)/.test(dest);
      if (!dest || isLaneNote || !inBox(BBOX, pts[0][0], pts[0][1])) return;
      const ref =
        w.tags[`${key.replace("destination", "destination:ref")}`] ?? w.tags["destination:ref"] ?? "";
      const entry: DestEntry = [
        round5(pts[0][0]),
        round5(pts[0][1]),
        bearing(pts[0], pts[1]),
        dest,
        en(key),
        ref,
      ];
      tile(`${tx(pts[0][0])}-${ty(pts[0][1])}`).dests.push(entry);
      addChars(dest);
      destCount++;
    };
    // `destination` applies to the way's travel direction: along it for one-way ways (and
    // :forward), against it for :backward.
    if (isOneway) at(line, "destination");
    at(line, "destination:forward");
    at([...line].reverse(), "destination:backward");
  }

  // ---------- 表示地名 on the map ----------
  // Junction names: OSM Japan puts them on the signal node or, at many big crossings (日比谷,
  // 祝田橋, 半蔵門, 日本橋), on junction=yes nodes the signal extract does not have.
  const signalNames = new Map<string, Array<[number, number]>>();
  const isNamedJunction = (t: Record<string, string>) =>
    (t.highway === "traffic_signals" || t.junction === "yes") && !!t.name;
  for (const n of readTaggedNodes(file, isNamedJunction)) {
    if (!inBox(WIDE, n.lon, n.lat)) continue;
    const name = (n.tags.name ?? "").replace(/交差点$/, "");
    const list = signalNames.get(name) ?? [];
    list.push([n.lon, n.lat]);
    signalNames.set(name, list);
    const isExtra =
      n.tags.junction === "yes" && n.tags.highway !== "traffic_signals" && inBox(BBOX, n.lon, n.lat);
    if (isExtra) {
      tile(`${tx(n.lon)}-${ty(n.lat)}`).names.push([
        round5(n.lon),
        round5(n.lat),
        name,
        n.tags["name:en"] ?? "",
      ]);
      addChars(name);
    }
  }
  // Bridges named in the lists (戸田橋, 言問橋, 永代橋 …) where no junction carries the name.
  const bridgeNames = new Set(
    [...TOKYO_PLACES, ...NEIGHBOUR_PLACES].map(([ja]) => ja).filter((ja) => ja.endsWith("橋")),
  );
  const bridgeWays = readWays(
    file,
    (t) => !!t.bridge && t.bridge !== "no" && !!t.highway && bridgeNames.has(t.name ?? ""),
  );
  const bridgeCoords = readNodeCoords(file, new Set(bridgeWays.flatMap((w) => w.refs)));
  const isPlace = (t: Record<string, string>) =>
    ["city", "town", "suburb", "quarter", "neighbourhood"].includes(t.place ?? "") ||
    t.railway === "station" ||
    (t.amenity === "townhall" && /区役所/.test(t.name ?? ""));
  const placeNodes = readTaggedNodes(file, isPlace).filter((n) => inBox(WIDE, n.lon, n.lat));
  const townhallWays = readWays(file, (t) => t.amenity === "townhall" && /区役所/.test(t.name ?? ""));
  const hallCoords = readNodeCoords(file, new Set(townhallWays.flatMap((w) => w.refs)));
  const byName = (pred: (t: Record<string, string>) => boolean, names: string[]) =>
    placeNodes.filter((n) => pred(n.tags) && names.includes(n.tags.name ?? ""));
  const centre = (pts: Array<[number, number]>): [number, number] => [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
  /**
   * In the 23 wards a 表示地名 is mostly a junction or a district: the signalled junction of that
   * name (the biggest cluster), else a place node, else a station. Outside, it is a town: the
   * place node first.
   */
  type Region = "wards" | "border" | "around";
  const locate = (ja: string, region: Region): { at: [number, number]; via: string } | null => {
    // The 23 wards' names exist elsewhere too (新橋 in 川崎, 中央区 in さいたま): inside the wards
    // only; the border bridges within the wards' box; the neighbours anywhere around.
    const isIn = ([lon, lat]: [number, number]) =>
      region === "wards" ? inWards(lon, lat) : inBox(region === "border" ? BBOX : WIDE, lon, lat);
    const isTokyo = region !== "around";
    const town = byName((t) => !!t.place, [ja, `${ja}市`]).find((n) => isIn([n.lon, n.lat]));
    if (!isTokyo && town) return { at: [town.lon, town.lat], via: `place=${town.tags.place}` };
    const signals = signalNames.get(ja)?.filter(isIn);
    if (signals?.length) {
      // Several junctions can share a name across Kanto: keep the cluster with the most nodes.
      const clusters: Array<Array<[number, number]>> = [];
      for (const p of signals) {
        const c = clusters.find((cl) => metres(cl[0], p) < 400);
        if (c) c.push(p);
        else clusters.push([p]);
      }
      const big = clusters.sort((a, b) => b.length - a.length)[0];
      return { at: centre(big), via: "signal" };
    }
    if (town) return { at: [town.lon, town.lat], via: `place=${town.tags.place}` };
    const bridge = bridgeWays
      .filter((w) => w.tags.name === ja)
      .flatMap((w) => w.refs.map((r) => bridgeCoords.get(r)).filter((c): c is [number, number] => !!c))
      .filter(isIn);
    if (bridge.length) return { at: centre(bridge), via: "bridge" };
    const stations = byName((t) => t.railway === "station", [ja, `${ja}駅`]).filter((n) =>
      isIn([n.lon, n.lat]),
    );
    if (stations.length) return { at: centre(stations.map((s) => [s.lon, s.lat])), via: "station" };
    return null;
  };
  const near = (at: [number, number]) => {
    const refs = new Set<string>();
    for (const r of routeLines) if (!refs.has(r.key) && distToLine(at, r.line) < NEAR_ROUTE) refs.add(r.key);
    return [...refs].sort().join(",");
  };
  type PlaceEntry = [string, string, number, number, number, string];
  const places: PlaceEntry[] = [];
  const missing: string[] = [];
  const via: Record<string, string> = {};
  const listed = [
    ...TOKYO_PLACES.map((p) => [...p, true] as const),
    ...NEIGHBOUR_PLACES.map((p) => [...p, false] as const),
  ];
  for (const [ja, en, rank, isTokyo] of listed) {
    // The border bridges' junctions stand on the far bank (戸田市, 市川市).
    const region = !isTokyo ? "around" : BORDER_BRIDGES.has(ja) ? "border" : "wards";
    const hit =
      [ja, ...(ALIASES[ja] ?? [])].map((name) => locate(name, region)).find((h) => h !== null) ?? null;
    if (!hit) {
      missing.push(ja);
      continue;
    }
    via[ja] = hit.via;
    places.push([ja, en, rank, round5(hit.at[0]), round5(hit.at[1]), near(hit.at)]);
    addChars(ja);
  }
  for (const [ja, en] of WARDS) {
    // 「練馬区役所本庁舎」 and the like: the name starts with the office's.
    const isOffice = (name: string | undefined) => (name ?? "").startsWith(`${ja}役所`);
    const node = placeNodes.find(
      (n) => n.tags.amenity === "townhall" && isOffice(n.tags.name) && inWards(n.lon, n.lat),
    );
    const wayPtsOf = (w: OsmWay) =>
      w.refs.map((r) => hallCoords.get(r)).filter((c): c is [number, number] => !!c);
    const way = townhallWays.find(
      (w) => isOffice(w.tags.name) && wayPtsOf(w).some(([lon, lat]) => inWards(lon, lat)),
    );
    const wayPts = way ? wayPtsOf(way) : [];
    const at: [number, number] | null = node ? [node.lon, node.lat] : wayPts.length ? centre(wayPts) : null;
    if (!at) {
      missing.push(ja);
      continue;
    }
    places.push([ja, en, 4, round5(at[0]), round5(at[1]), near(at)]);
    addChars(ja);
  }
  // 一般地 that are 公共施設 (備考一(一)6): the JR stations of the 23 wards, as 「〇〇駅 〇〇 Sta.」.
  const jr = new Map<string, { pts: Array<[number, number]>; en: string }>();
  for (const n of placeNodes) {
    const isJr = n.tags.railway === "station" && /東日本旅客鉄道|JR東日本/.test(n.tags.operator ?? "");
    const name = (n.tags.name ?? "").replace(/駅$/, "");
    if (!isJr || !name || !inWards(n.lon, n.lat)) continue;
    const e = jr.get(name) ?? { pts: [], en: n.tags["name:en"] ?? "" };
    e.pts.push([n.lon, n.lat]);
    e.en ||= n.tags["name:en"] ?? "";
    jr.set(name, e);
  }
  for (const [name, { pts, en }] of jr) {
    if (!en) continue;
    const at = centre(pts);
    places.push([
      `${name}駅`,
      `${en.replace(/\s*Station$/i, "")} Sta.`,
      3,
      round5(at[0]),
      round5(at[1]),
      near(at),
    ]);
    addChars(`${name}駅`);
  }
  log("places_located", { placed: places.length, stations: jr.size, missing, via });

  // 一般地 from signalled junction names (public/data/junctions, written by regulations.ts).
  const jdir = join(OUT, "junctions");
  for (const f of await readdir(jdir)) {
    if (!/^\d+-\d+\.json$/.test(f)) continue;
    const list = JSON.parse(await readFile(join(jdir, f), "utf8")) as Array<[number, number, string, string]>;
    for (const [, , name] of list) addChars(name);
  }

  const dir = join(OUT, "routes");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [key, t] of tiles) await writeFile(join(dir, `${key}.json`), JSON.stringify(t));
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ zoom: Z, tiles: [...tiles.keys()], fetchedAt: new Date().toISOString() }),
  );
  await writeFile(join(dir, "LICENSE.txt"), ODBL_NOTICE);
  await writeFile(
    join(OUT, "guide-places.json"),
    JSON.stringify({
      source:
        "国土交通省「各都道府県において表示される基準地・重要地・主要地一覧表」（平成30年6月末時点）の地名を、OpenStreetMap（© OpenStreetMap contributors, ODbL 1.0）の交差点名・地名・駅・区役所の位置に置いたもの",
      url: "https://www.mlit.go.jp/road/sign/sign/annai/6-hyou-timei.htm",
      places,
    }),
  );
  // Characters every board may need: digits, Latin for "m", the kana of この先, then the data.
  const base = "0123456789m．・ー〜この先通り街道大";
  const sorted = [
    ...new Set([...base, ...[...chars].filter((c) => c.trim() && c.charCodeAt(0) > 0x7f)]),
  ].sort();
  await mkdir(join(ROOT, "assets", "signs", "guide"), { recursive: true });
  await writeFile(CHARSET, `${sorted.join("")}\n`);
  log("written", {
    tiles: tiles.size,
    roads: roadCount,
    dests: destCount,
    places: places.length,
    chars: sorted.length,
  });
}

const ODBL_NOTICE = `Road numbers, street names and destinations in this folder are extracted from OpenStreetMap.
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database is made available under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Source extract: https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf (Geofabrik). Filters within the 23 wards:
- roads: way[highway~"trunk|primary|secondary"] with ref or name, and highway=tertiary named …通り/街道;
  ref, name and name:en, with the network of their route relation (JP:national / JP:prefectural)
- dests: way[highway] for vehicles with destination, destination:forward/backward, their :en / :lang:en
  and destination:ref, at the start of the way in the direction they apply to
- names: node[junction=yes][name] (junction names the signal nodes of ../junctions do not carry)
The positions in ../guide-places.json come from the same extract (signal and junction node names,
place and station nodes, named bridges, amenity=townhall).
`;

await main();
