// PR W, review0 3.1 / 3.2: dead ends (exit-less nodes, mid-street cuts, entry-less nodes) and the
// options (a)(b)(c)(d) alone and combined, on the networks of countW.mts (one per z16 tile group of
// site chunks). Needs src/world/regulations.before.ts (main) and regulations.exp.ts (makeExp.py).
// Run (from the worktree): pnpm exec tsx .qa/w/countW2.mts <xwDataDir> <gsiCache> <approxMoves.json> <out.json> [rows]
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
const approx = JSON.parse(await readFile(approxPath, "utf8")).ruledOneways as Record<
  string,
  { osm: string; lengthM: number }
>;
const approxDividedN = Object.values(approx).filter((v) => v.osm === "divided").length;
const r2 = (v: number) => Math.round(v * 100) / 100;
const isAllDay = (t: any) => t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);

type Row = { name: string; a: boolean; b: "off" | "judge" | "evidence"; c: boolean; d: boolean };
const baseRows: Array<Omit<Row, "c" | "d">> = [
  { name: "now", a: false, b: "off" },
  { name: "a", a: true, b: "off" },
  { name: "b-judge", a: false, b: "judge" },
  { name: "b-evidence", a: false, b: "evidence" },
  { name: "a+b-judge", a: true, b: "judge" },
  { name: "a+b-evidence", a: true, b: "evidence" },
];
let rows: Row[] = [];
for (const r of baseRows)
  for (const [c, d] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const)
    rows.push({ ...r, name: r.name + (c ? "+c" : "") + (d ? "+d" : ""), c, d });
if (rowsArg) rows = rows.filter((r) => rowsArg.split(",").includes(r.name));

const siteChunks = files.chunks.filter((c: any) => c.structure === "embankment" || c.structure === "cut");
const tileKeyOf = (c: any) => {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  return roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-");
};
const groups = new Map<string, any[]>();
for (const c of siteChunks) groups.set(tileKeyOf(c), [...(groups.get(tileKeyOf(c)) ?? []), c]);

/** The 麻布台 street (45021976): 659's key; the chain is found from it. */
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

