import { describe, expect, it } from "vitest";
import {
  defaultGraphics,
  GRAPHICS_ITEMS,
  parseGraphics,
  PRESETS,
  withItem,
  withPreset,
} from "../src/graphics";

describe("画質", () => {
  it("starts on 高 on a computer and 低 on a phone", () => {
    expect(defaultGraphics(false).preset).toBe("high");
    expect(defaultGraphics(true).preset).toBe("low");
  });

  it("gives every preset a valid option for every item", () => {
    for (const preset of Object.values(PRESETS))
      for (const item of GRAPHICS_ITEMS) expect(item.options.map((o) => o.value)).toContain(preset[item.key]);
  });

  it("turns カスタム when an item is changed by hand, and back when it matches a preset again", () => {
    const custom = withItem(withPreset("high"), "bloom", "off");
    expect(custom.preset).toBe("custom");
    expect(custom.bloom).toBe("off");
    expect(withItem(custom, "bloom", "high").preset).toBe("high");
  });

  it("ignores unknown values, stored or chosen", () => {
    expect(withItem(withPreset("medium"), "shadows", "8192").shadows).toBe("1024");
    const parsed = parseGraphics({ shadows: "huge", bloom: "low", resolution: 3 }, false);
    expect(parsed.shadows).toBe(defaultGraphics(false).shadows);
    expect(parsed.bloom).toBe("low");
    expect(parseGraphics(null, true)).toEqual(defaultGraphics(true));
  });
});
