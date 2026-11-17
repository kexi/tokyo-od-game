import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultGraphics,
  GRAPHICS_ITEMS,
  NON_PRESET,
  needsReload,
  parseGraphics,
  PRESET_ITEMS,
  PRESETS,
  SHADER_PREBUILD_DEFAULT,
  withItem,
  withPreset,
} from "../src/graphics";
import { en } from "../src/i18n/en";
import { ja } from "../src/i18n/ja";
import { zh } from "../src/i18n/zh";

describe("画質", () => {
  it("starts on 高 on a computer and 低 on a phone", () => {
    expect(defaultGraphics(false).preset).toBe("ultra");
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

  describe("レンズフレア", () => {
    it("is a row of its own, on or off, right after the bloom", () => {
      const keys = GRAPHICS_ITEMS.map((i) => i.key);
      const row = GRAPHICS_ITEMS.find((i) => i.key === "lensFlare");
      expect(row?.label).toBe("graphics.lensFlare");
      expect([ja["graphics.lensFlare"], en["graphics.lensFlare"], zh["graphics.lensFlare"]]).toEqual([
        "レンズフレア",
        "Lens flare",
        "镜头光晕",
      ]);
      expect(row?.options.map((o) => o.value)).toEqual(["on", "off"]);
      expect(row?.onReload).toBeUndefined();
      expect(keys.indexOf("lensFlare")).toBe(keys.indexOf("bloom") + 1);
    });

    it("is on in 最高 and 高, off in 中 and 低 (and so on a phone)", () => {
      expect(PRESETS.ultra.lensFlare).toBe("on");
      expect(PRESETS.high.lensFlare).toBe("on");
      expect(PRESETS.medium.lensFlare).toBe("off");
      expect(PRESETS.low.lensFlare).toBe("off");
      expect(defaultGraphics(false).lensFlare).toBe("on");
      expect(defaultGraphics(true).lensFlare).toBe("off");
    });

    it("turns 高 into カスタム when switched off, and settings stored before it existed keep 高", () => {
      expect(withItem(withPreset("high"), "lensFlare", "off").preset).toBe("custom");
      const { lensFlare: _, ...before } = withPreset("high");
      const parsed = parseGraphics(before, false);
      expect(parsed.lensFlare).toBe("on");
      expect(parsed.preset).toBe("high");
    });
  });

  describe("描画方式", () => {
    it("starts on 自動 (WebGPU where the browser has it), on a phone too", () => {
      expect(defaultGraphics(false).backend).toBe("auto");
      expect(defaultGraphics(true).backend).toBe("auto");
    });

    it("is a row of its own that takes effect on reload", () => {
      const row = GRAPHICS_ITEMS.find((i) => i.key === "backend");
      expect(row?.label).toBe("graphics.backend");
      expect([ja["graphics.backend"], en["graphics.backend"], zh["graphics.backend"]]).toEqual([
        "描画方式",
        "Renderer",
        "渲染方式",
      ]);
      expect(row?.onReload).toBe(true);
      expect(row?.options.map((o) => o.value)).toEqual(["auto", "webgl"]);
    });

    it("says in every language which backend is running, and why WebGL 2 when it is", () => {
      const keys = [
        "graphics.running",
        "graphics.runningWebgpu",
        "graphics.runningWebglAsked",
        "graphics.runningWebglFallback",
      ] as const;
      for (const dict of [ja, en, zh]) for (const key of keys) expect(dict[key]).toBeTruthy();
      for (const dict of [ja, en, zh]) expect(dict["graphics.running"]).toContain("{backend}");
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

  describe("シェーダーの事前作成", () => {
    it("starts on 先に作る on a computer and a phone, from the one default constant", () => {
      expect(SHADER_PREBUILD_DEFAULT).toBe("on");
      expect(defaultGraphics(false).shaderPrebuild).toBe(SHADER_PREBUILD_DEFAULT);
      expect(defaultGraphics(true).shaderPrebuild).toBe(SHADER_PREBUILD_DEFAULT);
    });

    it("reads settings stored before it existed as 先に作る, keeping their preset, and an unknown value too", () => {
      const { shaderPrebuild: _, ...before } = withPreset("medium");
      const parsed = parseGraphics(before, false);
      expect(parsed.shaderPrebuild).toBe("on");
      expect(parsed.preset).toBe("medium");
      expect(parseGraphics({ shaderPrebuild: "maybe" }, true).shaderPrebuild).toBe("on");
      expect(parseGraphics({ shaderPrebuild: "off" }, true).shaderPrebuild).toBe("off");
    });

    it("is not a quality level: off keeps the preset, a preset keeps off, and 描画方式 stays too", () => {
      const off = withItem(withPreset("high"), "shaderPrebuild", "off");
      expect(off.shaderPrebuild).toBe("off");
      expect(off.preset).toBe("high");
      const both = withItem(off, "backend", "webgl");
      for (const preset of ["ultra", "high", "medium", "low"] as const) {
        const chosen = withPreset(preset, both);
        expect(chosen.shaderPrebuild).toBe("off");
        expect(chosen.backend).toBe("webgl");
        expect(chosen.preset).toBe(preset);
      }
      expect(PRESET_ITEMS.map((i) => i.key)).not.toContain("shaderPrebuild");
    });

    it("lists every row outside the presets in the defaults a preset keeps", () => {
      // A row marked inPreset: false but missing from NON_PRESET would be reset by every preset.
      const outside = GRAPHICS_ITEMS.filter((i) => i.inPreset === false).map((i) => i.key);
      expect(Object.keys(NON_PRESET).toSorted()).toEqual(outside.toSorted());
    });

    it("is a row that takes effect on reload, with both choices named in every language", () => {
      const row = GRAPHICS_ITEMS.find((i) => i.key === "shaderPrebuild");
      expect(row?.onReload).toBe(true);
      expect(row?.inPreset).toBe(false);
      expect(row?.options.map((o) => o.value)).toEqual(["on", "off"]);
      const keys = [
        "graphics.shaderPrebuild",
        "graphics.shaderPrebuildOn",
        "graphics.shaderPrebuildOff",
      ] as const;
      for (const dict of [ja, en, zh]) for (const key of keys) expect(dict[key], key).toBeTruthy();
      expect(ja["graphics.reloadNote"]).toContain(ja["graphics.shaderPrebuild"]);
    });

    it("asks for a reload once changed, and not when changed back", () => {
      const loaded = defaultGraphics(false);
      const off = withItem(loaded, "shaderPrebuild", "off");
      expect(needsReload(loaded, off)).toBe(true);
      expect(needsReload(loaded, withItem(off, "shaderPrebuild", "on"))).toBe(false);
      // A row that applies at once does not ask (the panel's 再読み込み stays hidden).
      expect(needsReload(loaded, withItem(loaded, "bloom", "off"))).toBe(false);
    });
  });
});

const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

describe("the loading screen and シェーダーの事前作成 (src/main.ts)", () => {
  const main = read("src/main.ts");
  const body = (name: string) => {
    const start = main.indexOf(`const ${name} = async (): Promise<void> => {`);
    expect(start, name).toBeGreaterThan(-1);
    return main.slice(start, main.indexOf("\n  };", start));
  };

  it("reads the setting once, when the page loads, not each frame", () => {
    expect(main).toMatch(/const isShaderPrebuild = GRAPHICS\.settings\.shaderPrebuild === "on";/);
    expect(main.match(/settings\.shaderPrebuild/g)).toHaveLength(1);
  });

  it("calls precompile only through prepareForPlay, and only when the setting is on", () => {
    // main.ts's own precompile, not composer.precompile() / cockpit.precompile(…).
    expect(main.match(/(?<![.\w])precompile\(\)/g)).toHaveLength(1);
    const prepare = body("prepareForPlay");
    const skip = prepare.indexOf("if (!isShaderPrebuild)");
    const ret = prepare.indexOf("return;", skip);
    expect(skip).toBeGreaterThan(-1);
    expect(prepare.indexOf('log("pipelines_skipped"')).toBeGreaterThan(skip);
    expect(prepare.indexOf("precompile()")).toBeGreaterThan(ret);
    // The "building shaders" line shows only on the way that builds them.
    expect(prepare.indexOf('"loading.shaders"')).toBeGreaterThan(ret);
  });

  it("never stops short of 始められる: a failed precompile is caught, and ready follows either way", () => {
    expect(body("prepareForPlay")).toMatch(/await precompile\(\)\.catch\(/);
    expect(main).toMatch(
      /compiling = prepareForPlay\(\)\.finally\(\(\) => \{\s*state = "ready";\s*startButton\.disabled = false;/,
    );
  });

  it("keeps what precompile builds, the witnesses included", () => {
    const pre = body("precompile");
    expect(pre).toContain("renderer.compileAsync(scene, eye)");
    expect(pre).toContain("cockpit.precompile(");
    expect(pre).toContain("composer.precompile()");
    expect(pre).toContain("prewarmWitnesses()");
    expect(pre).toContain('log("pipelines_compiled"');
  });
});
