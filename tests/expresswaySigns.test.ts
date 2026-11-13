import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { planNetwork, solvePlan } from "../src/expressway/compile";
import type { XwChunk, XwSign } from "../src/expressway/format";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";
import { frameAt } from "../src/expressway/profile";
import { carriagewayWidth } from "../src/expressway/section";
import { planSigns } from "../src/expressway/signPlan";
import { PARAPET_WIDTH } from "../src/expressway/assumptions";
import { boardNames, type BoardContent } from "../src/signs/board/content";
import { layoutBoard, parseBoardContent } from "../src/signs/board/layout";
import type { Measure } from "../src/signs/board/boxes";
import { ROUTE_SYMBOL_RATIO } from "../src/signs/boardStandards";
import {
  BOARD_BEFORE,
  BOARD_SCALE,
  DECK_PLATE_SCALE,
  PICTOGRAM_SCALE,
  ENTRANCE_ROUTE_SYMBOL,
  EXPRESSWAY_SIGN_ASSUMPTIONS,
  PHONE_SPACING,
  ROUTE_SYMBOL_ON_ARM,
  SIGN_SPACING,
} from "../src/signs/expresswaySignAssumptions";
import { deckLevelAt } from "../src/expressway/deckLevel";
import { STATION_STRIDE } from "../src/expressway/format";
import { surfaceHeight } from "../src/expressway/profile";
import { hasOperatorWord } from "../src/game/roadNames";
import { BOARD_RANGES } from "../src/signs/expresswaySignStandards";
import { enlargementFor } from "../src/signs/schema";
import { resolveMount } from "../src/signs/mount";
import { boardSizeM, deckMount } from "../src/signs/deckMount";
import { MEMBER_SIZES } from "../src/signs/mountAssumptions";
import { rankBoards } from "../src/world/boardPriority";
import { placeBoard, signFrame } from "../src/world/expresswaySigns";
import { LocalFrame } from "../src/geo/frame";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "public", "data", "expressway");
// v6: the runs, diagnostics and entrances come from report.json and the tiles (scripts/expresswayFiles.ts).
const meta = readExpresswayFiles(DIR);
const chunks = meta.chunks;
const signs: Array<{ chunk: XwChunk; sign: XwSign }> = chunks.flatMap((chunk) =>
  (chunk.signs ?? []).map((sign) => ({ chunk, sign })),
);
/** A fixed advance per character (the layout's shape without a canvas). */
const measure: Measure = (font, text) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 10);
  return [...text].length * px * (font.includes("GuideJP") ? 1 : 0.6);
};
/** Board size in metres as laid out (the plate size for 323・325: 60 cm at 1.5). */
const sizeOf = (sign: XwSign) => {
  if (!sign.board) return { width: 0.9, height: 0.9 };
  return boardSizeM(layoutBoard(sign.board as BoardContent, measure));
};

/** The 建築限界 over a carriageway (道路構造令 第12条) and the lowest overhead lower edge (設置基準). */
const CLEARANCE_M = 4.5;
const OVERHEAD_MIN_M = 4.7;

