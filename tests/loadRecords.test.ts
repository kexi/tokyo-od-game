import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { dropLoadRecords } from "../src/world/buildings";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Code (not comments) that touches a b3dm tile's tables or the loader's result. */
const LOAD_RECORDS = /\bbatchTable\b|\bfeatureTable\b|engineData\b[^\n]*\bmetadata\b/;
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("a b3dm tile's load records", () => {
  it("dropLoadRecords takes the tables off the scene and the loader's result off the tile, and nothing else", () => {
    const scene = Object.assign(new Group(), { batchTable: { header: {} }, featureTable: { header: {} } });
    const geometry = [{}];
    const tile = {
      engineData: { scene, metadata: { batchTable: {} }, geometry, materials: [], textures: [] },
    };
    dropLoadRecords(scene, tile);
    expect(scene).toMatchObject({ batchTable: null, featureTable: null });
    expect(tile.engineData.metadata).toBeNull();
    expect(tile.engineData.scene).toBe(scene);
    expect(tile.engineData.geometry).toBe(geometry);
  });

  it("a tile without engineData (or none at all) only loses the scene's tables", () => {
    const scene = Object.assign(new Group(), { batchTable: {}, featureTable: {} });
    expect(() => dropLoadRecords(scene, {})).not.toThrow();
    expect(() => dropLoadRecords(scene, null)).not.toThrow();
    expect(scene).toMatchObject({ batchTable: null, featureTable: null });
  });

  it("nothing in src/ reads them: dropLoadRecords is the one place that touches them", () => {
    const touching = sources(join(ROOT, "src")).flatMap((path) => {
      const lines = readFileSync(path, "utf8").split("\n");
      // The body of dropLoadRecords: from its line to the first line that closes it.
      const first = lines.findIndex((l) => l.startsWith("export function dropLoadRecords"));
      const last = first >= 0 ? lines.findIndex((l, i) => i > first && l === "}") : -1;
      return lines.flatMap((line, i) => {
        const isInDrop = first >= 0 && i >= first && i <= last;
        const isTouch = LOAD_RECORDS.test(line) && !isComment(line) && !isInDrop;
        return isTouch ? [`${relative(ROOT, path)}:${i + 1}: ${line.trim()}`] : [];
      });
    });
    expect(touching).toEqual([]);
  });
});
