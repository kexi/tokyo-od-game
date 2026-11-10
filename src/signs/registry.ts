import { z } from "zod";
import { layoutJson, type Json } from "./jsonLayout";
import { AUX_TEXT_PLATES, PLATES, plateBoxMm } from "./plates";
import {
  AuxRenderSchema,
  DISPLAY_SCALE,
  ENLARGEMENT,
  PAINTER_MODULES,
  LaneRenderSchema,
  LawTableSchema,
  SignDefSchema,
  isLawfulScale,
  type AuxRender,
  type LaneRender,
  type Paint,
  type Plate,
  type LawTable,
  type PlateNode,
  type SignDef,
  type Variant,
} from "./schema";

/**
 * The checked, resolved form of the sign definitions: what scripts/signs.ts writes as
 * assets/signs/registry.json (what the Pillow generator draws faces from and Blender builds the
 * plates of signs.glb from) and what the legacy catalog.json, game.json and the coverage report are
 * derived from.
 */
export type Registry = {
  version: 3;
  law: LawTable["law"];
  /** src/signs/plates.ts with the box each texture covers. */
  plates: Record<PlateNode, Plate>;
  /** The scripts/textures modules a `paint.fn` may name (sign_textures.py imports exactly these). */
  painterModules: typeof PAINTER_MODULES;
  /**
   * Each definition with its plate resolved (a `shares` sign's from the number it shares) and its
   * 別表第二 figure (from the law table; null for 法定外 or where none).
   */
  signs: ResolvedSign[];
  lanes: Array<LaneRender & { file: string; plate: PlateNode }>;
  /** 補助標識 faces for the game's regulations (defs/auxiliary.ts auxRenders), with their painter. */
  aux: ResolvedAux[];
};

/**
 * `displayScale` is resolved from the group (DISPLAY_SCALE) unless the definition gives one; null
 * for a 補助標識, drawn at the scale of the plate above it.
 */
export type ResolvedSign = Omit<SignDef, "plate" | "displayScale"> & {
  plate: PlateNode | null;
  displayScale: number | null;
  figure: string | null;
};

/**
 * A 補助標識 face drawn ahead of time. `paint` is the number's own painter with `lines` replaced,
 * `colors` the palette it is saved with: black lettering on white needs no more, and a palette PNG
 * is a fifth of the RGBA one (there are hundreds of these).
 */
export type ResolvedAux = AuxRender & { file: string; plate: PlateNode; paint: Paint; colors: 16 };

/** One face of a sign: the PNG and the plate it goes on. */
export type Face = { key: string | null; file: string; plate: PlateNode };

/** 327の7 lane renders: the PNG of a lane key (the generator draws it from the key, lanes.py spec_of). */
export const laneFile = (lanes: string) => `327-7_${lanes}.png`;

/** 40 cm per lane × 90 cm, one lane on the 90 cm square (as lanes.py plate_size draws them). */
export function lanePlate(lanes: string): PlateNode {
  const n = lanes.split("-").length;
  return (n === 1 ? "PlateSquare90" : `PlateRect${n * 40}x90`) as PlateNode;
}

/** 32-bit FNV-1a of a string's UTF-16 units, as 8 hex digits. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * The PNG of a 補助標識 face drawn for the game: the number, then a hash of its lines. Why a hash:
 * the lines are Japanese with 「・」 and 「:」, and a readable slug would need its own escaping
 * rules; buildRegistry rejects two faces landing on one file.
 */
export const auxFile = (r: AuxRender) => `${r.sign.replace(/の/g, "-")}_h${fnv1a(r.lines.join("\n"))}.png`;

/** The plate for the lines (plates.ts AUX_TEXT_PLATES); undefined past three lines. */
export function auxPlate(r: AuxRender): PlateNode | undefined {
  return AUX_TEXT_PLATES[r.lines.length - 1];
}

/** Fails with every problem at once (path and message), not just the first. */
function parseAll<T>(schema: z.ZodType<T>, items: readonly unknown[], what: string): T[] {
  const problems: string[] = [];
  const out = items.flatMap((item, i) => {
    const r = schema.safeParse(item);
    if (r.success) return [r.data];
    const id = (item as { id?: string }).id ?? `#${i}`;
    for (const issue of r.error.issues)
      problems.push(`${what} ${id} ${issue.path.join(".")}: ${issue.message}`);
    return [];
  });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return out;
}

