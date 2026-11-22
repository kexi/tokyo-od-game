// PR W, review0 追記 6 J3 (from countW7.mts): rows main / now / L / L + G′ (room); e4 over every
// network (not the site groups only), every GSI street copy on the cells (main's doubled too),
// section differences between returned neighbours, named long copies, 35.67365.
// PR W, review0 追記 5 H2 の 4 (from countW6.mts): rows now / L / L + G′ (room) / L + G′ (value).
// PR W, review0 追記 4 手順 0 (from countW5.mts): rows now / L / L + G (upper) / L + G (value) over every
// network; strict returns unchanged, G's returns and drops, 659, the remaining edges, stability.
// PR W, review0 追記 3 E3 (from countW4.mts): L-only segments, 659 under L, doubled lists, L's
// entry-less nodes and same-width cuts, over every network (missing GSI tiles fetched into the cache).
// PR W, review0 追記 2: the stability checks by position on the GSI line (1 m cells, not segment
// keys), over more networks (C3: every network centred on a z16 tile whose 3 × 3 holds a returned
// segment), the rows now / a2 / a2+d / L, and the cause-finding round named places (C2 の 2).
// Needs src/world/regulations.before.ts (main) and regulations.exp.ts (makeExp2.py).
// Run (from the worktree):
//   pnpm exec tsx .qa/w/countW4.mts <xwDataDir> <gsiCache> <out.json> <mode> [focus lat,lon;…]
//   mode "all": the site networks and every network round their returned segments (C3);
//   mode "focus": the site networks holding the focus points and the 5 × 5 centres round each.
import { writeFile } from "node:fs/promises";
const W = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a5195e3853739145f";
const { ST, STATION_STRIDE } = await import(`${W}/src/expressway/format.ts`);
const { haversine } = await import(`${W}/src/expressway/geo.ts`);
const { LocalFrame } = await import(`${W}/src/geo/frame.ts`);
const { tileXToLon, tileYToLat } = await import(`${W}/src/geo/tiles.ts`);
const { expresswayRoadInput, joinExpressway } = await import(`${W}/src/world/expresswayRoads.ts`);
const { RoadGraph } = await import(`${W}/src/world/roads.ts`);
const { ROAD_TILE_ZOOM } = await import(`${W}/src/world/roadTiles.ts`);
const { takesJarticRules } = await import(`${W}/src/world/roadClass.ts`);
const { ROAD_LANES_COLUMN: C } = await import(`${W}/src/world/roadLanesData.ts`);
const { OSM_ONEWAY_REACH } = await import(`${W}/src/world/streetAssumptions.ts`);
const { readExpresswayFiles } = await import(`${W}/scripts/expresswayFiles.ts`);
const { gsiTileReader, regulationReader, roadTileOf } = await import(`${W}/scripts/gameStreets.ts`);
const before = await import(`${W}/src/world/regulations.before.ts`);
const exp = await import(`${W}/src/world/regulations.exp.ts`);
const { EXP, EXP_OUT, straightNode } = exp;

const [dataDir, cacheDir, outPath, mode, focusArg] = process.argv.slice(2);
const files = readExpresswayFiles(dataDir);
const runs = [
  ...new Map([...files.tiles.values()].flatMap((t: any) => t.runs).map((r: any) => [r.id, r])).values(),
];
const { VectorTile } = await import("@mapbox/vector-tile");
const PbfMod: any = await import("pbf");
const Pbf = PbfMod.default ?? PbfMod;
const { roadLinesOfTile } = await import(`${W}/src/world/roadTiles.ts`);
const { readFile: rf, writeFile: wf, mkdir } = await import("node:fs/promises");
const tileLines = new Map<string, any[] | null>();
const reasons: Record<string, number> = {};
/** A z16 GSI tile from the cache, else from GSI (written to the cache; an empty file is a 404). */
async function streetsOf(x: number, y: number): Promise<any[] | null> {
  const key = `${x}-${y}`;
  if (tileLines.has(key)) return tileLines.get(key)!;
  const file = `${cacheDir}/${ROAD_TILE_ZOOM}-${key}.pbf`;
  let bytes: Uint8Array | null = null;
  try {
    bytes = new Uint8Array(await rf(file));
  } catch {
    try {
      const res = await fetch(
        `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${ROAD_TILE_ZOOM}/${x}/${y}.pbf`,
      );
      const isMissing = res.status === 404;
      if (!res.ok && !isMissing) throw new Error(`HTTP ${res.status}`);
      bytes = isMissing ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
      if (isMissing) reasons["gsi-404"] = (reasons["gsi-404"] ?? 0) + 1;
      reasons.fetched = (reasons.fetched ?? 0) + 1;
      await mkdir(cacheDir, { recursive: true });
      await wf(file, bytes);
    } catch {
      reasons["fetch-failed"] = (reasons["fetch-failed"] ?? 0) + 1;
      bytes = null;
    }
  }
  const lines =
    bytes === null ? null : bytes.length === 0 ? [] : roadLinesOfTile(new VectorTile(new Pbf(bytes)), x, y);
  tileLines.set(key, lines);
  return lines;
}
void gsiTileReader;
const regsAround = regulationReader();
const r2 = (v: number) => Math.round(v * 100) / 100;
const PARALLEL = Math.cos((25 * Math.PI) / 180);
const isAllDay = (t: any) => t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);
const ROWS = [
  { name: "main", L: false, G: "off", main: true },
  { name: "now", L: false, G: "off" },
  { name: "L", L: true, G: "off" },
  { name: "L+G'-room", L: true, G: "room" },
];
const { streetRoom } = await import(`${W}/src/world/laneChange.ts`);
const roomHalf = (w: number) => streetRoom(w, 0).room / 2;
const { isEnterable } = await import(`${W}/src/world/roadClass.ts`);

