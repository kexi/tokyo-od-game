import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import {
  LandmarkFileSchema,
  landmarkPlaces,
  hiddenFootprints,
  LandmarkEntrySchema,
  walledFootprints,
  type LandmarkEntry,
} from "../src/world/landmarkEntry";
import { keepOnlyNode, parseLandmarks } from "../src/world/landmarks";

// Invariants every landmark entry keeps, whichever script wrote it. Checks of one landmark's own
// shape, heights or lighting belong in that landmark's test file (knowledge/landmarks-blender.md).

const PUBLIC = join(import.meta.dirname, "..", "public");
const raw: unknown = JSON.parse(readFileSync(join(PUBLIC, "data", "landmarks.json"), "utf8"));
const entries = LandmarkFileSchema.parse(raw);

/** Node names in a .glb's JSON chunk (header 12 bytes, then the chunk's length and type). */
function glbNodeNames(file: string): string[] {
  const bytes = readFileSync(file);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as {
    nodes?: Array<{ name?: string }>;
  };
  return (json.nodes ?? []).map((n) => n.name ?? "");
}

/**
 * Keys a landmark keeps for itself, by id (e.g. rainbow_bridge: ["deckLevels"]). The game reads the
 * file loosely; this register makes a new key a decision: here, or in landmarkEntry.ts if shared.
 */
const OWN_KEYS: Record<string, readonly string[]> = {
  rainbow_bridge: ["deckLevels"],
  national_diet: ["plateauNote"], // scripts/blender/major_buildings.py: why it hides nothing (PLATEAU has no copy)
};

const ring = (lon: number): Array<[number, number]> => [
  [lon, 35],
  [lon + 0.001, 35],
  [lon, 35.001],
];

describe("landmarks.json: invariants of every entry", () => {
  it("matches the schema the game parses it with, and the game keeps every entry", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(parseLandmarks(raw)).toHaveLength(entries.length);
  });

  it("gives every landmark an id of its own", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size, ids.join(", ")).toBe(ids.length);
  });

  it("points at model files that exist", () => {
    const missing = entries
      .flatMap((e) => [e.model, e.farModel])
      .filter((path) => !existsSync(join(PUBLIC, path)));
    expect(missing).toEqual([]);
  });

  it("has footprint rings of three points or more", () => {
    for (const e of entries)
      for (const r of [e.footprint, ...(e.extraFootprints ?? [])])
        expect(r.length, e.id).toBeGreaterThanOrEqual(3);
  });

  it("names a near node the near file has and a far node the far file has", () => {
    for (const e of entries) {
      expect(glbNodeNames(join(PUBLIC, e.model)), e.id).toContain(e.nodes.near);
      expect(glbNodeNames(join(PUBLIC, e.farModel)), e.id).toContain(e.nodes.far);
    }
  });

  it("uses only the schema's keys and the keys registered for that landmark", () => {
    const known = new Set(Object.keys(LandmarkEntrySchema.shape));
    const unknown = entries.flatMap((e) => {
      const own = new Set(OWN_KEYS[e.id] ?? []);
      return Object.keys(e)
        .filter((k) => !known.has(k) && !own.has(k))
        .map((k) => `${e.id}.${k}`);
    });
    expect(unknown).toEqual([]);
  });

  it("names its light modes for every mode its schedule switches to", () => {
    for (const e of entries) {
      const modes = new Set(e.lightModes.map((m) => m.id));
      const s = e.lightSchedule;
      const used = [s.after, ...(s.rules ?? []).map((r) => r.mode), ...(s.cycle?.modes ?? [])];
      for (const mode of used) expect(modes, `${e.id}: ${mode}`).toContain(mode);
    }
  });
});

/** A loaded near file as landmarks.py writes it (root → near + far node), with a stray node beside. */
function nearFile() {
  const scene = new Group();
  const root = new Group();
  root.name = "TokyoTower";
  const near = new Mesh();
  near.name = "TokyoTower_Near";
  const far = new Mesh();
  far.name = "TokyoTower_Far";
  root.add(near, far);
  const stray = new Mesh();
  stray.name = "Stray";
  scene.add(root, stray);
  return { scene, root, near };
}

describe("keeping only the near node of a near file (keepOnlyNode)", () => {
  it("drops the far node and anything else beside the near node's branch", () => {
    const { scene, root, near } = nearFile();
    expect(keepOnlyNode(scene, "TokyoTower_Near")).toBe(true);
    expect(scene.children).toEqual([root]);
    expect(root.children).toEqual([near]);
  });

  it("changes nothing and says so when the node is not there", () => {
    const { scene } = nearFile();
    expect(keepOnlyNode(scene, "Nowhere_Near")).toBe(false);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0]?.children).toHaveLength(2);
  });
});

