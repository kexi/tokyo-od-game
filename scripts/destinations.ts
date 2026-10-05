// Places the navi's 目的地 chooser searches (public/data/destinations.json), from the
// OpenStreetMap Kanto extract that scripts/regulations.ts caches: every railway station in the 23
// wards (one entry per station name and place, the operators as a note), the notable places people
// drive to (temples, shrines, parks, museums, stadiums, bridges, the airport … mostly those with a
// wikidata tag, which keeps the list to places someone has written about), and a featured list of
// well-known landmarks for the chooser's view before anything is typed.
// Run: pnpm exec tsx scripts/destinations.ts   (just destinations; after `just regs` cached the PBF)
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import {
  readNodeCoords,
  readRelations,
  readReplicationTimestamp,
  readTaggedNodes,
  readWays,
  readWaysById,
} from "./osm-pbf.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "data", "destinations.json");
/** The ODbL notice beside the database (credits.ts links it, as for signals/ and routes/). */
const LICENSE_OUT = join(ROOT, "public", "data", "destinations.LICENSE.txt");
const ODBL_NOTICE = `The stations and places in destinations.json are extracted from OpenStreetMap.
© OpenStreetMap contributors — https://www.openstreetmap.org/copyright
This database is made available under the Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
Source extract: https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf (Geofabrik). Within the 23 wards:
railway stations (railway=station / public_transport=station, merged per name and place) and notable
places with a wikidata tag (tourism, historic, places of worship, parks, stadiums, towers, bridges,
the airport, government buildings, markets) — see scripts/destinations.ts for the exact filters.
`;
const OSM_CACHE = join(ROOT, ".cache", "osm", "kanto-latest.osm.pbf");
// 23 wards with a margin (the box of scripts/regulations.ts); the wards' own outline (e-Stat 町丁
// boundaries in public/data/areas.json) decides what is in.
const BBOX = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
// Station objects of one name closer than this (single linkage) are one station: 浅草's four
// operators spread 640 m, 早稲田's 都電 stop and Metro station 690 m; no two different stations of
// one name in the wards are nearer than several kilometres.
const STATION_LINK = 1000;
// Objects sharing a wikidata id farther apart than this carry a brand's or a road's id rather than
// their own (a chain store's, a highway's), so the id does not make them one place or notable.
const SAME_QID_SPREAD = 2500;
// Two places of one name and kind this close are one place mapped twice (a node and a building).
const SAME_NAME = 400;
// A district (place=*) of the same name as a park or a market this close is that place's district;
// two district objects of one name this close are one district (東大井's two pins 1.3 km apart).
const SAME_AREA = 1500;
const M_LAT = 110_950; // metres per degree of latitude near Tokyo
const M_LON = M_LAT * Math.cos((35.68 * Math.PI) / 180);

type LonLat = [number, number];
type Tags = Record<string, string>;
/** One OSM object: a node's point, a way's line or ring, or a relation's member ways. */
export type Feature = { osm: string; tags: Tags; parts: Array<{ pts: LonLat[]; inner: boolean }> };

/**
 * Kinds of destination with their Japanese labels (the UI translates by id). The order is the
 * file's sort order and, when several OSM objects are one place (浅草寺 is a place of worship and an
 * attraction; 皇居外苑 a park and a district), which kind names it: the more specific first.
 */
export const KINDS = {
  station: "駅",
  airport: "空港",
  government: "官公庁",
  temple: "寺院",
  shrine: "神社",
  church: "教会",
  worship: "宗教施設",
  zoo: "動物園",
  aquarium: "水族館",
  theme_park: "遊園地",
  museum: "博物館・美術館",
  theatre: "劇場",
  hall: "ホール・展示場",
  stadium: "競技場・体育館",
  tower: "タワー",
  bridge: "橋",
  crossing: "交差点",
  market: "市場",
  shopping: "商業施設・商店街",
  park: "公園",
  garden: "庭園",
  historic: "史跡",
  attraction: "名所",
  viewpoint: "展望地点",
  area: "地区",
} as const;
export type Kind = keyof typeof KINDS;
const KIND_ORDER = Object.keys(KINDS) as Kind[];
const kindRank = (k: Kind) => KIND_ORDER.indexOf(k);

/** [kind, lat, lon, name, name_en, ward, featured, note] as written to the file. */
export type Row = [Kind, number, number, string, string | null, string | null, 0 | 1, string | null];

// ---------------------------------------------------------------- what counts

