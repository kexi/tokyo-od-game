// Converted once from assets/signs/catalog.json (G1a, knowledge/sign-system.md); this file is the
// definition now: edit it, then `just make-sign-registry`.
import type { Plate } from "./schema";

/**
 * Plates of public/models/signs.glb by node name: outline family and the box the texture covers
 * (UV 0–1, mm; 菱形 is given by its side as in 別表第二).
 */
export const PLATES = {
  PlateAux30x30: { shape: "square", sizeMm: [300, 300] },
  PlateAux60x18: { shape: "rect", sizeMm: [600, 180] },
  PlateAux60x22: { shape: "rect", sizeMm: [600, 220] },
  PlateAux60x25: { shape: "rect", sizeMm: [600, 250] },
  PlateAux60x32: { shape: "rect", sizeMm: [600, 320] },
  PlateAux60x38: { shape: "rect", sizeMm: [600, 380] },
  PlateAux60x44: { shape: "rect", sizeMm: [600, 440] },
  PlateBacker40x60: { shape: "rect", sizeMm: [400, 600] },
  PlateCircle: { shape: "circle", sizeMm: [600, 600] },
  PlateCircle40: { shape: "circle", sizeMm: [400, 400] },
  PlateDiamond: { shape: "diamond", sizeMm: [450, 450] },
  PlatePentagon: { shape: "pentagon", sizeMm: [600, 719.6] },
  PlateRect: { shape: "rect", sizeMm: [350, 600] },
  PlateRect30x50: { shape: "rect", sizeMm: [300, 500] },
  PlateRect40x15: { shape: "rect", sizeMm: [400, 150] },
  PlateRect60x90: { shape: "rect", sizeMm: [600, 900] },
  PlateRect80x90: { shape: "rect", sizeMm: [800, 900] },
  PlateRect90x60: { shape: "rect", sizeMm: [900, 600] },
  PlateRect120x90: { shape: "rect", sizeMm: [1200, 900] },
  PlateRect160x90: { shape: "rect", sizeMm: [1600, 900] },
  PlateRect200x90: { shape: "rect", sizeMm: [2000, 900] },
  PlateRect240x90: { shape: "rect", sizeMm: [2400, 900] },
  PlateRect280x90: { shape: "rect", sizeMm: [2800, 900] },
  PlateSquare: { shape: "square", sizeMm: [600, 600] },
  PlateSquare90: { shape: "square", sizeMm: [900, 900] },
  PlateTriangle: { shape: "triangle_down", sizeMm: [800, 692.8] },
  PlateWide: { shape: "rect", sizeMm: [600, 350] },
} as const satisfies Record<string, Plate>;
