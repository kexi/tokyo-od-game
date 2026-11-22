// PR W, review0 追記 6 J3 の 4: rows main and L + G′ (room) over the whole area the regulation tiles
// cover — a network centred on every second z16 tile (x and y even), so every segment lies 60 m or
// more inside one of them. Per shard (k of n over the centres). Counted where a segment lies 60 m or
// more inside the network's streets, each segment key once: returns (strict / G′ only), the G′-only
// returns with each sample's owner and margin (and whether an owner is a ≥ 13 m line not of the same
// street), exit-less and entry-less nodes, and each returned key's answer per network (stability).
// Needs src/world/regulations.before.ts (main) and regulations.exp.ts (makeExp4.py). Run (worktree):
//   pnpm exec tsx .qa/w/countWide.mts <xwDataDir> <gsiCache> <out.json> <k> <n>
import { readFile, writeFile } from "node:fs/promises";
const W = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a5195e3853739145f";
const { ST, STATION_STRIDE } = await import(`${W}/src/expressway/format.ts`);
const { haversine } = await import(`${W}/src/expressway/geo.ts`);
const { LocalFrame } = await import(`${W}/src/geo/frame.ts`);
const { tileXToLon, tileYToLat } = await import(`${W}/src/geo/tiles.ts`);
const { expresswayRoadInput, joinExpressway } = await import(`${W}/src/world/expresswayRoads.ts`);
const { RoadGraph } = await import(`${W}/src/world/roads.ts`);
const { ROAD_TILE_ZOOM } = await import(`${W}/src/world/roadTiles.ts`);
const { takesJarticRules, isEnterable } = await import(`${W}/src/world/roadClass.ts`);
const { ROAD_LANES_COLUMN: C } = await import(`${W}/src/world/roadLanesData.ts`);
const { OSM_ONEWAY_REACH } = await import(`${W}/src/world/streetAssumptions.ts`);
const { streetRoom } = await import(`${W}/src/world/laneChange.ts`);
const { readExpresswayFiles } = await import(`${W}/scripts/expresswayFiles.ts`);
const { gsiTileReader, regulationReader } = await import(`${W}/scripts/gameStreets.ts`);
const before = await import(`${W}/src/world/regulations.before.ts`);
const exp = await import(`${W}/src/world/regulations.exp.ts`);
const { EXP, EXP_OUT, straightNode } = exp;

const [dataDir, cacheDir, outPath, kArg, nArg] = process.argv.slice(2);
const shard = Number(kArg),
  shards = Number(nArg);
const files = readExpresswayFiles(dataDir);
const runs = [
  ...new Map([...files.tiles.values()].flatMap((t: any) => t.runs).map((r: any) => [r.id, r])).values(),
];
const streetsOf = gsiTileReader(cacheDir);
const regsAround = regulationReader();
const r2 = (v: number) => Math.round(v * 100) / 100;
const PARALLEL = Math.cos((25 * Math.PI) / 180);
const roomHalf = (w: number) => streetRoom(w, 0).room / 2;
const isAllDay = (t: any) => t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);

const regTiles = (
  JSON.parse(await readFile(`${W}/public/data/regs/meta.json`, "utf8")) as { tiles: string[] }
).tiles;
const centres: string[] = [];
for (const t of regTiles) {
  const [x, y] = t.split("-").map(Number);
  for (let dx = 0; dx < 4; dx++)
    for (let dy = 0; dy < 4; dy++) {
      const cx = x * 4 + dx,
        cy = y * 4 + dy;
      if (cx % 2 === 0 && cy % 2 === 0) centres.push(`${cx}-${cy}`);
    }
}
centres.sort();
const mine = centres.filter((_, i) => i % shards === shard);

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
const relOf = (g: any, s: any, o: any) =>
  o === s
    ? "self"
    : o.line === s.line
      ? "same-line"
      : straightNode(g, s, o) !== null
        ? o.line.width === s.line.width
          ? "straight-on"
          : "straight-on-other-width"
        : o.line.width === s.line.width && exp.leavesAlike(g, s, o)
          ? "same-width-leaves-alike"
          : "other";
