// How a sign is held up (取付): the seven mounts, and the pure resolveMount that turns a placement
// into faces (where each plate goes) and members (unit parts of signs.glb / guide_signs.glb,
// stretched or repeated). Standards: mountStandards.ts; the game's own values: mountAssumptions.ts.
// knowledge/sign-system.md「支柱と取付（G4）」.
import { z } from "zod";
import {
  ARM_CLEAR,
  BOARD_GAP,
  BOARD_MAX_TOP,
  COLUMN_GAP,
  MEMBER_SIZES,
  POST_MAX_TOP,
  POST_OVER,
  WIDE_PLATE,
} from "./mountAssumptions";
import {
  CLEARANCE_HEIGHT,
  FACE_LIMITS,
  KERB_CLEAR,
  LEG_CLEAR,
  OVERHEAD_BOTTOM,
  ROADSIDE_BOTTOM,
  SHARE_MAX_TOP,
  TILT_DEG,
} from "./mountStandards";
import { columnHeight, stackColumn, type StackInput } from "./stack";

export const MOUNT_KINDS = [
  "single-post",
  "double-post",
  "cantilever-f",
  "gantry",
  "barrier-mount",
  "girder-mount",
  "signal-share",
] as const;
export const MountKindSchema = z.enum(MOUNT_KINDS);
export type MountKind = z.output<typeof MountKindSchema>;

export type MemberSizes = (typeof MEMBER_SIZES)["value"];

/** The unit parts a mount is built from. */
export const MEMBER_ROLES = [
  "post",
  "postCap",
  "rail",
  "band",
  "signalBand",
  "pole",
  "arm",
  "flange",
  "boardPost",
  "gantryLeg",
  "gantryFoot",
  "truss",
  "barrierBracket",
  "girderHanger",
] as const;
export const MemberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.output<typeof MemberRoleSchema>;

/**
 * Which glb node draws each role (every role has one; tests/signMount.test.ts checks the nodes are
 * in the files). TrafficSigns loads the signs.glb ones and GuideSigns the guide_signs.glb ones.
 */
export const MEMBER_NODES: Record<MemberRole, { glb: "signs" | "guide_signs"; node: string }> = {
  post: { glb: "signs", node: "SignPostUnit" },
  postCap: { glb: "signs", node: "SignPostCap" },
  rail: { glb: "signs", node: "SignRail" },
  band: { glb: "signs", node: "SignBand" },
  signalBand: { glb: "signs", node: "SignalBand" },
  barrierBracket: { glb: "signs", node: "BarrierBracket" },
  girderHanger: { glb: "signs", node: "GirderHanger" },
  pole: { glb: "guide_signs", node: "GuidePole" },
  arm: { glb: "guide_signs", node: "GuideArm" },
  flange: { glb: "guide_signs", node: "GuideFlange" },
  boardPost: { glb: "guide_signs", node: "GuidePost" },
  gantryLeg: { glb: "guide_signs", node: "GantryLeg" },
  gantryFoot: { glb: "guide_signs", node: "GantryFoot" },
  truss: { glb: "guide_signs", node: "GantryTruss" },
};

/** One mount as declared: what it carries, which height rule it follows, and its members. */
export const MountSpecSchema = z.strictObject({
  kind: MountKindSchema,
  use: z.string().min(1),
  /** mountStandards.ts ROADSIDE_BOTTOM or OVERHEAD_BOTTOM; "host": the structure it hangs on. */
  bottom: z.enum(["roadside", "overhead", "host"]),
  members: z.array(MemberRoleSchema).min(1),
});
export type MountSpec = z.output<typeof MountSpecSchema>;