const hasQid = (t: Tags) => /^Q\d+$/.test(t.wikidata ?? "");
const hasJapanese = (s: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
// Scripts other than Japanese and Latin in `name` are a mapper's addition (浅草寺 is mapped
// 「Храм Сенсодзи 金龍山 浅草寺」), so name:ja is the one to show then.
const hasForeignScript = (s: string) =>
  /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(
    s,
  );

/**
 * The Japanese name: `name` as mapped (東京ビッグサイト, whose name:ja is the official 東京国際展示場),
 * name:ja when `name` is in a foreign script or Latin only.
 */
export function nameOf(t: Tags): string {
  const name = (t.name ?? "").trim();
  const ja = (t["name:ja"] ?? "").trim();
  const isUsable = !!name && !hasForeignScript(name) && (hasJapanese(name) || !ja);
  return isUsable ? name : ja || name;
}
// Station platforms and gates mapped as stations, and the training "stations" of JR's 蒲田
// training centre (usage=training) or the slope cars of 飛鳥山 (station=funicular), are not stops
// a passenger can be driven to; nor are the freight terminals.
const isGateName = (n: string) => /(改札|出入口|出口|入口$)/.test(n);

export function isStation(t: Tags): boolean {
  const isRail = t.railway === "station" || (t.railway === "halt" && t.public_transport === "station");
  if (!isRail || !nameOf(t)) return false;
  const isNotForPassengers =
    t.usage === "training" ||
    t.usage === "freight" ||
    t.station === "funicular" ||
    t.station === "freight" ||
    t.access === "private" ||
    /貨物/.test(`${nameOf(t)}${t.operator ?? ""}`);
  return !isNotForPassengers && !isGateName(nameOf(t));
}

// Shopping streets carry wikidata on the street way: 渋谷センター街, 谷中銀座, 思い出横丁 ….
const SHOPPING_STREET = /(商店街|銀座|横丁|横町|センター街|仲見世|ストリート)$/;
const isBridgeName = (n: string) => /(橋|ブリッジ)$/.test(n);
// Not community_centre: with wikidata that is still mostly a 町会会館 or a 地区センター.
const CIVIC_HALLS = new Set([
  "arts_centre",
  "exhibition_centre",
  "conference_centre",
  "events_venue",
  "concert_hall",
]);
// Adult venues and red-light districts are not places the game offers to drive to; nor are
// embassies (diplomatic premises, not sights).
const isLeftOut = (t: Tags) =>
  ["brothel", "love_hotel", "stripclub", "swingerclub", "embassy"].includes(t.amenity ?? "") ||
  t.office === "diplomatic" ||
  /red.?light/i.test(t["name:en"] ?? "");

/** Every kind the tags qualify for (the first one by KINDS order names the place). */
export function kindsOf(t: Tags): Kind[] {
  const out: Kind[] = [];
  const name = nameOf(t);
  if ((!name && !t["bridge:name"]) || isLeftOut(t)) return out;
  const qid = hasQid(t);
  if (t.aeroway === "aerodrome") out.push("airport");
  const isGovernment =
    !!t.government || t.office === "government" || t.amenity === "townhall" || t.amenity === "courthouse";
  if (qid && isGovernment) out.push("government");
  const isWorship = t.amenity === "place_of_worship" || (t.landuse === "religious" && !!t.religion);
  if (qid && isWorship) {
    const byReligion: Record<string, Kind> = { buddhist: "temple", shinto: "shrine", christian: "church" };
    out.push(byReligion[t.religion ?? ""] ?? "worship");
  }
  if (t.tourism === "zoo") out.push("zoo");
  if (t.tourism === "aquarium") out.push("aquarium");
  if (t.tourism === "theme_park") out.push("theme_park");
  // Museums are notable as such (most without wikidata are real ones: 刀剣博物館, 凧の博物館 …);
  // commercial galleries are not, unless written about.
  if (t.tourism === "museum" || (qid && t.tourism === "gallery")) out.push("museum");
  if (qid && t.amenity === "theatre") out.push("theatre");
  if (qid && CIVIC_HALLS.has(t.amenity ?? "")) out.push("hall");
  const isSportsVenue =
    t.leisure === "stadium" || t.leisure === "sports_centre" || t.leisure === "sports_hall";
  if (qid && (isSportsVenue || t.building === "stadium")) out.push("stadium");
  if (qid && (t.man_made === "tower" || t.man_made === "communications_tower")) out.push("tower");
  // A road way on a bridge often carries the road's wikidata under the road's name, with the
  // bridge in bridge:name (中山道 over 戸田橋, 有明通り over 東雲橋), so the id is the bridge's only
  // as bridge:wikidata or next to a name that is itself the bridge's.
  const isOnBridge = !!t.highway && !!t.bridge && t.bridge !== "no";
  const isOwnBridgeName = isBridgeName(name) && (!t["bridge:name"] || t["bridge:name"] === t.name);
  const hasBridgeQid = /^Q\d+$/.test(t["bridge:wikidata"] ?? "") || (qid && isOwnBridgeName);
  if ((t.man_made === "bridge" && qid) || (isOnBridge && hasBridgeQid)) out.push("bridge");
  const isMarket = t.amenity === "marketplace" || (name.endsWith("市場") && !!t.landuse);
  if (qid && isMarket) out.push("market");
  // A commercial landuse with wikidata is a shopping complex unless it is a hospital's or an
  // office's grounds (国立がん研究センター, 杉並郵便局 carry landuse=commercial too).
  const isCommercialSite =
    (t.landuse === "retail" || t.landuse === "commercial") && !t.amenity && !t.office && !t.healthcare;
  const isShopping =
    t.shop === "mall" ||
    t.shop === "department_store" ||
    isCommercialSite ||
    (!!t.highway && SHOPPING_STREET.test(name));
  if (qid && isShopping && !isMarket) out.push("shopping");
  if (qid && t.leisure === "park") out.push("park");
  if (qid && t.leisure === "garden") out.push("garden");
  if ((qid || !!t.wikipedia) && !!t.historic) out.push("historic");
  if (qid && t.tourism === "attraction") out.push("attraction");
  if (qid && t.tourism === "viewpoint") out.push("viewpoint");
  // Districts people name as places (原宿, 八重洲, 秋葉原), not the 丁目 subdivisions of a town.
  const isDistrict =
    ["suburb", "quarter", "locality"].includes(t.place ?? "") ||
    (t.place === "neighbourhood" && !name.endsWith("丁目"));
  if (qid && isDistrict) out.push("area");
  return out;
}

// ---------------------------------------------------------------- featured

type FeaturedSpec = {
  /** The name the chooser shows (the common name; the OSM name goes to the note when it differs). */
  label: string;
  en?: string;
  /** The kind when the tags do not say it (a junction, an exhibition hall mapped as a site). */
  kind?: Kind;
  /** A station's name (without 駅), or a test on an OSM object's tags. */
  station?: string;
  match?: (t: Tags) => boolean;
};

const named = (t: Tags, ...names: string[]) => names.includes(nameOf(t)) || names.includes(t.name ?? "");

/**
 * The well-known landmarks the chooser lists before anything is typed, each pinned to one OSM
 * object by its name and the tag that makes it that place (never by coordinates). 東京タワー and
 * 東京スカイツリー are also hero models (public/data/landmarks.json); the UI merges those.
 */
export const FEATURED: FeaturedSpec[] = [
  { label: "東京駅", station: "東京" },
  { label: "国会議事堂", match: (t) => named(t, "国会議事堂") && t.government === "parliament" },
  { label: "皇居外苑", match: (t) => named(t, "皇居外苑") && t.leisure === "park" },
  { label: "東京都庁", match: (t) => named(t, "東京都庁") && t.amenity === "townhall" },
  { label: "浅草寺", match: (t) => named(t, "浅草寺") && t.amenity === "place_of_worship" },
  { label: "雷門", match: (t) => named(t, "雷門") && t.building === "gatehouse" },
  { label: "明治神宮", match: (t) => named(t, "明治神宮") && t.amenity === "place_of_worship" },
  { label: "東京ドーム", match: (t) => named(t, "東京ドーム") && t.leisure === "stadium" },
  { label: "レインボーブリッジ", match: (t) => named(t, "レインボーブリッジ") && t.man_made === "bridge" },
  {
    // OSM names the junction 渋谷駅前 (the signal name) and the scramble an alt_name.
    label: "渋谷スクランブル交差点",
    kind: "crossing",
    match: (t) => t.alt_name === "渋谷スクランブル交差点" && t["crossing:scramble"] === "yes",
  },
  {
    // OSM's name is the common 上野公園; the official 上野恩賜公園 is its official_name.
    label: "上野恩賜公園",
    en: "Ueno Park",
    match: (t) => t.official_name === "上野恩賜公園" && t.leisure === "park",
  },
  {
    label: "羽田空港",
    en: "Haneda Airport",
    match: (t) => t.aeroway === "aerodrome" && t.alt_name === "羽田空港",
  },
  // The district (wikipedia ja:秋葉原), not the station: the town of electronics shops.
  { label: "秋葉原", match: (t) => named(t, "秋葉原") && !!t.place && t.wikipedia === "ja:秋葉原" },
  { label: "六本木ヒルズ", match: (t) => named(t, "六本木ヒルズ") && hasQid(t) },
  {
    // Mapped as a commercial landuse (the site) and a community_centre node: an exhibition hall.
    label: "東京ビッグサイト",
    kind: "hall",
    match: (t) => named(t, "東京ビッグサイト") && hasQid(t) && !t.railway,
  },
  { label: "お台場海浜公園", match: (t) => named(t, "お台場海浜公園") && t.leisure === "park" },
  { label: "増上寺", match: (t) => named(t, "増上寺") && t.amenity === "place_of_worship" },
  { label: "歌舞伎座", match: (t) => named(t, "歌舞伎座") && t.amenity === "theatre" },
  { label: "日本武道館", match: (t) => named(t, "日本武道館") && !!t.leisure },
  {
    // Mapped under its construction-time name 新国立競技場; it opened (2019) as 国立競技場.
    label: "国立競技場",
    en: "Japan National Stadium",
    match: (t) => named(t, "国立競技場", "新国立競技場") && /^(stadium|sports_centre)$/.test(t.leisure ?? ""),
  },
  { label: "両国国技館", match: (t) => named(t, "両国国技館") && !!t.leisure },
  {
    // No wikidata on the bridge's road ways and no bridge outline: the ways named for it.
    label: "東京ゲートブリッジ",
    kind: "bridge",
    match: (t) => (t["bridge:name"] ?? t.name) === "東京ゲートブリッジ" && !!t.bridge && !!t.highway,
  },
  { label: "豊洲市場", match: (t) => named(t, "豊洲市場") && hasQid(t) },
  { label: "新宿御苑", match: (t) => named(t, "新宿御苑") && t.leisure === "park" },
  {
    label: "迎賓館赤坂離宮",
    match: (t) => named(t, "迎賓館") && !!t.historic && t.wikipedia === "ja:迎賓館赤坂離宮",
  },
  { label: "日本橋", match: (t) => named(t, "日本橋") && t.man_made === "bridge" },
  {
    label: "銀座四丁目交差点",
    kind: "crossing",
    match: (t) => named(t, "銀座四丁目交差点") && t.tourism === "attraction",
  },
  { label: "東京タワー", match: (t) => named(t, "東京タワー") && t.man_made === "tower" },
  {
    label: "東京スカイツリー",
    match: (t) => named(t, "東京スカイツリー") && t.man_made === "communications_tower",
  },
];

/** Tags worth reading from the extract: stations, notable places and the featured objects. */
export const isCandidate = (t: Tags) =>
  isStation(t) || kindsOf(t).length > 0 || FEATURED.some((f) => f.match?.(t) ?? false);

// ---------------------------------------------------------------- geometry

const key = (p: LonLat) => `${p[0]},${p[1]}`;
const isClosed = (r: LonLat[]) => r.length >= 4 && key(r[0]) === key(r[r.length - 1]);
const metres = (a: LonLat, b: LonLat) => Math.hypot((b[0] - a[0]) * M_LON, (b[1] - a[1]) * M_LAT);

/** Member ways joined end to end into rings (a multipolygon's outline is often cut into many). */
export function joinRings(lines: LonLat[][]): LonLat[][] {
  const left = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const out: LonLat[][] = [];
  while (left.length > 0) {
    const ring = left.shift() as LonLat[];
    let grew = true;
    while (!isClosed(ring) && grew) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      const i = left.findIndex((l) => key(l[0]) === end || key(l[l.length - 1]) === end);
      if (i < 0) break;
      const [next] = left.splice(i, 1);
      const isForward = key(next[0]) === end;
      ring.push(...(isForward ? next.slice(1) : next.slice(0, -1).toReversed()));
      grew = true;
    }
    out.push(ring);
  }
  return out;
}

