// R1-5 手順 1 後半 5・6（読むだけ）: XW_DATA_DIR のフォルダの規模と、経路の (全)・(絞) の見積もりの元の数。
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";
import { ST, STATION_STRIDE } from "../../src/expressway/format.ts";

const files = readExpresswayFiles();
const runs = files.record.runs as Array<{
  id: string;
  chain: string;
  cls: string;
  lengthM: number;
  start: { kind: string; parent?: string };
  end: { kind: string; parent?: string };
}>;
const written = new Set(files.byRun.keys());
const clsOf = new Map(runs.map((r) => [r.id, r.cls]));
const out: Record<string, unknown> = { tiles: files.meta.tiles.length };
const byCls: Record<
  string,
  {
    runs: number;
    km: number;
    laneKm: number;
    hours60: number;
    hoursPosted: number;
    byLanes: Record<number, number>;
  }
> = {};
for (const [run, chunks] of files.byRun) {
  const cls = chunks[0].cls;
  const b = (byCls[cls] ??= { runs: 0, km: 0, laneKm: 0, hours60: 0, hoursPosted: 0, byLanes: {} });
  b.runs++;
  for (const c of chunks) {
    const len = c.st[c.st.length - STATION_STRIDE + ST.s] - c.st[ST.s];
    const km = len / 1000;
    b.km += km;
    b.laneKm += km * c.lanes;
    b.byLanes[c.lanes] = (b.byLanes[c.lanes] ?? 0) + km;
    const posted = (c as { posted?: number }).posted ?? 60;
    b.hours60 += (km * c.lanes) / 60;
    b.hoursPosted += (km * c.lanes) / posted;
  }
  void run;
}
for (const b of Object.values(byCls)) {
  b.km = Math.round(b.km * 10) / 10;
  b.laneKm = Math.round(b.laneKm * 10) / 10;
  b.hours60 = Math.round(b.hours60 * 100) / 100;
  b.hoursPosted = Math.round(b.hoursPosted * 100) / 100;
  for (const k of Object.keys(b.byLanes)) b.byLanes[Number(k)] = Math.round(b.byLanes[Number(k)] * 10) / 10;
}
out.byCls = byCls;
const mainChains = new Set<string>();
for (const [, chunks] of files.byRun) if (chunks[0].cls === "expressway") mainChains.add(chunks[0].chain);
out.mainChains = mainChains.size;
// Ramps: from a main line (exit), onto one (entrance), main to main (JCT connector).
let exits = 0;
let entrances = 0;
let connectors = 0;
let other = 0;
const isMainParent = (e: { kind: string; parent?: string }) =>
  e.kind === "junction" && e.parent !== undefined && clsOf.get(e.parent) === "expressway";
for (const r of runs) {
  const isRamp = r.cls === "ramp" && written.has(r.id);
  if (!isRamp) continue;
  const fromMain = isMainParent(r.start);
  const toMain = isMainParent(r.end);
  if (fromMain && toMain) connectors++;
  else if (fromMain) exits++;
  else if (toMain) entrances++;
  else other++;
}
out.ramps = { exits, entrances, connectors, other };
out.closed = (files.record as { closed?: unknown[] }).closed?.length ?? null;
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
