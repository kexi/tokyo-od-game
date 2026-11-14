import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { chunkAt, DECK_ROUTES, DEFAULT_ROUTE, routeOf, runsOf } from "../scripts/qa/deckRoutes";

// The deck routes table (P2.7-5 4.4) against the data under test (XW_DATA_DIR, else the default
// data): every route names runs the data has, and its places lie on them, so a rebuild that moves
// or renumbers the chunks does not leave a drive that starts nowhere or never ends.
const files = readExpresswayFiles();

describe("the deck routes table", () => {
  it("has P3's route as the default and unique ids", () => {
    expect(DEFAULT_ROUTE).toBe("shibakoen-shiodome");
    expect(routeOf(DEFAULT_ROUTE).kind).toBe("cruise");
    const ids = DECK_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "auto-shibakoen-shiodome",
        "auto-shiodome-shibakoen",
        "rainbow-upper-east",
        "rainbow-upper-west",
        "rainbow-lower-east",
        "rainbow-lower-west",
        "daiba-exit",
        "azabudai-tunnel",
      ]),
    );
    expect(() => routeOf("nowhere")).toThrow(/unknown route/);
  });

  for (const r of DECK_ROUTES) {
    it(`${r.id}: its runs are in the data, it starts and ends on them`, () => {
      for (const run of runsOf(r)) expect(files.byRun.has(run), `${r.id} run ${run}`).toBe(true);
      if (r.kind === "auto") {
        expect(files.byRun.get(r.entrance)![0].cls).toBe("ramp");
        expect(Number.isFinite(r.to.lat) && Number.isFinite(r.to.lon)).toBe(true);
        return;
      }
      const from = chunkAt(files.byRun, r.from);
      expect(from, `${r.id} from`).not.toBeNull();
      expect(from!.share).toBeGreaterThanOrEqual(0);
      expect(from!.share).toBeLessThanOrEqual(1);
      expect(r.prefer).toContain(r.from.run);
      expect(r.prefer).toContain(r.to.run);
      const isStreet = "street" in r.to;
      if (isStreet) {
        // Off the decks after this run: it must end at the ground (an exit ramp), or since S6 PR 7c go
        // on at grade (a seam onto a run at grade: the street's end of the ramp is that run's).
        const run = files.runs.find((x) => x.id === r.to.run)!;
        const parent = run.end.kind === "seam" ? files.runs.find((x) => x.id === run.end.parent) : undefined;
        const isAtGround = run.end.kind === "ground" || parent?.ground === true;
        expect(isAtGround, `${run.id} end ${run.end.kind}`).toBe(true);
        return;
      }
      expect(chunkAt(files.byRun, r.to as { run: string; s: number }), `${r.id} to`).not.toBeNull();
    });
  }

  it("resolves a run distance to the chunk holding it and its share, nothing past the run", () => {
    const list = files.byRun.get("4848762")!;
    const c = list[3];
    const s0 = c.st[0];
    const s1 = c.st[c.st.length - 7];
    const at = chunkAt(files.byRun, { run: "4848762", s: (s0 + s1) / 2 })!;
    expect(at.xid).toBe(c.id);
    expect(at.share).toBeCloseTo(0.5, 6);
    expect(chunkAt(files.byRun, { run: "4848762", s: 1e6 })).toBeNull();
    expect(chunkAt(files.byRun, { run: "no-such-run", s: 0 })).toBeNull();
  });
});
