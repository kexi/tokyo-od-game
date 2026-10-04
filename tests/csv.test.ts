import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeJapanese,
  findColumn,
  parseCsv,
  toNumber,
  wardFromAddress,
  wardFromCode,
} from "../scripts/csv";
import { PoiFileSchema } from "../src/data/schema";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and newlines inside quoted headers", () => {
    const rows = parseCsv('"区市町村\nコード",名称\r\n131041,"新宿中央公園, ""ふれあい"""\n');
    expect(rows).toEqual([
      ["区市町村\nコード", "名称"],
      ["131041", '新宿中央公園, "ふれあい"'],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n,\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("decodeJapanese", () => {
  it("decodes UTF-8 with BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("緯度")]);
    expect(decodeJapanese(bytes)).toBe("緯度");
  });

  it("falls back to Shift_JIS when the bytes are not valid UTF-8", () => {
    // "東京" in Shift_JIS
    expect(decodeJapanese(new Uint8Array([0x93, 0x8c, 0x8b, 0x9e]))).toBe("東京");
  });
});

describe("ward detection", () => {
  it("reads 23-ward codes with or without check digit", () => {
    expect(wardFromCode("131041")).toBe("新宿区");
    expect(wardFromCode("13123")).toBe("江戸川区");
    expect(wardFromCode("132012")).toBeNull(); // 八王子市
  });

  it("matches the ward at the start of an address only", () => {
    expect(wardFromAddress("東京都北区王子1-1")).toBe("北区");
    expect(wardFromAddress("台東区北上野2-1")).toBe("台東区");
    expect(wardFromAddress("東京都 中央区 銀座")).toBe("中央区");
    expect(wardFromAddress("八王子市元本郷町")).toBeNull();
  });

  it("finds columns by exact name before substring", () => {
    expect(findColumn(["名称_カナ", "名称", "緯度"], ["名称"])).toBe(1);
    expect(findColumn(["施設名称", "経度"], ["名称"])).toBe(0);
  });

  it("parses full-width digits", () => {
    expect(toNumber("３５．６８")).toBeCloseTo(35.68, 6);
    expect(Number.isNaN(toNumber(""))).toBe(true);
  });
});

describe("generated public/data/pois.json", () => {
  const file = PoiFileSchema.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "data", "pois.json"), "utf8")),
  );

  it("only contains 23-ward points inside the Tokyo bounding box", () => {
    for (const [, lat, lon, name, ward] of file.items) {
      expect(lat).toBeGreaterThan(35.48);
      expect(lat).toBeLessThan(35.84);
      expect(lon).toBeGreaterThan(139.55);
      expect(lon).toBeLessThan(139.93);
      expect(name.length).toBeGreaterThan(0);
      expect(ward).toMatch(/区$/);
    }
  });

  it("credits every source with a licence and every item references a source", () => {
    // Wording required by the Tokyo open-data terms (利用規約 2(1)).
    for (const s of file.sources) expect(s.license).toBe("クリエイティブ・コモンズ・ライセンス 表示4.0国際");
    for (const item of file.items) expect(file.sources[item[5]]).toBeDefined();
  });

  it("covers all 23 wards", () => {
    expect(new Set(file.items.map((i) => i[4])).size).toBe(23);
  });
});
