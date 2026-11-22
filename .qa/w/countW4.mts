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
const streetsOf = gsiTileReader(cacheDir);
const regsAround = regulationReader();
const r2 = (v: number) => Math.round(v * 100) / 100;
const PARALLEL = Math.cos((25 * Math.PI) / 180);
const isAllDay = (t: any) => t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);
const ROWS = [
  { name: "now", a2: false, d: false, L: false },
  { name: "a2", a2: true, d: false, L: false },
  { name: "a2+d", a2: true, d: true, L: false },
  { name: "L", a2: false, d: false, L: true },
];

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

function runRow(net: Net, row: (typeof ROWS)[number]) {
  Object.assign(EXP, { a: false, a2: row.a2, d: row.d, copy: false, narrow: true, L: row.L });
  const g = new RoadGraph(
    joinExpressway(net.streets, net.xw, () => {}),
    net.frame,
    () => {},
  );
  exp.applyRegulations(g, structuredClone(net.regs), net.frame, () => {});
  return {
    g,
    propagated: new Map(EXP_OUT.propagated.map((p: any) => [p.id, p.from])),
    undone: [...EXP_OUT.undone],
  };
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
};
const byRow = new Map<string, Map<string, Ans[]>>();
const undoneOrigin: any[] = [];
for (const key of centres) {
  const net = await netAt(key);
  if (!net) continue;
  for (const row of ROWS) {
    const { g, propagated, undone } = runRow(net, row);
    const cells = byRow.get(row.name) ?? new Map<string, Ans[]>();
    byRow.set(row.name, cells);
    if (row.name === "a2+d" && net.isSite)
      for (const id of undone) {
        const s = g.segments[id];
        // Undone segments were returned before (d) ran: strict (the first pass) or propagated (a2).
        undoneOrigin.push({
          net: key,
          key: segKey(net, g, s),
          width: s.line.width,
          length: r2(s.length),
          origin: propagated.has(id) ? "propagated" : "strict",
        });
      }
    for (let i = 0; i < g.segments.length; i++) {
      const b = net.gB.segments[i];
      if (!isCandidate(net.gB, b)) continue;
      const s = g.segments[i];
      const isRet = s.onewayRule === null;
      const hasMedian = (s.section?.median ?? 0) > 0;
      const ans = isRet ? `two-way ${s.lanes}${hasMedian ? "/median" : ""}` : "one-way";
      const fine = isRet ? `${ans} ${r2(s.section?.median ?? 0)}` : ans;
      const nodes = `${nodeKey(net, g, s.from)}|${nodeKey(net, g, s.to)}`;
      const origin = !isRet ? "-" : propagated.has(i) ? "propagated" : "strict";
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
        });
        cells.set(c.cell, list);
      }
    }
  }
}

