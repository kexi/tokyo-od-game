import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");
type Entry = {
  id: string;
  lon: number;
  lat: number;
  heading: number;
  height: number;
  model: string;
  farModel: string;
  footprint: Array<[number, number]>;
  plateau?: Array<{ gmlId: string; hide: boolean }>;
  solid?: boolean;
  widenFar?: boolean;
  sources: string[];
};
const entries = JSON.parse(readFileSync(join(PUBLIC, "data", "landmarks.json"), "utf8")) as Entry[];
/** scripts/blender/data: the PLATEAU LOD1 triangle centroids round the buildings whose copy is cut out. */
const plateau = JSON.parse(
  readFileSync(join(ROOT, "scripts", "blender", "data", "plateau_lod1_major_buildings.json"), "utf8"),
) as { sites: Record<string, { hide: string[]; buildings: Record<string, Array<[number, number]>> }> };

const MAJOR = ["tokyo_tocho", "national_diet", "tokyo_intl_exhibition", "national_stadium"];
const major = MAJOR.map((id) => {
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error(`${id} is not in landmarks.json`);
  return e;
});

/** Ground distance in metres (equirectangular: plenty for a few hundred metres). */
const metres = (a: [number, number], b: { lon: number; lat: number }) =>
  Math.hypot((a[0] - b.lon) * 111_320 * Math.cos((b.lat * Math.PI) / 180), (a[1] - b.lat) * 110_540);

/** The even–odd test of src/world/buildings.ts cutFootprints (a triangle goes when its centroid is in). */
function isInside(ring: Array<[number, number]>, x: number, y: number): boolean {
  let isIn = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    const crosses = ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax;
    if (crosses) isIn = !isIn;
  }
  return isIn;
}

describe("the four major buildings in landmarks.json", () => {
  it("each has its near and far model on disk", () => {
    for (const e of major) {
      expect(existsSync(join(PUBLIC, e.model)), e.model).toBe(true);
      expect(existsSync(join(PUBLIC, e.farModel)), e.farModel).toBe(true);
    }
  });

  it("stands on its own footprint and credits OpenStreetMap", () => {
    for (const e of major) {
      expect(e.footprint.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.heading, e.id).toBeGreaterThanOrEqual(0);
      expect(e.heading, e.id).toBeLessThan(360);
      const farthest = Math.max(...e.footprint.map((p) => metres(p, e)));
      expect(farthest, e.id).toBeLessThan(400);
      expect(e.sources.join(" "), e.id).toContain("OpenStreetMap");
    }
  });

  it("keeps the heights their owners publish", () => {
    const height = Object.fromEntries(major.map((e) => [e.id, e.height]));
    expect(height).toEqual({
      tokyo_tocho: 243.4, // 東京都財務局
      national_diet: 65.45, // 衆議院・参議院
      tokyo_intl_exhibition: 58,
      national_stadium: 47.35, // JIA 設計概要
    });
  });

  it("keeps the low, wide ones from widening far away (only the tall Tocho may)", () => {
    for (const id of ["national_diet", "tokyo_intl_exhibition", "national_stadium"]) {
      expect(major.find((e) => e.id === id)?.widenFar, id).toBe(false);
    }
  });

  it("gives the National Diet Building walls although PLATEAU has no copy of it", () => {
    const diet = major.find((e) => e.id === "national_diet");
    expect(diet?.plateau).toEqual([]);
    expect(diet?.solid).toBe(true);
  });
});

describe("cutting the PLATEAU copies out (LOD1, the tiles the game streams)", () => {
  /**
   * Neighbours whose walls are the replaced building's own walls (the same triangles, so the centroid
   * test cannot keep one and drop the other). Each is a wall quad or two facing the exhibition plaza.
   */
  const SHARED_WALLS: Record<string, Record<string, number>> = {
    tokyo_tocho: {},
    tokyo_intl_exhibition: {
      "bldg_a1f49e72-e24c-4369-a9bc-d8c7cb92a289": 4,
      "bldg_bae855e3-12f7-48b3-b325-9e1d93173c00": 2,
    },
    national_stadium: {},
  };

  for (const [id, shared] of Object.entries(SHARED_WALLS)) {
    it(`${id}: leaves none of the replaced building and cuts no neighbour beyond its shared walls`, () => {
      const e = major.find((x) => x.id === id);
      const site = plateau.sites[id];
      expect(e?.plateau?.map((p) => p.gmlId)).toEqual(site.hide);
      let left = 0;
      const cut: Record<string, number> = {};
      for (const [gmlId, centroids] of Object.entries(site.buildings)) {
        const n = centroids.filter(([x, y]) => isInside(e!.footprint, x, y)).length;
        const isReplaced = site.hide.includes(gmlId);
        if (isReplaced) left += centroids.length - n;
        else if (n > 0) cut[gmlId] = n;
      }
      expect(left).toBe(0);
      expect(cut).toEqual(shared);
    });
  }
});
