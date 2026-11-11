import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UNTAGGED,
  buttonOf,
  decodeSignalTags,
  encodeSignalRecord,
  soundOf,
  type SignalNodeFacts,
} from "../src/signals/osmTags";

const NONE: SignalNodeFacts = {
  isHighwaySignal: true,
  isCrossing: false,
  awayFromJunction: false,
  button: null,
  sound: null,
  bearing: null,
};

describe("signal records in public/data/signals (src/signals/osmTags.ts)", () => {
  it("writes a plain junction signal as [lon, lat], as every record was before T3", () => {
    expect(encodeSignalRecord(139.7, 35.6, NONE)).toEqual([139.7, 35.6]);
    expect(decodeSignalTags([139.7, 35.6])).toEqual(UNTAGGED);
  });

  it("keeps lon and lat first, so readers of [lon, lat] (src/world/regulations.ts) still work", () => {
    const record = encodeSignalRecord(139.7, 35.6, {
      ...NONE,
      isCrossing: true,
      awayFromJunction: true,
      button: true,
      bearing: 90,
    });
    const [lon, lat] = record;
    expect([lon, lat]).toEqual([139.7, 35.6]);
  });

  it("reads back what it wrote: crossing, 単路, button, sound, junction-capable and bearing", () => {
    const cases: SignalNodeFacts[] = [
      { ...NONE, isCrossing: true, awayFromJunction: true, button: true },
      {
        ...NONE,
        isHighwaySignal: false,
        isCrossing: true,
        awayFromJunction: true,
        button: false,
        sound: true,
      },
      { ...NONE, isHighwaySignal: false, isCrossing: true, sound: false },
      { ...NONE, awayFromJunction: true, bearing: 0 },
      { ...NONE, bearing: 271 },
    ];
    for (const facts of cases) {
      const tags = decodeSignalTags(encodeSignalRecord(1, 2, facts));
      expect(tags.crossing).toBe(facts.isCrossing);
      expect(tags.midBlock).toBe(facts.isCrossing && facts.awayFromJunction);
      expect(tags.awayFromJunction).toBe(facts.awayFromJunction);
      expect(tags.junctionCapable).toBe(facts.isHighwaySignal);
      expect(tags.button).toBe(facts.button);
      expect(tags.sound).toBe(facts.sound);
      expect(tags.bearing).toBe(facts.bearing);
    }
  });

  it("reads OSM's values: button_operated yes/no only (night is not a push-button plan), sound yes/walk (locate is only a locator tone)", () => {
    expect([buttonOf({ button_operated: "yes" }), buttonOf({ button_operated: "no" })]).toEqual([
      true,
      false,
    ]);
    expect([buttonOf({ button_operated: "night" }), buttonOf({})]).toEqual([null, null]);
    for (const v of ["yes", "walk"]) expect(soundOf({ "traffic_signals:sound": v })).toBe(true);
    expect(soundOf({ "traffic_signals:sound": "locate" })).toBe(null);
    expect(soundOf({ "traffic_signals:sound": "no" })).toBe(false);
    expect(soundOf({})).toBe(null);
  });

  it("the committed tiles decode: every record is [lon, lat] or carries flags the game understands", () => {
    const dir = join(import.meta.dirname, "..", "public", "data", "signals");
    const records = readdirSync(dir)
      .filter((f) => /^\d+-\d+\.json$/.test(f))
      .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as number[][]);
    expect(records.length).toBeGreaterThan(19_000);
    let midBlock = 0;
    for (const r of records) {
      expect(r.length === 2 || r.length === 3 || r.length === 4).toBe(true);
      const tags = decodeSignalTags(r);
      // A crossing-only node is kept only when it is 単路 or tells the crosswalk's sound.
      const isCrossingOnly = !tags.junctionCapable;
      if (isCrossingOnly) expect(tags.midBlock || tags.sound !== null).toBe(true);
      if (tags.midBlock) midBlock++;
    }
    expect(midBlock).toBeGreaterThan(300);
  });
});