const siteChunks = files.chunks.filter((c: any) => c.structure === "embankment" || c.structure === "cut");
const siteCentres = new Set<string>();
for (const c of siteChunks) {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  siteCentres.add(roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-"));
}

type Net = {
  key: string;
  isSite: boolean;
  frame: any;
  streets: any[];
  xw: any;
  regs: any;
  gB: any;
  extent: number[];
};
const netCache = new Map<string, Net | null>();
let missingNets = 0;
async function netAt(key: string): Promise<Net | null> {
  if (netCache.has(key)) return netCache.get(key)!;
  const [cx, cy] = key.split("-").map(Number);
  const streets: any[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const lines = await streetsOf(cx + dx, cy + dy);
      if (lines === null) {
        reasons["gsi-unreadable"] = (reasons["gsi-unreadable"] ?? 0) + 1;
        missingNets++;
        netCache.set(key, null);
        return null;
      }
      streets.push(...lines);
    }
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c: any) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= 1300) return true;
    return false;
  });
  const frame = new LocalFrame(lat, lon, 0);
  const regs = await regsAround(cx, cy);
  if (regs === null) {
    reasons["regs-null"] = (reasons["regs-null"] ?? 0) + 1;
    netCache.set(key, null);
    return null;
  }
  const xw = expresswayRoadInput(near, runs, (_a: number, _b: number, h: number) => h);
  const gB = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  before.applyRegulations(gB, structuredClone(regs), frame, () => {});
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  // The streets' extent (ground GSI lines), as expresswayRoads.ts isInsideStreets measures it.
  for (const s of gB.segments)
    if (takesJarticRules(s.line))
      for (const p of s.pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
  const net = {
    key,
    isSite: siteCentres.has(key),
    frame,
    streets,
    xw,
    regs,
    gB,
    extent: [minX, maxX, minZ, maxZ],
  };
  netCache.set(key, net);
  return net;
}
const edgeOf = (net: Net, p: any) =>
  Math.min(p.x - net.extent[0], net.extent[1] - p.x, p.z - net.extent[2], net.extent[3] - p.z);
const segKey = (net: Net, g: any, s: any) => {
  const q = net.frame.toGeodetic(g.sample(s, s.length / 2).pos);
  return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
};
const nodeKey = (net: Net, g: any, n: number) => {
  const s = g.segments[g.nodes.get(n)[0]];
  const p = s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
  const q = net.frame.toGeodetic(p);
  return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
};
const isCandidate = (gB: any, s: any) =>
  takesJarticRules(s.line) && s.line.oneway === 0 && s.onewayRule !== null && isAllDay(s.onewayRule.time);

function runRow(net: Net, row: any) {
  if (row.main) return { g: net.gB, byLoose: new Set<number>(), narrowKept: [] as number[] };
  Object.assign(EXP, { L: row.L, G: row.G, narrow: true });
  const g = new RoadGraph(
    joinExpressway(net.streets, net.xw, () => {}),
    net.frame,
    () => {},
  );
  exp.applyRegulations(g, structuredClone(net.regs), net.frame, () => {});
  return { g, byLoose: new Set(EXP_OUT.byLoose), narrowKept: [...EXP_OUT.narrowKept] };
}
/** 1 m cells along a segment (lat,lon to 5 places, ≈ 1 m), with the local point. */
function cellsOf(net: Net, g: any, s: any) {
  const out: Array<{ cell: string; p: any }> = [];
  for (let d = 0.5; d < s.length; d += 1) {
    const { pos: p, dir } = g.sample(s, d);
    const q = net.frame.toGeodetic(p);
    // The heading (mod 180°, 30° bins) keeps a crossing street's cells apart from this one's.
    const bin = Math.floor((((Math.atan2(dir.z, dir.x) * 180) / Math.PI + 360) % 180) / 30);
    out.push({ cell: `${q.lat.toFixed(5)},${q.lon.toFixed(5)}|${bin}`, p: { x: p.x, z: p.z } });
  }
  return out;
}

// ---- which networks ------------------------------------------------------------------------
const focus = (focusArg ?? "")
  .split(";")
  .filter(Boolean)
  .map((t) => t.split(",").map(Number));
