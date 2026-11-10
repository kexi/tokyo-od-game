import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CLEARANCE_HEIGHT as LAW_CLEARANCE_HEIGHT } from "../src/law/roadStandards";
import type { Design } from "../src/signs/game";
import {
  MEMBER_NODES,
  MEMBER_ROLES,
  MOUNT_KINDS,
  MOUNTS,
  MountPlacementSchema,
  resolveMount,
  withoutColumn,
  type MountFace,
  type MountPlacement,
  type ResolvedMount,
} from "../src/signs/mount";
import {
  ARM_CLEAR,
  BOARD_GAP,
  MEMBER_SIZES,
  MOUNT_ASSUMPTIONS,
  PLATE_GAP,
  POST_MAX_TOP,
  SIGN_KERB,
} from "../src/signs/mountAssumptions";
import {
  CLEARANCE_HEIGHT,
  FACE_LIMITS,
  KERB_CLEAR,
  LEG_CLEAR,
  LOGISTICS_CLEARANCE_HEIGHT,
  MOUNT_STANDARDS,
  OVERHEAD_BOTTOM,
  PLATE_GAP_RANGE,
  ROADSIDE_BOTTOM,
  SHARE_MAX_TOP,
  TILT_DEG,
} from "../src/signs/mountStandards";
import { mountPost, sharedPoles, type PostPlan } from "../src/world/signs";
import type { SignalPole } from "../src/world/trafficControl";

/**
 * The seven mounts (src/signs/mount.ts) put every face where the standards allow: lower edges at
 * or above the height for the site and authority (交通規制基準: 歩道上 2.5 m, never under 1.8 m;
 * 設置基準: 2.5 m on a narrow pavement; overhead 5.0 m and never under 4.7 m or the 建築限界), nothing
 * within 25 cm of the kerb or over the carriageway from a roadside mount, faces never overlapping,
 * two 本板 and four plates a face at most, three plates split onto two posts, plates on a signal pole
 * kept under its arm and over a 歩行者用灯器 beside it, gantry legs outside the clear width, parapet
 * mounts outside the parapet's face. The standards' values are written out again here from the
 * cited texts, the assumptions all say why, and the member sizes and glb nodes match the files.
 */

const ROOT = join(import.meta.dirname, "..");
const EPS = 1e-9;
const KERB = SIGN_KERB.value;
const PAVEMENT = ROADSIDE_BOTTOM.value.police.pavement;

/** Plates as drawn (m): 60 cm circle at 1.25×, 菱形 box at 1.3×, 逆三角, 407 pentagon, 30 × 50 通学路. */
const PLATES = [
  { width: 0.75, height: 0.75 },
  { width: 0.827, height: 0.827 },
  { width: 1.0, height: 0.866 },
  { width: 0.75, height: 0.8995 },
  { width: 0.375, height: 0.625 },
];
/** 補助標識 under a plate: none, or the 22 / 32 / 44 cm plates at 1.25×. */
const AUX = [[], [0.275], [0.4], [0.55]].map((hs) => hs.map((height) => ({ width: 0.75, height })));
const WIDE = { width: 2.0, height: 1.125, aux: [] as Array<{ width: number; height: number }> };

function postSets(): MountPlacement[] {
  const one = PLATES.flatMap((p) => AUX.map((aux) => ({ ...p, aux })));
  const sets = one.map((p) => [p]);
  for (const a of one) for (const b of one) sets.push([a, b]);
  for (const a of one.filter((_, i) => i % 3 === 0))
    for (const b of one.filter((_, i) => i % 2 === 0))
      for (const c of one.filter((_, i) => i % 4 === 0)) sets.push([a, b, c]);
  for (const a of one.filter((_, i) => i % 4 === 0)) sets.push([a, WIDE, a], [WIDE, a, a]);
  return sets.flatMap((plates) =>
    (["pavement", "roadside"] as const).map((site) => ({
      kind: "single-post" as const,
      site,
      kerbM: KERB,
      plates,
    })),
  );
}

const top = (f: MountFace) => f.y + f.height / 2;
const bottom = (f: MountFace) => f.y - f.height / 2;
const lowest = (m: ResolvedMount) => Math.min(...m.faces.map(bottom));
const faceCount = (p: MountPlacement) =>
  "plates" in p ? p.plates.reduce((n, q) => n + 1 + (q.aux?.length ?? 0), 0) : 1;
