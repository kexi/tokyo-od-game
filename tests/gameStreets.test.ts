import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyRegulations, gameStreetGraph, regulationReader, roadTileOf } from "../scripts/gameStreets";
import { LocalFrame } from "../src/geo/frame";
import type { RoadLine } from "../src/world/roads";

// East–west street along lat 35.68 (coordinates west → east), 22 m 幅員: room for two lanes a way.
const street = (): RoadLine => ({
  coords: [139.76, 35.68, 139.762, 35.68],
  width: 22,
  oneway: 0,
  kind: "local",
});
const frame = new LocalFrame(35.68, 139.761, 0);
/** JARTIC 車両通行帯 of 2 traced along the street. */
const regs = () => {
  const r = emptyRegulations();
  r.lanes.push([2, 139.76, 35.68, 139.762, 35.68]);
  return r;
};

describe("gameStreetGraph: the probes' network is the game's (P2.7 R1-2-0)", () => {
  it("gives a street the lanes JARTIC lists, as the worker's applyRegulations does", () => {
    const { graph, applied } = gameStreetGraph([street()], { lines: [], ends: [] }, frame, regs());
    expect(applied).not.toBeNull();
    expect(graph.segments).toHaveLength(1);
    expect(graph.segments[0].lanes).toBe(2);
    expect(graph.segments[0].section?.basis).toBe("jartic");
  });

  it("keeps the width's one lane where no regulations are given (data not fetched)", () => {
    const { graph, applied } = gameStreetGraph([street()], { lines: [], ends: [] }, frame, null);
    expect(applied).toBeNull();
    expect(graph.segments[0].lanes).toBe(1);
  });

  it("drives a timed JARTIC one-way the way its section was resolved, not as a two-way street", () => {
    const r = regs();
    // Permitted travel east → west (against the coords), 07:00–09:00 only (TIME: one window).
    r.oneway.push([1, 420, 540, 0, 0, 139.762, 35.68, 139.76, 35.68]);
    const { graph } = gameStreetGraph([street()], { lines: [], ends: [] }, frame, r);
    const seg = graph.segments[0];
    expect(seg.onewayRule?.dir).toBe(-1);
    expect(seg.oneway).toBe(-1);
  });
});

describe("regulationReader: RegulationTiles.around from the files", () => {
  it("returns null for a folder without the regulation index, so the tools fall back to the widths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "regs-none-"));
    expect(await regulationReader(dir)(58205, 25806)).toBeNull();
  });

  it("reads the z14 tiles under the 3 × 3 z16 tiles once each, every record once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "regs-"));
    const [cx, cy] = roadTileOf(139.761, 35.68);
    const key = `${Math.floor(cx / 4)}-${Math.floor(cy / 4)}`;
    mkdirSync(join(dir, "regs"));
    writeFileSync(join(dir, "regs", "meta.json"), JSON.stringify({ tiles: [key] }));
    writeFileSync(join(dir, "regs", `${key}.json`), JSON.stringify({ lanes: [[2, 1, 2, 3, 4]] }));
    const data = await regulationReader(dir)(cx, cy);
    expect(data?.lanes).toEqual([[2, 1, 2, 3, 4]]);
    expect(data?.roadlanes).toEqual([]);
  });
});