const isSameStreetRel = (rel: string) =>
  rel === "self" || rel === "same-line" || rel === "straight-on" || rel === "same-width-leaves-alike";

const returned = new Map<string, any>();
const looseList = new Map<string, any>();
const exitless = new Map<string, any>();
const entryless = new Map<string, any>();
const answers = new Map<string, Map<string, Set<string>>>();
let netsBuilt = 0,
  netsMissing = 0,
  netsNoRegs = 0;
const started = Date.now();
for (const key of mine) {
  const [cx, cy] = key.split("-").map(Number);
  const streets: any[] = [];
  let isMissing = false;
  for (let dy = -1; dy <= 1 && !isMissing; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const lines = await streetsOf(cx + dx, cy + dy);
      if (lines === null) {
        isMissing = true;
        break;
      }
      streets.push(...lines);
    }
  if (isMissing) {
    netsMissing++;
    continue;
  }
  const regs = await regsAround(cx, cy);
  if (regs === null) {
    netsNoRegs++;
    continue;
  }
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c: any) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= 1300) return true;
    return false;
  });
  const frame = new LocalFrame(lat, lon, 0);
  const xw = expresswayRoadInput(near, runs, (_a: number, _b: number, h: number) => h);
  const gB = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  before.applyRegulations(gB, structuredClone(regs), frame, () => {});
  Object.assign(EXP, { L: true, G: "room", narrow: true });
  const g = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  exp.applyRegulations(g, structuredClone(regs), frame, () => {});
  const byLoose = new Set<number>(EXP_OUT.byLoose);
  netsBuilt++;
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const s of gB.segments)
    if (takesJarticRules(s.line))
      for (const p of s.pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
  const edgeOf = (p: any) => Math.min(p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z);
  const segKey = (s: any) => {
    const q = frame.toGeodetic(g.sample(s, s.length / 2).pos);
    return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
  };
  const nodeKey = (n: number) => {
    const s = g.segments[g.nodes.get(n)[0]];
    const q = frame.toGeodetic(s.from === n ? s.pts[0] : s.pts[s.pts.length - 1]);
    return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
  };
  const eff = (x: any): number =>
    x.onewayRule && isAllDay(x.onewayRule.time) ? x.onewayRule.dir : x.line.oneway;
  const ways = regs.roadlanes.map((r: any) => {
    const pts: any[] = [];
    for (let i = C.coords; i + 1 < r.length; i += 2) pts.push(frame.toLocal(r[i + 1], r[i], 0));
    return { r, pts };
  });
  for (let i = 0; i < g.segments.length; i++) {
    const s = g.segments[i];
    if (!takesJarticRules(s.line)) continue;
    const isInside = Math.min(...s.pts.map((p: any) => edgeOf(p))) >= 60;
    if (!isInside) continue;
    const isRet = gB.segments[i].onewayRule !== null && s.onewayRule === null;
    const k = segKey(s);
    // Per key and network: the set of answers (doubled copies with one key give two in one network).
    if (gB.segments[i].onewayRule !== null) {
      const per = answers.get(k) ?? new Map<string, Set<string>>();
      per.set(
        key,
        (per.get(key) ?? new Set()).add(
          isRet ? `two-way ${s.lanes}${(s.section?.median ?? 0) > 0 ? "/median" : ""}` : "one-way",
        ),
      );
      answers.set(k, per);
    }
    if (!isRet) continue;
    const isLoose = byLoose.has(i);
    if (!returned.has(k)) returned.set(k, { len: s.length, width: s.line.width, loose: isLoose });
    if (isLoose && !looseList.has(k)) {
      // Each sample and sense: the nearest aligned way in reach, the street nearest that way point, the margin.
      const reach = Math.min(25, s.line.width / 2 + OSM_ONEWAY_REACH.value);
      const fr = s.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
      let hasBigOther = false;
      const samples = fr.map((f) => {
        const { pos, dir } = g.sample(s, s.length * f);
        return [1, -1].map((sense) => {
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
          if (!w) return `${sense}:-`;
          let best: any = null;
          for (const o of g.segments) {
            if (!takesJarticRules(o.line)) continue;
            const h = nearestOnPoly(
              o.pts,
              w.h.x,
              w.h.z,
              (dx, dz) => Math.abs(dx * w.h.dx + dz * w.h.dz) > PARALLEL,
            );
            if (h.d <= reach && (!best || h.d < best.h.d)) best = { o, h };
          }
          if (!best) return `${sense}:no-owner`;
          const rel = relOf(g, s, best.o);
          if (!isSameStreetRel(rel) && best.o.line.width >= 13) hasBigOther = true;
          return `${sense}:${rel} w${best.o.line.width} d${r2(best.h.d)} m${r2(best.h.d - roomHalf(best.o.line.width))}`;
        });
      });
      looseList.set(k, {
        seg: k,
        net: key,
        width: s.line.width,
        length: r2(s.length),
        lanes: s.lanes,
        median: r2(s.section?.median ?? 0),
        hasBigOther,
        samples,
      });
    }
    const nd = -gB.segments[i].onewayRule.dir;
    const arrive = nd === 1 ? s.to : s.from;
    const enter = nd === 1 ? s.from : s.to;
    const around = (n: number) =>
      (g.nodes.get(n) ?? [])
        .map((id: number) => g.segments[id])
        .filter((x: any) => x !== s && isEnterable(x.line));
    const nodeInside = (n: number) => {
      const x = g.segments[g.nodes.get(n)[0]];
      return edgeOf(x.from === n ? x.pts[0] : x.pts[x.pts.length - 1]) >= 60;
    };
    const outs = around(arrive);
    if (
      outs.length > 0 &&
      nodeInside(arrive) &&
      !outs.some((x: any) => eff(x) === 0 || eff(x) === (x.from === arrive ? 1 : -1))
    )
      exitless.set(`${nodeKey(arrive)}|${k}`, {
        node: nodeKey(arrive),
        seg: k,
        net: key,
        loose: isLoose,
        hinge: outs.map((x: any) => `${segKey(x)} w${x.line.width}`),
      });
    const inn = around(enter);
    if (
      inn.length > 0 &&
      nodeInside(enter) &&
      !inn.some((x: any) => eff(x) === 0 || eff(x) === (x.to === enter ? 1 : -1))
    )
      entryless.set(`${nodeKey(enter)}|${k}`, {
        node: nodeKey(enter),
        seg: k,
        net: key,
        loose: isLoose,
        hinge: inn.map((x: any) => `${segKey(x)} w${x.line.width}`),
      });
  }
}
const ret = [...returned.values()];
const out = {
  shard,
  shards,
  centres: mine.length,
  netsBuilt,
  netsMissing,
  netsNoRegs,
  seconds: Math.round((Date.now() - started) / 1000),
  returned: Object.fromEntries(returned),
  looseList: [...looseList.values()],
  exitless: [...exitless.values()],
  entryless: [...entryless.values()],
  answers: Object.fromEntries(
    [...answers].map(([k, per]) => [
      k,
      Object.fromEntries([...per].map(([n, set]) => [n, [...set].toSorted().join("+")])),
    ]),
  ),
};
await writeFile(outPath, JSON.stringify(out) + "\n");
console.log(
  JSON.stringify({
    shard,
    centres: mine.length,
    netsBuilt,
    netsMissing,
    netsNoRegs,
    seconds: out.seconds,
    returned: ret.length,
    loose: ret.filter((r) => r.loose).length,
    exitless: exitless.size,
    entryless: entryless.size,
  }),
);