export const MOUNTS: Record<MountKind, MountSpec> = Object.fromEntries(
  (
    [
      {
        kind: "single-post",
        use: "規制・警戒・指示（本板 2 段・4 枚まで）",
        bottom: "roadside",
        members: ["post", "postCap", "rail", "band"],
      },
      {
        kind: "double-post",
        use: "左右に振り分けた本板、幅の広い板、路側式の案内標識",
        bottom: "roadside",
        members: ["post", "postCap", "rail", "band", "boardPost"],
      },
      {
        kind: "cantilever-f",
        use: "片持式（案内標識 108 系）",
        bottom: "overhead",
        members: ["pole", "arm", "flange"],
      },
      {
        kind: "gantry",
        use: "門型（多車線・都市高速の本線）",
        bottom: "overhead",
        members: ["gantryLeg", "gantryFoot", "truss"],
      },
      {
        kind: "barrier-mount",
        use: "壁高欄への添架（都市高速）",
        bottom: "roadside",
        members: ["barrierBracket", "post", "postCap", "rail", "band"],
      },
      { kind: "girder-mount", use: "桁・歩道橋への添架", bottom: "host", members: ["girderHanger"] },
      { kind: "signal-share", use: "信号柱への共架", bottom: "roadside", members: ["signalBand", "rail"] },
    ] as const
  ).map((m) => [m.kind, MountSpecSchema.parse({ ...m, members: [...m.members] })]),
) as Record<MountKind, MountSpec>;

const FaceInSchema = z.strictObject({
  width: z.number().positive(),
  height: z.number().positive(),
  /** Mounted parallel to the street (326-A): reaches along the travel, not across. */
  parallel: z.boolean().optional(),
  /** Drawn on both sides: no rail or band behind it. */
  twoSided: z.boolean().optional(),
});
const PlateInSchema = FaceInSchema.extend({
  aux: z.array(FaceInSchema).optional(),
  /** On the column nearest the carriageway when the plates are split (横断歩道, game.kerbSide). */
  kerbSide: z.boolean().optional(),
});
const BoardInSchema = z.strictObject({
  width: z.number().positive(),
  height: z.number().positive(),
  /** Centre across, from the mount's origin (gantry: the left edge of the clear width), m. */
  x: z.number().optional(),
});
const Plates = z.array(PlateInSchema).min(1);
const AuthoritySchema = z.enum(["police", "road"]);
const SiteSchema = z.enum(["pavement", "roadside"]);
/** 建築限界 under an overhead mount: 4.5 m (CLEARANCE_HEIGHT), 4.8 m on a 重要物流道路. */
const Clearance = z.number().positive().optional();

/**
 * A placement in the mount's own frame: origin on the ground at the reference foot, +x across
 * toward the carriageway, +y up, +z toward the traffic the faces address. Sizes are as drawn
 * (scaled), in metres.
 */
export const MountPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["single-post", "double-post"]),
    site: SiteSchema,
    /** Whose standard: "police" (交通規制基準, the default) or "road" (道路標識設置基準). */
    authority: AuthoritySchema.optional(),
    /**
     * "sign" (the default): 60.5 mm posts with rails and bands. "guide": one 案内標識 board on two
     * φ89.1 posts (GuidePost, its rails built into the board), its edge KERB_CLEAR from the kerb.
     */
    support: z.enum(["sign", "guide"]).optional(),
    /** From the post's foot to the carriageway edge. */
    kerbM: z.number().nonnegative(),
    plates: Plates,
  }),
  z.strictObject({
    kind: z.literal("signal-share"),
    site: SiteSchema,
    kerbM: z.number().nonnegative(),
    /** Height of the signal arm above the pole's foot. */
    armY: z.number().positive(),
    /** Faces stay above this (a 歩行者用灯器 on a pole beside it), m above the foot. */
    minBottomM: z.number().nonnegative().optional(),
    plates: Plates,
  }),
  z.strictObject({ kind: z.literal("cantilever-f"), board: BoardInSchema, clearanceM: Clearance }),
  z.strictObject({
    kind: z.literal("gantry"),
    /** Between the kerbs or the 壁高欄 the legs stand outside of. */
    clearWidthM: z.number().positive(),
    boards: z.array(BoardInSchema).min(1),
    clearanceM: Clearance,
    /** Where the legs stand, above the road the boards are measured from (a parapet, a lower deck). */
    legBaseM: z.number().optional(),
  }),
  z.strictObject({
    kind: z.literal("barrier-mount"),
    /** Top of the 壁高欄 above the road; it spans x from −barrierWidthM to 0 (its inner face). */
    barrierTopM: z.number().positive(),
    barrierWidthM: z.number().positive(),
    plates: Plates,
  }),
  z.strictObject({
    kind: z.literal("girder-mount"),
    /** Underside of the girder above the road, and its depth; its face is the plane z = 0. */
    girderBottomM: z.number().positive(),
    girderDepthM: z.number().positive(),
    board: BoardInSchema,
    clearanceM: Clearance,
  }),
]);
export type MountPlacement = z.input<typeof MountPlacementSchema>;
type FaceIn = z.input<typeof FaceInSchema>;
type PlateIn = z.input<typeof PlateInSchema>;
type BoardIn = z.input<typeof BoardInSchema>;