describe("都市高速の標識（G6、試験区間の生成済みデータ）", () => {
  it("stands signs of every kind the planner writes around the test section", () => {
    const ids = new Set(signs.map((x) => x.sign.id));
    for (const id of ["110-B", "111-B", "112-B", "113-B", "108の2-C", "323", "325", "116の4"])
      expect(ids, id).toContain(id);
    expect(meta.entrances?.length).toBeGreaterThan(0);
  });

  it("writes boards that pass the BoardContent schema and plates with their values", () => {
    for (const { sign } of signs) {
      if (sign.plate) {
        const isSpeed = sign.plate.id === "323";
        if (isSpeed) expect([30, 40, 50, 60, 70, 80]).toContain(sign.plate.value);
        else expect(sign.plate.value).toBeNull();
        continue;
      }
      const parsed = parseBoardContent(sign.board);
      expect(parsed.success, `${sign.id} ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect((sign.board as BoardContent).kind).toBe(sign.id);
    }
  });

  it("places each exit's and JCT's boards inside the 命令's ranges before it (別表第一)", () => {
    for (const { chunk, sign } of signs) {
      const range = BOARD_RANGES.value[sign.id as keyof typeof BOARD_RANGES.value];
      if (!range) continue;
      const before = sign.ref.beforeM;
      expect(before, sign.id).toBeGreaterThanOrEqual(range[0]);
      expect(before, sign.id).toBeLessThanOrEqual(range[1]);
      // The distance is the real one along the main line: the branch's parentS less the sign's s.
      const branch = meta.runs.find(
        (r) =>
          r.start.kind === "junction" &&
          r.start.parent === chunk.run &&
          Math.abs((r.start.parentS ?? 0) - sign.s - before) < 0.05,
      );
      expect(branch, `${sign.id} at ${sign.s}`).toBeDefined();
    }
  });

  it("orders an exit's boards 110-B → 111-B → 112-B, each over the carriageway", () => {
    const byExit = new Map<number, XwSign[]>();
    for (const { sign } of signs) {
      const isExitBoard = ["110-B", "111-B", "112-B"].includes(sign.id);
      if (!isExitBoard) continue;
      byExit.set(sign.ref.node!, [...(byExit.get(sign.ref.node!) ?? []), sign]);
      expect(sign.side).toBe("over");
    }
    // The test section's two exits (芝公園), 台場出口 on the Rainbow Bridge's approach (P7 range) and
    // 汐留出口 (P6's shiodome range).
    expect(byExit.size).toBe(4);
    for (const list of byExit.values()) {
      const order = list.toSorted((a, b) => a.s - b.s).map((x) => x.id);
      expect(order).toEqual(["110-B", "111-B", "112-B"]);
    }
  });

  it("keeps two signs of one run SIGN_SPACING apart, a 116の4 PHONE_SPACING from any other", () => {
    const byRun = new Map<string, XwSign[]>();
    for (const { chunk, sign } of signs) byRun.set(chunk.run, [...(byRun.get(chunk.run) ?? []), sign]);
    const isPhone = (s: XwSign) => s.id.startsWith("116");
    for (const list of byRun.values())
      for (const [i, a] of list.entries())
        for (const b of list.slice(i + 1)) {
          const gap = isPhone(a) || isPhone(b) ? PHONE_SPACING.value : SIGN_SPACING.value;
          expect(Math.abs(a.s - b.s), `${a.id}@${a.s} ${b.id}@${b.s}`).toBeGreaterThanOrEqual(gap - 1e-6);
        }
  });

  it("gives each sign its deck's road surface and level (a sign on a deck is not on the ground)", () => {
    for (const { chunk, sign } of signs) {
      expect(sign.z).toBeCloseTo(frameAt(chunk.st, sign.s).z, 2);
      // Never under the ground (a ramp meets it at its ground end: equal there, within the rounding).
      expect(sign.z).toBeGreaterThanOrEqual(frameAt(chunk.st, sign.s).ground - 0.01);
      expect(sign.level).toBe(deckLevelAt(chunk, sign.s));
    }
  });

  it("keeps every overhead board's lower edge 4.7 m over the highest road under it (banked too)", () => {
    for (const { chunk, sign } of signs) {
      const dm = deckMount(chunk, sign, [sizeOf(sign)]);
      const mount = resolveMount(dm.placement);
      expect(mount.dropped, `${sign.id} at ${chunk.id}`).toBe(0);
      const isOverhead = sign.mount === "gantry" || sign.mount === "girder-mount";
      if (!isOverhead) continue;
      const f = frameAt(chunk.st, sign.s);
      for (const face of mount.faces) {
        // Absolute heights: the board's lower edge, and the road under the board's span across with
        // the superelevation applied (the worst of the flat and the banked deck).
        const bottom = sign.z + face.y - face.height / 2;
        const left = dm.u - (face.x - face.width / 2);
        const right = dm.u - (face.x + face.width / 2);
        const road = Math.max(
          ...[left, right, 0].flatMap((u) => [surfaceHeight(f, u, false), surfaceHeight(f, u, true)]),
        );
        expect(bottom - road, `${sign.id} at ${chunk.id}:${sign.s}`).toBeGreaterThanOrEqual(
          Math.max(OVERHEAD_MIN_M, CLEARANCE_M),
        );
      }
    }
  });

  it("gives the review hooks each board's lower edge over its road (S6 PR 7c1, H): a 門型's finite, as resolved, ≥ 4.7 m", () => {
    let gantries = 0;
    for (const { chunk, sign } of signs) {
      if (!sign.board) continue;
      const f0 = frameAt(chunk.st, sign.s);
      const frame = new LocalFrame(f0.lat, f0.lon, 40);
      const place = { frame, ellipsoidal: (_lat: number, _lon: number, h: number) => h + 36.9 };
      const size = sizeOf(sign);
      const dm = deckMount(chunk, sign, [size]);
      const mount = resolveMount(dm.placement);
      const placed = placeBoard(signFrame(chunk, sign, place), dm, mount, size.width, size.height);
      expect(placed, `${sign.id} at ${chunk.id}`).not.toBeNull();
      const bottom = placed!.bottomM;
      expect(Number.isFinite(bottom)).toBe(true);
      const face = mount.faces[0];
      expect(
        Math.abs(bottom - (face.y - face.height / 2)),
        `${sign.id} at ${chunk.id}:${sign.s}`,
      ).toBeLessThan(0.01);
      if (sign.mount !== "gantry") continue;
      gantries++;
      expect(bottom).toBeGreaterThanOrEqual(OVERHEAD_MIN_M);
    }
    expect(gantries).toBeGreaterThan(0);
  });

  it("stands the gantries' legs on the 壁高欄 and the 壁高欄 boards outside its inner face", () => {
    for (const { chunk, sign } of signs) {
      const dm = deckMount(chunk, sign, [sizeOf(sign)]);
      const mount = resolveMount(dm.placement);
      const hw = carriagewayWidth({ ...chunk, median: 0 }) / 2;
      if (sign.mount === "gantry")
        for (const foot of mount.feet) {
          const lateral = dm.u - foot.x;
          // The median side's leg of a carriageway sharing a slab with the opposite one stands on
          // the dividing wall (P2.7-5), not on a 壁高欄 of its own (there is none there).
          const isOnDivider = sign.divider !== undefined && Math.sign(lateral) === Math.sign(sign.divider);
          if (isOnDivider) {
            expect(Math.abs(lateral - sign.divider!), `${sign.id}@${chunk.id}:${sign.s}`).toBeLessThanOrEqual(
              PARAPET_WIDTH.value / 2,
            );
            continue;
          }
          expect(Math.abs(lateral)).toBeGreaterThan(hw);
          expect(Math.abs(lateral)).toBeLessThanOrEqual(hw + PARAPET_WIDTH.value);
        }
      if (sign.mount === "barrier-mount")
        for (const f of mount.faces) expect(f.x + f.width / 2).toBeLessThanOrEqual(1e-6);
    }
  });

  it("stands a gantry's median leg in the middle of the overlap with the opposite carriageway, never inside it (P2.7-5)", () => {
    let seen = 0;
    for (const { chunk, sign } of signs) {
      if (sign.mount !== "gantry") continue;
      const partners = chunk.decks.filter((d) => d.relation === "same" && sign.s >= d.s0 && sign.s <= d.s1);
      if (partners.length === 0) continue;
      const here = frameAt(chunk.st, sign.s);
      const plane = planeAt(here.lon, here.lat);
      const a = frameAt(chunk.st, Math.max(chunk.st[0], sign.s - 2));
      const b = frameAt(chunk.st, Math.min(chunk.st[chunk.st.length - STATION_STRIDE], sign.s + 2));
      const [ax, ay] = plane.toXY(a.lon, a.lat);
      const [bx, by] = plane.toXY(b.lon, b.lat);
      const len = Math.hypot(bx - ax, by - ay);
      const [lx, ly] = [-(by - ay) / len, (bx - ax) / len];
      const hw = carriagewayWidth({ ...chunk, median: 0 }) / 2;
      const dm = deckMount(chunk, sign, [sizeOf(sign)]);
      for (const p of partners) {
        // The partner's centre line nearest the sign, and its direction.
        let best = { d: Infinity, along: 0, hw: 0, cx: 0, cy: 0 };
        for (const oc of chunks.filter((c) => c.run === p.with))
          for (let i = 0; i + STATION_STRIDE < oc.st.length; i += STATION_STRIDE) {
            const j = i + STATION_STRIDE;
            const [px, py] = plane.toXY(oc.st[i + 1], oc.st[i + 2]);
            const [qx, qy] = plane.toXY(oc.st[j + 1], oc.st[j + 2]);
            const l2 = (qx - px) ** 2 + (qy - py) ** 2;
            const t = l2 > 0 ? Math.min(1, Math.max(0, (-px * (qx - px) - py * (qy - py)) / l2)) : 0;
            const [cx, cy] = [px + (qx - px) * t, py + (qy - py) * t];
            const d = Math.hypot(cx, cy);
            if (d >= best.d) continue;
            const l = Math.sqrt(l2) || 1;
            const along = (((qx - px) / l) * (bx - ax) + ((qy - py) / l) * (by - ay)) / len;
            best = { d, along, hw: carriagewayWidth({ ...oc, median: 0 }) / 2, cx, cy };
          }
        const isOpposite = best.along < 0;
        const partnerSide = lx * best.cx + ly * best.cy;
        const isWide = hw + best.hw + PARAPET_WIDTH.value - Math.abs(partnerSide) >= 0;
        if (!isOpposite || !isWide) continue;
        expect(sign.divider, `${sign.id}@${chunk.id}:${sign.s} with ${p.with}`).toBeDefined();
        const mount = resolveMount(dm.placement);
        for (const foot of mount.feet) {
          const lateral = dm.u - foot.x;
          const isMedianSide = Math.sign(lateral) === Math.sign(partnerSide);
          if (!isMedianSide) continue;
          const [fx, fy] = [lx * lateral, ly * lateral];
          const toPartner = Math.hypot(fx - best.cx, fy - best.cy);
          // In the middle of the overlap: as far into the partner's carriageway as into its own.
          expect(
            Math.abs(Math.abs(lateral) - hw - (toPartner - best.hw)),
            `${sign.id}@${chunk.id}:${sign.s} leg ${lateral.toFixed(2)} m, ${toPartner.toFixed(2)} m from ${p.with}`,
          ).toBeLessThanOrEqual(0.3);
          seen++;
        }
      }
    }
    // The six gantries round 浜崎橋 of round-01 at least.
    expect(seen).toBeGreaterThanOrEqual(6);
  });

  it("leaves room between a gantry's top and any deck over it (measured from the stations)", () => {
    for (const { chunk, sign } of signs) {
      if (sign.mount !== "gantry") continue;
      const mount = resolveMount(deckMount(chunk, sign, [sizeOf(sign)]).placement);
      const top = sign.z + Math.max(...mount.members.map((m) => m.y + (m.role === "gantryLeg" ? m.sy : 0)));
      const at = frameAt(chunk.st, sign.s);
      const reach = carriagewayWidth({ ...chunk, median: 0 }) / 2 + PARAPET_WIDTH.value;
      for (const other of chunks) {
        if (other.run === chunk.run) continue;
        const otherReach = carriagewayWidth({ ...other, median: 0 }) / 2 + PARAPET_WIDTH.value;
        const plane = planeAt(at.lon, at.lat);
        for (let i = 0; i + STATION_STRIDE < other.st.length; i += STATION_STRIDE) {
          const j = i + STATION_STRIDE;
          const [ax, ay] = plane.toXY(other.st[i + 1], other.st[i + 2]);
          const [bx, by] = plane.toXY(other.st[j + 1], other.st[j + 2]);
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (-ax * (bx - ax) - ay * (by - ay)) / len2)) : 0;
          const d = Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t);
          const z = other.st[i + 3] + (other.st[j + 3] - other.st[i + 3]) * t;
          const isOver = d <= reach + otherReach && z > sign.z + 2;
          if (!isOver) continue;
          // The deck's underside (its girder below the road) clears the gantry's top.
          expect(z - other.girder, `${sign.id}@${chunk.id}:${sign.s} under ${other.id}`).toBeGreaterThan(top);
        }
      }
    }
  });

  it("puts the 111-B over the exit's lane, the others on the centre", () => {
    for (const { chunk, sign } of signs) {
      if (sign.mount !== "gantry") continue;
      const dm = deckMount(chunk, sign, [sizeOf(sign)]);
      const x = dm.placement.kind === "gantry" ? (dm.placement.boards[0].x ?? 0) : 0;
      const lateral = dm.u - x;
      if (sign.id !== "111-B") {
        expect(Math.abs(lateral)).toBeLessThan(1e-6);
        continue;
      }
      // Over the centre of the exit's lane, measured from its edge of the carriageway. Why not "more
      // than 1 m off the centre": on the Rainbow Bridge the left shoulder is 4.8 m and the right 1.5 m
      // (P7's band section), so the left lane's centre lies 0.1 m from the deck's centreline.
      const hw = carriagewayWidth({ ...chunk, median: 0 }) / 2;
      const isLeft = sign.lane === "left";
      const fromEdge = (isLeft ? chunk.shoulderL : chunk.shoulderR) + chunk.laneWidth / 2;
      // Where the median leg stands on the dividing wall on the lane's side (P2.7-5), the board
      // keeps clear of it: as near the lane's centre as the leg lets it (resolveGantry's rule).
      const isTowardDivider = sign.divider !== undefined && Math.sign(sign.divider) === (isLeft ? 1 : -1);
      const byLeg = isTowardDivider
        ? Math.abs(sign.divider!) - MEMBER_SIZES.value.gantryLegRadius - sizeOf(sign).width / 2
        : Infinity;
      expect(Math.abs(lateral), `${chunk.id}:${sign.s}`).toBeCloseTo(
        Math.min(Math.abs(hw - fromEdge), byLeg),
        6,
      );
    }
  });

  it("stands 325 at each entrance ramp's start and 323 at each main line", () => {
    for (const e of meta.entrances ?? []) {
      const at = signs.find((x) => x.chunk.run === e.run && x.sign.id === "325");
      expect(at, e.run).toBeDefined();
      expect(at!.sign.s).toBeLessThan(30);
    }
    // Every main line that starts on its own, or branches off at another speed than its parent's,
    // announces its speed. A branch that carries its parent's (POSTED_SPEED_CARRY: 45021972 off C1
    // in the P7 range) continues the same limit and needs no plate at its start.
    const postedAt = (run: string, s: number) =>
      chunks.find(
        (c) => c.run === run && c.st[0] <= s + 1e-6 && s <= c.st[c.st.length - STATION_STRIDE] + 1e-6,
      )?.posted;
    for (const r of meta.runs.filter((r) => r.cls === "expressway")) {
      const own = chunks.find((c) => c.run === r.id && c.k === 0)?.posted;
      const isBranch = r.start.kind === "junction" && r.start.parent !== undefined;
      const isCarried = isBranch && postedAt(r.start.parent!, r.start.parentS ?? 0) === own;
      const hasChange = chunks.some((c) => c.run === r.id && c.k > 0 && c.posted !== own);
      if (isCarried && !hasChange) continue;
      expect(
        signs.some((x) => x.chunk.run === r.id && x.sign.id === "323"),
        r.id,
      ).toBe(true);
    }
  });

  it("shows on every 323 the posted speed the graph enforces (XwChunk.posted), and has it on every chunk", () => {
    for (const c of chunks) expect(c.posted, c.id).toBeGreaterThan(0);
    for (const { chunk, sign } of signs) {
      if (sign.id !== "323") continue;
      // At most SPEED_SIGN_SHIFT before the change it announces: the chunk's value or the next's.
      const next = chunks.find((c) => c.id === chunk.next);
      expect([chunk.posted, next?.posted], `${chunk.id}:${sign.s}`).toContain(sign.plate?.value);
    }
  });

  it("stands a 323 where the posted speed changes along a run (within the shifts tried)", () => {
    const byRun = new Map<string, XwChunk[]>();
    for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
    for (const [run, list] of byRun) {
      const sorted = list.toSorted((a, b) => a.k - b.k);
      for (let k = 1; k < sorted.length; k++) {
        const isChange = sorted[k].posted !== sorted[k - 1].posted;
        if (!isChange) continue;
        const at = sorted[k].st[0];
        const plate = signs.find(
          (x) => x.chunk.run === run && x.sign.id === "323" && Math.abs(x.sign.s - at) <= 35,
        );
        expect(plate?.sign.plate?.value, `${run} at ${at}`).toBe(sorted[k].posted);
      }
    }
  });

  it("counts a deck's level from the decks it stands over (the car's level is read the same way)", () => {
    const decks = [{ with: "x", relation: "above" as const, s0: 100, s1: 200 }];
    expect(deckLevelAt({ decks }, 50)).toBe(1);
    expect(deckLevelAt({ decks }, 150)).toBe(2);
    expect(deckLevelAt({ decks: [{ ...decks[0], relation: "below" as const }] }, 150)).toBe(1);
  });

  /** Every text the boards of the data draw (their layout's text nodes), the entrances' 103・104 too. */
  const drawnTexts = (): string[] => {
    const contents: BoardContent[] = signs.flatMap(({ sign }) =>
      sign.board ? [sign.board as BoardContent] : [],
    );
    for (const e of meta.entrances ?? []) {
      const name = e.name ? { ja: e.name, en: e.nameEn ?? "", expressway: false } : null;
      const names = e.routeName ? [{ ja: e.routeName, en: e.routeNameEn ?? "", expressway: false }] : [];
      const route = e.route ? { kind: "route" as const, number: e.route } : null;
      const base = { operator: "guide.operator" as const, route, entranceName: name, names, letter: 20 };
      contents.push(
        { kind: "103-A", ...base, angle: 0, distance: null },
        { kind: "104", ...base, angle: null, distance: 150 },
      );
    }
    return contents.flatMap((c) =>
      layoutBoard(c, measure).nodes.flatMap((n) => (n.type === "text" ? [n.text] : [])),
    );
  };

  it("draws exits and JCTs by their real names, the operator by its fictional name only", () => {
    const texts = drawnTexts();
    expect(texts).toContain("芝公園");
    expect(texts.some((t) => t.includes("都心環状線"))).toBe(true);
    expect(texts.some((t) => t.includes("1号羽田線"))).toBe(true);
    expect(texts).toContain("都市高速");
    expect(texts.filter((t) => hasOperatorWord(t))).toEqual([]);
  });

  it("has every character the boards draw in the guide font subset", () => {
    const charset = new Set(readFileSync(join(ROOT, "assets/signs/guide/charset.txt"), "utf8").trim());
    const missing = [...new Set(drawnTexts().join(""))].filter(
      (c) => c.charCodeAt(0) > 0x7f && !charset.has(c),
    );
    expect(missing).toEqual([]);
  });

  it("names a route in one English on every board (the most frequent of its ways)", () => {
    const en = new Map<string, Set<string>>();
    for (const { sign } of signs)
      if (sign.board)
        for (const n of boardNames(sign.board as BoardContent))
          en.set(n.ja, (en.get(n.ja) ?? new Set()).add(n.en));
    for (const e of meta.entrances ?? [])
      if (e.routeName) en.set(e.routeName, (en.get(e.routeName) ?? new Set()).add(e.routeNameEn ?? ""));
    for (const [ja, set] of en) expect(set.size, ja).toBe(1);
  });
});

describe("設置規則と仮定（expresswaySignAssumptions.ts）", () => {
  it("tries only distances inside the 命令's ranges", () => {
    for (const [id, list] of Object.entries(BOARD_BEFORE.value)) {
      const [lo, hi] = BOARD_RANGES.value[id as keyof typeof BOARD_RANGES.value];
      for (const d of list) {
        expect(d).toBeGreaterThanOrEqual(lo);
        expect(d).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("keeps the route symbols inside 備考一(五)6 and the boards inside 3 times (備考一(二)3)", () => {
    expect(ROUTE_SYMBOL_ON_ARM.value).toBeLessThanOrEqual(ROUTE_SYMBOL_RATIO.value.via);
    expect(ENTRANCE_ROUTE_SYMBOL.value).toBeLessThanOrEqual(ROUTE_SYMBOL_RATIO.value.destination);
    const guide = enlargementFor("案内", { kind: "expressway", designSpeedKmh: 60 });
    expect("range" in guide && guide.range[1]).toBe(3);
    const range = "range" in guide ? guide.range : [1, 1];
    for (const scale of [BOARD_SCALE.value, PICTOGRAM_SCALE.value]) {
      expect(scale).toBeGreaterThanOrEqual(range[0]);
      expect(scale).toBeLessThanOrEqual(range[1]);
    }
    const plates = enlargementFor("規制", { kind: "expressway", designSpeedKmh: 60 });
    expect("range" in plates && DECK_PLATE_SCALE.value <= plates.range[1]).toBe(true);
  });

  it("marks every choice unverified with its reason", () => {
    for (const [name, a] of Object.entries(EXPRESSWAY_SIGN_ASSUMPTIONS)) {
      expect(a.verified, name).toBe(false);
      expect(a.reason.length, name).toBeGreaterThan(10);
    }
  });
});

describe("planSigns（合成の区間）", () => {
  // A 2.6 km viaduct going east (+x): a left exit at x = 900 (exit 20), a right exit at x = 1700
  // (exit 21), a JCT branching left at x = 2400, an entrance merging at x = 1100, a deck crossing
  // over it at x = 780 (layer 2), maxspeed 50 to x = 800, untagged to x = 1550 (carries 50), then 60.
  const plane = planeAt(139.75, 35.65);
  const line = (x0: number, x1: number, step = 50) =>
    Array.from(
      { length: Math.round((x1 - x0) / step) + 1 },
      (_, i) => [x0 + i * step, 0] as [number, number],
    );
  const main = line(0, 2600);
  const mainIds = main.map((_, i) => 1000 + i);
  const idAt = (x: number) => mainIds[Math.round(x / 50)];
  const net: Network = { ways: new Map(), nodes: new Map() };
  const viaduct = {
    highway: "motorway",
    bridge: "yes",
    layer: "1",
    lanes: "2",
    ref: "C1",
    name: "首都高速都心環状線",
  };
  const span = (x0: number, x1: number) => mainIds.slice(Math.round(x0 / 50), Math.round(x1 / 50) + 1);
  net.ways.set(10, normalizeWay(10, span(0, 800), { ...viaduct, maxspeed: "50" }));
  net.ways.set(11, normalizeWay(11, span(800, 1550), viaduct));
  net.ways.set(12, normalizeWay(12, span(1550, 2600), { ...viaduct, maxspeed: "60" }));
  const tagged = new Map<number, Record<string, string>>([
    [idAt(900), { highway: "motorway_junction", name: "芝公園出口", "name:en": "Shibakoen", ref: "20" }],
    [idAt(1700), { highway: "motorway_junction", name: "浜松町出口", "name:en": "Hamamatsucho", ref: "21" }],
    [idAt(2400), { highway: "motorway_junction", name: "浜崎橋JCT" }],
  ]);
  const ways: Array<{
    id: number;
    pts: Array<[number, number]>;
    ids: number[];
    tags: Record<string, string>;
  }> = [
    {
      id: 20,
      pts: [
        [900, 0],
        [950, 6],
        [1000, 14],
        [1100, 40],
        [1200, 70],
      ],
      ids: [idAt(900), 2001, 2002, 2003, 2004],
      tags: { highway: "motorway_link", bridge: "yes", layer: "1", name: "芝公園出口" },
    },
    {
      id: 21,
      pts: [
        [1700, 0],
        [1750, -6],
        [1800, -14],
        [1900, -40],
        [2000, -70],
      ],
      ids: [idAt(1700), 2101, 2102, 2103, 2104],
      tags: { highway: "motorway_link", bridge: "yes", layer: "1", name: "浜松町出口" },
    },
    {
      id: 30,
      pts: [
        [2400, 0],
        [2450, 6],
        [2500, 16],
        [2600, 45],
        [2700, 90],
        [2800, 140],
      ],
      ids: [idAt(2400), 3001, 3002, 3003, 3004, 3005],
      tags: {
        highway: "motorway",
        bridge: "yes",
        layer: "1",
        lanes: "2",
        name: "首都高速1号羽田線",
        "name:en": "Route 1 Haneda Line",
      },
    },
    {
      id: 40,
      pts: [
        [800, -90],
        [900, -60],
        [1000, -24],
        [1050, -8],
        [1100, 0],
      ],
      ids: [4001, 4002, 4003, 4004, idAt(1100)],
      tags: { highway: "motorway_link", bridge: "yes", layer: "1" },
    },
    {
      id: 50,
      pts: [
        [780, -500],
        [780, -250],
        [780, 0],
        [780, 250],
        [780, 500],
      ],
      ids: [5001, 5002, 5003, 5004, 5005],
      tags: { highway: "motorway", bridge: "yes", layer: "2", lanes: "2", name: "首都高速11号台場線" },
    },
  ];
  const nodeAt = (id: number, x: number, y: number) => {
    const [lon, lat] = plane.toLonLat(x, y);
    net.nodes.set(id, normalizeNode(id, lon, lat, tagged.get(id) ?? {}));
  };
  main.forEach(([x, y], i) => nodeAt(mainIds[i], x, y));
  for (const w of ways) {
    net.ways.set(w.id, normalizeWay(w.id, w.ids, w.tags));
    w.ids.forEach((id, i) => {
      if (!net.nodes.has(id)) nodeAt(id, w.pts[i][0], w.pts[i][1]);
    });
  }
  const plan = planNetwork(net, new Set(), null);
  const result = solvePlan(plan, () => 3, []);
  const phone = (id: number, x: number, y: number) => {
    const [lon, lat] = plane.toLonLat(x, y);
    return { id, lon, lat };
  };
  // The crossing deck 3 m higher than the compiler's least (4.5 m + girder): room to hang a board on
  // its girder over the main line.
  const raised = result.chunks.map((c) => {
    if (c.run !== "50") return c;
    const st = [...c.st];
    for (let i = 0; i < st.length; i += STATION_STRIDE) st[i + 3] += 3;
    return { ...c, st };
  });
  const out = planSigns({
    chunks: raised,
    runs: result.runs,
    features: result.features,
    net,
    // One by the right 壁高欄 in the open, one where the left exit's 110-B stands.
    phones: [phone(9, 200, -8), phone(8, 400, 8)],
    bays: [],
  });
  const onRun = (run: string) =>
    [...out.signs.entries()].filter(([id]) => id.startsWith(`${run}:`)).flatMap(([, l]) => l);
  const mainRun = result.runs.find((r) => r.cls === "expressway" && r.id === "10")!;
  const mainSigns = onRun(mainRun.id);
  const forExit = (node: number, id: string) => mainSigns.find((s) => s.id === id && s.ref.node === node);

  it("solves every run of the section (the planner sees them all)", () => {
    expect(result.runs.map((r) => r.id).toSorted()).toEqual(["10", "20", "21", "30", "40", "50"]);
  });

  it("puts each exit's 110-B, 111-B and 112-B at the first free distance, the 111-B over the exit's lane", () => {
    const left = idAt(900);
    const right = idAt(1700);
    expect(forExit(left, "110-B")?.ref.beforeM).toBe(BOARD_BEFORE.value["110-B"][0]);
    expect(forExit(left, "111-B")?.lane).toBe("left");
    expect(forExit(right, "111-B")?.lane).toBe("right");
    expect((forExit(right, "112-B")!.board as { angle: number }).angle).toBeLessThan(0);
    expect((forExit(left, "112-B")!.board as { angle: number }).angle).toBeGreaterThan(0);
  });

  it("hangs the 112-B under the crossing deck on its girder, above 4.7 m (girder-mount)", () => {
    const b = forExit(idAt(900), "112-B")!;
    expect(b.mount).toBe("girder-mount");
    expect(b.girder!.bottomM).toBeGreaterThan(4.7);
    const chunk = result.chunks.find(
      (c) => c.run === mainRun.id && c.st[0] <= b.s && b.s <= c.st[c.st.length - 7],
    )!;
    const mount = resolveMount(
      deckMount(chunk, b, [boardSizeM(layoutBoard(b.board as BoardContent, measure))]).placement,
    );
    expect(mount.dropped).toBe(0);
    for (const f of mount.faces) expect(f.y - f.height / 2).toBeGreaterThanOrEqual(4.7);
  });

  it("puts the nose sign on the ramp's side toward the main line", () => {
    expect(onRun("20").find((s) => s.id === "113-B")?.side).toBe("right");
    expect(onRun("21").find((s) => s.id === "113-B")?.side).toBe("left");
  });

  it("draws the JCT's arms: the branch to its side with its route symbol, the main line straight on", () => {
    const b = mainSigns.find((s) => s.id === "108の2-C")!;
    const arms = (
      b.board as {
        arms: Array<{ angle: number; names: Array<{ ja: string }>; shields: Array<{ number: string }> }>;
      }
    ).arms;
    const branch = arms.find((a) => a.angle !== 0)!;
    const straight = arms.find((a) => a.angle === 0)!;
    expect(branch.angle).toBeGreaterThan(0);
    expect(branch.names[0].ja).toBe("1号羽田線");
    expect(branch.shields[0].number).toBe("1");
    expect(straight.names[0].ja).toBe("都心環状線");
    expect(straight.shields[0].number).toBe("C1");
  });

  it("stands 323 only where the posted speed changes, the untagged stretch carrying 50", () => {
    const plates = mainSigns.filter((s) => s.id === "323").toSorted((a, b) => a.s - b.s);
    // Since P6 the chunks are cut where the tag changes (XW_VERSION 5, x = 1550 here), so the 60's
    // plate is due right where the right exit's boards stand: it is reported, never forced.
    expect(plates.map((p) => p.plate?.value)).toEqual([50]);
    expect(out.unplaced).toContainEqual({
      run: mainRun.id,
      id: "323",
      reason: "no_free_distance:posted_change:60",
    });
    // No plate after the entrance's merge at x = 1100: the value there is the same.
    const merge = result.runs.find((r) => r.id === "40")!.end.parentS!;
    expect(plates.some((p) => p.s > merge && p.s < merge + 150)).toBe(false);
    // The change is at the first chunk starting on the 60 way: the way's own first point.
    const changed = result.chunks.find((c) => c.run === mainRun.id && out.posted.get(c.id) === 60)!;
    expect(changed.st[0]).toBeCloseTo(1550, 0);
    expect(changed.maxspeed).toBe(60);
    for (const c of result.chunks.filter((x) => x.run === mainRun.id && x.st[0] < 800))
      expect(out.posted.get(c.id)).toBe(50);
  });

  it("stands 116の4 on the left 壁高欄 at the phone's distance, and reports the one that has no room", () => {
    const placed = mainSigns.filter((s) => s.id === "116の4");
    expect(placed).toHaveLength(1);
    expect(placed[0].side).toBe("left");
    expect(Math.abs(placed[0].s - 200)).toBeLessThan(2);
    expect(out.unplaced).toContainEqual({ run: mainRun.id, id: "116の4", reason: "no_free_distance" });
  });
});

describe("新しい板のレイアウト（111-B・116の4・116の6）", () => {
  const texts = (c: BoardContent) =>
    layoutBoard(c, measure).nodes.flatMap((n) => (n.type === "text" ? [n.text] : []));

  it("lays 111-B out as 図 029: the place, the number's plate, the arrow down and 出口 300m EXIT", () => {
    const c: BoardContent = {
      kind: "111-B",
      names: [{ ja: "芝公園", en: "Shibakoen", expressway: false }],
      number: "20",
      distance: 300,
      letter: 30,
    };
    const l = layoutBoard(c, measure);
    expect(texts(c)).toEqual(expect.arrayContaining(["芝公園", "Shibakoen", "20", "出口", "300m", "EXIT"]));
    const arrow = l.nodes.find((n) => n.type === "arrow");
    expect(arrow && arrow.type === "arrow" && arrow.tip.y > arrow.tail.y).toBe(true);
    expect(l.nodes.some((n) => n.type === "text" && n.text === "20" && n.colour === "green")).toBe(true);
    expect(l.width).toBeGreaterThanOrEqual(320);
  });

  it("draws 116の4・116の6 at 図示's 60 × 90 proportions, scaled by the caption", () => {
    for (const kind of ["116の4", "116の6"] as const) {
      const caption = kind === "116の4" ? 14 : 10;
      const l = layoutBoard({ kind, letter: caption * 1.5 }, measure);
      expect(l.width).toBeCloseTo(90, 5);
      expect(l.height).toBeCloseTo(135, 5);
      expect(l.nodes.some((n) => n.type === "pictogram")).toBe(true);
    }
    expect(texts({ kind: "116の4", letter: 14 })).toEqual(["非常電話"]);
    expect(texts({ kind: "116の6", letter: 10 })).toEqual(["非常駐車帯"]);
  });

  it("stands 113-B upright as 図 033: 出口 EXIT on top, the arrow, the number's plate and place below", () => {
    const c: BoardContent = {
      kind: "113-B",
      names: [{ ja: "芝公園", en: "Shibakoen", expressway: false }],
      exitName: null,
      number: "20",
      distance: null,
      angle: 45,
      letter: 30,
    };
    const l = layoutBoard(c, measure);
    expect(l.height).toBeGreaterThan(l.width);
    expect(texts(c)).toEqual(expect.arrayContaining(["出口", "EXIT", "20", "芝公園"]));
    const top = l.nodes.find((n) => n.type === "text" && n.text === "出口");
    const plate = l.nodes.find((n) => n.type === "field");
    expect(top && plate && top.type === "text" && plate.type === "field" && top.y < plate.y).toBe(true);
  });

  it("keeps every box of the new boards inside the board", () => {
    const contents: BoardContent[] = [
      {
        kind: "111-B",
        names: [{ ja: "芝公園", en: "Shibakoen", expressway: false }],
        number: "20",
        distance: 300,
        letter: 30,
      },
      { kind: "116の4", letter: 21 },
      { kind: "116の6", letter: 15 },
    ];
    for (const c of contents) {
      const l = layoutBoard(c, measure);
      for (const n of l.nodes) {
        const isBox = n.type === "field" || n.type === "pictogram";
        if (!isBox) continue;
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(l.width + 1e-6);
        expect(n.y + n.h).toBeLessThanOrEqual(l.height + 1e-6);
      }
    }
  });
});

describe("BoardFacePool の利用者ごとの登録（G5 レビュー W5）", () => {
  const board = (key: string, x: number, level = 0) => ({
    key,
    pos: { x, z: 0 },
    normal: { x: -1, z: 0 },
    width: 3,
    level,
  });

  it("ranks the street's and the deck's boards together: one user's list never drops the other's", () => {
    const street = [board("s1", -50), board("s2", -300)];
    const deck = [board("d1", -100, 1)];
    const chosen = rankBoards([street, deck], { x: 0, z: 0 }, 1, { range: 400, count: 24 }).map(
      (r) => r.b.key,
    );
    expect(chosen).toEqual(expect.arrayContaining(["s1", "s2", "d1"]));
    // On the deck, its board comes before the street's nearer one (another level comes last).
    expect(chosen[0]).toBe("d1");
  });

  it("keeps the count across users and one face per content", () => {
    const a = Array.from({ length: 20 }, (_, i) => board(`a${i}`, -10 - i));
    const b = [...Array.from({ length: 20 }, (_, i) => board(`b${i}`, -10.5 - i)), board("a0", -5)];
    const chosen = rankBoards([a, b], { x: 0, z: 0 }, 0, { range: 400, count: 24 });
    expect(chosen).toHaveLength(24);
    expect(new Set(chosen.map((r) => r.b.key)).size).toBe(24);
  });
});