/** Faces grouped by the column they hang in. */
function columnsOf(m: ResolvedMount): MountFace[][] {
  const by = new Map<number, MountFace[]>();
  for (const f of m.faces) by.set(f.column, [...(by.get(f.column) ?? []), f]);
  return [...by.values()];
}
const reachOf = (f: MountFace) => (f.parallel ? 0.05 : f.width / 2);
const design = (id: string, extra: Partial<Design> = {}): Design => ({
  id,
  file: id,
  shape: "PlateCircle",
  scale: 1.25,
  ...extra,
});
/** Plates for traffic heading −z (north) at `pos`, without 補助標識. */
const plan = (pos: Vector3, designs: Design[]): PostPlan => ({
  pos,
  travel: new Vector3(0, 0, -1),
  plates: designs,
  auxOf: designs.map(() => []),
});

/** Node names in a .glb's JSON chunk (header 12 bytes, then the chunk's length and type). */
function glbNodeNames(file: string): string[] {
  const bytes = readFileSync(join(ROOT, file));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as {
    nodes?: Array<{ name?: string }>;
  };
  return (json.nodes ?? []).map((n) => n.name ?? "");
}

/** A constant `NAME = <arithmetic>` of a Blender script, evaluated. */
function constant(file: string, name: string): number {
  const text = readFileSync(join(ROOT, "scripts", "blender", file), "utf8");
  const m = new RegExp(`^${name} = (.+)$`, "m").exec(text);
  if (!m) throw new Error(`${file} has no ${name}`);
  return Function(`return (${m[1].split("#")[0]})`)() as number;
}

describe("the standards and the assumptions", () => {
  it("cite where each standard is written, and say why for each assumption (none verified)", () => {
    for (const [name, s] of Object.entries(MOUNT_STANDARDS)) expect(s.source.length, name).toBeGreaterThan(5);
    for (const [name, a] of Object.entries(MOUNT_ASSUMPTIONS)) {
      expect(a.verified, name).toBe(false);
      expect(a.reason.length, name).toBeGreaterThan(5);
    }
  });

  it("are the values the cited texts give (written out again from 交通規制基準・設置基準・構造令)", () => {
    expect(ROADSIDE_BOTTOM.value).toEqual({
      police: { pavement: { standardM: 2.5, minM: 1.8 }, roadside: { standardM: 1.8, minM: 1.5 } },
      road: { pavement: { standardM: 2.5, minM: 2.5 }, roadside: { standardM: 1.8, minM: 1.8 } },
    });
    expect(OVERHEAD_BOTTOM.value).toEqual({ standardM: 5.0, minM: 4.7 });
    expect(KERB_CLEAR.value).toBe(0.25);
    expect(FACE_LIMITS.value).toEqual({ plates: 2, faces: 4 });
    expect(PLATE_GAP_RANGE.value).toEqual({ min: 0.1, max: 0.15 });
    expect(SHARE_MAX_TOP.value).toBe(6);
    expect(TILT_DEG.value).toBe(3);
    expect(LOGISTICS_CLEARANCE_HEIGHT.value).toBe(4.8);
  });

  it("take the 建築限界 from src/law/roadStandards.ts, and keep the overhead minimum above it", () => {
    expect(CLEARANCE_HEIGHT).toBe(LAW_CLEARANCE_HEIGHT);
    expect(OVERHEAD_BOTTOM.value.minM).toBeGreaterThan(CLEARANCE_HEIGHT.value);
  });

  it("choose the plate gap inside the range the standard allows", () => {
    expect(PLATE_GAP.value).toBeGreaterThanOrEqual(PLATE_GAP_RANGE.value.min);
    expect(PLATE_GAP.value).toBeLessThanOrEqual(PLATE_GAP_RANGE.value.max);
  });
});

describe("the mounts as declared", () => {
  it("declare all seven kinds, each with members that have a glb node", () => {
    expect(Object.keys(MOUNTS).toSorted()).toEqual([...MOUNT_KINDS].toSorted());
    for (const m of Object.values(MOUNTS))
      for (const role of m.members) expect(MEMBER_NODES[role]).toBeDefined();
  });

  it("draw every member role from a node that is in its glb", () => {
    const nodes = {
      signs: glbNodeNames("public/models/signs.glb"),
      guide_signs: glbNodeNames("public/models/guide_signs.glb"),
    };
    for (const role of MEMBER_ROLES) {
      const { glb, node } = MEMBER_NODES[role];
      expect(nodes[glb], role).toContain(node);
    }
  });
});