let centres = new Set<string>(siteCentres);
if (mode === "focus") {
  centres = new Set();
  for (const [la, lo] of focus) {
    const [fx, fy] = roadTileOf(lo, la);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) centres.add(`${fx + dx}-${fy + dy}`);
  }
}
// Pass 0 (mode all): the site networks' returned segments give the tiles; every centre whose 3 × 3 holds one.
if (mode === "all") {
  const tiles = new Set<string>();
  for (const key of siteCentres) {
    const net = await netAt(key);
    if (!net) continue;
    for (const row of ROWS) {
      const { g } = runRow(net, row);
      for (let i = 0; i < g.segments.length; i++) {
        const isRet = net.gB.segments[i].onewayRule !== null && g.segments[i].onewayRule === null;
        if (!isRet) continue;
        const q = net.frame.toGeodetic(g.sample(g.segments[i], g.segments[i].length / 2).pos);
        tiles.add(roadTileOf(q.lon, q.lat).join("-"));
      }
    }
  }
  for (const t of tiles) {
    const [x, y] = t.split("-").map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) centres.add(`${x + dx}-${y + dy}`);
  }
}

// ---- pass 1: the cells of every returned segment, any row, any network ------------------------
const S = new Set<string>();
for (const key of centres) {
  const net = await netAt(key);
  if (!net) continue;
  for (const row of ROWS) {
    const { g } = runRow(net, row);
    for (let i = 0; i < g.segments.length; i++) {
      const isRet = net.gB.segments[i].onewayRule !== null && g.segments[i].onewayRule === null;
      if (isRet) for (const c of cellsOf(net, g, g.segments[i])) S.add(c.cell);
    }
  }
}

// ---- pass 2: answers at those cells --------------------------------------------------------
type Ans = {
  net: string;
  ans: string;
  fine: string;
  nodes: string;
  edge: number;
  seg: string;
  origin: string;
  width: number;
  len: number;
};
const byRow = new Map<string, Map<string, Ans[]>>();
const undoneOrigin: any[] = [];
for (const key of centres) {
  const net = await netAt(key);
  if (!net) continue;
  for (const row of ROWS) {
    const { g, byLoose } = runRow(net, row);
    const cells = byRow.get(row.name) ?? new Map<string, Ans[]>();
    byRow.set(row.name, cells);
    for (let i = 0; i < g.segments.length; i++) {
      const b = net.gB.segments[i];
      const s = g.segments[i];
      if (!takesJarticRules(s.line)) continue;
      // Every street copy on the cell (main's doubled lines count too); one-way = a rule or the GSI line's.
      const isRet = s.onewayRule === null && s.line.oneway === 0;
      void b;
      const hasMedian = (s.section?.median ?? 0) > 0;
      const ans = isRet ? `two-way ${s.lanes}${hasMedian ? "/median" : ""}` : "one-way";
      const fine = isRet ? `${ans} ${r2(s.section?.median ?? 0)}` : ans;
      const nodes = `${nodeKey(net, g, s.from)}|${nodeKey(net, g, s.to)}`;
      const origin = !isRet ? "-" : byLoose.has(i) ? "loose" : "strict";
      for (const c of cellsOf(net, g, s)) {
        if (!S.has(c.cell)) continue;
        const list = cells.get(c.cell) ?? [];
        list.push({
          net: key,
          ans,
          fine,
          nodes,
          edge: Math.round(edgeOf(net, c.p)),
          seg: segKey(net, g, s),
          origin,
          width: s.line.width,
          len: r2(s.length),
        });
        cells.set(c.cell, list);
      }
    }
  }
}

