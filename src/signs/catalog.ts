import { layoutJson, PyFloat, type Json } from "./jsonLayout";
import { facesOf, type Registry } from "./registry";

/**
 * assets/signs/catalog.json, the older table src/world/signs.ts, src/world/coverage.ts and the asset
 * page read, derived from the registry in exactly the shape (and bytes) scripts/textures/signs/
 * catalog.py wrote it. Kept until those readers move to the registry (design 2.2); then it goes.
 *
 * Python's float / int split shows in the file: sizes of 別表第一 signs and lane renders were
 * floats (`600.0`), the hand-written 法定外 sizes ints (`600`). `size` reproduces that.
 */

const SCHEMA_NOTES = {
  id: "別表第一の番号（例 327の7-A）。法定外は x- で始まる",
  name: "別表第一の種類",
  group: "案内|警戒|規制|指示|補助|法定外",
  texture: "assets/signs/textures のファイル名。描いていないものは null で reason を付ける",
  plate: "circle|triangle_down|diamond|square|rect|pentagon（標示板の形）",
  plate_node: "public/models/signs.glb の板のノード名",
  size_mm: "[横, 縦] 別表第二の標準の大きさ（菱形は一辺）。テクスチャは板の外接矩形を UV 0–1 で覆う",
  variable: "lanes（車線リストから描く）| text（数値・文言を引数で描く）| null",
  source: "根拠の URL。figure は別表第二の図の e-Gov 添付ファイル",
  variants: "同じ番号の別の図柄（左右・例示の値・車線パターン）",
};

const LANES_NOTES = {
  generator: "scripts/textures/signs/lanes.py lane_sign()",
  input:
    "車線ごと（左から）に OSM turn:lanes の語を + か ; で結ぶ（例 left+through）。" +
    "全体は | 区切りも可。専用・優先は {dirs, use: bus|bus_priority|bicycle}",
  file:
    "327-7_<車線ごとの略号を - で連結>.png（u=reverse, l=left, hl=slight_left, t=through, " +
    "hr=slight_right, r=right, ~bus/~busp/~cyc=専用・優先）",
};

type Sign = Registry["signs"][number];

function size(reg: Registry, plate: keyof Registry["plates"], asFloat: boolean): Json {
  const [w, h] = reg.plates[plate].sizeMm;
  return asFloat ? [new PyFloat(w), new PyFloat(h)] : [w, h];
}

function entry(reg: Registry, s: Sign): Json {
  const isStatutory = s.group !== "法定外";
  const faces = facesOf(reg, s.id);
  const head = { id: s.id, name: s.name, group: s.group };
  const plate = s.plate;
  if (!isStatutory) {
    return {
      ...head,
      texture: faces[0]?.file ?? null,
      plate: plate === null ? null : reg.plates[plate].shape,
      plate_node: plate,
      size_mm: plate === null ? null : size(reg, plate, false),
      variable: null,
      source: s.source ?? null,
      ...(s.note === undefined ? {} : { note: s.note }),
    };
  }
  const figure = s.figure === null ? null : reg.law.figureUrl.replace("{}", s.figure);
  if (plate === null) {
    const reason = s.art?.by === "none" ? s.art.reason : "未描画";
    return {
      ...head,
      texture: null,
      plate: null,
      plate_node: null,
      size_mm: null,
      variable: null,
      source: reg.law.url,
      figure,
      reason,
    };
  }
  const own = reg.plates[plate];
  const variants = faces.slice(1).map((f): Json => {
    const other = reg.plates[f.plate];
    const isOtherSize = other.sizeMm.some((v, i) => v !== own.sizeMm[i]);
    return {
      key: f.key ?? f.file.replace(/\.png$/, ""),
      texture: f.file,
      ...(f.plate === plate ? {} : { plate_node: f.plate }),
      ...(isOtherSize ? { size_mm: size(reg, f.plate, true) } : {}),
    };
  });
  return {
    ...head,
    texture: faces[0]?.file ?? null,
    plate: own.shape,
    plate_node: plate,
    size_mm: size(reg, plate, true),
    variable: s.variable ?? null,
    source: reg.law.url,
    figure,
    ...(s.sizeSource === undefined ? {} : { size_source: s.sizeSource }),
    ...(s.note === undefined ? {} : { note: s.note }),
    ...(variants.length > 0 ? { variants } : {}),
    ...(faces.length === 0 ? { reason: "未描画" } : {}),
  };
}

export function buildCatalog(reg: Registry): Json {
  const signs = reg.signs.map((s) => entry(reg, s));
  const coverage: Record<string, { drawn: number; total: number }> = {};
  for (const s of signs as Array<{ group: string; texture: string | null }>) {
    const g = (coverage[s.group] ??= { drawn: 0, total: 0 });
    g.total += 1;
    g.drawn += s.texture ? 1 : 0;
  }
  return {
    schema: SCHEMA_NOTES,
    law: { url: reg.law.url, figures: reg.law.figureUrl.replace("{}", "…") },
    coverage,
    lanes: {
      ...LANES_NOTES,
      rendered: reg.lanes.map((r) => ({
        lanes: r.lanes,
        texture: r.file,
        plate_node: r.plate,
        size_mm: size(reg, r.plate, true),
      })),
    },
    signs,
  };
}

/** The file text of catalog.json. */
export const formatCatalog = (reg: Registry): string => layoutJson(buildCatalog(reg));