describe("roadside posts (single-post, double-post)", () => {
  const sets = postSets();

  it("validate as placements and build only the members their kind declares", () => {
    for (const p of sets) {
      expect(MountPlacementSchema.safeParse(p).success).toBe(true);
      const m = resolveMount(p);
      for (const member of m.members) expect(MOUNTS[m.kind].members, m.kind).toContain(member.role);
    }
  });

  it("keep every lower edge at or above the site's least height and leave no face off", () => {
    for (const p of sets) {
      const m = resolveMount(p);
      const site = p.kind === "single-post" ? p.site : "pavement";
      expect(lowest(m), JSON.stringify(p)).toBeGreaterThanOrEqual(
        ROADSIDE_BOTTOM.value.police[site].minM - EPS,
      );
      expect(m.dropped, JSON.stringify(p)).toBe(0);
      expect(m.faces.length).toBe(faceCount(p));
    }
  });

  it("keep the top under the post's limit unless a face would otherwise go below the least height", () => {
    for (const p of sets) {
      const m = resolveMount(p);
      const site = p.kind === "single-post" ? p.site : "pavement";
      const isOverLimit = Math.max(...m.faces.map(top)) > POST_MAX_TOP.value + EPS;
      if (!isOverLimit) continue;
      const hasWide = "plates" in p && p.plates.some((q) => q.width > 1.2);
      const atLeast = ROADSIDE_BOTTOM.value.police[site].minM;
      expect(hasWide || Math.abs(lowest(m) - atLeast) < 1e-6, JSON.stringify(p)).toBe(true);
    }
  });

  it("hang a lone plate at the site's standard height (2.5 m over a pavement, 1.8 m elsewhere)", () => {
    for (const site of ["pavement", "roadside"] as const) {
      const m = resolveMount({ kind: "single-post", site, kerbM: KERB, plates: [PLATES[0]] });
      expect(lowest(m)).toBeCloseTo(ROADSIDE_BOTTOM.value.police[site].standardM, 9);
    }
  });

  it("never overlap faces, and put two 本板 and four plates a face at most", () => {
    for (const p of sets) {
      for (const col of columnsOf(resolveMount(p))) {
        const sorted = col.toSorted((a, b) => b.y - a.y);
        for (let i = 1; i < sorted.length; i++)
          expect(top(sorted[i])).toBeLessThanOrEqual(bottom(sorted[i - 1]) + EPS);
        expect(col.filter((f) => f.aux === null).length).toBeLessThanOrEqual(FACE_LIMITS.value.plates);
        expect(col.length).toBeLessThanOrEqual(FACE_LIMITS.value.faces);
      }
    }
  });

  it("keep faces 25 cm or more from the kerb, and columns side by side clear of each other", () => {
    for (const p of sets) {
      const m = resolveMount(p);
      for (const f of m.faces) expect(f.x + reachOf(f)).toBeLessThanOrEqual(KERB - KERB_CLEAR.value + EPS);
      const spans = columnsOf(m).map((col) => [
        Math.min(...col.map((f) => f.x - reachOf(f))),
        Math.max(...col.map((f) => f.x + reachOf(f))),
      ]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][1]).toBeLessThan(spans[i - 1][0]);
    }
  });

  it("put three plates on two posts (two 本板 a face), dropping none, each column its own feet", () => {
    const m = resolveMount({
      kind: "single-post",
      site: "pavement",
      kerbM: KERB,
      plates: [PLATES[0], PLATES[0], PLATES[0]],
    });
    expect(m.kind).toBe("double-post");
    expect(m.feet.map((f) => f.column)).toEqual([0, 1]);
    expect(m.faces).toHaveLength(3);
    expect(m.dropped).toBe(0);
    expect(lowest(m)).toBeGreaterThanOrEqual(PAVEMENT.minM);
  });

  it("fit a plate after a wide one under the first plate instead of leaving it off", () => {
    const m = resolveMount({
      kind: "single-post",
      site: "pavement",
      kerbM: KERB,
      plates: [PLATES[0], WIDE, PLATES[1]],
    });
    expect(m.dropped).toBe(0);
    expect(m.faces.filter((f) => f.column === 0).map((f) => f.plate)).toEqual([0, 2]);
  });

  it("stand a wide plate on two posts under it, moved back from the kerb", () => {
    const m = resolveMount({ kind: "single-post", site: "pavement", kerbM: KERB, plates: [WIDE] });
    expect(m.kind).toBe("double-post");
    const [f] = m.faces;
    for (const foot of m.feet) expect(Math.abs(foot.x - f.x)).toBeLessThan(f.width / 2);
    expect(f.x + f.width / 2).toBeCloseTo(KERB - KERB_CLEAR.value, 9);
  });

  it("keep a 横断歩道 plate on the column by the carriageway when the plates are split", () => {
    const crosswalk = { width: 0.75, height: 0.8995, kerbSide: true };
    const m = resolveMount({
      kind: "single-post",
      site: "pavement",
      kerbM: KERB,
      plates: [PLATES[0], PLATES[0], crosswalk],
    });
    expect(m.faces.find((f) => f.plate === 2)?.column).toBe(0);
  });

  it("drop one column alone, its faces counted and its feet and members gone", () => {
    const m = resolveMount({
      kind: "single-post",
      site: "pavement",
      kerbM: KERB,
      plates: [PLATES[0], PLATES[0], PLATES[0]],
    });
    const first = withoutColumn(m, 1);
    expect(first.kind).toBe("single-post");
    expect(first.faces.every((f) => f.column === 0)).toBe(true);
    expect(first.members.every((x) => x.column === 0)).toBe(true);
    expect(first.dropped).toBe(1);
  });
});

