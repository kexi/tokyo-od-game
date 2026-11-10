// The plates of public/models/signs.glb. scripts/blender/signs.py builds every plate from this
// table (through assets/signs/registry.json `plates`), so edit it here, then
// `just make-sign-registry` and `just make-sign-model` (knowledge/sign-system.md).
import type { PlateOutline } from "./schema";

/**
 * Each plate by its signs.glb node name: the outline as 別表第二 dimensions it (circle by its
 * diameter, inverted triangle and 菱形 by their side, rectangles by width × height, the 407
 * pentagon by its width and the height of its base) and the corner radius, all in mm. The box the
 * texture covers (UV 0–1) follows from the outline (`plateBoxMm`), so it is written nowhere.
 *
 * The order is the order signs.py creates the nodes in (and so the order of signs.glb). Why keep
 * it: the glb then comes out byte for byte as it did when the plates were written in signs.py.
 */
export const PLATES = {
  PlateCircle: { shape: "circle", diameterMm: 600 },
  PlateTriangle: { shape: "triangle_down", sideMm: 800, cornerMm: 35 },
  PlateSquare: { shape: "square", widthMm: 600, heightMm: 600, cornerMm: 25 },
  // 一方通行 326-A: 60 × 35 cm, mounted parallel to the street.
  PlateWide: { shape: "rect", widthMm: 600, heightMm: 350, cornerMm: 20 },
  // 一方通行 326-B: 35 × 60 cm (図 156; the first version was 30 × 60).
  PlateRect: { shape: "rect", widthMm: 350, heightMm: 600, cornerMm: 20 },
  // 警戒標識: a 45 cm square on its corner.
  PlateDiamond: { shape: "diamond", sideMm: 450, cornerMm: 20 },
  // 横断歩道・自転車横断帯 (407): a 60 cm equilateral triangle on a 60 × 20 cm base.
  PlatePentagon: { shape: "pentagon", widthMm: 600, baseMm: 200, cornerMm: 35 },
  // 327 series: 90 × 90 cm, and 40 cm per lane × 90 cm for 進行方向別通行区分 (327の7-A).
  PlateSquare90: { shape: "square", widthMm: 900, heightMm: 900, cornerMm: 40 },
  PlateRect80x90: { shape: "rect", widthMm: 800, heightMm: 900, cornerMm: 40 },
  PlateRect120x90: { shape: "rect", widthMm: 1200, heightMm: 900, cornerMm: 40 },
  PlateRect160x90: { shape: "rect", widthMm: 1600, heightMm: 900, cornerMm: 40 },
  PlateRect200x90: { shape: "rect", widthMm: 2000, heightMm: 900, cornerMm: 40 },
  PlateRect240x90: { shape: "rect", widthMm: 2400, heightMm: 900, cornerMm: 40 },
  PlateRect280x90: { shape: "rect", widthMm: 2800, heightMm: 900, cornerMm: 40 },
  // 規制予告 409-A (60 × 90 cm) and 409-B (90 × 60 cm).
  PlateRect60x90: { shape: "rect", widthMm: 600, heightMm: 900, cornerMm: 30 },
  PlateRect90x60: { shape: "rect", widthMm: 900, heightMm: 600, cornerMm: 25 },
  // 補助標識 (警察庁「交通規制基準」): 60 cm wide, 18 (arrows), 22 (one line), 25 (503-B), 32 (two
  // lines), 38 (503-C) and 44 cm (three lines, 511) high; the 30 × 30 cm 510 example; 終わり 507-C
  // is a 40 cm disc.
  PlateAux60x18: { shape: "rect", widthMm: 600, heightMm: 180, cornerMm: 30 },
  PlateAux60x22: { shape: "rect", widthMm: 600, heightMm: 220, cornerMm: 30 },
  PlateAux60x25: { shape: "rect", widthMm: 600, heightMm: 250, cornerMm: 30 },
  PlateAux60x32: { shape: "rect", widthMm: 600, heightMm: 320, cornerMm: 30 },
  PlateAux60x38: { shape: "rect", widthMm: 600, heightMm: 380, cornerMm: 30 },
  PlateAux60x44: { shape: "rect", widthMm: 600, heightMm: 440, cornerMm: 30 },
  PlateAux30x30: { shape: "square", widthMm: 300, heightMm: 300, cornerMm: 30 },
  PlateCircle40: { shape: "circle", diameterMm: 400 },
  // 法定外: ゾーン30 backing plate 40 × 60 cm, ゾーン30プラス plate 40 × 15 cm, ward 通学路 plate 30 × 50 cm.
  PlateBacker40x60: { shape: "rect", widthMm: 400, heightMm: 600, cornerMm: 30 },
  PlateRect40x15: { shape: "rect", widthMm: 400, heightMm: 150, cornerMm: 35 },
  PlateRect30x50: { shape: "rect", widthMm: 300, heightMm: 500, cornerMm: 28 },
} as const satisfies Record<string, PlateOutline>;

/**
 * [width, height] in mm of the box the texture covers (UV 0–1): the plate's bounding box. The
 * inverted triangle's box is 80 × 69.3 cm and the 菱形's is its diagonal square (63.6 cm).
 */
export function plateBoxMm(p: PlateOutline): [number, number] {
  switch (p.shape) {
    case "circle":
      return [p.diameterMm, p.diameterMm];
    case "triangle_down":
      return [p.sideMm, round1((p.sideMm * Math.sqrt(3)) / 2)];
    case "diamond": {
      const diagonal = round1(p.sideMm * Math.SQRT2);
      return [diagonal, diagonal];
    }
    case "pentagon":
      return [p.widthMm, round1((p.widthMm * Math.sqrt(3)) / 2 + p.baseMm)];
    case "square":
    case "rect":
      return [p.widthMm, p.heightMm];
  }
}

/** 0.1 mm, as the box was written before it was derived (692.8, 719.6). */
const round1 = (mm: number) => Math.round(mm * 10) / 10;

/**
 * The 補助標識 plate for lettering in one, two and three lines: 60 cm wide, 22, 32 and 44 cm high
 * (警察庁「交通規制基準」: 12 cm letters for one line, 10 cm for more, 5 cm margins). The registry
 * picks the plate of a 補助標識 drawn for the game by its line count and hands its height to
 * text_plate (`h`); tests/signRegistry.test.ts checks auxiliary.py's HEIGHTS table against these.
 */
export const AUX_TEXT_PLATES = [
  "PlateAux60x22",
  "PlateAux60x32",
  "PlateAux60x44",
] as const satisfies ReadonlyArray<keyof typeof PLATES>;