/**
 * Where a face goes: the support's axis at (x, y, z) and the face `standoff` in front of it (along
 * +z, or toward the carriageway for a parallel face); `pitch` leans it forward (radians).
 * `column`: which column of a split post it hangs in (0 elsewhere), so the game can hide one alone.
 */
export type MountFace = {
  plate: number;
  aux: number | null;
  x: number;
  y: number;
  z: number;
  standoff: number;
  width: number;
  height: number;
  pitch: number;
  parallel: boolean;
  column: number;
};
/** A unit part placed at (x, y, z) and scaled by (sx, sy, sz), leaning `pitch` about +x. */
export type MountMember = {
  role: MemberRole;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  pitch: number;
  column: number;
};
/** Where a support stands on the ground, for its collider and the building test. */
export type MountFoot = { x: number; z: number; radius: number; height: number; column: number };

export type ResolvedMount = {
  kind: MountKind;
  faces: MountFace[];
  members: MountMember[];
  feet: MountFoot[];
  /** Faces left off: no room within the mount's limits (the caller logs them, or falls back). */
  dropped: number;
};

/** A member at (x, y, depth) scaled by (sx, sy, sz); `depth` is its z (the zod import owns `z`). */
const member = (
  role: MemberRole,
  x: number,
  y: number,
  depth: number,
  scale: { sx?: number; sy?: number; pitch?: number; column?: number } = {},
): MountMember => ({
  role,
  x,
  y,
  z: depth,
  sx: scale.sx ?? 1,
  sy: scale.sy ?? 1,
  sz: 1,
  pitch: scale.pitch ?? 0,
  column: scale.column ?? 0,
});

/** Turns a placement into faces, members and feet. Pure; never throws for a valid placement. */
export function resolveMount(
  placement: MountPlacement,
  sizes: MemberSizes = MEMBER_SIZES.value,
): ResolvedMount {
  switch (placement.kind) {
    case "single-post":
    case "double-post":
      return resolvePosts(placement, sizes);
    case "signal-share":
      return resolveSignalShare(placement, sizes);
    case "cantilever-f":
      return resolveCantilever(placement.board, sizes);
    case "gantry":
      return resolveGantry(placement, sizes);
    case "barrier-mount":
      return resolveBarrier(placement, sizes);
    case "girder-mount":
      return resolveGirder(placement);
  }
}

/** The mount without one column of a split post (its faces counted as dropped). */
export function withoutColumn(m: ResolvedMount, column: number): ResolvedMount {
  const faces = m.faces.filter((f) => f.column !== column);
  const feet = m.feet.filter((f) => f.column !== column);
  return {
    kind: feet.length > 1 ? m.kind : m.kind === "double-post" ? "single-post" : m.kind,
    faces,
    members: m.members.filter((x) => x.column !== column),
    feet,
    dropped: m.dropped + m.faces.length - faces.length,
  };
}

// ---------------------------------------------------------------- columns of plates

type Column = { plates: number[]; wide: boolean };

const faceCount = (p: PlateIn) => 1 + (p.aux?.length ?? 0);
const stackInput = (p: PlateIn): StackInput => ({
  height: p.height,
  aux: (p.aux ?? []).map((a) => a.height),
});
/** How far a face reaches across from its column's axis. */
const reach = (f: FaceIn) => (f.parallel ? 0.05 : f.width / 2);
const columnReach = (plates: readonly PlateIn[], col: Column) =>
  Math.max(...col.plates.flatMap((i) => [plates[i], ...(plates[i].aux ?? [])]).map(reach));
const heightOf = (plates: readonly PlateIn[], col: Column) =>
  columnHeight(col.plates.map((i) => stackInput(plates[i])));

/**
 * Splits the plates, in order, into at most `maxColumns` columns. Each plate goes into the first
 * column it fits (fewer than two 本板, at most four faces, within `room` = top limit − lowest edge),
 * else starts a new one. A wide plate stands alone. Plates that find no column are counted.
 *
 * Why first fit and not only the last column: [plate, wide, plate] would otherwise need three
 * columns and drop the third plate, though it fits under the first (review I1).
 */
