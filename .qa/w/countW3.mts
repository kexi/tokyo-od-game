// PR W, review0 追記 1 A4: the rows now / a / a2 / a2+d / a2+copy (narrow rule on) and a2 without it,
// on the networks of countW.mts. Needs src/world/regulations.before.ts (main) and
// regulations.exp.ts (makeExp2.py). Run (from the worktree):
//   pnpm exec tsx .qa/w/countW3.mts <xwDataDir> <gsiCache> <approxMoves.json> <out.json> [rows]
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
const { readExpresswayFiles } = await import(`${W}/scripts/expresswayFiles.ts`);
const { gsiTileReader, regulationReader, roadTileOf } = await import(`${W}/scripts/gameStreets.ts`);
const before = await import(`${W}/src/world/regulations.before.ts`);
const exp = await import(`${W}/src/world/regulations.exp.ts`);
const { EXP, EXP_OUT, straightNode, isDoubled } = exp;

const [dataDir, cacheDir, approxPath, outPath, rowsArg] = process.argv.slice(2);
const files = readExpresswayFiles(dataDir);
const runs = [
  ...new Map([...files.tiles.values()].flatMap((t: any) => t.runs).map((r: any) => [r.id, r])).values(),
];
const streetsOf = gsiTileReader(cacheDir);
const regsAround = regulationReader();
const approx = JSON.parse(await readFile(approxPath, "utf8")).ruledOneways as Record<string, { osm: string }>;
const approxDividedN = Object.values(approx).filter((v) => v.osm === "divided").length;
const r2 = (v: number) => Math.round(v * 100) / 100;
const isAllDay = (t: any) => t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);

type Row = { name: string; a: boolean; a2: boolean; d: boolean; copy: boolean; narrow: boolean; L?: boolean };
let rows: Row[] = [
  { name: "now", a: false, a2: false, d: false, copy: false, narrow: true },
  { name: "a", a: true, a2: false, d: false, copy: false, narrow: true },
  { name: "a2", a: false, a2: true, d: false, copy: false, narrow: true },
  { name: "a2+d", a: false, a2: true, d: true, copy: false, narrow: true },
  { name: "a2+copy", a: false, a2: true, d: false, copy: true, narrow: true },
  { name: "a2-no-narrow", a: false, a2: true, d: false, copy: false, narrow: false },
  { name: "L", a: false, a2: false, d: false, copy: false, narrow: true, L: true },
  { name: "L+d", a: false, a2: false, d: true, copy: false, narrow: true, L: true },
];
if (rowsArg) rows = rows.filter((r) => rowsArg.split(",").includes(r.name));

const siteChunks = files.chunks.filter((c: any) => c.structure === "embankment" || c.structure === "cut");
const tileKeyOf = (c: any) => {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  return roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-");
};
const groups = new Map<string, any[]>();
for (const c of siteChunks) groups.set(tileKeyOf(c), [...(groups.get(tileKeyOf(c)) ?? []), c]);
const KEY_659 = "35.65922,139.73663";

const stateOf = (seg: any) =>
  JSON.stringify({
    oneway: seg.onewayRule ? { dir: seg.onewayRule.dir, time: seg.onewayRule.time } : null,
    lanes: seg.lanes,
    section: seg.section ?? null,
    limit: seg.limit,
    limitKind: seg.limitKind,
    rules: seg.rules,
    closures: seg.closures,
    noOvertake: seg.noOvertake,
    noLaneChange: seg.noLaneChange,
  });

type Net = {
  key: string;
  frame: any;
  streets: any[];
  xw: any;
  regs: any;
  gB: any;
  keyOf: (s: any) => string;
  nodeKey: (n: number) => string;
  edgeDist: (s: any) => number;
};
const nets: Net[] = [];
for (const [key] of groups) {
  const [cx, cy] = key.split("-").map(Number);
  const streets: any[] = [];
  let isMissing = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const lines = await streetsOf(cx + dx, cy + dy);
      if (lines === null) isMissing = true;
      else streets.push(...lines);
    }
  if (isMissing) continue;
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c: any) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= 1300) return true;
    return false;
  });
  const frame = new LocalFrame(lat, lon, 0);
  const regs = await regsAround(cx, cy);
  if (regs === null) continue;
  const xw = expresswayRoadInput(near, runs, (_a: number, _b: number, h: number) => h);
  const gB = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  before.applyRegulations(gB, structuredClone(regs), frame, () => {});
  const keyOf = (seg: any) => {
    const g = frame.toGeodetic(gB.sample(seg, seg.length / 2).pos);
    return `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`;
  };
  const nodeKey = (n: number) => {
    const s = gB.segments[gB.nodes.get(n)[0]];
    const p = s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
    const q = frame.toGeodetic(p);
    return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
  };
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const s of gB.segments)
    for (const p of s.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  const edgeDist = (s: any) =>
    Math.min(...s.pts.map((p: any) => Math.min(p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z)));
  nets.push({ key, frame, streets, xw, regs, gB, keyOf, nodeKey, edgeDist });
}

