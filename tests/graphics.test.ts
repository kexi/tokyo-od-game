import { describe, expect, it } from "vitest";
import {
  defaultGraphics,
  GRAPHICS_ITEMS,
  parseGraphics,
  PRESET_ITEMS,
  PRESETS,
  withItem,
  withPreset,
} from "../src/graphics";

describe("画質", () => {
  it("starts on 高 on a computer and 低 on a phone", () => {
    expect(defaultGraphics(false).preset).toBe("high");
    expect(defaultGraphics(true).preset).toBe("low");
  });

  it("gives every preset a valid option for every item it sets", () => {
    for (const preset of Object.values(PRESETS))
      for (const item of PRESET_ITEMS) expect(item.options.map((o) => o.value)).toContain(preset[item.key]);
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

  describe("描画方式", () => {
    it("starts on 自動 (WebGPU where the browser has it), on a phone too", () => {
      expect(defaultGraphics(false).backend).toBe("auto");
      expect(defaultGraphics(true).backend).toBe("auto");
    });

    it("is a row of its own that takes effect on reload", () => {
      const row = GRAPHICS_ITEMS.find((i) => i.key === "backend");
      expect(row?.label).toBe("描画方式");
      expect(row?.onReload).toBe(true);
      expect(row?.options.map((o) => o.value)).toEqual(["auto", "webgl"]);
    });

    it("is not a quality level: WebGL 2 keeps the preset, and a preset keeps WebGL 2", () => {
      const webgl = withItem(withPreset("high"), "backend", "webgl");
      expect(webgl.backend).toBe("webgl");
      expect(webgl.preset).toBe("high");
      const low = withPreset("low", webgl);
      expect(low.backend).toBe("webgl");
      expect(low.shadows).toBe("off");
    });

    it("is remembered, and an unknown stored value falls back to 自動", () => {
      expect(parseGraphics({ backend: "webgl" }, false).backend).toBe("webgl");
      expect(parseGraphics({ backend: "vulkan" }, false).backend).toBe("auto");
      expect(parseGraphics({ backend: "webgl", bloom: "low" }, false).preset).toBe("custom");
    });
  });
});