// ---- compare ---------------------------------------------------------------------------------
const summary: any = {
  reasons,
  centres: centres.size,
  netsBuilt: [...netCache.values()].filter(Boolean).length,
  missingNets,
  cells: S.size,
  rows: {},
};
const lists: any = {};
for (const [row, cells] of byRow) {
  let doubledCells = 0;
  let crossCells = 0;
  let crossFineCells = 0;
  let mainToo = 0;
  const places = new Map<string, any>();
  const doubledPlaces = new Map<string, any>();
  const splitPlaces = new Map<string, any>();
  const doubledCross = new Map<string, any>();
  let doubledCrossCells = 0;
  for (const [cell, list] of cells) {
    const perNet = new Map<string, Ans[]>();
    for (const a of list) perNet.set(a.net, [...(perNet.get(a.net) ?? []), a]);
    // Within one network: two candidate segments on the cell (doubled lines) with different answers.
    let isDoubled = false;
    for (const as of perNet.values()) if (new Set(as.map((a) => a.ans)).size > 1) isDoubled = true;
    if (isDoubled) {
      doubledCells++;
      // A copy read in some networks only: do the answer sets differ across networks inside the band?
      const sets = [...perNet.values()]
        .filter((as) => as[0].edge >= 60)
        .map((as) => [...new Set(as.map((a) => a.ans))].toSorted().join("+"));
      if (new Set(sets).size > 1) {
        doubledCrossCells++;
        const k = [...new Set(list.map((a) => a.seg))].toSorted().join(" / ");
        const d = doubledCross.get(k) ?? {
          segs: [...new Map(list.map((a) => [a.seg, { seg: a.seg, len: a.len, width: a.width }])).values()],
          nets: {} as any,
          cells: 0,
        };
        d.cells++;
        for (const [n, as] of perNet)
          d.nets[n] = [...new Set(as.map((a) => `${a.seg} ${a.ans}`))].join(" | ");
        doubledCross.set(k, d);
      }
      for (const [n, as] of perNet) {
        if (new Set(as.map((a) => a.ans)).size < 2) continue;
        const k = as
          .map((a) => a.seg)
          .toSorted()
          .join(" / ");
        const d = doubledPlaces.get(k) ?? {
          segs: as.map((a) => ({ seg: a.seg, ans: a.ans, width: a.width, len: a.len, nodes: a.nodes })),
          nets: new Set<string>(),
          cells: 0,
        };
        d.nets.add(n);
        d.cells++;
        doubledPlaces.set(k, d);
      }
      continue;
    }
    // Across networks: the cell 60 m or more inside each network's extent.
    const inside = [...perNet.values()].map((as) => as[0]).filter((a) => a.edge >= 60);
    if (inside.length < 2) continue;
    const answers = new Set(inside.map((a) => a.ans));
    const sameNodes = new Set(inside.map((a) => a.nodes)).size === 1;
    const isCoarse = answers.size > 1;
    const isFine = !isCoarse && sameNodes && new Set(inside.map((a) => a.fine)).size > 1;
    // Named (6): segments cut differently across networks whose answer still agrees.
    if (!sameNodes && !isCoarse) {
      const sp = splitPlaces.get(inside[0].seg) ?? {
        seg: inside[0].seg,
        cells: 0,
        answer: inside[0].ans,
        nodes: [...new Set(inside.map((a) => a.nodes))],
      };
      sp.cells++;
      splitPlaces.set(inside[0].seg, sp);
    }
    if (!isCoarse && !isFine) continue;
    if (isCoarse) crossCells++;
    else crossFineCells++;
    const place = inside[0].seg;
    const p = places.get(place) ?? {
      seg: place,
      cells: 0,
      kind: isCoarse ? "answer" : "median-value",
      sameNodes,
      nets: {} as any,
    };
    p.cells++;
    for (const a of inside) p.nets[a.net] = `${a.fine} ${a.origin} edge ${a.edge} nodes ${a.nodes}`;
    places.set(place, p);
  }
  // Does main differ on those cells across networks? (main's rule and lanes on the candidate segments.)
  void mainToo;
  summary.rows[row] = { doubledCells, crossCells, crossFineCells, places: places.size };
  lists[row] = [...places.values()];
  lists[row + ":doubled"] = [...doubledPlaces.values()].map((d) => ({ ...d, nets: [...d.nets] }));
  lists[row + ":split"] = [...splitPlaces.values()];
  summary.rows[row].splitAgreeing = splitPlaces.size;
  summary.rows[row].doubledCrossCells = doubledCrossCells;
  lists[row + ":doubledCross"] = [...doubledCross.values()];
}
console.log(JSON.stringify(summary));

// ---- 追記 4 手順 0: over the site networks, rows now / L / L+G upper / L+G value ------------------
const nearestOnPoly = (pts: any[], x: number, z: number, along?: (dx: number, dz: number) => boolean) => {
  let bestD = Infinity,
    bx = 0,
    bz = 0,
    bdx = 0,
    bdz = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const ex = b.x - a.x,
      ez = b.z - a.z,
      l = Math.hypot(ex, ez);
    if (l < 1e-3) continue;
    if (along && !along(ex / l, ez / l)) continue;
    const t = Math.max(0, Math.min(l, ((x - a.x) * ex + (z - a.z) * ez) / l));
    const px = a.x + (ex / l) * t,
      pz = a.z + (ez / l) * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < bestD) [bestD, bx, bz, bdx, bdz] = [d, px, pz, ex / l, ez / l];
  }
  return { d: bestD, x: bx, z: bz, dx: bdx, dz: bdz };
};
const sectionOf = (s: any) => ({
  oneway: s.onewayRule ? s.onewayRule.dir : 0,
  lanes: s.lanes,
  median: r2(s.section?.median ?? 0),
  carriageway: r2(s.section?.carriageway ?? 0),
  laneWidth: r2(s.section?.laneWidth ?? 0),
  basis: s.section?.basis,
});
const stateOf = (s: any) =>
  JSON.stringify({
    o: s.onewayRule ? [s.onewayRule.dir, s.onewayRule.time] : null,
    l: s.lanes,
    sec: s.section ?? null,
    lim: s.limit,
    k: s.limitKind,
    r: s.rules,
    c: s.closures,
    no: s.noOvertake,
    nl: s.noLaneChange,
  });