const results: any[] = [];
for (const row of rows) {
  Object.assign(EXP, {
    a: row.a,
    a2: row.a2,
    d: row.d,
    copy: row.copy,
    narrow: row.narrow,
    L: row.L ?? false,
  });
  const seen = new Set<string>();
  // Stability: per seg key, per network: answer, main's rule, edge distance, nodes.
  const per = new Map<string, any[]>();
  let returned = 0,
    returnedM = 0,
    returnedWide = 0,
    propagated = 0,
    propagatedM = 0;
  const L = { exitless: new Map(), entryless: new Map(), cutWrong: new Map(), cutReal: new Map() } as Record<
    string,
    Map<string, any>
  >;
  let doubledSplit = 0,
    otherChanged = 0,
    approxOneWayReturned = 0;
  const propNoReach: any[] = [];
  const propWidthDiff: any[] = [];
  const medianPresence: any[] = [];
  const laneDiff: any[] = [];
  const narrowReturned: any[] = [];
  const narrowKept: any[] = [];
  const undone: any[] = [];
  const retKeys: any[] = [];
  let r659: any = null;
  let chain659: any = null;
  for (const net of nets) {
    const gB = net.gB;
    const g = new RoadGraph(
      joinExpressway(net.streets, net.xw, () => {}),
      net.frame,
      () => {},
    );
    exp.applyRegulations(g, structuredClone(net.regs), net.frame, () => {});
    const reachBoth = EXP_OUT.reachBoth;
    const eff = (s: any): number =>
      s.onewayRule && isAllDay(s.onewayRule.time) ? s.onewayRule.dir : s.line.oneway;
    const isRet = (i: number) => gB.segments[i].onewayRule !== null && g.segments[i].onewayRule === null;
    const nodeInside = (n: number) => {
      const s = g.segments[g.nodes.get(n)[0]];
      const p = s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
      return net.edgeDist({ pts: [p] }) >= 60;
    };
    const propFrom = new Map(EXP_OUT.propagated.map((p: any) => [p.id, p.from]));
    const once = (tag: string, k: string) => {
      const isNew = !seen.has(tag + k);
      seen.add(tag + k);
      return isNew;
    };
    for (const id of EXP_OUT.narrowKept) {
      const s = g.segments[id];
      if (once("nk", net.keyOf(s)))
        narrowKept.push({
          key: net.keyOf(s),
          width: s.line.width,
          length: r2(s.length),
          group: net.key,
          propagatedCandidate: !gB.segments[id].onewayRule ? null : true,
        });
    }
    for (const id of EXP_OUT.undone) {
      const s = g.segments[id];
      if (once("u", net.keyOf(s)))
        undone.push({
          key: net.keyOf(s),
          width: s.line.width,
          length: r2(s.length),
          group: net.key,
          id,
          origin: EXP_OUT.propagated.some((p: any) => p.id === id) ? "propagated" : "strict",
        });
    }
    // The 45021976 street: 659 and the straight same-width segments JARTIC made one-way, both ways on.
    if (chain659 === null) {
      const start = g.segments.find((s: any) => takesJarticRules(s.line) && net.keyOf(s) === KEY_659);
      if (start) {
        const out: any[] = [];
        const visited = new Set<number>([start.id]);
        const walk = (s: any) => {
          out.push({
            key: net.keyOf(s),
            id: s.id,
            len: r2(s.length),
            returned: isRet(s.id),
            lanes: s.lanes,
            median: r2(s.section?.median ?? 0),
            carriageway: r2(s.section?.carriageway ?? 0),
            basis: s.section?.basis,
          });
          for (const n of [s.from, s.to])
            for (const id of g.nodes.get(n) ?? []) {
              const b = g.segments[id];
              if (
                visited.has(id) ||
                b.line.width !== s.line.width ||
                straightNode(g, s, b) !== n ||
                gB.segments[id].onewayRule === null
              )
                continue;
              visited.add(id);
              walk(b);
            }
        };
        walk(start);
        chain659 = { group: net.key, segments: out };
      }
    }
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < g.segments.length; i++) {
      const a = g.segments[i];
      if (!takesJarticRules(a.line)) continue;
      const k = net.keyOf(a);
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
      const ret = isRet(i);
      const list = per.get(k) ?? [];
      list.push({
        group: net.key,
        ans: ret
          ? `two-way ${a.lanes}/${r2(a.section?.median ?? 0)}`
          : stateOf(a) === stateOf(gB.segments[i])
            ? "same"
            : "changed",
        main: gB.segments[i].onewayRule?.dir ?? 0,
        mainLanes: gB.segments[i].lanes,
        mainSection: `${r2(gB.segments[i].section?.median ?? 0)}/${r2(gB.segments[i].section?.carriageway ?? 0)}`,
        len: r2(a.length),
        edge: Math.round(net.edgeDist(a)),
        nodes: `${net.nodeKey(a.from)}→${net.nodeKey(a.to)}`,
      });
      per.set(k, list);
      const isFirst = once("s", k);
      if (k === KEY_659 && r659 === null)
        r659 = {
          returned: ret,
          lanes: a.lanes,
          median: r2(a.section?.median ?? 0),
          carriageway: r2(a.section?.carriageway ?? 0),
        };
      if (!ret) {
        if (isFirst && stateOf(a) !== stateOf(gB.segments[i])) otherChanged++;
        continue;
      }
      if (!isFirst) continue;
      returned++;
      returnedM += a.length;
      retKeys.push({
        key: k,
        width: a.line.width,
        length: r2(a.length),
        lanes: a.lanes,
        median: r2(a.section?.median ?? 0),
        approx: approx[k]?.osm ?? null,
        group: net.key,
      });
      if (a.line.width >= 13) returnedWide++;
      if (approx[k]?.osm === "one-way") approxOneWayReturned++;
      if ((a.section?.laneWidth ?? 99) < 2.75)
        narrowReturned.push({ key: k, width: a.line.width, laneWidth: r2(a.section.laneWidth) });
      const src = propFrom.get(i);
      if (src !== undefined) {
        propagated++;
        propagatedM += a.length;
        const f = g.segments[src];
        if (!reachBoth(a))
          propNoReach.push({
            key: k,
            width: a.line.width,
            length: r2(a.length),
            approx: approx[k]?.osm ?? null,
          });
        if (f.line.width !== a.line.width)
          propWidthDiff.push({ key: k, width: a.line.width, fromWidth: f.line.width });
        const mt = (a.section?.median ?? 0) > 0;
        const mf = (f.section?.median ?? 0) > 0;
        if (mt !== mf)
          medianPresence.push({
            key: k,
            from: net.keyOf(f),
            median: r2(a.section?.median ?? 0),
            fromMedian: r2(f.section?.median ?? 0),
            basis: a.section?.basis,
            fromBasis: f.section?.basis,
          });
      }
      // Lane differences between straight-on returned neighbours (listed, not a line).
      for (const n of [a.from, a.to])
        for (const id of g.nodes.get(n) ?? []) {
          if (id <= i || !isRet(id)) continue;
          const b = g.segments[id];
          if (straightNode(g, a, b) !== n || a.lanes === b.lanes) continue;
          laneDiff.push({
            a: k,
            b: net.keyOf(b),
            lanes: [a.lanes, b.lanes],
            basis: [a.section?.basis, b.section?.basis],
            jartic: [a.section?.forward, b.section?.forward],
          });
        }
      const nd = -gB.segments[i].onewayRule.dir;
      const arrive = nd === 1 ? a.to : a.from;
      const enter = nd === 1 ? a.from : a.to;
      const around = (n: number) =>
        (g.nodes.get(n) ?? [])
          .map((id: number) => g.segments[id])
          .filter((s: any) => s !== a && isEnterable(s.line));
      const leaves = (s: any, n: number) => (s.from === n ? 1 : -1);
      const arrives = (s: any, n: number) => (s.to === n ? 1 : -1);
      const cut = (s: any, side: string, node: number) => {
        const isMaybeWrong =
          s.line.oneway === 0 && s.onewayRule && isAllDay(s.onewayRule.time) && reachBoth(s);
        const item = {
          side,
          node: net.nodeKey(node),
          seg: k,
          width: a.line.width,
          partner: net.keyOf(s),
          partnerWidth: s.line.width,
          partnerGsiOneway: s.line.oneway,
          sameWidth: s.line.width === a.line.width,
          approx: approx[net.keyOf(s)]?.osm ?? null,
          group: net.key,
        };
        (isMaybeWrong ? L.cutWrong : L.cutReal).set(`${side}|${item.node}|${k}`, item);
      };
      const out = around(arrive);
      if (out.length > 0 && nodeInside(arrive)) {
        if (!out.some((s: any) => eff(s) === 0 || eff(s) === leaves(s, arrive)))
          L.exitless.set(net.nodeKey(arrive) + "|" + k, {
            node: net.nodeKey(arrive),
            seg: k,
            group: net.key,
          });
        for (const s of out)
          if (straightNode(g, a, s) === arrive && eff(s) !== 0 && eff(s) !== leaves(s, arrive))
            cut(s, "arrive", arrive);
      }
      const inn = around(enter);
      if (inn.length > 0 && nodeInside(enter)) {
        if (!inn.some((s: any) => eff(s) === 0 || eff(s) === arrives(s, enter)))
          L.entryless.set(net.nodeKey(enter) + "|" + k, { node: net.nodeKey(enter), seg: k, group: net.key });
        for (const s of inn)
          if (straightNode(g, a, s) === enter && eff(s) !== 0 && eff(s) !== arrives(s, enter))
            cut(s, "enter", enter);
      }
    }
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      const t = ids.filter(isRet).length;
      const ruled = ids.filter((i) => gB.segments[i].onewayRule !== null).length;
      if (t > 0 && t < ruled) doubledSplit++;
    }
  }
  // Stability: keys in two or more networks whose answers differ.
  const unstable: any[] = [];
  for (const [k, list] of per) {
    if (list.length < 2) continue;
    const answers = new Set(list.map((x: any) => x.ans));
    if (answers.size < 2) continue;
    const mains = new Set(list.map((x: any) => `${x.main}/${x.mainLanes}/${x.mainSection}`));
    const isMainToo = mains.size > 1;
    const insideAll = list.every((x: any) => x.edge >= 60);
    const sameNodes = new Set(list.map((x: any) => x.nodes)).size === 1;
    unstable.push({ key: k, isMainToo, insideAll, sameNodes, per: list });
  }
  // Undone streets: undone segments joined by straight continuation (by key adjacency in the list order).
  const res = {
    row: row.name,
    s659: r659,
    chain659,
    returned: { n: returned, m: Math.round(returnedM) },
    ratioWideToApprox: r2(returnedWide / approxDividedN),
    propagated: { n: propagated, m: Math.round(propagatedM) },
    exitless: L.exitless.size,
    entryless: L.entryless.size,
    cutWrong: {
      arrive: [...L.cutWrong.values()].filter((x) => x.side === "arrive").length,
      enter: [...L.cutWrong.values()].filter((x) => x.side === "enter").length,
    },
    cutReal: {
      arrive: [...L.cutReal.values()].filter((x) => x.side === "arrive").length,
      enter: [...L.cutReal.values()].filter((x) => x.side === "enter").length,
      sameWidth: [...L.cutReal.values()].filter((x) => x.sameWidth).length,
    },
    propNoReach: propNoReach.length,
    propWidthDiff: propWidthDiff.length,
    doubledSplit,
    otherChanged,
    approxOneWayReturned,
    medianPresence: medianPresence.length,
    laneDiff: laneDiff.length,
    narrowReturned: narrowReturned.length,
    narrowKept: narrowKept.length,
    unstable: {
      all: unstable.length,
      prOnly: unstable.filter((u) => !u.isMainToo).length,
      prOnlyInside: unstable.filter((u) => !u.isMainToo && u.insideAll).length,
      mainToo: unstable.filter((u) => u.isMainToo).length,
    },
    undone: { n: undone.length, m: Math.round(undone.reduce((n, u) => n + u.length, 0)) },
    lists: {
      exitless: [...L.exitless.values()],
      entryless: [...L.entryless.values()],
      cutWrong: [...L.cutWrong.values()],
      cutReal: [...L.cutReal.values()],
      propNoReach,
      propWidthDiff,
      medianPresence,
      laneDiff,
      narrowReturned,
      narrowKept,
      unstable,
      undone,
      retKeys,
    },
  };
  results.push(res);
  const { lists, chain659: _c, ...brief } = res;
  console.log(JSON.stringify(brief));
}
await writeFile(outPath, JSON.stringify({ results }, null, 1) + "\n");