function partition(
  plates: readonly PlateIn[],
  room: number,
  maxColumns: number,
): { columns: Column[]; dropped: number } {
  const columns: Column[] = [];
  let dropped = 0;
  const { plates: maxPlates, faces: maxFaces } = FACE_LIMITS.value;
  for (const [i, plate] of plates.entries()) {
    const isWide = !plate.parallel && plate.width > WIDE_PLATE.value;
    const joinedHeight = (col: Column) => columnHeight([...col.plates, i].map((k) => stackInput(plates[k])));
    const isAllowed = (col: Column) =>
      !col.wide &&
      !isWide &&
      col.plates.length < maxPlates &&
      [...col.plates, i].reduce((n, k) => n + faceCount(plates[k]), 0) <= maxFaces;
    const home = columns.find((col) => isAllowed(col) && joinedHeight(col) <= room);
    if (home) {
      home.plates.push(i);
      continue;
    }
    const isFull = columns.length >= maxColumns;
    if (!isFull) {
      columns.push({ plates: [i], wide: isWide });
      continue;
    }
    // No room left: the lowest column the face limits still allow takes it, and the mount raises
    // its top (review I1: raising beats leaving a plate off). None: the plate is counted off.
    const raised = columns.filter(isAllowed).toSorted((a, b) => joinedHeight(a) - joinedHeight(b))[0];
    if (raised) raised.plates.push(i);
    else dropped += faceCount(plate);
  }
  return { columns, dropped };
}

type Hung = { plate: number; aux: number | null; y: number; height: number; f: FaceIn };

/** The faces of a column hung from `top`, those that would go below `floor` left off. */
function hangColumn(
  plates: readonly PlateIn[],
  col: Column,
  top: number,
  floor: number,
): { faces: Hung[]; dropped: number } {
  const own = col.plates.map((i) => plates[i]);
  const faces: Hung[] = [];
  let dropped = 0;
  for (const s of stackColumn(top, own.map(stackInput))) {
    const plate = own[s.plate];
    const isBelowFloor = s.y - s.height / 2 < floor - 1e-9;
    if (isBelowFloor) {
      dropped++;
      continue;
    }
    const f = s.aux === null ? plate : (plate.aux ?? [])[s.aux];
    faces.push({ plate: col.plates[s.plate], aux: s.aux, y: s.y, height: s.height, f });
  }
  return { faces, dropped };
}

/** A face record from a hung face at (x, 0) with the given standoff. */
const faceAt = (h: Hung, x: number, standoff: number, column: number): MountFace => ({
  plate: h.plate,
  aux: h.aux,
  x,
  y: h.y,
  z: 0,
  standoff,
  width: h.f.width,
  height: h.height,
  pitch: 0,
  parallel: h.f.parallel === true,
  column,
});
const hasBracket = (f: FaceIn) => !f.parallel && !f.twoSided;
/** The rail behind a plate: 8 tenths of its width, 40 cm at most (a 30 cm plate's rail stays behind it). */
const railFor = (f: FaceIn) => Math.min(0.4, 0.8 * f.width);

/**
 * 路側式 on one or two posts. The plates go into columns (partition); more than one column, or a
 * wide plate, stands on two posts. All columns hang from one top: as high as the standard lower
 * edge asks, no higher than the post allows, but raised past that rather than leaving a face off.
 * Column 0 is at the post's foot, moved back from the carriageway just enough that its faces stay
 * KERB_CLEAR from the kerb; column 1 stands beside it, further from the carriageway (the driver's
 * left). Asking for "double-post" stands even a narrow first plate on two posts.
 *
 * Why two columns side by side and not a taller post: 交通規制基準 第2章 9 (2) ア allows two 本板 on
 * one face, and three plates on one post put the lowest one under 1.8 m (G2's posts did).
 */