/** The angle (deg) at the shared node between a's way in and b's way out. */
function angleAt(g: any, a: any, b: any): number | null {
  for (const n of [a.from, a.to]) {
    if (b.from !== n && b.to !== n) continue;
    const t = (s: any, arriving: boolean) => {
      const atTo = s.to === n;
      const d = g.sample(s, atTo ? Math.max(0, s.length - 2) : Math.min(2, s.length)).dir.clone();
      return arriving === atTo ? d : d.multiplyScalar(-1);
    };
    const tIn = t(a, true),
      tOut = t(b, false);
    return Math.round((Math.atan2(tIn.z * tOut.x - tIn.x * tOut.z, tIn.dot(tOut)) * 180) / Math.PI);
  }
  return null;
}
/** The owner's relation to the segment, finer than countW5's (G3 (i) and what is not). */
function relOf(g: any, s: any, o: any): string {
  if (o === s) return "self";
  if (o.line === s.line) return "same-line";
  if (exp.isDoubled(g, s, o)) return "doubled";
  const isStraight = straightNode(g, s, o) !== null;
  if (isStraight) return o.line.width === s.line.width ? "straight-on" : "straight-on-other-width";
  if (o.line.width === s.line.width && exp.leavesAlike(g, s, o)) return "same-width-leaves-alike";
  const angle = angleAt(g, s, o);
  // How much of the segment the owner runs over (within 1.5 m): a doubled line cut at other nodes.
  let over = 0,
    n = 0;
  for (let d = 0.5; d < s.length; d += 1) {
    const p = g.sample(s, d).pos;
    n++;
    if (nearestOnPoly(o.pts, p.x, p.z).d <= 1.5) over++;
  }
  const overlap = n ? Math.round((over / n) * 100) : 0;
  if (angle !== null)
    return `${o.line.width === s.line.width ? "same-width" : "other-width"}-node-angle ${angle}° overlap ${overlap}%`;
  if (overlap > 0) return `other-line overlap ${overlap}%`;
  return "other-line";
}
/** Per sample and sense: the nearest aligned way within reach, its side, its owner, and G's margins. */
function wayDetail(net: Net, gB: any, s: any) {
  const ways = net.regs.roadlanes
    .map((r: any) => {
      const pts: any[] = [];
      for (let i = C.coords; i + 1 < r.length; i += 2) pts.push(net.frame.toLocal(r[i + 1], r[i], 0));
      return { r, pts };
    })
    .filter((w: any) => w.pts.some((p: any) => Math.hypot(p.x - s.pts[0].x, p.z - s.pts[0].z) < 600));
  const reach = Math.min(25, s.line.width / 2 + OSM_ONEWAY_REACH.value);
  const fr = s.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
  return fr.map((f) => {
    const { pos, dir } = gB.sample(s, s.length * f);
    const senses = [1, -1].map((sense) => {
      let w: any = null;
      for (const way of ways) {
        const h = nearestOnPoly(
          way.pts,
          pos.x,
          pos.z,
          (dx, dz) => sense * (dx * dir.x + dz * dir.z) > PARALLEL,
        );
        if (h.d <= reach && (!w || h.d < w.h.d)) w = { way, h };
      }
      if (!w) return { sense, way: null };
      const side = (w.h.x - pos.x) * dir.z + (w.h.z - pos.z) * -dir.x;
      const best = gB.segments
        .filter((o: any) => takesJarticRules(o.line))
        .map((o: any) => ({
          o,
          h: nearestOnPoly(o.pts, w.h.x, w.h.z, (dx, dz) => Math.abs(dx * w.h.dx + dz * w.h.dz) > PARALLEL),
        }))
        .filter((x: any) => x.h.d <= reach)
        .toSorted((a: any, b: any) => a.h.d - b.h.d)[0];
      const o = best?.o;
      const room = o ? roomHalf(o.line.width) : 0;
      return {
        sense,
        way: { side: r2(side), oneway: w.way.r[C.oneway], forward: w.way.r[C.forward] },
        own: { d: r2(w.h.d), roomHalf: r2(roomHalf(s.line.width)), beyond: w.h.d > roomHalf(s.line.width) },
        owner: o
          ? {
              seg: segKey(net, gB, o),
              width: o.line.width,
              rel: relOf(gB, s, o),
              d: r2(best.h.d),
              roomHalf: r2(room),
              valueHalf: r2(o.line.width / 2),
              marginRoom: r2(best.h.d - room),
              marginValue: r2(best.h.d - o.line.width / 2),
            }
          : null,
      };
    });
    return { f, senses };
  });
}
/** A one-way OSM way each way within the game's reach at most samples (the partner's "maybe wrong" test). */
function reachBoth(net: Net, gB: any, s: any): boolean {
  const reach = Math.min(25, s.line.width / 2 + OSM_ONEWAY_REACH.value);
  const fr = s.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
  const ways = net.regs.roadlanes
    .filter((r: any) => r[C.oneway] === 1)
    .map((r: any) => {
      const pts: any[] = [];
      for (let i = C.coords; i + 1 < r.length; i += 2) pts.push(net.frame.toLocal(r[i + 1], r[i], 0));
      return pts;
    })
    .filter((pts: any[]) => pts.some((p: any) => Math.hypot(p.x - s.pts[0].x, p.z - s.pts[0].z) < 600));
  let n = 0;
  for (const f of fr) {
    const { pos, dir } = gB.sample(s, s.length * f);
    const both = [1, -1].every((sense) =>
      ways.some(
        (pts: any[]) =>
          nearestOnPoly(pts, pos.x, pos.z, (dx, dz) => sense * (dx * dir.x + dz * dir.z) > PARALLEL).d <=
          reach,
      ),
    );
    if (both) n++;
  }
  return n >= Math.ceil(fr.length / 2);
}
const rowOf = (name: string) => ROWS.find((r) => r.name === name)!;
const out: any = {};
for (const row of ROWS)
  out[row.name] = {
    returned: new Map(),
    strictChanged: [],
    looseOnly: new Map(),
    dropped: new Map(),
    exitless: new Map(),
    entryless: new Map(),
    cutWrong: new Map(),
    cutReal: new Map(),
    otherChanged: new Map(),
    narrowKept: new Map(),
    chain659: null,
  };