/** Values that occur more than once. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) twice.add(v);
    seen.add(v);
  }
  return [...twice];
}

/**
 * The checks the schema cannot make on one definition alone: ids, shared plates, the law table,
 * variant keys and the lane renders. Every problem is listed, one per line.
 */
function crossCheck(signs: SignDef[], renders: LaneRender[], aux: AuxRender[], table: LawTable): string[] {
  const problems: string[] = [];
  const known = new Map(signs.map((s) => [s.id, s]));
  const lawIds = new Set(table.signs.map((r) => r.id));
  for (const id of duplicates(signs.map((s) => s.id))) problems.push(`sign ${id}: defined more than once`);
  for (const s of signs) {
    const isOutsideLaw = s.group !== "法定外" && !lawIds.has(s.id);
    if (isOutsideLaw) problems.push(`sign ${s.id}: not a 番号 of 別表第一 (law-table.json)`);
    if (s.shares === undefined) continue;
    const target = known.get(s.shares);
    const isBrokenShare = target?.art?.by !== "texture";
    if (isBrokenShare) problems.push(`sign ${s.id}: shares ${s.shares}, which is not drawn on its own`);
    const isOtherPlate = s.plate !== undefined && target !== undefined && s.plate !== target.plate;
    if (isOtherPlate) problems.push(`sign ${s.id}: plate ${s.plate} is not the plate of ${s.shares}`);
  }
  for (const r of renders) {
    const isLaneSign = known.get(r.sign)?.art?.by === "texture";
    if (!isLaneSign) problems.push(`lane ${r.lanes}: sign ${r.sign} is not a drawn definition`);
    const hasPlate = lanePlate(r.lanes) in PLATES;
    if (!hasPlate) problems.push(`lane ${r.lanes}: no plate ${lanePlate(r.lanes)}`);
  }
  for (const key of duplicates(renders.map((r) => r.lanes)))
    problems.push(`lane ${key}: rendered more than once`);
  for (const s of signs) {
    const art = s.art;
    if (art?.by !== "texture") continue;
    const lanes = renders.filter((r) => r.sign === s.id && laneFile(r.lanes) !== art.file);
    const keys = [...art.variants.map((v) => v.key), ...lanes.map((r) => `lanes:${r.lanes}`)];
    for (const key of duplicates(keys)) problems.push(`sign ${s.id}: variant key ${key} used more than once`);
  }
  problems.push(
    ...paintProblems(signs, renders),
    ...gameProblems(signs, renders),
    ...scaleProblems(signs),
    ...auxProblems(signs, aux),
  );
  return problems;
}

/** Every resolved scale is one 別表第二 備考一(二) allows the group (ENLARGEMENT). */
function scaleProblems(signs: SignDef[]): string[] {
  return signs.flatMap((s) => {
    const scale = displayScaleOf(s);
    if (isLawfulScale(s.group, scale)) return [];
    return [`sign ${s.id}: displayScale ${scale} is outside ${JSON.stringify(ENLARGEMENT[s.group])}`];
  });
}

const displayScaleOf = (s: SignDef): number | null => s.displayScale ?? DISPLAY_SCALE[s.group];

/**
 * A 補助標識 face drawn for the game belongs to a drawn 補助標識 whose painter takes `lines`, has
 * a plate for its line count, and has a file of its own (not another face's, not another render's).
 */
function auxProblems(signs: SignDef[], aux: AuxRender[]): string[] {
  const problems: string[] = [];
  const known = new Map(signs.map((s) => [s.id, s]));
  for (const r of aux) {
    const s = known.get(r.sign);
    const paint = s?.art?.by === "texture" ? s.art.paint : undefined;
    const isTextPlate = s?.group === "補助" && paint?.args !== undefined && "lines" in paint.args;
    const name = `aux ${r.sign} ${r.lines.join("/")}`;
    if (!isTextPlate) problems.push(`${name}: not a drawn 補助標識 painted from lines`);
    const hasPlate = auxPlate(r) !== undefined;
    if (!hasPlate) problems.push(`${name}: no plate for ${r.lines.length} lines`);
  }
  const artFiles = new Set(
    signs.flatMap((s) => (s.art?.by === "texture" ? [s.art.file, ...s.art.variants.map((v) => v.file)] : [])),
  );
  const files = aux.map(auxFile);
  for (const f of duplicates(files)) problems.push(`aux ${f}: two faces on one file`);
  for (const f of files.filter((x) => artFiles.has(x))) problems.push(`aux ${f}: is a definition's face`);
  return problems;
}