/** Area centroid and |area| of a closed ring (shoelace, around its first vertex for precision). */
function ringCentroid(r: LonLat[]): { at: LonLat; area: number } {
  const [x0, y0] = r[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const xi = (r[i][0] - x0) * M_LON;
    const yi = (r[i][1] - y0) * M_LAT;
    const xj = (r[i + 1][0] - x0) * M_LON;
    const yj = (r[i + 1][1] - y0) * M_LAT;
    const cross = xi * yj - xj * yi;
    a += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  if (Math.abs(a) < 1e-6) return { at: lineCentroid([r]), area: 0 };
  return { at: [x0 + cx / (3 * a) / M_LON, y0 + cy / (3 * a) / M_LAT], area: Math.abs(a / 2) };
}

/** Length-weighted centre of open lines (a bridge's carriageways). */
function lineCentroid(lines: LonLat[][]): LonLat {
  let sum = 0;
  let x = 0;
  let y = 0;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const len = metres(l[i - 1], l[i]);
      sum += len;
      x += ((l[i - 1][0] + l[i][0]) / 2) * len;
      y += ((l[i - 1][1] + l[i][1]) / 2) * len;
    }
  }
  if (sum > 0) return [x / sum, y / sum];
  const pts = lines.flat();
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/**
 * Where a feature is: a node's point; an area's centroid (outer rings, weighted by area); an open
 * way's or an unclosed relation's length-weighted centre.
 */