const strictPer = new Map<string, any[]>();
const detailCache = new Map<string, any>();
const detailOf = (net: Net, gB: any, s: any, k: string) => {
  if (!detailCache.has(k)) detailCache.set(k, wayDetail(net, gB, s));
  return detailCache.get(k);
};
const secDiff = new Map<string, any>();
const named = new Map<string, any[]>();
const NAMED = new Set(["35.60260", "35.66578", "35.67365"]);
for (const key of centres) {
  const net = await netAt(key);
  if (!net) continue;
  const gB = net.gB;
  const res: any = {};
  for (const row of ROWS) res[row.name] = runRow(net, row);
  const isRet = (gg: any, i: number) =>
    gB.segments[i].onewayRule !== null && gg.segments[i].onewayRule === null;
  const eff = (x: any): number =>
    x.onewayRule && isAllDay(x.onewayRule.time) ? x.onewayRule.dir : x.line.oneway;
  for (const row of ROWS) {
    const o = out[row.name];
    const g = res[row.name].g;
    for (const id of res[row.name].narrowKept)
      o.narrowKept.set(segKey(net, g, g.segments[id]), g.segments[id].line.width);
    for (let i = 0; i < g.segments.length; i++) {
      const s = g.segments[i];
      if (!takesJarticRules(s.line)) continue;
      // Counted only where the segment lies 60 m or more inside this network's streets (J3 の 1).
      const isInsideSeg = Math.min(...s.pts.map((p: any) => edgeOf(net, p))) >= 60;
      if (!isInsideSeg) continue;
      const k = segKey(net, g, s);
      const ret = isRet(g, i);
      // 35.67365 and the long copies (J3 の 1・5): every copy on this segment, per network and row.
      if (NAMED.has(k.split(",")[0]) || NAMED.has(k.slice(0, 8))) {
        const copies = g.segments.filter(
          (x: any) =>
            x !== s &&
            takesJarticRules(x.line) &&
            x.line.width === s.line.width &&
            (exp.leavesAlike(g, s, x) || straightNode(g, s, x) !== null),
        );
        named.set(`${row.name}|${k}`, [
          ...(named.get(`${row.name}|${k}`) ?? []),
          {
            net: key,
            len: r2(s.length),
            main: gB.segments[i].onewayRule?.dir ?? 0,
            ans: s.onewayRule
              ? `one-way${s.onewayRule.dir}`
              : `two-way ${s.lanes}/${r2(s.section?.median ?? 0)}`,
            nodes: `${nodeKey(net, g, s.from)}|${nodeKey(net, g, s.to)}`,
            edge: Math.round(Math.min(...s.pts.map((p: any) => edgeOf(net, p)))),
            sameStreet: copies.map(
              (x: any) => `${segKey(net, g, x)} ${r2(x.length)}m ${x.onewayRule ? "one-way" : "two-way"}`,
            ),
            detail: row.name === "L+G'-room" ? wayDetail(net, gB, gB.segments[i]) : undefined,
          },
        ]);
      }
      const isStrict = isRet(res.now.g, i);
      const isCand = gB.segments[i].onewayRule !== null;
      if (row.name === "now" && isCand)
        strictPer.set(k, [
          ...(strictPer.get(k) ?? []),
          {
            net: key,
            strict: isStrict,
            edge: Math.round(Math.min(...s.pts.map((p: any) => edgeOf(net, p)))),
            nodes: `${nodeKey(net, g, s.from)}|${nodeKey(net, g, s.to)}`,
          },
        ]);
      // 1: a strict return stays, with the same state, in every row.
      if (isStrict && stateOf(s) !== stateOf(res.now.g.segments[i]))
        o.strictChanged.push({ seg: k, net: key, now: sectionOf(res.now.g.segments[i]), row: sectionOf(s) });
      if (!ret) {
        if (stateOf(s) !== stateOf(gB.segments[i])) o.otherChanged.set(k, { net: key });
        continue;
      }
      if (!o.returned.has(k))
        o.returned.set(k, {
          len: s.length,
          width: s.line.width,
          strict: isStrict,
          loose: res[row.name].byLoose.has(i),
        });
      // J3 の 3: returned neighbours straight on or alike at a shared node, median presence / lanes differing.
      if (row.name !== "main")
        for (const n of [s.from, s.to])
          for (const id of g.nodes.get(n) ?? []) {
            const x = g.segments[id];
            if (id <= i || !isRet(g, id) || !takesJarticRules(x.line)) continue;
            const isNext =
              straightNode(g, s, x) === n || (x.line.width === s.line.width && exp.leavesAlike(g, s, x));
            if (!isNext) continue;
            const ma = (s.section?.median ?? 0) > 0,
              mb = (x.section?.median ?? 0) > 0;
            if (ma === mb && s.lanes === x.lanes) continue;
            const pk = `${row.name}|${[k, segKey(net, g, x)].toSorted().join(" / ")}`;
            if (!secDiff.has(pk))
              secDiff.set(pk, {
                row: row.name,
                a: k,
                b: segKey(net, g, x),
                widths: [s.line.width, x.line.width],
                lanes: [s.lanes, x.lanes],
                median: [r2(s.section?.median ?? 0), r2(x.section?.median ?? 0)],
                basis: [s.section?.basis, x.section?.basis],
                how: straightNode(g, s, x) === n ? "straight" : "alike",
                origin: [
                  res[row.name].byLoose.has(i) ? "loose" : "strict",
                  res[row.name].byLoose.has(id) ? "loose" : "strict",
                ],
              });
          }
      if (row.name !== "now" && res[row.name].byLoose.has(i)) detailOf(net, gB, gB.segments[i], k);
      const isGRow = row.name === "L+G'-room";
      if (isGRow && !isStrict && !o.looseOnly.has(k))
        o.looseOnly.set(k, {
          seg: k,
          net: key,
          width: s.line.width,
          length: r2(s.length),
          section: sectionOf(s),
          samples: detailOf(net, gB, gB.segments[i], k),
        });
      // Remaining edges (5): exit-less / entry-less nodes, cuts (maybe wrong / real, same width).
      const nd = -gB.segments[i].onewayRule.dir;
      const arrive = nd === 1 ? s.to : s.from;
      const enter = nd === 1 ? s.from : s.to;
      const around = (n: number) =>
        (g.nodes.get(n) ?? [])
          .map((id: number) => g.segments[id])
          .filter((x: any) => x !== s && isEnterable(x.line));
      const isInside = (n: number) => {
        const x = g.segments[g.nodes.get(n)[0]];
        return edgeOf(net, x.from === n ? x.pts[0] : x.pts[x.pts.length - 1]) >= 60;
      };
      const cut = (x: any, side: string, n: number) => {
        const isMaybeWrong =
          x.line.oneway === 0 &&
          x.onewayRule &&
          isAllDay(x.onewayRule.time) &&
          reachBoth(net, gB, gB.segments[x.id]);
        const item = {
          side,
          node: nodeKey(net, g, n),
          seg: k,
          width: s.line.width,
          partner: segKey(net, g, x),
          partnerWidth: x.line.width,
          sameWidth: x.line.width === s.line.width,
          net: key,
        };
        (isMaybeWrong ? o.cutWrong : o.cutReal).set(`${side}|${item.node}|${k}`, item);
      };
      const outs = around(arrive);
      if (outs.length > 0 && isInside(arrive)) {
        if (!outs.some((x: any) => eff(x) === 0 || eff(x) === (x.from === arrive ? 1 : -1)))
          o.exitless.set(`${nodeKey(net, g, arrive)}|${k}`, {
            node: nodeKey(net, g, arrive),
            seg: k,
            net: key,
            hinge: outs.map(
              (x: any) =>
                `${segKey(net, g, x)} w${x.line.width}${straightNode(g, s, x) === arrive ? " straight" : ""}`,
            ),
          });
        for (const x of outs)
          if (straightNode(g, s, x) === arrive && eff(x) !== 0 && eff(x) !== (x.from === arrive ? 1 : -1))
            cut(x, "arrive", arrive);
      }
      const inn = around(enter);
      if (inn.length > 0 && isInside(enter)) {
        if (!inn.some((x: any) => eff(x) === 0 || eff(x) === (x.to === enter ? 1 : -1)))
          o.entryless.set(`${nodeKey(net, g, enter)}|${k}`, {
            node: nodeKey(net, g, enter),
            seg: k,
            net: key,
            hinge: inn.map(
              (x: any) =>
                `${segKey(net, g, x)} w${x.line.width}${straightNode(g, s, x) === enter ? " straight" : ""}`,
            ),
          });
        for (const x of inn)
          if (straightNode(g, s, x) === enter && eff(x) !== 0 && eff(x) !== (x.to === enter ? 1 : -1))
            cut(x, "enter", enter);
      }
    }
    // G drops: returned under L, not under this G row.
    if (row.name === "L+G'-room")
      for (let i = 0; i < g.segments.length; i++) {
        const s = g.segments[i];
        const isInsideSeg = Math.min(...s.pts.map((p: any) => edgeOf(net, p))) >= 60;
        if (!takesJarticRules(s.line) || !isInsideSeg || !isRet(res.L.g, i) || isRet(g, i)) continue;
        const k = segKey(net, g, s);
        if (!o.dropped.has(k))
          o.dropped.set(k, {
            seg: k,
            net: key,
            width: s.line.width,
            length: r2(s.length),
            samples: detailOf(net, gB, gB.segments[i], k),
          });
      }
    // 4: 659's street.
    if (o.chain659 === null) {
      const start = g.segments.find(
        (x: any) => takesJarticRules(x.line) && segKey(net, g, x) === "35.65922,139.73663",
      );
      if (start) {
        const list: any[] = [];
        const seen = new Set<number>([start.id]);
        const walk = (x: any) => {
          list.push({ seg: segKey(net, g, x), len: r2(x.length), returned: isRet(g, x.id), ...sectionOf(x) });
          for (const n of [x.from, x.to])
            for (const id of g.nodes.get(n) ?? []) {
              const b = g.segments[id];
              if (
                seen.has(id) ||
                b.line.width !== x.line.width ||
                straightNode(g, x, b) !== n ||
                gB.segments[id].onewayRule === null
              )
                continue;
              seen.add(id);
              walk(b);
            }
        };
        walk(start);
        o.chain659 = list;
      }
    }
  }
}
const e4: any = {};
for (const row of ROWS) {
  const o = out[row.name];
  const ret = [...o.returned.values()];
  e4[row.name] = {
    returned: {
      n: ret.length,
      m: Math.round(ret.reduce((n: number, r: any) => n + r.len, 0)),
      strict: ret.filter((r: any) => r.strict).length,
      loose: ret.filter((r: any) => !r.strict).length,
    },
    strictChanged: o.strictChanged,
    exitless: [...o.exitless.values()],
    entryless: [...o.entryless.values()],
    cutWrong: [...o.cutWrong.values()],
    cutReal: [...o.cutReal.values()],
    otherChanged: [...o.otherChanged.keys()],
    narrowKept: [...o.narrowKept.entries()],
    chain659: o.chain659,
    looseOnly: [...o.looseOnly.values()],
    dropped: [...o.dropped.values()],
  };
  const v = e4[row.name];
  console.log(
    JSON.stringify({
      row: row.name,
      returned: v.returned,
      strictChanged: v.strictChanged.length,
      exitless: v.exitless.length,
      entryless: v.entryless.length,
      cutWrong: v.cutWrong.length,
      cutReal: v.cutReal.length,
      cutRealSame: v.cutReal.filter((c: any) => c.sameWidth).length,
      otherChanged: v.otherChanged.length,
      narrowKept: v.narrowKept.length,
      looseOnly: v.looseOnly.length,
      dropped: v.dropped.length,
      chain659: (v.chain659 ?? [])
        .map((c: any) => `${c.returned ? "R" : "-"}${c.lanes}/${c.median}/${c.carriageway}`)
        .join(" "),
    }),
  );
}
// 1: strict answers that differ across networks (same key), with the edge distance in each.
const strictMixed = [...strictPer.entries()]
  .filter(([, l]) => new Set(l.map((x: any) => x.strict)).size > 1)
  .map(([k, l]) => ({ seg: k, per: l }));