describe("a 案内標識 board on two posts (road authority)", () => {
  it("keeps its lower edge at 設置基準's 2.5 m whatever its height, its edge 25 cm behind the kerb", () => {
    for (const height of [1.2, 2.2, 3.2, 4.0]) {
      const m = resolveMount({
        kind: "double-post",
        site: "pavement",
        authority: "road",
        support: "guide",
        kerbM: 0.9,
        plates: [{ width: 1.9, height, twoSided: true }],
      });
      expect(m.faces).toHaveLength(1);
      expect(lowest(m)).toBeCloseTo(2.5, 9);
      expect(m.faces[0].x + 1.9 / 2).toBeCloseTo(0.9 - KERB_CLEAR.value, 9);
      expect(m.members.every((x) => x.role === "boardPost")).toBe(true);
      expect(m.feet.every((f) => f.radius === MEMBER_SIZES.value.guidePostRadius)).toBe(true);
    }
  });
});

describe("signal-share (信号柱への共架)", () => {
  const arm = 5.2 + 0.4;
  const share = (plates: Array<{ width: number; height: number }>, minBottomM?: number) =>
    resolveMount({ kind: "signal-share", site: "pavement", kerbM: 1.2, armY: arm, minBottomM, plates });

  it("hang the plates on the pole under its arm, at the pavement's heights, with no post of their own", () => {
    for (const plates of [[PLATES[0]], [PLATES[0], PLATES[1]]]) {
      const m = share(plates);
      expect(m.dropped).toBe(0);
      expect(m.feet).toEqual([]);
      expect(m.members.some((x) => x.role === "post")).toBe(false);
      for (const f of m.faces)
        expect(top(f)).toBeLessThanOrEqual(Math.min(arm - ARM_CLEAR.value, SHARE_MAX_TOP.value) + EPS);
      expect(lowest(m)).toBeGreaterThanOrEqual(PAVEMENT.minM);
    }
  });

  it("keep the plates above a 歩行者用灯器 beside the pole, or report that they do not fit", () => {
    const pedTop = 2.75 + 0.36 + 0.1;
    const two = share([PLATES[0], PLATES[0]], pedTop);
    expect(two.dropped).toBe(0);
    expect(lowest(two)).toBeGreaterThanOrEqual(pedTop - EPS);
    expect(share([{ ...PLATES[0], aux: AUX[3] } as never, PLATES[2]], pedTop).dropped).toBeGreaterThan(0);
  });

  it("report what does not fit (three plates), so the game stands them on their own posts", () => {
    expect(share([PLATES[0], PLATES[0], PLATES[0]]).dropped).toBeGreaterThan(0);
  });

  const pole: SignalPole = {
    pos: new Vector3(3, 0, 0),
    travel: new Vector3(0, 0, -1),
    armY: arm,
    kerbM: 1.2,
    minBottomM: 0,
  };

  it("go to the pole the nearest post for the same traffic, one post per pole, whatever the order", () => {
    const far = plan(new Vector3(0, 0, 0), [design("311-F")]);
    const near = plan(new Vector3(2, 0, 0), [design("323")]);
    const tooFar = plan(new Vector3(20, 0, 0), [design("326-A")]);
    const against: PostPlan = {
      ...plan(new Vector3(3, 0, 1), [design("302")]),
      travel: new Vector3(0, 0, 1),
    };
    expect(sharedPoles([far, near, tooFar, against], [pole])).toEqual([null, pole, null, null]);
  });

  it("never move a plate whose place means something (一時停止, 横断歩道: game.fixedPlace)", () => {
    const stop = plan(new Vector3(2, 0, 0), [design("330-A", { fixedPlace: true }), design("323")]);
    expect(sharedPoles([stop], [pole])).toEqual([null]);
  });

  it("move a post onto its pole when it fits there, and keep its own post when it does not", () => {
    const fits = mountPost(plan(new Vector3(0, 0, 0), [design("311-F")]), pole);
    expect(fits.mount.kind).toBe("signal-share");
    expect(fits.pos.distanceTo(pole.pos)).toBe(0);
    const tooMany = mountPost(
      plan(new Vector3(0, 0, 0), [design("311-F"), design("323"), design("302")]),
      pole,
    );
    expect(tooMany.mount.kind).toBe("double-post");
  });

  it("drop a second column whose foot would stand in a carriageway, keeping the first", () => {
    const threePlates = plan(new Vector3(0, 0, 0), [design("311-F"), design("323"), design("302")]);
    // Travel −z: local −x (the second column, away from the kerb) is world −x.
    const m = mountPost(threePlates, null, (p) => p.x < -0.5).mount;
    expect(m.kind).toBe("single-post");
    expect(m.faces.map((f) => f.column)).toEqual([0, 0]);
    expect(m.dropped).toBe(1);
  });
});

