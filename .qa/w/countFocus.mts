// PR W, review0 追記 7 N5: named segments and nodes, in every even-centred network (as countWide.mts)
// whose centre lies within 2 tiles of them — per network and per copy (segments sharing the key):
// candidate or not, main / L / L + G′ answers (strict or G′-only), each sample's owner and margin
// under G′, and the edge distance of the segment and of the named nodes.
// Needs src/world/regulations.before.ts and regulations.exp.ts (makeExp4.py). Run (worktree):
//   pnpm exec tsx .qa/w/countFocus.mts <xwDataDir> <gsiCache> <out.json> <segKeys,…> <nodeKeys,…>
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
const { streetRoom } = await import(`${W}/src/world/laneChange.ts`);
const { readExpresswayFiles } = await import(`${W}/scripts/expresswayFiles.ts`);
const { gsiTileReader, regulationReader, roadTileOf } = await import(`${W}/scripts/gameStreets.ts`);
const before = await import(`${W}/src/world/regulations.before.ts`);
const exp = await import(`${W}/src/world/regulations.exp.ts`);
const { EXP, EXP_OUT, straightNode } = exp;

const [dataDir, cacheDir, outPath, segArg, nodeArg] = process.argv.slice(2);
const segKeys = new Set(
  segArg
    .split(",")
    .map((s, i, a) => (i % 2 === 0 ? `${s},${a[i + 1]}` : ""))
    .filter(Boolean),
);
const nodeKeys = new Set(
  (nodeArg ?? "")
    .split(",")
    .map((s, i, a) => (i % 2 === 0 ? `${s},${a[i + 1]}` : ""))
    .filter(Boolean),
);
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
const centres = new Set<string>();
for (const k of [...segKeys, ...nodeKeys]) {
  const [la, lo] = k.split(",").map(Number);
  const [tx, ty] = roadTileOf(lo, la);
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const cx = tx + dx,
        cy = ty + dy;
      if (cx % 2 === 0 && cy % 2 === 0) centres.add(`${cx}-${cy}`);
    }
}
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
const segRows: any[] = [];
const nodeRows: any[] = [];
for (const key of [...centres].toSorted()) {
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
  const regs = isMissing ? null : await regsAround(cx, cy);
  if (regs === null) continue;
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c: any) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= 1300) return true;
    return false;
  });
  const frame = new LocalFrame(lat, lon, 0);
  const xw = expresswayRoadInput(near, runs, (_a: number, _b: number, h: number) => h);
  const build = () =>
    new RoadGraph(
      joinExpressway(streets, xw, () => {}),
      frame,
      () => {},
    );
  const gB = build();
  before.applyRegulations(gB, structuredClone(regs), frame, () => {});
  Object.assign(EXP, { L: true, G: "off", narrow: true });
  const gL = build();
  exp.applyRegulations(gL, structuredClone(regs), frame, () => {});
  const looseL = new Set<number>(EXP_OUT.byLoose);
  Object.assign(EXP, { L: true, G: "room", narrow: true });
  const gG = build();
  exp.applyRegulations(gG, structuredClone(regs), frame, () => {});
  const looseG = new Set<number>(EXP_OUT.byLoose);
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
  const edgeOf = (p: any) => Math.round(Math.min(p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z));
  const geo = (p: any) => {
    const q = frame.toGeodetic(p);
    return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
  };
  const answer = (g: any, i: number, loose: Set<number>) => {
    const s = g.segments[i];
    const isRet = gB.segments[i].onewayRule !== null && s.onewayRule === null;
    return s.onewayRule
      ? `one-way${s.onewayRule.dir}`
      : isRet
        ? `two-way ${s.lanes}/${r2(s.section?.median ?? 0)} ${loose.has(i) ? "G′-only/L-only" : "strict"}`
        : "two-way (main)";
  };
  const ways = regs.roadlanes.map((r: any) => {
    const pts: any[] = [];
    for (let i = C.coords; i + 1 < r.length; i += 2) pts.push(frame.toLocal(r[i + 1], r[i], 0));
    return { r, pts };
  });
  for (let i = 0; i < gB.segments.length; i++) {
    const s = gB.segments[i];
    if (!takesJarticRules(s.line)) continue;
    const k = geo(gB.sample(s, s.length / 2).pos);
    if (!segKeys.has(k)) continue;
    const rule = s.onewayRule;
    const isCandidate = s.line.oneway === 0 && rule !== null && isAllDay(rule.time);
    const reach = Math.min(25, s.line.width / 2 + OSM_ONEWAY_REACH.value);
    const fr = s.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    const samples = fr.map((f) => {
      const { pos, dir } = gG.sample(gG.segments[i], s.length * f);
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
        if (!w) return `${sense}:no-way`;
        let best: any = null;
        for (const o of gG.segments) {
          if (!takesJarticRules(o.line)) continue;
          const h = nearestOnPoly(
            o.pts,
            w.h.x,
            w.h.z,
            (dx, dz) => Math.abs(dx * w.h.dx + dz * w.h.dz) > PARALLEL,
          );
          if (h.d <= reach && (!best || h.d < best.h.d)) best = { o, h };
        }
        if (!best) return `${sense}:way ${r2(w.h.d)} no-owner`;
        const rel = relOf(gG, gG.segments[i], best.o);
        const side = (w.h.x - pos.x) * dir.z + (w.h.z - pos.z) * -dir.x;
        return `${sense}:way side ${r2(side)} oneway${w.way.r[C.oneway]} <- ${rel} w${best.o.line.width} d${r2(best.h.d)} margin ${r2(best.h.d - roomHalf(best.o.line.width))}`;
      });
    });
    segRows.push({
      seg: k,
      net: key,
      id: i,
      width: s.line.width,
      length: r2(s.length),
      nodes: `${geo(s.pts[0])}→${geo(s.pts[s.pts.length - 1])}`,
      edge: {
        segment: Math.min(...s.pts.map((p: any) => edgeOf(p))),
        from: edgeOf(s.pts[0]),
        to: edgeOf(s.pts[s.pts.length - 1]),
      },
      gsiOneway: s.line.oneway,
      mainRule: rule ? { dir: rule.dir, allDay: isAllDay(rule.time) } : null,
      isCandidate,
      L: answer(gL, i, looseL),
      G: answer(gG, i, looseG),
      samples,
    });
  }
  for (const [n] of gB.nodes) {
    const s = gB.segments[gB.nodes.get(n)[0]];
    const p = s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
    const k = geo(p);
    if (nodeKeys.has(k)) nodeRows.push({ node: k, net: key, edge: edgeOf(p) });
  }
}
await writeFile(outPath, JSON.stringify({ centres: [...centres], segRows, nodeRows }, null, 1) + "\n");
console.log(JSON.stringify({ centres: centres.size, segRows: segRows.length, nodeRows: nodeRows.length }));
