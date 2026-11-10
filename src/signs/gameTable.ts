import { auxKey } from "./auxPlates";
import type { GameFace, GameKindEntry, GameSignKind, GameTable } from "./game";
import { layoutJson, type Json } from "./jsonLayout";
import { artOwner, facesOf, type Face, type Registry, type ResolvedSign } from "./registry";

/**
 * assets/signs/game.json: for each game sign type, the faces it shows and how a placed sign picks
 * one (src/signs/game.ts designFor reads it). Derived from the definitions' `game` and `gameValue`
 * so the game carries only file names, plates and numbers, not the definitions' names and notes
 * (review I9).
 */

const stem = (file: string) => file.replace(/\.png$/, "");

/** The `gameValue` of each face of a definition, by file (from its art and variants). */
function valuesOf(s: ResolvedSign | undefined): Map<string, number> {
  const art = s?.art;
  if (art?.by !== "texture") return new Map();
  const faces = [art, ...art.variants];
  return new Map(faces.flatMap((f) => (f.gameValue === undefined ? [] : [[f.file, f.gameValue] as const])));
}

function gameFace(id: string, f: Face, scale: number | null, value?: number): GameFace {
  return {
    id,
    file: stem(f.file),
    plate: f.plate,
    ...(scale === null ? {} : { scale }),
    ...(value === undefined ? {} : { value }),
  };
}

function entryOf(reg: Registry, defs: ResolvedSign[]): GameKindEntry {
  const game = defs[0].game;
  const pick = game?.pick ?? "default";
  const out: GameKindEntry = { pick, faces: [] };
  for (const s of defs) {
    const faces = facesOf(reg, s.id);
    if (pick === "default") out.faces.push(gameFace(s.id, faces[0], s.displayScale));
    if (pick === "value") {
      const values = valuesOf(artOwner(reg, s.id));
      for (const f of faces) {
        const value = values.get(f.file);
        if (value !== undefined) out.faces.push(gameFace(s.id, f, s.displayScale, value));
      }
    }
    if (pick === "lanes") {
      out.lanes ??= {};
      for (const r of reg.lanes.filter((x) => x.sign === s.id))
        out.lanes[r.lanes] = gameFace(s.id, { key: null, file: r.file, plate: r.plate }, s.displayScale);
    }
    const back = game?.back === undefined ? undefined : faces.find((f) => f.key === game.back);
    if (back) out.back = gameFace(s.id, back, s.displayScale);
  }
  if (game?.mount === "parallel") out.parallel = true;
  if (game?.bothFaces) out.bothFaces = true;
  return out;
}

export function buildGameTable(reg: Registry): GameTable {
  const byKind = new Map<GameSignKind, ResolvedSign[]>();
  for (const s of reg.signs) {
    const kind = s.game?.kind;
    if (kind === undefined || facesOf(reg, s.id).length === 0) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), s]);
  }
  // 補助標識 faces carry no scale: they take the scale of the plate they hang under.
  const aux = reg.aux.map(
    (r) => [auxKey(r), gameFace(r.sign, { key: null, file: r.file, plate: r.plate }, null)] as const,
  );
  return {
    kinds: Object.fromEntries([...byKind].map(([kind, defs]) => [kind, entryOf(reg, defs)])),
    aux: Object.fromEntries(aux),
  };
}

/** The file text of game.json. */
export const formatGameTable = (reg: Registry): string => layoutJson(buildGameTable(reg) as unknown as Json);
