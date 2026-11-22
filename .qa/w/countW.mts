// PR W: the street segments the OSM-divided check turns back to two-way, counted on the game's
// networks round the expressway's site chunks (the same groups as measureStreetBands.ts), with the
// regulations applied by main's regulations.ts (regulations.before.ts) and by the branch's. Every
// JARTIC-ruled segment's state is diffed; the approximate list (measureStreetBands --moves) is
// compared by its key (midpoint lat,lon to 5 places).
// Run (from the worktree): pnpm exec tsx <this> <xwDataDir> <gsiCache> <approxMoves.json> <out.json>
import { readFile, writeFile } from "node:fs/promises";

const W = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a5195e3853739145f";
const { ST, STATION_STRIDE } = await import(`${W}/src/expressway/format.ts`);
const { haversine } = await import(`${W}/src/expressway/geo.ts`);
const { LocalFrame } = await import(`${W}/src/geo/frame.ts`);
const { tileXToLon, tileYToLat } = await import(`${W}/src/geo/tiles.ts`);
const { expresswayRoadInput, joinExpressway } = await import(`${W}/src/world/expresswayRoads.ts`);
const { RoadGraph } = await import(`${W}/src/world/roads.ts`);
const { ROAD_TILE_ZOOM } = await import(`${W}/src/world/roadTiles.ts`);
const { readTime } = await import(`${W}/src/time/ruleTime.ts`);
const { ROAD_LANES_COLUMN: C } = await import(`${W}/src/world/roadLanesData.ts`);
const { takesJarticRules } = await import(`${W}/src/world/roadClass.ts`);
const { OSM_ONEWAY_REACH } = await import(`${W}/src/world/streetAssumptions.ts`);
const { streetRoom } = await import(`${W}/src/world/laneChange.ts`);
const { readExpresswayFiles } = await import(`${W}/scripts/expresswayFiles.ts`);
const { gsiTileReader, regulationReader, roadTileOf } = await import(`${W}/scripts/gameStreets.ts`);
const { Vector3 } = await import(`${W}/node_modules/three/build/three.module.js`);
const after = await import(`${W}/src/world/regulations.ts`);
const before = await import(`${W}/src/world/regulations.before.ts`);

const [dataDir, cacheDir, approxPath, outPath] = process.argv.slice(2);
const files = readExpresswayFiles(dataDir);
const runs = [
  ...new Map([...files.tiles.values()].flatMap((t: any) => t.runs).map((r: any) => [r.id, r])).values(),
];
const streetsOf = gsiTileReader(cacheDir);
const regsAround = regulationReader();
const approx = JSON.parse(await readFile(approxPath, "utf8")).ruledOneways as Record<
  string,
  { osm: string; widthM: number; lengthM: number; jarticOffsetM: number | null }
>;
const PARALLEL = Math.cos((25 * Math.PI) / 180);
const r2 = (v: number) => Math.round(v * 100) / 100;

const siteChunks = files.chunks.filter((c: any) => c.structure === "embankment" || c.structure === "cut");
const tileKeyOf = (c: any) => {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  return roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-");
};
const groups = new Map<string, any[]>();
for (const c of siteChunks) groups.set(tileKeyOf(c), [...(groups.get(tileKeyOf(c)) ?? []), c]);

