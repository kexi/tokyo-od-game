// The root tileset that joins the prefectures' PLATEAU building tilesets under one tree, so the near
// town and the far skyline keep one TilesRenderer each across prefecture borders. Each prefecture
// but Tokyo carries a gate (`extras.gate`): its municipalities' regions, copied from its root, which
// the buildings' load regions require the near sphere to touch before the prefecture opens
// (buildings.ts GatedSphereRegion). Pure: no three.js, no fetch; scripts/plateauRoot.ts writes it to
// public/data/plateau/tileset.json from the prefecture roots it reads.

/** A box in degrees (WGS 84): the outer frame a prefecture's tileset stays within. */
export type DegreeBox = { west: number; south: number; east: number; north: number };

/** One prefecture's PLATEAU building tileset (LOD1, the distribution service's `-latest`). */
export type PlateauSource = {
  /** JIS X 0401 prefecture code ("13" Tokyo). */
  code: string;
  name: string;
  url: string;
  box: DegreeBox;
  /** Whether the prefecture opens only where the near sphere reaches one of its municipalities. */
  gated: boolean;
};

/** A 3D Tiles region: west, south, east, north (radians), lowest and highest (m, ellipsoidal). */
export type Region = number[];
/** Per gated prefecture code, its municipalities' regions as its root lists them. */
export type Gates = Readonly<Record<string, readonly Region[]>>;

/** A 3D Tiles 1.0 tile as this root writes it: a region and either children or an external tileset. */
export type RootTile = {
  boundingVolume: { region: Region };
  geometricError: number;
  refine?: "ADD";
  content?: { uri: string };
  extras?: { gate: Region[] };
  children?: RootTile[];
};

export type RootTileset = { asset: { version: "1.0" }; geometricError: number; root: RootTile };

/**
 * The prefecture roots' own geometricError (Kanagawa's, Tokyo's, Saitama's and Chiba's all read
 * 50000 on 2026-11-15; `just check-plateau-root` fails if one grows past it). Why not a smaller
 * value: a tile whose screen-space error falls under the renderer's target is a leaf and its
 * children are not traversed, so a pointer finer than the root it points at could leave a
 * prefecture unopened; with the roots' own value the new level is traversed as Tokyo's root was.
 */
export const ROOT_GEOMETRIC_ERROR = 50000;
/**
 * Heights (m, ellipsoidal) of the boxes here. The prefecture roots say −50…500; wider, so a tall
 * building or a low shore never falls outside the outer frame.
 */
export const REGION_HEIGHTS = [-100, 1500] as const;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** A box as a 3D Tiles region: west, south, east, north in radians, then the heights. */
export function regionOf(box: DegreeBox): Region {
  return [
    toRadians(box.west),
    toRadians(box.south),
    toRadians(box.east),
    toRadians(box.north),
    ...REGION_HEIGHTS,
  ];
}

/** The smallest box holding all of `boxes`. */
export function unionBox(boxes: readonly DegreeBox[]): DegreeBox {
  return {
    west: Math.min(...boxes.map((b) => b.west)),
    south: Math.min(...boxes.map((b) => b.south)),
    east: Math.max(...boxes.map((b) => b.east)),
    north: Math.max(...boxes.map((b) => b.north)),
  };
}

const byNumbers = (a: Region, b: Region) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * A gate in a fixed order (by west, then south …) without repeats, so the same prefecture root
 * gives the same bytes whatever order the service lists its municipalities in.
 */
export function normalizeGate(regions: readonly Region[]): Region[] {
  const sorted = regions.map((r) => [...r]).toSorted(byNumbers);
  return sorted.filter((r, i) => i === 0 || byNumbers(r, sorted[i - 1]) !== 0);
}

/**
 * The root tileset: no content of its own, one child per prefecture in `sources`' order, each
 * pointing at that prefecture's tileset.json over its box, a gated one with its gate; the root's
 * region is the boxes' union. Throws when a gated prefecture has no gate in `gates`.
 */
export function plateauRoot(sources: readonly PlateauSource[], gates: Gates): RootTileset {
  const children: RootTile[] = sources.map((s) => {
    const child: RootTile = {
      boundingVolume: { region: regionOf(s.box) },
      geometricError: ROOT_GEOMETRIC_ERROR,
      content: { uri: s.url },
    };
    if (!s.gated) return child;
    const gate = gates[s.code];
    const isMissing = !gate || gate.length === 0;
    if (isMissing) throw new Error(`no gate for the gated prefecture ${s.code} (${s.name})`);
    return { ...child, extras: { gate: normalizeGate(gate) } };
  });
  return {
    asset: { version: "1.0" },
    geometricError: ROOT_GEOMETRIC_ERROR,
    root: {
      boundingVolume: { region: regionOf(unionBox(sources.map((s) => s.box))) },
      geometricError: ROOT_GEOMETRIC_ERROR,
      refine: "ADD",
      children,
    },
  };
}

/**
 * The file's bytes: two-space JSON with each region on one line (a gate is a hundred of them) and a
 * final newline, the same for the same sources and gates.
 */
export function plateauRootText(sources: readonly PlateauSource[], gates: Gates): string {
  const json = JSON.stringify(plateauRoot(sources, gates), null, 2);
  // How: a region's six numbers, which the indented form puts one per line, joined back onto one.
  const oneLine = json.replace(
    /\[\n\s*(-?[\d.e+-]+(?:,\n\s*-?[\d.e+-]+){5})\n\s*\]/g,
    (_, nums: string) => `[${nums.split(/,\n\s*/).join(", ")}]`,
  );
  return `${oneLine}\n`;
}

/** The gates a root holds, by the code of the source whose URL the child points at. */
export function gatesOf(root: RootTileset, sources: readonly PlateauSource[]): Record<string, Region[]> {
  const out: Record<string, Region[]> = {};
  for (const child of root.root.children ?? []) {
    const code = sources.find((s) => s.url === child.content?.uri)?.code;
    const gate = child.extras?.gate;
    const isGated = code !== undefined && gate !== undefined;
    if (isGated) out[code] = gate;
  }
  return out;
}