// 5: returned (loose) segments whose own way lies beyond their own carriageway's half; 6: owners that overlap without a shared node.
const own: any = {};
for (const row of ROWS) {
  if (row.name === "now" || row.name === "main") continue;
  const keys = [...out[row.name].returned.entries()].filter(([, v]: any) => v.loose).map(([k]: any) => k);
  own[row.name] = {
    beyond: keys.filter((k: string) =>
      (detailCache.get(k) ?? []).some((smp: any) => smp.senses.some((x: any) => x.own?.beyond)),
    ),
    overlapNoNode: keys.filter((k: string) =>
      (detailCache.get(k) ?? []).some((smp: any) =>
        smp.senses.some(
          (x: any) =>
            /^other-line overlap ([5-9][0-9]|100)%/.test(x.owner?.rel ?? "") &&
            x.owner.width === (out[row.name].returned.get(k) as any).width,
        ),
      ),
    ),
  };
}
const overlapNoNodeAll = [...detailCache.entries()]
  .filter(([, d]: any) =>
    d.some((smp: any) =>
      smp.senses.some((x: any) => /^other-line overlap ([5-9][0-9]|100)%/.test(x.owner?.rel ?? "")),
    ),
  )
  .map(([k]) => ({
    seg: k,
    answers: Object.fromEntries(ROWS.map((r) => [r.name, out[r.name].returned.has(k)])),
  }));
console.log(
  JSON.stringify({
    strictMixed: strictMixed.length,
    own: Object.fromEntries(
      Object.entries(own).map(([k, v]: any) => [
        k,
        { beyond: v.beyond.length, overlapNoNode: v.overlapNoNode.length },
      ]),
    ),
    overlapNoNodeAll: overlapNoNodeAll.length,
  }),
);
console.log(
  JSON.stringify({
    secDiff: Object.fromEntries(
      ROWS.map((r) => [r.name, [...secDiff.values()].filter((d) => d.row === r.name).length]),
    ),
    named: named.size,
  }),
);
await writeFile(
  outPath,
  JSON.stringify(
    {
      summary,
      lists,
      e4,
      strictMixed,
      own,
      overlapNoNodeAll,
      secDiff: [...secDiff.values()],
      named: Object.fromEntries(named),
    },
    null,
    1,
  ) + "\n",
);