export function centreOf(f: Feature): LonLat | null {
  const outer = f.parts.filter((p) => !p.inner && p.pts.length > 0).map((p) => p.pts);
  if (outer.length === 0) return null;
  if (outer.length === 1 && outer[0].length === 1) return outer[0][0];
  const rings = joinRings(outer).filter(isClosed);
  if (rings.length === 0) return lineCentroid(outer);
  let area = 0;
  let x = 0;
  let y = 0;
  for (const r of rings) {
    const c = ringCentroid(r);
    area += c.area;
    x += c.at[0] * c.area;
    y += c.at[1] * c.area;
  }
  return area > 0 ? [x / area, y / area] : lineCentroid(rings);
}

// ---------------------------------------------------------------- build

type Located = { f: Feature; at: LonLat; ward: string };
/** Order of preference among objects that are one place: lower first, element by element. */
type Rank = [number, number, number, number, number, number];
type Part = Located & { kind: Kind; rank: Rank };
type Item = {
  kind: Kind;
  at: LonLat;
  ward: string;
  name: string;
  en: string | null;
  note: string | null;
  featured: boolean;
  /** OSM objects merged into this place ("n123", "w45", "r6"). */
  members: Set<string>;
  tags: Tags;
  qid: string;
  /** The representative's closed outline, to take in the parts mapped inside it. */
  rings: LonLat[][];
  rank: Rank;
};