// ---- compare ---------------------------------------------------------------------------------
const summary: any = {
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
  for (const [cell, list] of cells) {
    const perNet = new Map<string, Ans[]>();
    for (const a of list) perNet.set(a.net, [...(perNet.get(a.net) ?? []), a]);
    // Within one network: two candidate segments on the cell (doubled lines) with different answers.
    let isDoubled = false;
    for (const as of perNet.values()) if (new Set(as.map((a) => a.ans)).size > 1) isDoubled = true;
    if (isDoubled) {
      doubledCells++;
      continue;
    }
    // Across networks: the cell 60 m or more inside each network's extent.
    const inside = [...perNet.values()].map((as) => as[0]).filter((a) => a.edge >= 60);
    if (inside.length < 2) continue;
    const answers = new Set(inside.map((a) => a.ans));
    const sameNodes = new Set(inside.map((a) => a.nodes)).size === 1;
    const isCoarse = answers.size > 1;
    const isFine = !isCoarse && sameNodes && new Set(inside.map((a) => a.fine)).size > 1;
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
}
console.log(JSON.stringify(summary));

// ---- cause-finding at the focus points -------------------------------------------------------
const diag: any[] = [];
for (const [la, lo] of focus) {
  for (const key of centres) {
    const net = await netAt(key);
    if (!net) continue;
    const local = net.frame.toLocal(la, lo, 0);
    const gB = net.gB;
    // The street: GSI segments within 200 m of the focus, width as the nearest one, parallel to it.
    let near: any = null;
    let best = Infinity;
    for (const s of gB.segments) {
      if (!takesJarticRules(s.line)) continue;
      const m = gB.nearestOn(s, local);
      if (m.dist < best) {
        best = m.dist;
        near = s;
      }
    }
    if (!near || best > 5 || edgeOf(net, local) < 0) continue;
    const results: any = {};
    for (const row of ROWS) results[row.name] = runRow(net, row);
    // The chain: straight, same width, both ways from the nearest segment, 300 m each way.
    const chain: any[] = [];
    const seen = new Set<number>([near.id]);
    const walk = (s: any, dist: number) => {
      chain.push(s);
      if (dist > 300) return;
      for (const n of [s.from, s.to])
        for (const id of gB.nodes.get(n) ?? []) {
          const b = gB.segments[id];
          if (seen.has(id) || b.line.width !== s.line.width || straightNode(gB, s, b) !== n) continue;
          seen.add(id);
          walk(b, dist + b.length);
        }
    };
    walk(near, 0);
    // Per segment of the chain: main's rule, each row's answer, and the matcher's gates per sample.
    const ways = net.regs.roadlanes.map((r: any) => {
      const pts: any[] = [];
      for (let i = C.coords; i + 1 < r.length; i += 2) pts.push(net.frame.toLocal(r[i + 1], r[i], 0));
      return {
        r,
        pts,
        id:
          JSON.stringify(r.slice(0, 5)) +
          JSON.stringify(r.slice(C.coords, C.coords + 2).map((v: number) => v.toFixed(6))),
      };
    });
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
    const segRows = chain.map((s: any) => {
      const reach = Math.min(25, s.line.width / 2 + OSM_ONEWAY_REACH.value);
      const fr = s.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
      const samples = fr.map((f) => {
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
          // The GSI segments nearest that way point, parallel to the way: who takes it, by how much.
          const owners = gB.segments
            .filter((o: any) => takesJarticRules(o.line))
            .map((o: any) => ({
              o,
              h: nearestOnPoly(
                o.pts,
                w.h.x,
                w.h.z,
                (dx, dz) => Math.abs(dx * w.h.dx + dz * w.h.dz) > PARALLEL,
              ),
            }))
            .filter((x: any) => x.h.d <= reach)
            .toSorted((a: any, b: any) => a.h.d - b.h.d)
            .slice(0, 3)
            .map((x: any) => ({
              seg: segKey(net, gB, x.o),
              id: x.o.id,
              width: x.o.line.width,
              d: r2(x.h.d),
              self: x.o === s,
            }));
          return {
            sense,
            way: {
              d: r2(w.h.d),
              oneway: w.way.r[C.oneway],
              forward: w.way.r[C.forward],
              id: w.way.id.slice(0, 60),
            },
            owners,
            tie: owners.length > 1 && owners[1].d - owners[0].d < 0.1,
          };
        });
        return { f, senses };
      });
      return {
        id: s.id,
        seg: segKey(net, gB, s),
        len: r2(s.length),
        nodes: `${nodeKey(net, gB, s.from)}→${nodeKey(net, gB, s.to)}`,
        edge: Math.round(Math.min(...s.pts.map((p: any) => edgeOf(net, p)))),
        main: s.onewayRule ? s.onewayRule.dir : 0,
        rows: Object.fromEntries(
          Object.entries(results).map(([name, r]: any) => [
            name,
            r.g.segments[s.id].onewayRule
              ? "one-way"
              : `two-way${r.propagated.has(s.id) ? " (propagated)" : ""}${r.undone.includes(s.id) ? " (undone)" : ""}`,
          ]),
        ),
        samples,
      };
    });
    // GSI lines and OSM ways within 80 m of the focus in this network (to diff across networks).
    const gsiNear = net.streets
      .filter((l: any) => {
        for (let i = 0; i + 1 < l.coords.length; i += 2)
          if (haversine(lo, la, l.coords[i], l.coords[i + 1]) < 80) return true;
        return false;
      })
      .map(
        (l: any) => `${l.width}|${l.coords.length / 2}|${l.coords[0].toFixed(6)},${l.coords[1].toFixed(6)}`,
      );
    const osmNear = ways
      .filter((w: any) => {
        const r = w.r;
        for (let i = C.coords; i + 1 < r.length; i += 2)
          if (haversine(lo, la, r[i], r[i + 1]) < 80) return true;
        return false;
      })
      .map((w: any) => w.id);
    // Lines joined at the chain's nodes that are not GSI streets (the expressway's connectors).
    const atNodes = new Set<string>();
    for (const s of chain)
      for (const n of [s.from, s.to])
        for (const id of gB.nodes.get(n) ?? []) {
          const o = gB.segments[id];
          atNodes.add(
            `${nodeKey(net, gB, n)} ${o.line.source ?? "gsi"} ${o.line.kind} w${o.line.width} ${o.line.structure ?? ""} ${segKey(net, gB, o)}`,
          );
        }
    diag.push({
      focus: `${la},${lo}`,
      net: key,
      isSite: net.isSite,
      edgeOfFocus: Math.round(edgeOf(net, local)),
      chain: segRows,
      gsiNear,
      osmNear,
      atNodes: [...atNodes],
    });
  }
}
// Lines present in some networks only, per focus.
const onlySome: any[] = [];
for (const f of new Set(diag.map((d) => d.focus))) {
  const ds = diag.filter((d) => d.focus === f);
  for (const kind of ["gsiNear", "osmNear", "atNodes"]) {
    const all = new Set(ds.flatMap((d) => d[kind]));
    for (const x of all) {
      const has = ds.filter((d) => d[kind].includes(x)).map((d) => d.net);
      if (has.length !== ds.length)
        onlySome.push({
          focus: f,
          kind,
          item: x,
          in: has,
          notIn: ds.filter((d) => !d[kind].includes(x)).map((d) => d.net),
        });
    }
  }
}
await writeFile(outPath, JSON.stringify({ summary, lists, undoneOrigin, diag, onlySome }, null, 1) + "\n");
console.log(
  JSON.stringify({ undoneOrigin: undoneOrigin.length, diag: diag.length, onlySome: onlySome.length }),
);