/**
 * The game types resolve to one face for every placement: one definition for a type shown by its
 * default face, distinct values for one shown by value (and values nowhere else), lane renders for
 * one shown by lanes, a `back` that is a variant. Legacy names are unique and are not ids.
 */
function gameProblems(signs: SignDef[], renders: LaneRender[]): string[] {
  const problems: string[] = [];
  const byKind = new Map<string, SignDef[]>();
  for (const s of signs) if (s.game) byKind.set(s.game.kind, [...(byKind.get(s.game.kind) ?? []), s]);
  for (const [kind, defs] of byKind) {
    const picks = new Set(defs.map((s) => s.game?.pick ?? "default"));
    if (picks.size > 1) problems.push(`game ${kind}: its definitions pick faces in different ways`);
    // game.json keeps one mounting per type, so every definition of the type must agree on it.
    const mounts = new Set(defs.map((s) => JSON.stringify([s.game?.mount, s.game?.back, s.game?.bothFaces])));
    if (mounts.size > 1) problems.push(`game ${kind}: its definitions differ in mount, back or bothFaces`);
    const pick = [...picks][0];
    const isAmbiguous = pick === "default" && defs.length > 1;
    if (isAmbiguous)
      problems.push(`game ${kind}: shown by default face, but ${defs.map((s) => s.id)} claim it`);
    const values = defs.flatMap((s) => valuedFaces(s).map((f) => f.gameValue));
    if (pick === "value" && values.length === 0)
      problems.push(`game ${kind}: picks by value, but no face has one`);
    for (const v of duplicates(values.map(String)))
      problems.push(`game ${kind}: value ${v} on more than one face`);
    const hasLanes = defs.some((s) => renders.some((r) => r.sign === s.id));
    if (pick === "lanes" && !hasLanes) problems.push(`game ${kind}: picks by lanes, but none are rendered`);
  }
  for (const s of signs) {
    const isStrayValue = valuedFaces(s).length > 0 && s.game?.pick !== "value";
    if (isStrayValue)
      problems.push(`sign ${s.id}: gameValue on a sign whose game type does not pick by value`);
    const back = s.game?.back;
    const variants = s.art?.by === "texture" ? s.art.variants : [];
    const isUnknownBack = back !== undefined && !variants.some((v) => v.key === back);
    if (isUnknownBack) problems.push(`sign ${s.id}: game.back ${back} is not one of its variants`);
  }
  const ids = new Set(signs.map((s) => s.id));
  const legacy = signs.flatMap((s) => s.legacy ?? []);
  for (const name of duplicates(legacy)) problems.push(`legacy ${name}: given to more than one sign`);
  for (const name of legacy.filter((n) => ids.has(n))) problems.push(`legacy ${name}: is a sign id`);
  return problems;
}

/** The faces of a definition that carry a gameValue. */
function valuedFaces(s: SignDef): Array<{ gameValue: number }> {
  const art = s.art;
  if (art?.by !== "texture") return [];
  return [art, ...art.variants].flatMap((f) =>
    f.gameValue === undefined ? [] : [{ gameValue: f.gameValue }],
  );
}

/**
 * Every face has a painter, except lane renders (lanes.lane_sign draws them from the key), and a
 * face drawn over another names one that is drawn on its own.
 */
function paintProblems(signs: SignDef[], renders: LaneRender[]): string[] {
  const problems: string[] = [];
  const laneFiles = new Set(renders.map((r) => laneFile(r.lanes)));
  const faces = signs.flatMap((s) => {
    const art = s.art;
    if (art?.by !== "texture") return [];
    const all = [{ file: art.file, paint: art.paint }, ...art.variants];
    return all.map((f) => ({ id: s.id, ...f }));
  });
  const standalone = new Set(faces.filter((f) => f.paint && !f.paint.over).map((f) => f.file));
  for (const f of faces) {
    const isLaneRender = laneFiles.has(f.file);
    if (isLaneRender && f.paint)
      problems.push(`sign ${f.id}: ${f.file} is a lane render, drawn from its key`);
    if (!isLaneRender && !f.paint) problems.push(`sign ${f.id}: ${f.file} has no paint`);
    const over = f.paint?.over;
    const isOverUndrawn = over !== undefined && !standalone.has(over);
    if (isOverUndrawn) problems.push(`sign ${f.id}: ${f.file} is drawn over ${over}, not drawn on its own`);
  }
  return problems;
}

