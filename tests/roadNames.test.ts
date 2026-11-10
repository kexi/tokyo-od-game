import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  displayPlace,
  facilityName,
  facilityNameEn,
  hasOperatorWord,
  isExpresswayName,
  OPERATOR_PATTERNS,
  routeName,
  routeSymbol,
  routeSymbolOf,
} from "../src/game/roadNames";
import { ja } from "../src/i18n/ja";
import { en } from "../src/i18n/en";

const ROOT = join(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/** Each line of a file naming the real operator, as "file:line: text". */
function operatorLines(files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (OPERATOR_PATTERNS.some((p) => p.test(line)))
          hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
  }
  return hits;
}

describe("名称層（src/game/roadNames.ts、knowledge/road-redesign-plan.md 4.8）", () => {
  it("keeps the real operator's name out of every source file but the name layer itself", () => {
    const sources = filesUnder(join(ROOT, "src")).filter(
      (f) => /\.(ts|tsx|css|html)$/.test(f) && !f.endsWith(join("src", "game", "roadNames.ts")),
    );
    expect(operatorLines(sources)).toEqual([]);
  });

  /**
   * Data that keeps the real names as OSM / the police data write them, each shown only through
   * displayPlace (the name layer replaces the operator at the point of display): regenerating
   * them without the names would lose the place they name (「…銀座入口」 is the entrance).
   */
  const KEEPS_REAL_NAMES: ReadonlyArray<{ path: RegExp; why: string }> = [
    { path: /^public\/data\/police\.json$/, why: "orbis の道路名（表示に使わない）" },
    {
      path: /^public\/data\/routes\/\d+-\d+\.json$/,
      why: "OSM の destination（guidePlan.localDests が displayPlace）",
    },
    {
      path: /^public\/data\/junctions\/\d+-\d+\.json$/,
      why: "交差点名（regulations.ts の junctionNames が displayPlace）",
    },
  ];

  it("keeps it out of public/data but for the files the name layer shows through displayPlace", () => {
    const files = filesUnder(join(ROOT, "public", "data")).filter((f) => /\.(json|txt|csv|geojson)$/.test(f));
    expect(files.length).toBeGreaterThan(2);
    const isKept = (line: string) => KEEPS_REAL_NAMES.some((k) => k.path.test(line.split(":")[0]));
    expect(operatorLines(files).filter((l) => !isKept(l))).toEqual([]);
    // The list names what is there: every kept file kind still has a real name (else drop it).
    for (const k of KEEPS_REAL_NAMES)
      expect(
        operatorLines(files).some((l) => k.path.test(l.split(":")[0])),
        k.why,
      ).toBe(true);
  });

  it("keeps the expressway data (tiles, meta.json, the licence notice) wholly free of it", () => {
    const files = filesUnder(join(ROOT, "public", "data", "expressway"));
    expect(files.length).toBeGreaterThan(2);
    expect(operatorLines(files)).toEqual([]);
  });

  it("names the operator by the fictional 都市高速, in both languages, never a real name", () => {
    expect(ja["guide.operator"]).toBe("都市高速");
    expect(hasOperatorWord(ja["guide.operator"])).toBe(false);
    expect(hasOperatorWord(en["guide.operator"])).toBe(false);
  });

  it("strips the operator off route names and drops what still names it", () => {
    expect(routeName("首都高速都心環状線")).toBe("都心環状線");
    expect(routeName("首都高速1号羽田線")).toBe("1号羽田線");
    expect(routeName("Shuto Expressway Route 1 Haneda Line")).toBe("Route 1 Haneda Line");
    expect(routeName("首都高")).toBeNull();
    expect(routeName("")).toBeNull();
    expect(routeName("芝公園出口")).toBe("芝公園出口");
  });

  it("gives an exit's or entrance's own name without 出口・入口, and a JCT with its JCT", () => {
    expect(facilityName("芝公園出口")).toBe("芝公園");
    expect(facilityName("首都高速 芝公園入口")).toBe("芝公園");
    expect(facilityName("浜崎橋JCT")).toBe("浜崎橋JCT");
    expect(facilityNameEn("Shibakoen Exit")).toBe("Shibakoen");
  });

  it("reads a route symbol in the 118の3 form from the ref, or from the number of the name", () => {
    expect(routeSymbol("C1")).toBe("C1");
    expect(routeSymbol("11")).toBe("11");
    expect(routeSymbol("首都高 1")).toBeNull();
    expect(routeSymbolOf(null, "首都高速1号羽田線")).toBe("1");
    expect(routeSymbolOf(null, "都心環状線")).toBeNull();
  });

  it("shows data that names the real operator with the fictional name instead", () => {
    expect(displayPlace("首都高銀座入口")).toBe("都市高速銀座入口");
    expect(displayPlace("首都高速出入口")).toBe("都市高速出入口");
    expect(displayPlace("Shuto Expressway", "en")).toBe(en["guide.operator"]);
    expect(displayPlace("Shuto Expwy Ginza", "en")).toBe(`${en["guide.operator"]} Ginza`);
    expect(displayPlace("日比谷")).toBe("日比谷");
    // 「首都圏」 in romaji is not the operator (an account handle has it).
    expect(hasOperatorWord("shutoken_news")).toBe(false);
    expect(hasOperatorWord("shutoExpressway")).toBe(true);
    expect(hasOperatorWord("SHUTO_EXPWY")).toBe(true);
    expect(hasOperatorWord("Metropolitan_Expressway")).toBe(true);
  });

  it("tells an expressway's name for the green box on a blue board, the fictional one too", () => {
    expect(isExpresswayName("都市高速銀座入口")).toBe(true);
    expect(isExpresswayName("東名高速")).toBe(true);
    expect(isExpresswayName("浜崎橋JCT")).toBe(true);
    expect(isExpresswayName("日比谷")).toBe(false);
  });

  it("records the exception in AGENTS.md (real exit, JCT and route names; the operator fictional)", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain("都市高速");
    expect(agents).toContain("src/game/roadNames.ts");
  });
});