describe("overhead mounts (cantilever-f, gantry)", () => {
  it("lay the 片持式 out as the guide signs did before G4: 5.0 m, 0.55 m off the pole, leaning 3°", () => {
    const w = 2.8;
    const h = 2.2;
    const s = MEMBER_SIZES.value;
    const m = resolveMount({ kind: "cantilever-f", board: { width: w, height: h } });
    const [f] = m.faces;
    expect(bottom(f)).toBe(5);
    expect(f.x - w / 2 - s.guidePoleRadius).toBeCloseTo(BOARD_GAP.value, 9);
    expect(f.pitch).toBeCloseTo((3 * Math.PI) / 180, 12);
    expect(m.feet).toEqual([{ x: 0, z: 0, radius: s.guidePoleRadius, height: 5 + h + 0.3, column: 0 }]);
    const arms = m.members.filter((x) => x.role === "arm");
    expect(arms.map((a) => a.y)).toEqual([5 + h * 0.25, 5 + h * 0.75]);
  });

  it("stand gantry legs outside the clear width, centre every board on the truss, 4.7 m or more up", () => {
    const m = resolveMount({
      kind: "gantry",
      clearWidthM: 10.5,
      boards: [
        { width: 3, height: 2, x: 2 },
        { width: 3, height: 0.6, x: 7.5 },
      ],
    });
    expect(m.dropped).toBe(0);
    for (const foot of m.feet) {
      const isOutside =
        foot.x + foot.radius <= -LEG_CLEAR.value + EPS ||
        foot.x - foot.radius >= 10.5 + LEG_CLEAR.value - EPS;
      expect(isOutside).toBe(true);
    }
    const truss = m.members.find((x) => x.role === "truss");
    for (const f of m.faces) {
      expect(bottom(f)).toBeGreaterThanOrEqual(OVERHEAD_BOTTOM.value.minM);
      expect(f.y).toBeCloseTo(truss?.y ?? NaN, 9);
    }
    const bays = m.members.filter((x) => x.role === "truss");
    for (const b of bays) expect(Math.abs(b.sx - 1)).toBeLessThan(0.1);
    expect(bays.reduce((n, b) => n + b.sx, 0)).toBeCloseTo(m.feet[1].x - m.feet[0].x, 9);
  });

  it("stand gantry legs at legBaseM (a parapet, a lower deck) reaching the same truss", () => {
    const flat = resolveMount({ kind: "gantry", clearWidthM: 8, boards: [{ width: 3, height: 2 }] });
    const raised = resolveMount({
      kind: "gantry",
      clearWidthM: 8,
      boards: [{ width: 3, height: 2 }],
      legBaseM: 1.1,
    });
    const legs = raised.members.filter((x) => x.role === "gantryLeg");
    expect(legs.every((l) => l.y === 1.1)).toBe(true);
    const flatLeg = flat.members.find((x) => x.role === "gantryLeg");
    expect(legs[0].y + legs[0].sy).toBeCloseTo((flatLeg?.y ?? 0) + (flatLeg?.sy ?? 0), 9);
  });

  it("leave off a gantry board that would reach past a leg", () => {
    const m = resolveMount({ kind: "gantry", clearWidthM: 6, boards: [{ width: 3, height: 2, x: 0 }] });
    expect(m.dropped).toBe(1);
    expect(m.faces).toEqual([]);
  });
});