function resolvePosts(
  p: Extract<MountPlacement, { kind: "single-post" | "double-post" }>,
  sizes: MemberSizes,
): ResolvedMount {
  const plates = p.plates;
  const isGuide = p.support === "guide";
  const isBoard = isGuide || p.kind === "double-post";
  const bottom = ROADSIDE_BOTTOM.value[p.authority ?? "police"][p.site];
  const hasWide = isBoard || plates.some((q) => !q.parallel && q.width > WIDE_PLATE.value);
  // A guide board has no post limit: its lower edge is what 設置基準 fixes.
  const maxTop = isGuide ? Infinity : hasWide ? BOARD_MAX_TOP.value : POST_MAX_TOP.value;
  const room = Math.max(maxTop - bottom.minM, 0);
  const { columns: split, dropped: overflow } = partition(plates, room, 2);
  if (isBoard && split[0]) split[0].wide = true;
  const kerbColumn = split.findIndex((c) => c.plates.some((i) => plates[i].kerbSide === true));
  const columns = kerbColumn > 0 ? [split[kerbColumn], ...split.filter((_, k) => k !== kerbColumn)] : split;
  const tallest = Math.max(...columns.map((c) => heightOf(plates, c)));
  const top = Math.max(Math.min(maxTop, bottom.standardM + tallest), bottom.minM + tallest);
  const kerbRoom = p.kerbM - KERB_CLEAR.value;
  const postRadius = isGuide ? sizes.guidePostRadius : sizes.postRadius;
  // A guide board's rails (43 mm deep) clamp to the front of its posts.
  const standoff = isGuide ? sizes.guidePostRadius + 0.05 : sizes.postRadius + 0.02;
  const faces: MountFace[] = [];
  const members: MountMember[] = [];
  const feet: MountFoot[] = [];
  let dropped = overflow;
  let x = 0;
  for (const [k, col] of columns.entries()) {
    const half = columnReach(plates, col);
    const prevHalf = k > 0 ? columnReach(plates, columns[k - 1]) : 0;
    // A guide board keeps its edge exactly KERB_CLEAR behind the kerb, as before G4.
    const firstX = isGuide ? kerbRoom - half : Math.min(0, kerbRoom - half);
    x = k === 0 ? firstX : x - prevHalf - COLUMN_GAP.value - half;
    const widest = Math.max(...col.plates.map((i) => plates[i].width));
    const postXs = col.wide ? [x - 0.28 * widest, x + 0.28 * widest] : [x];
    // GuidePost has its cap and reaches the board's top; a sign post rises a little over its top face.
    const postTop = isGuide ? top : top + POST_OVER.value;
    for (const px of postXs) {
      feet.push({ x: px, z: 0, radius: postRadius, height: postTop, column: k });
      if (isGuide) {
        members.push(member("boardPost", px, 0, 0, { sy: postTop, column: k }));
        continue;
      }
      members.push(
        member("post", px, 0, 0, { sy: postTop, column: k }),
        member("postCap", px, postTop, 0, { column: k }),
      );
    }
    const hung = hangColumn(plates, col, top, bottom.minM);
    dropped += hung.dropped;
    for (const h of hung.faces) {
      faces.push(faceAt(h, x, standoff, k));
      const isBracketed = !isGuide && hasBracket(h.f);
      if (!isBracketed) continue;
      const rail = col.wide ? postXs[1] - postXs[0] + 0.1 : railFor(h.f);
      members.push(member("rail", x, h.y, standoff, { sx: rail, column: k }));
      for (const px of postXs) members.push(member("band", px, h.y, standoff, { column: k }));
    }
  }
  return { kind: feet.length > 1 ? "double-post" : "single-post", faces, members, feet, dropped };
}

/**
 * 信号柱への共架: one column on the signal pole, under its arm (and the heads and 交差点名 on the arm)
 * and no higher than 6 m (交通規制基準 第2章 3 表 4), and above `minBottomM` when a 歩行者用灯器
 * stands beside the pole. Faces left off mean it does not fit: the caller stands the plates on
 * their own post instead (設置基準 3-1-2 (3): sharing is an option, not a rule).
 */