export function buildRegistry(
  defs: readonly unknown[],
  lanes: readonly unknown[],
  law: unknown,
  aux: readonly unknown[] = [],
): Registry {
  const table = LawTableSchema.parse(law);
  const signs = parseAll(SignDefSchema, defs, "sign");
  const renders = parseAll(LaneRenderSchema, lanes, "lane");
  const auxRenders = parseAll(AuxRenderSchema, aux, "aux");
  const problems = crossCheck(signs, renders, auxRenders, table);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const figure = new Map(table.signs.map((r) => [r.id, r.figure]));
  const known = new Map(signs.map((s) => [s.id, s]));
  const plateOf = (s: SignDef): PlateNode | null => {
    const isGiven = s.plate !== undefined;
    if (isGiven) return s.plate ?? null;
    return known.get(s.shares ?? "")?.plate ?? null;
  };
  const plates = Object.fromEntries(
    Object.entries(PLATES).map(([node, p]) => [node, { ...p, boxMm: plateBoxMm(p) }]),
  ) as Record<PlateNode, Plate>;
  return {
    version: 3,
    law: table.law,
    plates,
    painterModules: PAINTER_MODULES,
    // The plate goes right after the group, where the definitions write it, also when derived.
    signs: signs.map((s) => {
      const { id, name, group, plate: _given, displayScale: _scale, ...rest } = s;
      return {
        id,
        name,
        group,
        plate: plateOf(s),
        displayScale: displayScaleOf(s),
        ...rest,
        figure: figure.get(id) ?? null,
      };
    }),
    lanes: renders.map((r) => ({ ...r, file: laneFile(r.lanes), plate: lanePlate(r.lanes) })),
    aux: auxRenders.map((r) => ({
      ...r,
      file: auxFile(r),
      plate: auxPlate(r) as PlateNode,
      paint: linesPaint(known.get(r.sign), r.lines, auxPlate(r) as PlateNode),
      colors: 16 as const,
    })),
  };
}

/**
 * The number's own painter with `lines` replaced (auxProblems has checked it takes them) and the
 * plate's height as `h`, so the face's height comes from plates.ts, not from text_plate's own table.
 */
function linesPaint(s: SignDef | undefined, lines: string[], plate: PlateNode): Paint {
  const paint = s?.art?.by === "texture" ? s.art.paint : undefined;
  if (!paint) throw new Error(`aux ${s?.id}: no painter`);
  return { fn: paint.fn, args: { ...paint.args, lines, h: plateBoxMm(PLATES[plate])[1] } };
}

/** The definition whose art a sign shows: its own, or the one it shares a plate with. */
export function artOwner(reg: Registry, id: string): ResolvedSign | undefined {
  const s = reg.signs.find((x) => x.id === id);
  if (s?.shares === undefined) return s;
  return reg.signs.find((x) => x.id === s.shares);
}

/**
 * Every face a sign shows, default first: its art's file, the variants, then its lane renders
 * (not repeating the default). Empty when it is not drawn.
 */
export function facesOf(reg: Registry, id: string): Face[] {
  const owner = artOwner(reg, id);
  const art = owner?.art;
  const plate = owner?.plate ?? null;
  const isUndrawn = owner === undefined || art?.by !== "texture" || plate === null;
  if (isUndrawn) return [];
  const variant = (v: Variant): Face => ({ key: v.key, file: v.file, plate: v.plate ?? plate });
  const lanes = reg.lanes
    .filter((r) => r.sign === owner.id && r.file !== art.file)
    .map((r): Face => ({ key: `lanes:${r.lanes}`, file: r.file, plate: r.plate }));
  return [{ key: null, file: art.file, plate }, ...art.variants.map(variant), ...lanes];
}

/** The file text of registry.json. */
export const formatRegistry = (reg: Registry): string => layoutJson(reg as unknown as Json);