describe("添架 (barrier-mount, girder-mount)", () => {
  it("keep faces on a 壁高欄 outside its inner face and above it, at roadside heights", () => {
    for (const plates of [[PLATES[0]], [PLATES[2], PLATES[0]], [{ ...PLATES[0], aux: AUX[2] }]]) {
      const m = resolveMount({ kind: "barrier-mount", barrierTopM: 1.1, barrierWidthM: 0.5, plates });
      expect(m.dropped).toBe(0);
      for (const f of m.faces) expect(f.x + reachOf(f)).toBeLessThanOrEqual(EPS);
      expect(lowest(m)).toBeGreaterThanOrEqual(Math.max(ROADSIDE_BOTTOM.value.police.roadside.minM, 1.2));
      expect(m.members.find((x) => x.role === "barrierBracket")?.y).toBe(1.1);
    }
  });

  it("hang a board on a girder within its depth, above the 建築限界, or not at all", () => {
    const fits = resolveMount({
      kind: "girder-mount",
      girderBottomM: 5.0,
      girderDepthM: 1.6,
      board: { width: 2.5, height: 1.2 },
    });
    const [f] = fits.faces;
    expect(bottom(f)).toBeGreaterThanOrEqual(5.0);
    expect(top(f)).toBeLessThanOrEqual(6.6);
    const low = resolveMount({
      kind: "girder-mount",
      girderBottomM: 4.5,
      girderDepthM: 0.6,
      board: { width: 2.5, height: 1.2 },
    });
    expect(low.faces).toEqual([]);
    expect(low.dropped).toBe(1);
    // A 重要物流道路 (4.8 m) refuses a board that would do over a 4.5 m road.
    const board = { width: 2.5, height: 1.2 };
    expect(
      resolveMount({ kind: "girder-mount", girderBottomM: 4.55, girderDepthM: 1.6, board }).faces,
    ).toHaveLength(1);
    const logistics = LOGISTICS_CLEARANCE_HEIGHT.value;
    expect(
      resolveMount({
        kind: "girder-mount",
        girderBottomM: 4.55,
        girderDepthM: 1.6,
        board,
        clearanceM: logistics,
      }).faces,
    ).toEqual([]);
  });
});

describe("the member sizes", () => {
  it("equal those signs.py and guide_signs.py model the parts with", () => {
    const s = MEMBER_SIZES.value;
    expect(constant("signs.py", "POST_R")).toBe(s.postRadius);
    expect(constant("signs.py", "SIGNAL_POLE_R")).toBe(s.signalPoleRadius);
    expect(constant("guide_signs.py", "POLE_R")).toBeCloseTo(s.guidePoleRadius, 9);
    expect(constant("guide_signs.py", "POLE_H")).toBe(s.guidePoleHeight);
    expect(constant("guide_signs.py", "ARM_R")).toBeCloseTo(s.guideArmRadius, 9);
    expect(constant("guide_signs.py", "POST_R")).toBeCloseTo(s.guidePostRadius, 9);
    expect(constant("guide_signs.py", "LEG_R")).toBeCloseTo(s.gantryLegRadius, 9);
    expect(constant("guide_signs.py", "TRUSS_D")).toBe(s.trussDepth);
    expect(constant("guide_signs.py", "BOARD_T") + constant("guide_signs.py", "RAIL_D")).toBeCloseTo(
      s.guideRailOffset,
      9,
    );
  });

  it("equal the signal pole's radius in src/world/trafficControl.ts", () => {
    const text = readFileSync(join(ROOT, "src", "world", "trafficControl.ts"), "utf8");
    expect(Number(/const POLE_RADIUS = ([\d.]+);/.exec(text)?.[1])).toBe(MEMBER_SIZES.value.signalPoleRadius);
  });
});
