import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hiddenFootprints, walledFootprints } from "../src/world/landmarkEntry";
import { lightMode, type LandmarkEntry } from "../src/world/landmarks";

// The buildings around Tokyo Tower (scripts/blender/tower_area.py, knowledge/tokyo-tower-surroundings-blender.md).
const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");
const LANDMARKS_JSON = readFileSync(join(PUBLIC, "data", "landmarks.json"), "utf8");
const entries = JSON.parse(LANDMARKS_JSON) as LandmarkEntry[];
const IDS = [
  "shiba_park_hotel_east",
  "shiba_park_hotel_south",
  "tower_north_hall",
  "zojoji_daiden",
  "zojoji_sangedatsumon",
];
const around = entries.filter((e) => IDS.includes(e.id));
const byId = (id: string) => around.find((e) => e.id === id) as LandmarkEntry;

/**
 * Names of the real facilities and their operators that must not reach the player: the hotels' and the
 * hall's own names, in Japanese and in Latin letters, and the short forms once used as identifiers.
 * 増上寺 stays (a temple's name, as 東京駅 and 東京タワー do).
 */
const BANNED = [
  /prince/i,
  /プリンス/,
  /park ?tower/i,
  /パークタワー/,
  /kikai/i,
  /shinko/i,
  /機械振興/,
  /西武/,
  /seibu/i,
];

/** A Tuesday in November at hour h (JST). */
const at = (h: number) => ({ y: 2026, m: 11, d: 10, weekday: 2, minutes: h * 60 });

/** The JSON chunk of a glb: node, mesh, material and image names live there. */
function glbJson(file: string): string {
  const b = readFileSync(file);
  const length = b.readUInt32LE(12);
  return b.subarray(20, 20 + length).toString("utf8");
}

describe("the buildings around Tokyo Tower", () => {
  it("keep their far silhouettes unwidened (low and broad, unlike the towers)", () => {
    for (const e of around) expect(e.widenFar, e.id).toBe(false);
  });

  it("are all in landmarks.json, each within 600 m of the tower", () => {
    const tower = entries.find((e) => e.id === "tokyo_tower") as LandmarkEntry;
    expect(around.map((e) => e.id).toSorted()).toEqual(IDS);
    for (const e of around) {
      const metres = Math.hypot(
        (e.lon - tower.lon) * 111_320 * Math.cos((tower.lat * Math.PI) / 180),
        (e.lat - tower.lat) * 110_950,
      );
      expect(metres, e.id).toBeLessThan(600);
    }
  });

  it("go by generic names: no facility, company or organisation name in the data, models or textures", () => {
    const shipped: Array<[string, string]> = [["landmarks.json", LANDMARKS_JSON]];
    for (const e of around) {
      for (const path of [e.model, e.farModel]) shipped.push([path, glbJson(join(PUBLIC, path))]);
    }
    for (const name of readdirSync(join(ROOT, "assets", "landmarks", "textures"))) shipped.push([name, name]);
    for (const [where, text] of shipped) {
      for (const word of BANNED) expect(text, `${where} ${word}`).not.toMatch(word);
    }
    expect(byId("shiba_park_hotel_south").name).toBe("芝公園の高層ホテル（タワーの南）");
    expect(byId("shiba_park_hotel_east").name).toBe("芝公園のホテル（タワーの東）");
    expect(byId("tower_north_hall").name).toBe("東京タワー北の会館");
  });

  it("hide and wall both PLATEAU buildings the east hotel replaces (main block and banquet wing)", () => {
    const hotel = byId("shiba_park_hotel_east");
    expect(hotel.plateau?.filter((p) => p.hide)).toHaveLength(2);
    expect(hotel.extraFootprints).toHaveLength(1);
    const rings = hiddenFootprints([hotel]);
    expect(rings).toEqual([hotel.footprint, ...(hotel.extraFootprints ?? [])]);
    expect(walledFootprints([hotel])).toEqual(rings);
    for (const r of rings) expect(r.length).toBeGreaterThanOrEqual(4);
  });

  it("light their windows after dark, dim them late, and keep them dim from 04:00 until it is light", () => {
    const hotel = byId("shiba_park_hotel_south");
    const hall = byId("tower_north_hall");
    expect(lightMode(hotel, at(19), false)).toBeNull();
    expect(lightMode(hotel, at(19), true)).toBe("evening");
    expect(lightMode(hotel, at(1), true)).toBe("lateNight");
    expect(lightMode(hotel, at(5), true)).toBe("lateNight");
    expect(lightMode(hall, at(19), true)).toBe("evening");
    expect(lightMode(hall, at(22), true)).toBe("afterHours");
    expect(lightMode(hall, at(5.5), true)).toBe("afterHours");
    expect(lightMode(byId("zojoji_daiden"), at(20), true)).toBe("nightGlow");
  });
});
