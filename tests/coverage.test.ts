import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import catalog from "../assets/signs/catalog.json";
import { VIOLATIONS } from "../src/game/traffic";
import { IMPORTED_CODES, JARTIC_COVERAGE } from "../src/world/coverage";

const drawn = new Map(
  (catalog.signs as Array<{ id: string; texture: string | null }>).map((s) => [s.id, s.texture]),
);

describe("漏れなく: every regulation the data holds is shown or checked", () => {
  it("lists every code the data build imports", () => {
    const build = readFileSync("scripts/regulations.ts", "utf8");
    for (const code of IMPORTED_CODES) expect(build).toContain(`"${code}"`);
    for (const code of IMPORTED_CODES) expect(JARTIC_COVERAGE[code], `code ${code}`).toBeDefined();
  });

  it("gives each code a sign, a marking or a law check — or says why not", () => {
    for (const [code, c] of Object.entries(JARTIC_COVERAGE)) {
      const hasSomething = c.signs.length + c.markings.length + c.checks.length > 0;
      expect(hasSomething, `code ${code} ${c.name}`).toBe(true);
      if (c.signs.length === 0)
        expect(c.note, `code ${code} ${c.name} has no sign and no reason`).toBeTruthy();
    }
  });

  it("has artwork for every sign it promises", () => {
    for (const [code, c] of Object.entries(JARTIC_COVERAGE))
      for (const id of c.signs) expect(drawn.get(id), `code ${code}: sign ${id}`).toBeTruthy();
  });

  it("names only law checks the game has", () => {
    for (const [code, c] of Object.entries(JARTIC_COVERAGE))
      for (const kind of c.checks)
        expect(kind in VIOLATIONS || kind === "speed", `code ${code}: ${kind}`).toBe(true);
  });
});
