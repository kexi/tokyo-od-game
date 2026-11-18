import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { STATION_STRIDE, type XwEnd, type XwTileRun } from "../src/expressway/format";
import { endAhead, endsAhead, rangeOfChunks, type RunRange } from "../src/world/expresswayEnds";

// R1-1b 3.1: which ends have nothing written going on beyond them (the ends the game closes with a
// wall), from the tiles' run summaries and the runs' loaded ranges alone.

const end = (kind: XwEnd["kind"], parent?: string, parentS?: number): XwEnd => ({
  kind,
  ...(parent !== undefined ? { parent, parentS } : {}),
});
const run = (id: string, start: XwEnd, last: XwEnd, cls: XwTileRun["cls"] = "expressway"): XwTileRun => ({
  id,
  cls,
  start,
  end: last,
});
const net = (list: XwTileRun[]) => new Map(list.map((r) => [r.id, r]));
const ranges =
  (map: Record<string, number>) =>
  (id: string): RunRange | null =>
    id in map ? { s0: 0, s1: map[id] } : null;

describe("先の無い端の判定（src/world/expresswayEnds.ts、R1-1b 3.1）", () => {
  it("(a) a ground end goes on at the ground", () => {
    const runs = net([run("a", end("ground"), end("open"))]);
    expect(endAhead(runs, ranges({ a: 100 }), "a", "start")).toEqual({ ahead: true, why: "ground" });
    expect(endAhead(runs, ranges({ a: 100 }), "a", "end").ahead).toBe(false);
  });

  it("(b) an open end with a run seamed on there goes on; without it, it is a dead end", () => {
    const runs = net([run("a", end("ground"), end("open")), run("b", end("seam", "a", 100), end("ground"))]);
    expect(endAhead(runs, ranges({ a: 100, b: 50 }), "a", "end")).toEqual({
      ahead: true,
      why: "seam-child",
      via: "b",
    });
    const alone = net([run("a", end("ground"), end("open"))]);
    expect(endAhead(alone, ranges({ a: 100 }), "a", "end")).toEqual({ ahead: false, why: "dead" });
  });

  it("(c) a run hung by a junction at the node and leaving it beyond the end goes on; one coming back into the end does not", () => {
    const onward = net([
      run("a", end("ground"), end("open")),
      run("c", end("junction", "a", 100), end("ground"), "ramp"),
    ]);
    expect(endAhead(onward, ranges({ a: 100, c: 80 }), "a", "end")).toEqual({
      ahead: true,
      why: "onward",
      via: "c",
    });
    const merging = net([
      run("a", end("ground"), end("open")),
      run("c", end("ground"), end("junction", "a", 100), "ramp"),
    ]);
    expect(endAhead(merging, ranges({ a: 100, c: 80 }), "a", "end").ahead).toBe(false);
  });

  it("(d) an end on a written parent goes on inside it; at the parent's end, as that end (through its start, dead with it)", () => {
    const runs = net([
      run("p", end("ground"), end("open")),
      run("in", end("junction", "p", 40), end("ground"), "ramp"),
      run("same", end("ground"), end("junction", "p", 100), "ramp"),
      run("through", end("ground"), end("junction", "p", 0), "ramp"),
    ]);
    const r = ranges({ p: 100, in: 30, same: 30, through: 30 });
    expect(endAhead(runs, r, "in", "start")).toEqual({ ahead: true, why: "on-parent", via: "p" });
    expect(endAhead(runs, r, "same", "end")).toEqual({ ahead: false, why: "parent-dead", via: "p" });
    expect(endAhead(runs, r, "through", "end")).toEqual({ ahead: true, why: "parent-goes-on", via: "p" });
  });

  it("an end on a parent whose last chunk is not loaded goes on (no wall); once it is, it takes the parent's end's answer", () => {
    const runs = net([
      run("p", end("ground"), end("open")),
      run("c", end("ground"), end("junction", "p", 100), "ramp"),
    ]);
    const unread = (id: string): RunRange | null => (id === "p" ? { s0: 0, s1: null } : { s0: 0, s1: 30 });
    expect(endAhead(runs, unread, "c", "end")).toEqual({ ahead: true, why: "on-parent", via: "p" });
    expect(endAhead(runs, ranges({ p: 100, c: 30 }), "c", "end")).toEqual({
      ahead: false,
      why: "parent-dead",
      via: "p",
    });
    // A run whose summary or chunks are not read at all: nothing to decide, no wall.
    expect(endAhead(runs, ranges({ c: 30 }), "p", "end")).toEqual({ ahead: true, why: "unknown" });
    expect(endAhead(net([]), ranges({}), "p", "end")).toEqual({ ahead: true, why: "unknown" });
  });

  it("(e) a portal, and a junction or seam whose parent is not written, are dead ends; a loop of (d) stops", () => {
    const runs = net([
      run("t", end("portal"), end("seam", "gone", 10)),
      run("x", end("ground"), end("junction", "y", 50)),
      run("y", end("ground"), end("junction", "x", 50)),
    ]);
    const r = ranges({ t: 50, x: 50, y: 50 });
    expect(endAhead(runs, r, "t", "start").ahead).toBe(false);
    expect(endAhead(runs, r, "t", "end").ahead).toBe(false);
    expect(endAhead(runs, r, "x", "end").ahead).toBe(false);
  });

  it("gives the same answers whatever order the summaries come in", () => {
    const list = [
      run("p", end("ground"), end("open")),
      run("same", end("ground"), end("junction", "p", 100), "ramp"),
      run("b", end("seam", "p", 0), end("portal")),
    ];
    const r = ranges({ p: 100, same: 30, b: 20 });
    const one = endsAhead(net(list), r);
    const two = endsAhead(net([...list].reverse()), r);
    expect([...two]).toEqual([...one]);
  });

  it("knows a run's end only once its last chunk is in", () => {
    const c = (k: number, s0: number, s1: number, next: string | null) => ({
      k,
      next,
      st: [s0, 0, 0, 0, 0, 0, 0, s1, 0, 0, 0, 0, 0, 0],
    });
    expect(rangeOfChunks([c(0, 0, 300, "x:1")], STATION_STRIDE)).toEqual({ s0: 0, s1: null });
    expect(rangeOfChunks([c(1, 300, 420, null), c(0, 0, 300, "x:1")], STATION_STRIDE)).toEqual({
      s0: 0,
      s1: 420,
    });
  });
});

describe("既定のデータの先の無い端（R1-1b 2 節）", () => {
  const isDefault = !process.env.XW_DATA_DIR;
  it("are the 7 ends of the default range, the ground end 45019020:start not among them, none in a tunnel", () => {
    if (!isDefault) return;
    const files = readExpresswayFiles();
    const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
    const answers = endsAhead(runs, (id) => rangeOfChunks(files.byRun.get(id) ?? [], STATION_STRIDE));
    const dead = [...answers].filter(([, a]) => !a.ahead).map(([k]) => k);
    expect(dead).toEqual([
      "24039751:end",
      "24402609:start",
      "45068169:start",
      "45068170:end",
      "45554541:start",
      "4848762:end",
      "5213324:end",
    ]);
    expect(answers.get("45019020:start")?.ahead).toBe(true);
    const inTunnel = dead.filter((k) => {
      const [id, side] = k.split(":");
      const list = files.byRun.get(id)!;
      return (side === "start" ? list[0] : list[list.length - 1]).structure === "tunnel";
    });
    expect(inTunnel).toEqual([]);
  });
});