function resolveSignalShare(
  p: Extract<MountPlacement, { kind: "signal-share" }>,
  sizes: MemberSizes,
): ResolvedMount {
  const site = ROADSIDE_BOTTOM.value.police[p.site];
  const floor = Math.max(site.minM, p.minBottomM ?? 0);
  const standard = Math.max(site.standardM, floor);
  const maxTop = Math.min(p.armY - ARM_CLEAR.value, SHARE_MAX_TOP.value);
  const { columns, dropped: overflow } = partition(p.plates, maxTop - floor, 1);
  const col = columns[0];
  const isTooWide = col.wide || columnReach(p.plates, col) > p.kerbM - KERB_CLEAR.value;
  if (isTooWide) {
    const all = p.plates.reduce((n, q) => n + faceCount(q), 0);
    return { kind: "signal-share", faces: [], members: [], feet: [], dropped: all };
  }
  const top = Math.min(maxTop, standard + heightOf(p.plates, col));
  const hung = hangColumn(p.plates, col, top, floor);
  const standoff = sizes.signalPoleRadius + 0.05;
  const faces: MountFace[] = [];
  const members: MountMember[] = [];
  for (const h of hung.faces) {
    faces.push(faceAt(h, 0, standoff, 0));
    if (!hasBracket(h.f)) continue;
    members.push(
      member("rail", 0, h.y, standoff, { sx: railFor(h.f) }),
      member("signalBand", 0, h.y, standoff),
    );
  }
  return { kind: "signal-share", faces, members, feet: [], dropped: overflow + hung.dropped };
}

// ---------------------------------------------------------------- overhead

/**
 * 片持式（F 形）: the board's lower edge at 5.0 m, its inner edge BOARD_GAP from the pole, two arms
 * a quarter and three quarters up the board, leaning TILT_DEG forward. The layout src/world/
 * guideSigns.ts had before G4, moved here unchanged.
 */
function resolveCantilever(board: BoardIn, sizes: MemberSizes): ResolvedMount {
  const { width: w, height: h } = board;
  const bottom = OVERHEAD_BOTTOM.value.standardM;
  const poleTop = bottom + h + 0.3;
  const offset = sizes.guidePoleRadius + BOARD_GAP.value + w / 2;
  const behind = sizes.guideArmRadius + 0.02;
  const members: MountMember[] = [member("pole", 0, 0, 0, { sy: poleTop / sizes.guidePoleHeight })];
  for (const f of [0.25, 0.75]) {
    const y = bottom + h * f;
    members.push(member("arm", 0, y, -behind, { sx: offset + w / 2 - 0.15 }), member("flange", 0, y, 0));
  }
  const face: MountFace = {
    plate: 0,
    aux: null,
    x: offset,
    y: bottom + h / 2,
    z: sizes.guideRailOffset - behind + sizes.guideArmRadius,
    standoff: 0,
    width: w,
    height: h,
    pitch: (TILT_DEG.value * Math.PI) / 180,
    parallel: false,
    column: 0,
  };
  const feet = [{ x: 0, z: 0, radius: sizes.guidePoleRadius, height: poleTop, column: 0 }];
  return { kind: "cantilever-f", faces: [face], members, feet, dropped: 0 };
}

/** The lowest lower edge an overhead board may have over a road with 建築限界 `clearanceM`. */
const overheadFloor = (clearanceM = CLEARANCE_HEIGHT.value) =>
  Math.max(OVERHEAD_BOTTOM.value.minM, clearanceM);

/**
 * 門型: two legs LEG_CLEAR outside the clear width (x from 0 to clearWidthM), standing at
 * `legBaseM`; a truss of 1 m bays across (the bays are repeated, not stretched, so the diagonals
 * keep their angle; the last few percent are shared by all bays) behind the middle of the tallest
 * board, whose lower edge is at 5.0 m; every board centred on the truss, so a short one is clamped
 * across it too. A board that would reach past a leg, or under the 建築限界, is left off.
 */
function resolveGantry(p: Extract<MountPlacement, { kind: "gantry" }>, sizes: MemberSizes): ResolvedMount {
  const r = sizes.gantryLegRadius;
  const left = -(LEG_CLEAR.value + r);
  const right = p.clearWidthM + LEG_CLEAR.value + r;
  const base = p.legBaseM ?? 0;
  const tallest = Math.max(...p.boards.map((b) => b.height));
  const trussY = OVERHEAD_BOTTOM.value.standardM + tallest / 2;
  const legTop = trussY + sizes.trussDepth / 2;
  const members: MountMember[] = [];
  for (const x of [left, right])
    members.push(member("gantryLeg", x, base, 0, { sy: legTop - base }), member("gantryFoot", x, base, 0));
  const span = right - left;
  const bays = Math.max(1, Math.round(span));
  for (let i = 0; i < bays; i++)
    members.push(member("truss", left + (i * span) / bays, trussY, 0, { sx: span / bays }));
  const floor = overheadFloor(p.clearanceM);
  const faces: MountFace[] = [];
  let dropped = 0;
  for (const [i, b] of p.boards.entries()) {
    const x = b.x ?? p.clearWidthM / 2;
    const isClear =
      x - b.width / 2 >= left + r && x + b.width / 2 <= right - r && trussY - b.height / 2 >= floor;
    if (!isClear) {
      dropped++;
      continue;
    }
    faces.push({
      plate: i,
      aux: null,
      x,
      y: trussY,
      z: sizes.trussDepth / 2 + sizes.guideRailOffset,
      standoff: 0,
      width: b.width,
      height: b.height,
      pitch: (TILT_DEG.value * Math.PI) / 180,
      parallel: false,
      column: 0,
    });
  }
  const feet = [left, right].map((x) => ({ x, z: 0, radius: r, height: legTop - base, column: 0 }));
  return { kind: "gantry", faces, members, feet, dropped };
}