const elementRank = (osm: string) => "rwn".indexOf(osm[0]);
const idOf = (osm: string) => Number(osm.slice(1));
const cmpRank = (a: Rank, b: Rank) => a.reduce((d, v, i) => d || v - b[i], 0);
const cmpText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const qidOf = (t: Tags, kind: Kind) =>
  (kind === "bridge" ? t["bridge:wikidata"] : undefined) ??
  t.wikidata ??
  (t.wikipedia ? `wp:${t.wikipedia}` : "");

/** The Japanese Wikipedia article's title (「ja:日本橋 (東京都中央区の橋)」 → 日本橋). */
const articleTitle = (t: Tags) => (t.wikipedia ?? "").match(/^ja:([^(（#]+)/)?.[1]?.trim() ?? "";

/**
 * Preference: a Japanese name (a stray English-named node can carry a place's id: 六本木ヒルズ's
 * id is also on 「Roppongi hills - Kojipro?」 office=government), the more specific kind, the object
 * named as its article is (明治神宮's id is also on its 本殿), an object written about, a relation
 * over a way over a node (the outline over a pin), the older id.
 */
const rankOf = (f: Feature, kind: Kind): Rank => [
  hasJapanese(nameOf(f.tags)) ? 0 : 1,
  kindRank(kind),
  nameOf(f.tags) === articleTitle(f.tags) ? 0 : 1,
  qidOf(f.tags, kind) ? 0 : 1,
  elementRank(f.osm),
  idOf(f.osm),
];

/** Inside a closed ring (even-odd, in degrees: fine at a place's scale). */
function inRings(rings: LonLat[][], [x, y]: LonLat): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const crosses =
        r[i][1] > y !== r[j][1] > y &&
        x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0];
      if (crosses) inside = !inside;
    }
  }
  return inside;
}

/** Other names a place goes by (official, alternative), Japanese only, for search and display. */
const fold = (s: string) => s.replace(/\s+/g, "");

function otherNames(t: Tags, name: string, extra: string[] = []): string | null {
  const seen = new Set([fold(name)]);
  const out: string[] = [];
  const candidates = [
    ...extra,
    t.name,
    t["name:ja"],
    t.official_name,
    t["official_name:ja"],
    ...(t.alt_name ?? "").split(";"),
    ...(t["alt_name:ja"] ?? "").split(";"),
    t["bridge:name"],
  ];
  for (const raw of candidates) {
    const n = (raw ?? "").trim();
    const isNew = !!n && hasJapanese(n) && !hasForeignScript(n) && !seen.has(fold(n));
    if (!isNew || out.length >= 3) continue;
    seen.add(fold(n));
    out.push(n);
  }
  const note = out.join("、");
  return note ? note.slice(0, 40) : null;
}

// Operators as people call them, in the order a note lists them.
const OPERATORS: Array<[RegExp, string]> = [
  [/東日本旅客鉄道|JR東日本/, "JR東日本"],
  [/東海旅客鉄道|JR東海/, "JR東海"],
  [/東京地下鉄|東京メトロ/, "東京メトロ"],
  [/東京都交通局|都営/, "都営"],
  [/東京急行|東急/, "東急"],
  [/京浜急行|京急/, "京急"],
  [/京王/, "京王"],
  [/小田急/, "小田急"],
  [/西武/, "西武"],
  [/東武/, "東武"],
  [/京成/, "京成"],
  [/首都圏新都市鉄道|つくばエクスプレス/, "つくばエクスプレス"],
  [/東京臨海高速鉄道|りんかい線/, "りんかい線"],
  [/ゆりかもめ/, "ゆりかもめ"],
  [/東京モノレール/, "東京モノレール"],
  [/北総/, "北総鉄道"],
  [/埼玉高速/, "埼玉高速鉄道"],
];

const operatorOrder = (op: string) => {
  const i = OPERATORS.findIndex(([, short]) => short === op);
  return i < 0 ? OPERATORS.length : i;
};

function operatorNote(tagsList: Tags[]): string | null {
  const found = new Set<string>();
  for (const t of tagsList) {
    for (const raw of (t.operator ?? t.network ?? "").split(";")) {
      const op = raw.replace(/株式会社|\(株\)/g, "").trim();
      if (!op) continue;
      found.add(OPERATORS.find(([re]) => re.test(op))?.[1] ?? op);
    }
  }
  const list = [...found].toSorted((a, b) => operatorOrder(a) - operatorOrder(b) || cmpText(a, b));
  return list.length > 0 ? list.join("・") : null;
}