// Networks built once per group; each row re-applies the regulations on a fresh graph.
type Net = {
  key: string;
  frame: any;
  streets: any[];
  xw: any;
  regs: any;
  gB: any;
  keyOf: (s: any) => string;
  nodeKey: (n: number, g: any) => string;
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
  const nodeKey = (n: number, g: any) => {
    const s = g.segments[g.nodes.get(n)[0]];
    const p = s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
    const q = frame.toGeodetic(p);
    return `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
  };
  nets.push({ key, frame, streets, xw, regs, gB, keyOf, nodeKey });
}

function extentOf(g: any) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const s of g.segments)
    for (const p of s.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  return (p: any) => p.x < minX + 60 || p.x > maxX - 60 || p.z < minZ + 60 || p.z > maxZ - 60;
}

const results: any[] = [];
let detail659: any = null;
const narrow: any[] = [];
for (const row of rows) {
  EXP.a = row.a;
  EXP.b = row.b;
  EXP.c = row.c;
  EXP.d = row.d;
  const seen = new Set<string>();
  const answers = new Map<string, Set<string>>(); // seg key → answers across networks (stability)
  let returned = 0,
    returnedM = 0,
    returnedWide = 0;
  const exitless = new Map<string, any>();
  const cuts = new Map<string, any>();
  const entryless = new Map<string, any>();
  const entryCuts = new Map<string, any>();
  let doubledSplit = 0,
    otherChanged = 0,
    approxOneWayReturned = 0,
    sectionMismatch = 0;
  let undone = 0,
    undoneM = 0;
  const undoneStreets = new Map<string, { n: number; m: number }>();
  let r659: any = null;
  for (const net of nets) {
    const gB = net.gB;
    const g = new RoadGraph(
      joinExpressway(net.streets, net.xw, () => {}),
      net.frame,
      () => {},
    );
    exp.applyRegulations(g, structuredClone(net.regs), net.frame, () => {});
    const isEdge = extentOf(g);
    const eff = (s: any): number =>
      s.onewayRule && isAllDay(s.onewayRule.time) ? s.onewayRule.dir : s.line.oneway;
    const isRet = (i: number) => gB.segments[i].onewayRule !== null && g.segments[i].onewayRule === null;
    const nodePos = (n: number) => {
      const s = g.segments[g.nodes.get(n)[0]];
      return s.from === n ? s.pts[0] : s.pts[s.pts.length - 1];
    };
    for (const id of EXP_OUT.undone) {
      const s = g.segments[id];
      const k = net.keyOf(s);
      if (seen.has("u" + k)) continue;
      seen.add("u" + k);
      undone++;
      undoneM += s.length;
    }
    const dbg = process.env.DEBUG_KEY;
    if (dbg && row.name === "now") {
      const start = g.segments.find((s: any) => takesJarticRules(s.line) && net.keyOf(s) === dbg);
      if (start) {
        const show = (s: any) => ({
          id: s.id,
          key: net.keyOf(s),
          w: s.line.width,
          len: r2(s.length),
          from: net.nodeKey(s.from, g),
          to: net.nodeKey(s.to, g),
          main: gB.segments[s.id].onewayRule?.dir ?? 0,
          now: s.onewayRule?.dir ?? 0,
          lineOw: s.line.oneway,
          approx: approx[net.keyOf(s)]?.osm ?? null,
        });
        console.log("DEBUG", net.key, JSON.stringify(show(start)));
        const seenD = new Set([start.id]);
        let frontier = [start];
        for (let hop = 0; hop < 3; hop++) {
          const next: any[] = [];
          for (const a of frontier)
            for (const n of [a.from, a.to])
              for (const id of g.nodes.get(n) ?? []) {
                if (seenD.has(id)) continue;
                seenD.add(id);
                const b = g.segments[id];
                const st = straightNode(g, a, b) === n;
                console.log(
                  "DEBUG",
                  "hop",
                  hop + 1,
                  "from",
                  a.id,
                  "at",
                  net.nodeKey(n, g),
                  st ? "straight" : "turn",
                  JSON.stringify(show(b)),
                );
                if (st && b.line.width === a.line.width) next.push(b);
              }
          frontier = next;
        }
      }
    }
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < g.segments.length; i++) {
      const a = g.segments[i];
      if (!takesJarticRules(a.line)) continue;
      const k = net.keyOf(a);
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
      const ret = isRet(i);
      const ans = ret ? "two-way" : stateOf(a) === stateOf(gB.segments[i]) ? "same" : "changed";
      answers.set(
        k,
        (answers.get(k) ?? new Set()).add(ans + (ret ? `:${a.lanes}/${a.section?.median ?? 0}` : "")),
      );
      const isFirst = !seen.has(k);
      seen.add(k);
      if (k === KEY_659 && r659 === null)
        r659 = { group: net.key, returned: ret, state: JSON.parse(stateOf(a)) };
      if (!ret) {
        if (isFirst && stateOf(a) !== stateOf(gB.segments[i])) otherChanged++;
        continue;
      }
      if (!isFirst) continue;
      returned++;
      returnedM += a.length;
      if (a.line.width >= 13) returnedWide++;
      if (approx[k]?.osm === "one-way") approxOneWayReturned++;
      if (row.name === "now" && a.line.width < 13)
        narrow.push({
          key: k,
          seg: i,
          group: net.key,
          width: a.line.width,
          length: r2(a.length),
          line: {
            kind: a.line.kind,
            source: a.line.source,
            oneway: a.line.oneway,
            bridge: a.line.bridge,
            structure: a.line.structure,
            level: a.line.level,
            cls: a.line.cls,
          },
          before: JSON.parse(stateOf(gB.segments[i])),
          after: JSON.parse(stateOf(a)),
          ways: nearWays(net, g, a),
          doubled: g.segments
            .filter((o: any) => isDoubled(g, a, o))
            .map((o: any) => ({
              id: o.id,
              width: o.line.width,
              key: net.keyOf(o),
              oneway: o.onewayRule?.dir ?? 0,
            })),
        });
      // The newly opened direction: against the rule it had.
      const nd = -gB.segments[i].onewayRule.dir;
      const arrive = nd === 1 ? a.to : a.from;
      const enter = nd === 1 ? a.from : a.to;
      const others = (n: number) =>
        (g.nodes.get(n) ?? [])
          .map((id: number) => g.segments[id])
          .filter((s: any) => s !== a && isEnterable(s.line));
      const out = others(arrive);
      const isArriveCounted = out.length > 0 && !isEdge(nodePos(arrive));
      if (isArriveCounted) {
        const canLeave = out.some((s: any) => eff(s) === 0 || eff(s) === (s.from === arrive ? 1 : -1));
        const where = {
          node: net.nodeKey(arrive, g),
          seg: k,
          width: a.line.width,
          group: net.key,
          beyond: out.map((s: any) => ({
            key: net.keyOf(s),
            width: s.line.width,
            eff: eff(s),
            leaving: s.from === arrive ? 1 : -1,
            straight: straightNode(g, a, s) === arrive,
            approx: approx[net.keyOf(s)]?.osm ?? null,
          })),
        };
        if (!canLeave) exitless.set(where.node + "|" + k, where);
        const cut = out.find(
          (s: any) =>
            straightNode(g, a, s) === arrive && eff(s) !== 0 && eff(s) !== (s.from === arrive ? 1 : -1),
        );
        if (cut) cuts.set(where.node + "|" + k, where);
      }
      const inn = others(enter);
      const isEnterCounted = inn.length > 0 && !isEdge(nodePos(enter));
      if (isEnterCounted) {
        const canEnter = inn.some((s: any) => eff(s) === 0 || eff(s) === (s.to === enter ? 1 : -1));
        if (!canEnter)
          entryless.set(net.nodeKey(enter, g) + "|" + k, {
            node: net.nodeKey(enter, g),
            seg: k,
            group: net.key,
          });
        // Not in review0 3.1: the cut seen from the entry side (the straight way in runs against the new direction).
        const back = inn.find(
          (s: any) => straightNode(g, a, s) === enter && eff(s) !== 0 && eff(s) !== (s.to === enter ? 1 : -1),
        );
        if (back)
          entryCuts.set(net.nodeKey(enter, g) + "|" + k, {
            node: net.nodeKey(enter, g),
            seg: k,
            group: net.key,
            back: net.keyOf(back),
            backWidth: back.line.width,
            approx: approx[net.keyOf(back)]?.osm ?? null,
          });
      }
      // Section agreement with straight-on returned neighbours.
      for (const n of [a.from, a.to])
        for (const id of g.nodes.get(n) ?? []) {
          if (id <= i || !isRet(id)) continue;
          const b = g.segments[id];
          if (straightNode(g, a, b) !== n) continue;
          const isSame = a.lanes === b.lanes && (a.section?.median ?? 0) === (b.section?.median ?? 0);
          if (!isSame) sectionMismatch++;
        }
    }
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      const t = ids.filter(isRet).length;
      const ruled = ids.filter((i) => gB.segments[i].onewayRule !== null).length;
      if (t > 0 && t < ruled) doubledSplit++;
    }
  }
  const unstable = [...answers.values()].filter((s) => s.size > 1).length;
  const res = {
    row: row.name,
    s659: r659,
    returned: { n: returned, m: Math.round(returnedM) },
    ratioWideToApprox: r2(returnedWide / approxDividedN),
    exitless: exitless.size,
    cuts: cuts.size,
    entryless: entryless.size,
    entryCuts: entryCuts.size,
    undone: { n: undone, m: Math.round(undoneM) },
    doubledSplit,
    otherChanged,
    approxOneWayReturned,
    sectionMismatch,
    unstable,
    lists: {
      exitless: [...exitless.values()],
      cuts: [...cuts.values()],
      entryless: [...entryless.values()],
      entryCuts: [...entryCuts.values()],
    },
  };
  results.push(res);
  const { lists, ...brief } = res;
  console.log(JSON.stringify(brief));
}

function nearWays(net: Net, g: any, seg: any) {
  const out: any[] = [];
  const mid = g.sample(seg, seg.length / 2);
  for (const r of net.regs.roadlanes) {
    let best = Infinity;
    for (let i = C.coords; i + 3 < r.length; i += 2) {
      const p = net.frame.toLocal(r[i + 1], r[i], 0);
      const q = net.frame.toLocal(r[i + 3], r[i + 2], 0);
      const ex = q.x - p.x,
        ez = q.z - p.z;
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((mid.pos.x - p.x) * ex + (mid.pos.z - p.z) * ez) / l2));
      best = Math.min(best, Math.hypot(p.x + ex * t - mid.pos.x, p.z + ez * t - mid.pos.z));
    }
    if (best < 30)
      out.push({
        dist: r2(best),
        forward: r[C.forward],
        backward: r[C.backward],
        oneway: r[C.oneway],
        widthDm: r[C.widthDm],
        layer: r[C.layer],
      });
  }
  return out.toSorted((a, b) => a.dist - b.dist).slice(0, 6);
}
await writeFile(outPath, JSON.stringify({ results, narrow, detail659 }, null, 1) + "\n");