// ---------------------------------------------------------------- 添架

/**
 * 壁高欄への添架: a clamp on the parapet's top and a short 60.5 mm post on it carrying one column.
 * 路側 heights (設置基準 3-1-2 (2) 3): 添架式 follows the other mounts), the lower edge at least 10 cm
 * over the parapet; every face stays outside the parapet's inner face (x ≤ 0), so nothing reaches
 * over the 路肩 into the carriageway's 建築限界.
 */
function resolveBarrier(
  p: Extract<MountPlacement, { kind: "barrier-mount" }>,
  sizes: MemberSizes,
): ResolvedMount {
  const site = ROADSIDE_BOTTOM.value.police.roadside;
  const floor = Math.max(site.minM, p.barrierTopM + 0.1);
  const standard = Math.max(site.standardM, floor);
  const { columns, dropped: overflow } = partition(p.plates, POST_MAX_TOP.value - floor, 1);
  const col = columns[0];
  const postX = -p.barrierWidthM / 2;
  const x = Math.min(postX, -columnReach(p.plates, col));
  const h = heightOf(p.plates, col);
  const top = Math.max(Math.min(POST_MAX_TOP.value, standard + h), floor + h);
  const hung = hangColumn(p.plates, col, top, floor);
  const postTop = top + POST_OVER.value;
  const members: MountMember[] = [
    member("barrierBracket", postX, p.barrierTopM, 0),
    member("post", postX, p.barrierTopM, 0, { sy: postTop - p.barrierTopM }),
    member("postCap", postX, postTop, 0),
  ];
  const standoff = sizes.postRadius + 0.02;
  const faces: MountFace[] = [];
  for (const f of hung.faces) {
    faces.push(faceAt(f, x, standoff, 0));
    if (!hasBracket(f.f)) continue;
    members.push(member("rail", x, f.y, standoff, { sx: Math.max(railFor(f.f), postX - x + 0.1) }));
    members.push(member("band", postX, f.y, standoff));
  }
  return { kind: "barrier-mount", faces, members, feet: [], dropped: overflow + hung.dropped };
}

/**
 * 桁・歩道橋への添架: the board on two hangers bolted to the girder's face, centred in the girder's
 * depth when it fits and otherwise with its top 5 cm under the girder's top. Its lower edge must
 * stay 4.7 m and the 建築限界 or more above the road (設置基準 3-1-2 (2) 3): 添架式 follows 片持式・
 * 門型式); if it cannot, nothing is hung.
 */
function resolveGirder(p: Extract<MountPlacement, { kind: "girder-mount" }>): ResolvedMount {
  const { width: w, height: h } = p.board;
  const x = p.board.x ?? 0;
  const fitsInDepth = h <= p.girderDepthM - 0.1;
  const y = fitsInDepth
    ? p.girderBottomM + p.girderDepthM / 2
    : p.girderBottomM + p.girderDepthM - 0.05 - h / 2;
  const isTooLow = y - h / 2 < overheadFloor(p.clearanceM);
  if (isTooLow) return { kind: "girder-mount", faces: [], members: [], feet: [], dropped: 1 };
  const members = [-0.3, 0.3].map((f) => member("girderHanger", x + f * w, y, 0, { sy: h }));
  const face: MountFace = {
    plate: 0,
    aux: null,
    x,
    y,
    z: 0.06,
    standoff: 0,
    width: w,
    height: h,
    pitch: 0,
    parallel: false,
    column: 0,
  };
  return { kind: "girder-mount", faces: [face], members, feet: [], dropped: 0 };
}