const isAscii = (s: string) => /^[\x20-\x7e]+$/.test(s);

/** The English name most of the objects give, ASCII spellings (Tokyo) over macrons (Tōkyō). */
function commonEnglish(tagsList: Tags[]): string | null {
  const count = new Map<string, number>();
  for (const t of tagsList) {
    const en = t["name:en"]?.trim();
    if (en) count.set(en, (count.get(en) ?? 0) + 1);
  }
  const best = [...count].toSorted(
    (a, b) => Number(isAscii(b[0])) - Number(isAscii(a[0])) || b[1] - a[1] || cmpText(a[0], b[0]),
  )[0];
  return best?.[0] ?? null;
}

export type BuildReport = {
  featured: Array<{ label: string; osm: string[]; kind: Kind } | { label: string; missing: true }>;
  /** Places whose centre fell outside the wards and moved to their nearest point inside. */
  movedIntoWards: string[];
  /** Areas mostly outside the wards (a park across the border) left out. */
  outsideWards: string[];
  brandQids: string[];
};

/**
 * The destinations from the features: stations merged per name and place, places merged per
 * wikidata id, then per name and by being mapped inside another; featured ones marked. `wardOf`
 * answers which ward a point is in (null outside the 23 wards).
 */
export function buildDestinations(
  features: Feature[],
  wardOf: (lat: number, lon: number) => string | null,
): { rows: Row[]; report: BuildReport } {
  const report: BuildReport = { featured: [], movedIntoWards: [], outsideWards: [], brandQids: [] };
  /**
   * A centre outside the wards moves to the object's own point inside them nearest to it: a
   * bridge's mid-span over the bay or a border river (any bridge with a foot in the wards), or an
   * area mostly inside (a beach park reaching into the sea, 水元公園 round its pond). An area
   * mostly outside is a neighbour's (戸田公園, みさと公園, 川崎市中原区) and a node outside is not in.
   */
  const locate = (f: Feature, isBridge = false): Located | null => {
    const at = centreOf(f);
    if (!at) return null;
    const ward = wardOf(at[1], at[0]);
    if (ward) return { f, at, ward };
    const pts = f.parts.filter((p) => !p.inner).flatMap((p) => p.pts);
    const inside = pts
      .map((p) => ({ p, ward: wardOf(p[1], p[0]) }))
      .filter((v): v is { p: LonLat; ward: string } => v.ward !== null);
    const isMostlyInside = isBridge ? inside.length > 0 : inside.length * 2 >= pts.length && pts.length > 1;
    if (!isMostlyInside) {
      if (inside.length > 0) report.outsideWards.push(`${f.osm} ${nameOf(f.tags)}`);
      return null;
    }
    const best = inside.reduce((a, b) => (metres(at, b.p) < metres(at, a.p) ? b : a));
    report.movedIntoWards.push(`${f.osm} ${nameOf(f.tags)} ${Math.round(metres(at, best.p))} m`);
    return { f, at: best.p, ward: best.ward };
  };

  // ---------- stations: one per name and place
  const byName = new Map<string, Located[]>();
  for (const f of features) {
    if (!isStation(f.tags)) continue;
    const s = locate(f);
    if (!s) continue;
    const name = nameOf(f.tags).replace(/駅$/, "");
    const list = byName.get(name) ?? [];
    list.push(s);
    byName.set(name, list);
  }
  const items: Item[] = [];
  for (const [name, list] of byName) {
    const clusters: Located[][] = [];
    for (const s of list) {
      const near = clusters.filter((c) => c.some((o) => metres(o.at, s.at) < STATION_LINK));
      for (const c of near) clusters.splice(clusters.indexOf(c), 1);
      clusters.push([s, ...near.flat()]);
    }
    for (const c of clusters) {
      // The station nodes where there are any (a station's outline adds nothing a node lacks).
      const nodes = c.filter((s) => s.f.osm.startsWith("n"));
      const pts = (nodes.length > 0 ? nodes : c).map((s) => s.at);
      const centre: LonLat = [
        pts.reduce((a, p) => a + p[0], 0) / pts.length,
        pts.reduce((a, p) => a + p[1], 0) / pts.length,
      ];
      const tagsList = c.map((s) => s.f.tags);
      const en = commonEnglish(tagsList);
      items.push({
        kind: "station",
        at: centre,
        ward: wardOf(centre[1], centre[0]) ?? c[0].ward,
        name: `${name}駅`,
        en: en ? (/station$/i.test(en) ? en : `${en} Station`) : null,
        note: operatorNote(tagsList),
        featured: false,
        members: new Set(c.map((s) => s.f.osm)),
        tags: {},
        qid: "",
        rings: [],
        rank: [0, 0, 0, 0, 0, 0],
      });
    }
  }

  // ---------- places: grouped by wikidata id
  const groups = new Map<string, Part[]>();
  const singles: Part[] = [];
  for (const f of features) {
    if (isStation(f.tags)) continue;
    const kind = kindsOf(f.tags)[0];
    if (!kind) continue;
    const l = locate(f, kind === "bridge");
    if (!l) continue;
    const part: Part = { ...l, kind, rank: rankOf(f, kind) };
    const qid = qidOf(f.tags, kind);
    if (!qid) {
      singles.push(part);
      continue;
    }
    const g = groups.get(qid) ?? [];
    g.push(part);
    groups.set(qid, g);
  }
  for (const [qid, g] of [...groups].toSorted((a, b) => cmpText(a[0], b[0]))) {
    const spread = Math.max(...g.flatMap((a) => g.map((b) => metres(a.at, b.at))));
    const isBrand = spread > SAME_QID_SPREAD && !g.every((p) => p.kind === "bridge");
    if (!isBrand) {
      const rep = g.toSorted((a, b) => cmpRank(a.rank, b.rank))[0];
      items.push(placeItem(rep, g));
      continue;
    }
    // Without the borrowed id a member is a place only if it qualifies on its own tags.
    report.brandQids.push(`${qid} ×${g.length} ${Math.round(spread)} m`);
    for (const p of g) {
      const { wikidata: _qid, wikipedia: _article, ...own } = p.f.tags;
      const kind = kindsOf(own)[0];
      if (kind)
        singles.push({ ...p, f: { ...p.f, tags: own }, kind, rank: rankOf({ ...p.f, tags: own }, kind) });
    }
  }
  for (const p of singles) items.push(placeItem(p, [p]));

  // ---------- one place mapped twice
  // One name close by, whatever the kinds: a museum's node may be a museum and its building,
  // written about, a historic one. Sorted below, so the more specific kind is the one kept.
  const isSameName = (k: Item, it: Item) => {
    const radius = it.kind === "area" || k.kind === "area" ? SAME_AREA : SAME_NAME;
    return k.name === it.name && metres(k.at, it.at) < radius;
  };
  // A part mapped inside a place of its kind without an id of its own (上野動物園's 東園 and 西園, a
  // hall's gallery tagged museum).
  const isPartOf = (k: Item, it: Item) =>
    !it.qid && it.kind === k.kind && k.kind !== "station" && inRings(k.rings, it.at);
  const kept: Item[] = [];
  for (const it of items.toSorted((a, b) => cmpRank(a.rank, b.rank))) {
    const twin = kept.find((k) => isSameName(k, it) || isPartOf(k, it));
    if (!twin) {
      kept.push(it);
      continue;
    }
    for (const m of it.members) twin.members.add(m);
    twin.en ??= it.en;
  }

  // ---------- featured
  /** A featured place none of the rules above made an item of (a junction, a bridge's ways). */
  const featuredItem = (spec: FeaturedSpec): Item | null => {
    const kind = spec.kind;
    if (!kind) return null;
    const hits = features
      .filter((f) => spec.match?.(f.tags))
      .map((f) => locate(f, kind === "bridge"))
      .filter((l): l is Located => l !== null)
      .toSorted((a, b) => cmpRank(rankOf(a.f, kind), rankOf(b.f, kind)));
    if (hits.length === 0) return null;
    const it = placeItem({ ...hits[0], kind, rank: rankOf(hits[0].f, kind) }, hits);
    kept.push(it);
    return it;
  };
  for (const spec of FEATURED) {
    const station = spec.station;
    const matched = new Set(features.filter((f) => spec.match?.(f.tags)).map((f) => f.osm));
    const hit = station
      ? kept.find((it) => it.kind === "station" && it.name === `${station}駅`)
      : (kept.find((it) => it.kind !== "station" && [...it.members].some((m) => matched.has(m))) ??
        featuredItem(spec));
    if (!hit) {
      report.featured.push({ label: spec.label, missing: true });
      continue;
    }
    hit.featured = true;
    if (hit.name !== spec.label) {
      // The common name to show and search; the mapped one stays findable in the note.
      hit.note = station ? hit.note : otherNames(hit.tags, spec.label, [hit.name]);
      hit.name = spec.label;
    }
    if (spec.en) hit.en = spec.en;
    if (spec.kind) hit.kind = spec.kind;
    report.featured.push({ label: spec.label, osm: [...hit.members].toSorted(), kind: hit.kind });
  }
  // A featured place renamed to its common name can now share it with a district close by (羽田空港
  // the airport and 羽田空港 the town): the featured one stays.
  const featured = kept.filter((it) => it.featured);
  const final = kept.filter((it) => it.featured || !featured.some((f) => isSameName(f, it)));

  const rows: Row[] = final
    .toSorted(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) ||
        cmpText(a.name, b.name) ||
        a.at[1] - b.at[1] ||
        a.at[0] - b.at[0],
    )
    .map((it) => [
      it.kind,
      round6(it.at[1]),
      round6(it.at[0]),
      it.name,
      it.en,
      it.ward,
      it.featured ? 1 : 0,
      it.note,
    ]);
  return { rows, report };
}

