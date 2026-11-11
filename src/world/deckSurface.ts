import { DoubleSide, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  float,
  max,
  mix,
  normalize,
  normalWorldGeometry,
  positionWorld,
  pow,
  select,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import concreteAlbedoUrl from "../../assets/expressway/textures/concrete_albedo.jpg?url";
import concreteNrmUrl from "../../assets/expressway/textures/concrete_nrm.png?url";
import porousAlbedoUrl from "../../assets/expressway/textures/porous_asphalt_albedo.jpg?url";
import porousNrmUrl from "../../assets/expressway/textures/porous_asphalt_nrm.png?url";
import markingWearUrl from "../../assets/road/textures/marking_wear.png?url";
import type { Node } from "three/webgpu";
import { valueNoise } from "../render/shaderMath";
import { StreetMaterial } from "./streetLights";

/**
 * The elevated deck's surfaces (expresswayDeck.ts): porous asphalt on the road, formed concrete on
 * the 壁高欄, the slab's edge, the box girder and the piers, and worn paint, from the textures of
 * scripts/textures/expressway_textures.py and marking_wear.png (knowledge/road-textures.md).
 *
 * The deck stays one mesh and one material per chunk (one draw call, as before): each vertex keeps
 * its flat colour, which says which surface it is (DECK_COLOURS), and `aDeck` adds, per triangle,
 * how far below the face's top edge it lies and how tall the face is (for the rain streaks hung
 * from that edge and the grime at the foot). Why not an attribute written by the deck builder: the
 * builder is shared with the bridge sections being added in parallel (P7); reading the colours it
 * already writes keeps every face it makes, now or later, textured without touching it.
 */

/** The deck's flat colours (linear RGB), the key to its surfaces. */
export const DECK_COLOURS: Record<keyof typeof DECK_SURFACE, number[]> = {
  asphalt: [0.16, 0.16, 0.17],
  concrete: [0.66, 0.65, 0.61],
  soffit: [0.48, 0.47, 0.44],
  pier: [0.62, 0.61, 0.57],
  paintWhite: [0.86, 0.86, 0.84],
  paintYellow: [0.85, 0.64, 0.1],
};

/** Surface codes in `aDeck.x`, in DECK_COLOURS order. */
export const DECK_SURFACE = {
  asphalt: 0,
  concrete: 1,
  soffit: 2,
  pier: 3,
  paintWhite: 4,
  paintYellow: 5,
} as const;

const PALETTE = Object.values(DECK_COLOURS);

/** The surface code of a vertex colour: the nearest palette entry. */
export function deckSurfaceOf(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  PALETTE.forEach(([pr, pg, pb], k) => {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    const isCloser = d < bestDistance;
    if (!isCloser) return;
    best = k;
    bestDistance = d;
  });
  return best;
}

/**
 * `aDeck` for non-indexed triangles: per vertex the surface code, the depth below the highest
 * vertex of its triangle and that triangle's height (m).
 *
 * How: the deck's faces are quads between two rings split into two triangles, each with a vertex
 * on the face's top edge, so the highest vertex of a triangle is that edge (within the grade over
 * one ring step, a few centimetres). A flat face (the road) has height ~0 and no streaks.
 */
export function deckSurfaceAttribute(position: Float32Array, color: Float32Array): Float32Array {
  const out = new Float32Array(position.length);
  for (let t = 0; t + 8 < position.length; t += 9) {
    const y0 = position[t + 1];
    const y1 = position[t + 4];
    const y2 = position[t + 7];
    const top = Math.max(y0, y1, y2);
    const height = top - Math.min(y0, y1, y2);
    const code = deckSurfaceOf(color[t], color[t + 1], color[t + 2]);
    for (let v = 0; v < 3; v++) {
      out[t + v * 3] = code;
      out[t + v * 3 + 1] = top - position[t + v * 3 + 1];
      out[t + v * 3 + 2] = height;
    }
  }
  return out;
}

/** Tile sizes (m) the textures were drawn at (expressway_textures.py, asphalt_textures.py). */
const ASPHALT_TILE = 4;
const CONCRETE_TILE = 3.6;
const WEAR_TILE = 4;

const loadMap = (url: string, isColour: boolean): Texture => {
  // Without a DOM (the deck's tests in Node) there is no image to decode: an empty texture keeps
  // the material whole.
  const hasDom = typeof document !== "undefined";
  const t = hasDom ? new TextureLoader().load(url) : new Texture();
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (isColour) t.colorSpace = SRGBColorSpace;
  return t;
};

/** A packed `_nrm` texel's tangent-space normal x/y (−1…1). */
const tangentXY = (texel: Node<"vec4">) => texel.xy.mul(2).sub(1);

/**
 * The material of every chunk's mesh (one instance shared by all of them). Exported as a function
 * so the textures load only when the expressway is on.
 */
export function createDeckMaterial(): StreetMaterial {
  const porousAlbedo = loadMap(porousAlbedoUrl, true);
  const porousNrm = loadMap(porousNrmUrl, false);
  const concreteAlbedo = loadMap(concreteAlbedoUrl, true);
  const concreteNrm = loadMap(concreteNrmUrl, false);
  const wearMap = loadMap(markingWearUrl, false);

  const aDeck = attribute<"vec3">("aDeck", "vec3");
  const colour = attribute<"vec3">("color", "vec3");
  const code = aDeck.x;
  const depth = aDeck.y;
  const faceHeight = aDeck.z;
  const P = positionWorld;
  const N = normalWorldGeometry;
  const isRoad = code.lessThan(0.5);
  const isPaint = code.greaterThan(3.5);
  const isTop = isRoad.or(isPaint);

  // Road and paint: planar in world XZ, u along +x and v along +z (as the ground's asphalt).
  const roadUv = P.xz.div(ASPHALT_TILE);
  const asphaltTexel = texture(porousAlbedo, roadUv);
  const asphaltNrm = texture(porousNrm, roadUv);
  // A variation that does not repeat (30–250 m) over the 4 m tile, so the repeat does not show from
  // the deck's far end or from above.
  const macro = valueNoise(P.xz.mul(0.033))
    .mul(0.6)
    .add(valueNoise(P.xz.mul(0.0041).add(7)).mul(0.4))
    .sub(0.5)
    .mul(0.16)
    .add(1);
  const asphaltColour = asphaltTexel.rgb.mul(macro);
  const wear = texture(wearMap, P.xz.div(WEAR_TILE));
  // Paint: worn to the asphalt where the mask says (no lanes known here, so no wheel paths), with
  // dust in its texture.
  const paintColour = mix(colour, asphaltColour, wear.r.mul(0.45)).mul(wear.g.mul(-0.12).add(1.04));

  // Concrete: triplanar on world axes (a face's own axes would jump between the faces of a curve).
  const weights = pow(abs(N), vec3(4)).toVar();
  const w = weights.div(max(weights.x.add(weights.y).add(weights.z), 1e-4)).toVar();
  const uvX = vec2(P.z, P.y).div(CONCRETE_TILE);
  const uvZ = vec2(P.x, P.y).div(CONCRETE_TILE);
  const uvY = P.xz.div(CONCRETE_TILE);
  const cX = texture(concreteAlbedo, uvX).rgb;
  const cZ = texture(concreteAlbedo, uvZ).rgb;
  const cY = texture(concreteAlbedo, uvY).rgb;
  const nX = texture(concreteNrm, uvX);
  const nZ = texture(concreteNrm, uvZ);
  const nY = texture(concreteNrm, uvY);
  const concreteTexel = cX.mul(w.x).add(cZ.mul(w.z)).add(cY.mul(w.y));
  const isVertical = float(1).sub(abs(N.y));
  // Rain streaks (alpha) hang from the top edge and fade over 1–3 m; grime splashes the foot.
  const streakMask = nX.a
    .mul(w.x)
    .add(nZ.a.mul(w.z))
    .div(max(w.x.add(w.z), 1e-4));
  const hang = smoothstep(0.3, 2.8, depth).oneMinus();
  const streak = streakMask.mul(hang).mul(isVertical);
  const foot = smoothstep(faceHeight.sub(0.8), faceHeight, depth)
    .mul(isVertical)
    .mul(smoothstep(0.6, 1.2, faceHeight));
  const tint = select(code.lessThan(1.5), float(1), select(code.lessThan(2.5), float(0.82), float(0.96)));
  const concreteColour = concreteTexel
    .mul(tint)
    .mul(macro)
    .mul(float(1).sub(streak.mul(0.5)))
    .mul(float(1).sub(foot.mul(0.22)));

  const albedo = select(isRoad, asphaltColour, select(isPaint, paintColour, concreteColour));

  // Roughness from the packed blue channel.
  const asphaltRough = asphaltNrm.b;
  const concreteRough = nX.b.mul(w.x).add(nZ.b.mul(w.z)).add(nY.b.mul(w.y));
  const paintRough = mix(float(0.62), asphaltRough, wear.r.mul(0.5));
  const roughness = select(isRoad, asphaltRough, select(isPaint, paintRough, concreteRough));

  // Normals: each projection's tangent x/y along its own u and v axes, added to the face normal.
  const tA = tangentXY(asphaltNrm);
  const asphaltNormal = normalize(N.add(vec3(tA.x, 0, tA.y)));
  const tX = tangentXY(nX);
  const tZ = tangentXY(nZ);
  const tY = tangentXY(nY);
  const concreteNormal = normalize(
    N.add(vec3(0, tX.y, tX.x).mul(w.x))
      .add(vec3(tZ.x, tZ.y, 0).mul(w.z))
      .add(vec3(tY.x, 0, tY.y).mul(w.y)),
  );
  const paintNormal = normalize(N.add(vec3(tA.x, 0, tA.y).mul(wear.r.mul(0.6))));
  const worldNormal = select(isRoad, asphaltNormal, select(isPaint, paintNormal, concreteNormal));

  // Rain: the road and paint fully, the 壁高欄 and the slab's edge mostly, the girder's webs a
  // little (wind-driven), the soffit and the piers under the deck not at all.
  const exposure = select(isTop, float(1), select(code.lessThan(1.5), clamp(N.y.add(0.7), 0, 1), float(0)));

  return new StreetMaterial("porous", {
    base: {
      color: vec4(albedo, 1),
      roughness,
      normal: normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz),
      exposure,
    },
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    // Double-sided like the bridge decks in water.ts: the faces wind outward, but a deck seen from
    // under its overhang must never show a hole if one face is turned the wrong way.
    side: DoubleSide,
  });
}