type State = Record<string, unknown>;
const stateOf = (seg: any): State => ({
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
let curFrame: any = null;
let curKeyOf: (seg: any) => string = () => "";
const seen = new Set<string>();
const targets: any[] = [];
const otherChanged: any[] = [];
const ruledTwoWayLines: Record<string, number> = { all: 0, wide: 0 };
const consequences = { signs: 0, laneUse: 0, stopLines: 0, turnRules: 0, groupsWithSignDiff: [] as string[] };
const diag: any[] = [];
const splitDoubled: any[] = [];
const unattr: any[] = [];
const timedTargetsSkipped: any[] = [];

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
  curFrame = frame;
  const regs = await regsAround(cx, cy);
  if (regs === null) continue;
  const xw = expresswayRoadInput(near, runs, (_a: number, _b: number, h: number) => h);
  const gA = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  const gB = new RoadGraph(
    joinExpressway(streets, xw, () => {}),
    frame,
    () => {},
  );
  const appB = before.applyRegulations(gB, structuredClone(regs), frame, () => {});
  const appA = after.applyRegulations(gA, structuredClone(regs), frame, () => {});
  // Consequences off the segments: signs, lane use, stop lines, turn rules.
  const sj = (app: any) =>
    JSON.stringify({
      signs: app.signs.map((s: any) => [s.type, s.value, r2(s.pos.x), r2(s.pos.z), s.seg?.id, s.dir]),
    });
  const cmp = (a: any[], b: any[], f: (x: any) => unknown) => {
    const A = new Set(a.map((x) => JSON.stringify(f(x))));
    const B = new Set(b.map((x) => JSON.stringify(f(x))));
    let n = 0;
    for (const x of A) if (!B.has(x)) n++;
    for (const x of B) if (!A.has(x)) n++;
    return n;
  };
  const dSigns = cmp(appA.signs, appB.signs, (s) => [
    s.type,
    s.value,
    r2(s.pos.x),
    r2(s.pos.z),
    s.seg?.id,
    s.dir,
  ]);
  const dLane = cmp(appA.laneUse, appB.laneUse, (u) => [u.seg.id, u.dir, u.lanes, u.source]);
  const dStop = cmp(appA.stopLines, appB.stopLines, (l) => [l.seg.id, l.dir, r2(l.at)]);
  const dTurn = cmp(appA.turnRules, appB.turnRules, (t) =>
    JSON.stringify(t, (k, v) =>
      (k === "seg" || k === "from" || k === "to") && typeof v === "object" ? v?.id : v,
    ),
  );
  consequences.signs += dSigns;
  consequences.laneUse += dLane;
  consequences.stopLines += dStop;
  consequences.turnRules += dTurn;
  if (dSigns) consequences.groupsWithSignDiff.push(key);
  void sj;

  // Grids for the diagnostic (as osmLaneMatcher's).
  const ways = new after.LineGrid<any>();
  for (const r of regs.roadlanes)
    ways.add(
      { forward: r[C.forward], backward: r[C.backward], oneway: r[C.oneway] === 1, layer: r[C.layer] },
      toLocalPts(frame, r, C.coords),
    );
  const segGrid = new after.LineGrid<any>();
  for (const s of gA.segments) if (takesJarticRules(s.line)) segGrid.add(s, s.pts);
  const owGrid = new after.LineGrid<number>();
  for (const r of regs.oneway) {
    const { next } = readTime(r, 0);
    owGrid.add(0, toLocalPts(frame, r, next));
  }

  const keyOf = (seg: any) => {
    const g = frame.toGeodetic(gA.sample(seg, seg.length / 2).pos);
    return `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`;
  };
  curKeyOf = keyOf;
  const byKey = new Map<string, any[]>();
  const targetIds = new Set<number>();
  for (let i = 0; i < gA.segments.length; i++) {
    const a = gA.segments[i];
    if (!takesJarticRules(a.line)) continue;
    const isT = gB.segments[i].onewayRule !== null && a.onewayRule === null;
    if (isT) targetIds.add(i);
    const k = keyOf(a);
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  }
  for (const [k, ids] of byKey) {
    if (ids.length < 2) continue;
    const t = ids.filter((i) => targetIds.has(i)).length;
    const ruled = ids.filter((i) => gB.segments[i].onewayRule !== null).length;
    if (t > 0 && t < ruled) splitDoubled.push({ key: k, group: key, ids, targets: t, ruled });
  }
  const targetNodes = new Set<number>();
  for (const i of targetIds) {
    targetNodes.add(gA.segments[i].from);
    targetNodes.add(gA.segments[i].to);
  }
  const touches = (seg: any) =>
    seg && (targetIds.has(seg.id) || targetNodes.has(seg.from) || targetNodes.has(seg.to));
  const unattributed = (a: any[], b: any[], f: (x: any) => unknown, label: string) => {
    const B = new Set(b.map((x) => JSON.stringify(f(x))));
    const A = new Set(a.map((x) => JSON.stringify(f(x))));
    for (const x of a)
      if (!B.has(JSON.stringify(f(x))) && !touches(x.seg))
        unattr.push({ label, side: "after", group: key, item: f(x) });
    for (const x of b)
      if (!A.has(JSON.stringify(f(x))) && !touches(x.seg))
        unattr.push({ label, side: "before", group: key, item: f(x) });
  };
  unattributed(
    appA.signs,
    appB.signs,
    (s) => [s.type, s.value, r2(s.pos.x), r2(s.pos.z), s.seg?.id, s.dir],
    "sign",
  );
  unattributed(appA.laneUse, appB.laneUse, (u) => [u.seg.id, u.dir, u.lanes, u.source], "laneUse");
  unattributed(appA.stopLines, appB.stopLines, (l) => [l.seg.id, l.dir, r2(l.at)], "stopLine");
  for (let i = 0; i < gA.segments.length; i++) {
    const a = gA.segments[i];
    const b = gB.segments[i];
    if (!takesJarticRules(a.line)) continue;
    const g = frame.toGeodetic(gA.sample(a, a.length / 2).pos);
    const k = `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const isRuledTwoWayLine = b.onewayRule !== null && a.line.oneway === 0;
    if (isRuledTwoWayLine) {
      ruledTwoWayLines.all++;
      if (a.line.width >= 13) ruledTwoWayLines.wide++;
    }
    const sa = stateOf(a);
    const sb = stateOf(b);
    const isSame = JSON.stringify(sa) === JSON.stringify(sb);
    const ap = approx[k];
    // The JARTIC line's lateral offset at the samples (+ left of the coords), as the vote saw it.
    const offsets: number[] = [];
    for (const f of a.length < 20 ? [0.5] : [0.2, 0.5, 0.8]) {
      const { pos, dir } = gA.sample(a, a.length * f);
      const hit = owGrid.nearest(
        pos.x,
        pos.z,
        6,
        (dx: number, dz: number) => Math.abs(dx * dir.x + dz * dir.z) > PARALLEL,
      );
      if (hit) {
        // Offset of the line from the centre, + left of the segment's coords.
        const wx = pos.x - hit.lateral * hit.dz;
        const wz = pos.z + hit.lateral * hit.dx;
        offsets.push(r2((wx - pos.x) * dir.z + (wz - pos.z) * -dir.x));
      }
    }
    const row = {
      key: k,
      seg: i,
      group: key,
      widthM: a.line.width,
      lengthM: Math.round(a.length),
      jarticOffsetsM: offsets,
      approx: ap?.osm ?? null,
      before: sb,
      after: sa,
    };
    if (isSame) {
      // The approximation said divided, the game's matching did not: why (per sample, per sense).
      const isMissed = ap?.osm === "divided" && b.onewayRule !== null;
      // Beside a segment turned two-way (sharing a node): a one-way stub left in a two-way street.
      const besideTarget = [a.from, a.to].some((node: number) =>
        (gA.nodes.get(node) ?? []).some((id: number) => {
          const o = gA.segments[id];
          const ob = gB.segments[id];
          return id !== a.id && ob.onewayRule !== null && o.onewayRule === null;
        }),
      );
      if (isMissed)
        diag.push({
          ...row,
          besideTarget,
          why: whyNot(a, gA, ways, segGrid),
          timed: !isAllDayT(b.onewayRule.time),
        });
      continue;
    }
    const isTarget = b.onewayRule !== null && a.onewayRule === null;
    if (isTarget) targets.push(row);
    else otherChanged.push(row);
  }
}

function isAllDayT(t: any) {
  return t.off.length === 0 && t.on.some(([x, y]: number[]) => x === 0 && y >= 1440);
}
function toLocalPts(frame: any, r: number[], from: number) {
  const out: any[] = [];
  for (let i = from; i + 1 < r.length; i += 2) out.push(frame.toLocal(r[i + 1], r[i], 0));
  return out.map((v: any) => new Vector3(v.x, 0, v.z));
}
/** osmLaneMatcher's gates, in its order, for each sample and sense: the first one a sense failed. */
function whyNot(seg: any, graph: any, ways: any, segGrid: any) {
  const reach = Math.min(25, seg.line.width / 2 + OSM_ONEWAY_REACH.value);
  const { fitting } = streetRoom(seg.line.width, 0);
  const out: string[] = [];
  for (const f of seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8]) {
    const { pos, dir } = graph.sample(seg, seg.length * f);
    const per: string[] = [];
    for (const sense of [1, -1]) {
      const isAligned = (dx: number, dz: number) => sense * (dx * dir.x + dz * dir.z) > PARALLEL;
      const hit = ways.nearest(pos.x, pos.z, reach, isAligned);
      if (!hit) {
        per.push(`${sense}:none-in-reach`);
        continue;
      }
      if (!hit.owner.oneway) {
        per.push(hit.dist > 6 ? `${sense}:two-way-far` : `${sense}:two-way`);
        continue;
      }
      const isOnLevel = hit.owner.layer === 0 || seg.line.bridge === true;
      if (!isOnLevel) {
        per.push(`${sense}:layer`);
        continue;
      }
      const wx = pos.x - hit.lateral * hit.dz;
      const wz = pos.z + hit.lateral * hit.dx;
      const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
      const other = segGrid.nearest(wx, wz, reach, isParallel);
      const mutual = other?.owner === seg;
      if (!mutual) {
        const o = other?.owner;
        const og = o ? curFrame.toGeodetic(graph.sample(o, o.length / 2).pos) : null;
        const sharesNode = o && [o.from, o.to].some((n: number) => n === seg.from || n === seg.to);
        const isSameKey = og && curKeyOf(seg) === `${og.lat.toFixed(5)},${og.lon.toFixed(5)}`;
        const kind = isSameKey ? "doubled" : sharesNode ? "same-street" : "other-line";
        per.push(
          `${sense}:not-mutual-${kind}(way ${r2(hit.dist)} off; nearer seg w${o?.line.width} ow${o?.line.oneway} rule${o?.onewayRule?.dir ?? 0} ${r2(other?.dist ?? -1)} off, ${og ? og.lat.toFixed(5) + "," + og.lon.toFixed(5) : "?"})`,
        );
        continue;
      }
      const along = sense === 1 ? hit.owner.forward : 0;
      const against = sense === 1 ? 0 : hit.owner.forward;
      if (Math.max(along, against) > fitting) {
        per.push(`${sense}:not-fit(${hit.owner.forward}>${fitting})`);
        continue;
      }
      per.push(`${sense}:ok(${r2(hit.dist)})`);
    }
    out.push(per.join(" "));
  }
  return out;
}

const sum = (rows: any[]) => ({ n: rows.length, m: rows.reduce((n, r) => n + r.lengthM, 0) });
const wide = (rows: any[]) => rows.filter((r) => r.widthM >= 13);
const approxDivided = Object.entries(approx).filter(([, v]) => v.osm === "divided");
const targetKeys = new Set(targets.map((t) => t.key));
const summary = {
  targets: sum(targets),
  targetsWide: sum(wide(targets)),
  targetsNarrow: sum(targets.filter((r) => r.widthM < 13)),
  approxDivided: {
    n: approxDivided.length,
    m: approxDivided.reduce((n, [, v]) => n + Math.round(v.lengthM), 0),
  },
  approxDividedAlsoTarget: approxDivided.filter(([k]) => targetKeys.has(k)).length,
  approxDividedNotInNetwork: approxDivided.filter(([k]) => !seen.has(k)).length,
  targetsWideNotApproxDivided: wide(targets)
    .filter((t) => t.approx !== "divided")
    .map((t) => [t.key, t.approx]),
  targetsApproxOneWay: targets.filter((t) => t.approx === "one-way").map((t) => t.key),
  missedApproxDivided: diag.length,
  missedTimed: diag.filter((d) => d.timed).length,
  missedBesideTarget: sum(diag.filter((d) => d.besideTarget)),
  missedByGate: (() => {
    const out: Record<string, number> = {};
    for (const d of diag) {
      const gates = new Set<string>();
      for (const w of d.why)
        for (const p of w.split(/ (?=-?1:)/)) gates.add(p.replace(/^-?1:/, "").replace(/\(.*$/, ""));
      gates.delete("ok");
      const k = [...gates].toSorted().join("+") || "minority";
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  })(),
  otherChanged: otherChanged.length,
  splitDoubled: splitDoubled.length,
  unattributed: unattr.length,
  unattributedByLabel: unattr.reduce((o: any, u: any) => ((o[u.label] = (o[u.label] ?? 0) + 1), o), {}),
  ruledTwoWayLines,
  consequences,
};
console.log(JSON.stringify(summary, null, 1));
await writeFile(
  outPath,
  JSON.stringify({ summary, targets, otherChanged, missed: diag, splitDoubled, unattr }, null, 1) + "\n",
);