function placeItem(rep: Part, group: Located[]): Item {
  const t = rep.f.tags;
  const isBridge = rep.kind === "bridge";
  const name = (isBridge ? (t["bridge:name:ja"] ?? t["bridge:name"]) : undefined) ?? nameOf(t);
  const en =
    (isBridge ? t["bridge:name:en"] : undefined) ?? t["name:en"] ?? commonEnglish(group.map((g) => g.f.tags));
  const outer = rep.f.parts.filter((p) => !p.inner).map((p) => p.pts);
  return {
    kind: rep.kind,
    at: rep.at,
    ward: rep.ward,
    name,
    en,
    note: otherNames(t, name),
    featured: false,
    members: new Set(group.map((g) => g.f.osm)),
    tags: t,
    qid: qidOf(t, rep.kind),
    rings: joinRings(outer).filter(isClosed),
    rank: rep.rank,
  };
}

// ---------------------------------------------------------------- extract

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
const inBox = ([lon, lat]: LonLat) =>
  lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;

// Multipolygons and sites (豊洲市場 is a site of its blocks); not routes or stop areas, whose
// members are lines and platforms rather than the outline of a place.
const isArea = (t: Tags) => ["multipolygon", "boundary", "site"].includes(t.type ?? "");

/** The candidate objects in the wards' box with their geometry (five passes over the file). */
export function extractFeatures(file: Uint8Array): Feature[] {
  const nodes = readTaggedNodes(file, isCandidate);
  const ways = readWays(file, isCandidate);
  const rels = readRelations(file, (t) => isArea(t) && isCandidate(t));
  const memberIds = new Set(rels.flatMap((r) => r.members.filter((m) => m.type === "way").map((m) => m.ref)));
  const memberWays = new Map(readWaysById(file, memberIds).map((w) => [w.id, w]));
  const ids = new Set<number>();
  for (const w of [...ways, ...memberWays.values()]) for (const r of w.refs) ids.add(r);
  const coords = readNodeCoords(file, ids);
  log("osm_read", { nodes: nodes.length, ways: ways.length, relations: rels.length, coords: coords.size });
  const line = (refs: number[]) => refs.map((r) => coords.get(r)).filter((c): c is LonLat => c !== undefined);
  const out: Feature[] = [];
  for (const n of nodes) {
    const at: LonLat = [n.lon, n.lat];
    if (inBox(at)) out.push({ osm: `n${n.id}`, tags: n.tags, parts: [{ pts: [at], inner: false }] });
  }
  for (const w of ways) {
    const pts = line(w.refs);
    if (pts.some(inBox)) out.push({ osm: `w${w.id}`, tags: w.tags, parts: [{ pts, inner: false }] });
  }
  for (const r of rels) {
    const parts = r.members
      .filter((m) => m.type === "way" && memberWays.has(m.ref))
      .map((m) => ({ pts: line(memberWays.get(m.ref)?.refs ?? []), inner: m.role === "inner" }));
    if (parts.some((p) => p.pts.some(inBox))) out.push({ osm: `r${r.id}`, tags: r.tags, parts });
  }
  return out;
}