describe("the footprints the buildings leave out and wall off (hiddenFootprints / walledFootprints)", () => {
  const hides = [{ gmlId: "a", hide: true }];
  const keeps = [{ gmlId: "a", hide: false }];
  const extra = [ring(139.8), ring(139.9)];
  // Fixtures shaped like the landmarks on their way in (the review's cases).
  const tower = { footprint: ring(139.7), plateau: hides }; // hides its PLATEAU copy
  const skytree = { footprint: ring(139.71), plateau: keeps }; // its PLATEAU block stays
  const diet = { footprint: ring(139.72), solid: true }; // nothing in PLATEAU to hide, walls wanted
  const hotel = { footprint: ring(139.73), plateau: hides, extraFootprints: [ring(139.74)] };
  const bridge = { footprint: ring(139.75), solid: false, extraFootprints: extra }; // bbox footprint

  it("cuts and walls the footprint of a landmark that hides a PLATEAU building", () => {
    expect(hiddenFootprints([tower])).toEqual([tower.footprint]);
    expect(walledFootprints([tower])).toEqual([tower.footprint]);
  });

  it("neither cuts nor walls a landmark whose PLATEAU building stays", () => {
    expect(hiddenFootprints([skytree])).toEqual([]);
    expect(walledFootprints([skytree])).toEqual([]);
  });

  it("only walls a solid landmark with nothing to hide", () => {
    expect(hiddenFootprints([diet])).toEqual([]);
    expect(walledFootprints([diet])).toEqual([diet.footprint]);
  });

  it("cuts and walls both rings of a hiding landmark with an extra ring", () => {
    const rings = [hotel.footprint, ...hotel.extraFootprints];
    expect(hiddenFootprints([hotel])).toEqual(rings);
    expect(walledFootprints([hotel])).toEqual(rings);
  });

  it("cuts the extra rings of a landmark with solid: false, walls nothing, and leaves its footprint alone", () => {
    expect(hiddenFootprints([bridge])).toEqual(extra);
    expect(walledFootprints([bridge])).toEqual([]);
  });

  it("cuts and walls every shipped entry by the documented rule (hide → cut, solid ?? hide → wall, extras follow)", () => {
    // Stated over the real landmarks.json so a new entry cannot slip past the contract; the fixtures
    // above pin each shape (tower, Diet, east hotel, bridge) on its own.
    const hidesPlateau = (e: (typeof entries)[number]) => e.plateau?.some((p) => p.hide) ?? false;
    const cut = entries.flatMap((e) => [...(hidesPlateau(e) ? [e.footprint] : []), ...(e.extraFootprints ?? [])]);
    const walled = entries.flatMap((e) =>
      (e.solid ?? hidesPlateau(e)) ? [e.footprint, ...(e.extraFootprints ?? [])] : [],
    );
    expect(hiddenFootprints(entries)).toEqual(cut);
    expect(walledFootprints(entries)).toEqual(walled);
  });
});

describe("the landmarks offered as warps and destinations (landmarkPlaces)", () => {
  const entry: Pick<LandmarkEntry, "name" | "lon" | "lat"> = { name: "橋", lon: 139.76, lat: 35.63 };

  it("lands at the landmark's own point by default", () => {
    expect(landmarkPlaces([entry], "ランドマーク")).toEqual([
      { name: "橋", kind: "ランドマーク", lat: 35.63, lon: 139.76 },
    ]);
  });

  it("lands at warpAt when the entry gives one", () => {
    const [place] = landmarkPlaces([{ ...entry, warpAt: [139.77, 35.64] }], "k");
    expect(place).toMatchObject({ lat: 35.64, lon: 139.77 });
  });

  it("leaves out a landmark excluded from warps", () => {
    expect(landmarkPlaces([{ ...entry, excludeFromWarp: true }], "k")).toEqual([]);
  });

  it("offers every entry without warpAt at its lon/lat, as before", () => {
    const plain = entries.filter((e) => e.warpAt === undefined && e.excludeFromWarp !== true);
    expect(landmarkPlaces(plain, "k")).toEqual(
      plain.map((e) => ({ name: e.name, kind: "k", lat: e.lat, lon: e.lon })),
    );
  });
});

describe("reading landmarks.json in the game (parseLandmarks)", () => {
  it("leaves out a malformed entry and keeps the others", () => {
    const broken = { ...entries[0], id: "broken", footprint: [[139.7, 35.6]] };
    const parsed = parseLandmarks([broken, ...entries]);
    expect(parsed.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  it("keeps fields the schema does not know (a landmark's own data)", () => {
    const [parsed] = parseLandmarks([{ ...entries[0], deckLevels: [1, 2] }]);
    expect(parsed).toHaveProperty("deckLevels", [1, 2]);
  });
});