async function main(): Promise<void> {
  const started = Date.now();
  if (!existsSync(OSM_CACHE))
    throw new Error(`${OSM_CACHE} missing: run \`just regs\` (pnpm exec tsx scripts/regulations.ts signals)`);
  const file = new Uint8Array(await readFile(OSM_CACHE));
  const areas = new AreaIndex(
    JSON.parse(await readFile(join(ROOT, "public", "data", "areas.json"), "utf8")) as AreaFile,
  );
  const features = extractFeatures(file);
  const { rows, report } = buildDestinations(features, (lat, lon) => areas.lookup(lat, lon)?.ward ?? null);
  const asOf = readReplicationTimestamp(file);
  const body = {
    source:
      "© OpenStreetMap contributors（ODbL 1.0）。Geofabrik の関東抽出（kanto-latest.osm.pbf）から 23 区内の鉄道駅と名所を抽出（scripts/destinations.ts）",
    generatedAt: asOf ?? "",
    kinds: KINDS,
    items: rows,
  };
  // One item per line: still compact, and a re-run's diff shows which places changed.
  const head = JSON.stringify({ ...body, items: [] }).replace(/\[\]\}$/, "");
  await writeFile(OUT, `${head}[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`);
  await writeFile(LICENSE_OUT, ODBL_NOTICE);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r[0]] = (counts[r[0]] ?? 0) + 1;
  log("written", {
    file: OUT,
    items: rows.length,
    counts,
    featured: report.featured,
    movedIntoWards: report.movedIntoWards.length,
    brandQids: report.brandQids,
    seconds: Math.round((Date.now() - started) / 1000),
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
  });
  log("moved_into_wards", { list: report.movedIntoWards });
}

// Only when run as a script: the tests import the rules above without reading the extract.
const isEntry = !!process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename;
if (isEntry) await main();
