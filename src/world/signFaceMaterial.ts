import {
  InstancedBufferAttribute,
  Vector3,
  type Camera,
  type DataArrayTexture,
  type InstancedMesh,
  type Object3D,
} from "three";
import {
  MeshStandardNodeMaterial,
  PhysicalLightingModel,
  type LightingModelDirectInput,
  type Node,
  type NodeBuilder,
} from "three/webgpu";
import {
  asin,
  atan,
  BRDF_Lambert,
  diffuseColor,
  normalView,
  attribute,
  renderGroup,
  clamp,
  cross,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec4,
} from "three/tsl";
import { ENT_POWER, LAMP, OBS_FALLOFF, RETRO_HALF, RETRO_MAX } from "../signs/retroAssumptions";
import { RA_PEAK } from "../signs/retroreflection";

/**
 * SignFaceMaterial: the one material of every sign face (規制・警戒・指示・補助標識 and the 案内標識's
 * Canvas faces). The artwork is a layer of an array texture, picked per instance by the
 * `faceLayer` instance attribute (FACE_LAYER), so one InstancedMesh per plate shape draws faces
 * of any artwork: the draw calls follow the plate shapes, not the artwork. The layers are kept by
 * FaceLayerPool (signFaces.ts).
 *
 * The face glows with what it sends back of the player's headlamps (retroreflection.ts
 * retroWhite(), copied here node for node), over the albedo, plus a small base glow (the 0.18 the
 * plates always had by day, dimmed at night by `signGlow.base`).
 *
 * Where the return is seen from (the observation angle's eye): for the game's own camera, the
 * driver's eye, whether the view is the driver's seat or the chase camera behind the car; for any
 * other camera (a passer-by's photo, the mirrors) that camera. How: `observer` is a uniform updated
 * per render from the render's camera (setSignObserver).
 * Why not the drawing camera everywhere (physically right): the chase camera stands 6 m behind and
 * 2.6 m above the lamps, which puts every plate 3–5° off their axis, so at night signs were darker
 * than before G3 (0.001 at 30 m on the dipped beam, review); the chase camera stands in for the
 * driver's eyes.
 *
 * Why not one material per artwork (as before G3): every material is its own pipeline and draw
 * call per shape it is used on, and the node builder's cache is per InstancedMesh, so hundreds of
 * artworks meant hundreds of draw calls and builds.
 */

/** The instance attribute holding each face's layer (a float: exact for these small integers). */
export const FACE_LAYER = "faceLayer";

/**
 * Gives a face mesh its `faceLayer` instance attribute, as long as its capacity (all at layer 0, the
 * stand-in), and returns it. Called where the mesh is made or taken, before anything can draw it:
 * a pipeline built while the geometry lacks the attribute keeps a constant 0 for it for good
 * (three only warns "attribute not found" once; review round 2).
 */
export function attachFaceLayers(mesh: InstancedMesh): InstancedBufferAttribute {
  const capacity = mesh.instanceMatrix.count;
  const known = mesh.geometry.getAttribute(FACE_LAYER) as InstancedBufferAttribute | undefined;
  const isLongEnough = known !== undefined && known.count >= capacity;
  if (isLongEnough) return known;
  const made = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  mesh.geometry.setAttribute(FACE_LAYER, made);
  return made;
}

/** Marks the player's headlamps (signFaces.ts): only these lose their glossy lobe on the faces. */
const HEADLAMP_TAG = "signFaceHeadlamp";
export function markHeadlamp(light: Object3D): void {
  light.userData[HEADLAMP_TAG] = true;
}

const observerState: { camera: Camera | null; eye: Vector3 | null } = { camera: null, eye: null };
const cameraWorld = new Vector3();

/**
 * The game's own camera and, while the player drives, the driver's eye (world) the faces are seen
 * from in it (null: from the camera itself, e.g. on foot or with a placed review camera).
 */
export function setSignObserver(camera: Camera, eye: Vector3 | null): void {
  observerState.camera = camera;
  observerState.eye = eye;
}

/** The headlamps and how strongly faces return them, shared by every face material (set per frame). */
export const signGlow = {
  /** World positions of the two lamps. */
  lampA: uniform(new Vector3()),
  lampB: uniform(new Vector3()),
  /** The car's forward and up (unit). */
  forward: uniform(new Vector3(0, 0, 1)),
  up: uniform(new Vector3(0, 1, 0)),
  /** 0: すれ違い用, 1: 走行用. */
  high: uniform(0),
  /** Lamps lit × darkness the eye is adapted to × the wet face (signFaces.ts updateSignLamps). */
  gain: uniform(0),
  /** The base glow's share by day (1) and night (0.28 of it): signFaces.ts. */
  base: uniform(1),
  /** The eye the return is seen from, per render (setSignObserver). */
  observer: uniform(new Vector3())
    .setGroup(renderGroup)
    .onRenderUpdate(({ camera }) => {
      const isGame = camera !== null && camera === observerState.camera && observerState.eye !== null;
      if (isGame && observerState.eye) return observerState.eye;
      if (!camera) return undefined;
      return cameraWorld.setFromMatrixPosition(camera.matrixWorld);
    }),
};

const DEG = 180 / Math.PI;
const COS_ENT_FLOOR = Math.cos((5 * Math.PI) / 180);

const gauss = (x: Node<"float">, w: number) => {
  const t = x.div(w);
  return exp(t.mul(t).negate());
};

/** retroreflection.ts lampIntensity(): one lamp's cd towards (h, v), degrees. */
function lampIntensity(h: Node<"float">, v: Node<"float">): Node<"float"> {
  const { low, high } = LAMP.value;
  const cut = float(low.cutDeg).add(smoothstep(0, low.kickWidthDeg, h).mul(low.kickDeg - low.cutDeg));
  const below = float(1).sub(smoothstep(cut.sub(0.7), cut.add(0.7), v));
  const dipped = gauss(h, low.glareSpreadDeg)
    .mul(low.glareCd)
    .add(below.mul(gauss(h, low.spreadDeg)).mul(low.peakCd));
  const raised = gauss(h, high.floorSpreadDeg)
    .mul(high.floorCd)
    .add(gauss(h, high.spreadDeg).mul(gauss(v, high.riseDeg)).mul(high.peakCd));
  return mix(dipped, raised, signGlow.high);
}

/** retroreflection.ts retroWhite() for one lamp: cd/m² of white sheeting at this fragment. */
function fromLamp(lamp: Node<"vec3">, n: Node<"vec3">, view: Node<"vec3">): Node<"float"> {
  const toLamp = lamp.sub(positionWorld);
  const d = max(length(toLamp), 1e-4);
  const l = toLamp.div(d);
  const obs = asin(min(length(l.sub(view)).mul(0.5), 1)).mul(2 * DEG);
  const cosEnt = dot(n, l);
  const ent = min(pow(max(cosEnt, 0).div(COS_ENT_FLOOR), ENT_POWER.value), 1);
  const obsK = exp(max(obs.sub(0.2), 0).mul(-OBS_FALLOFF.value));
  const out = l.negate();
  const left = cross(signGlow.up, signGlow.forward);
  const h = atan(dot(out, left), dot(out, signGlow.forward)).mul(DEG);
  const v = asin(clamp(dot(out, signGlow.up), -1, 1)).mul(DEG);
  const near = max(d, LAMP.value.nearM);
  const isFacing = step(0, cosEnt);
  return lampIntensity(h, v).div(near.mul(near)).mul(obsK).mul(ent).mul(isFacing).mul(RA_PEAK);
}

/**
 * Three's physical lighting, but the player's headlamps (markHeadlamp) light the face diffusely
 * only. How: for those lights `direct` adds the Lambert term and leaves out the GGX lobe; any other
 * spot light (a police searchlight) keeps it.
 * Why: sheeting sends a lamp's light back along its path, which the face's emission already draws
 * (retroWhite). The glossy lobe of roughness 0.45 points the same way when the lamp sits by the eye,
 * and blew the plates out to white in the high beam (multi-view review, round 2). Why not a rougher
 * face: the sun's highlight by day would change, and the day look must not.
 */
class SignFaceLightingModel extends PhysicalLightingModel {
  override direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    const light = (input.lightNode as { light?: Object3D }).light;
    const isHeadlamp = light?.userData[HEADLAMP_TAG] === true;
    if (!isHeadlamp) {
      super.direct(input, builder);
      return;
    }
    const dotNL = normalView.dot(input.lightDirection as Node<"vec3">).clamp();
    const irradiance = dotNL.mul(input.lightColor as Node<"vec3">);
    (input.reflectedLight.directDiffuse as Node<"vec3">).addAssign(
      irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Node<"vec3">),
    );
  }
}

export type SignFaceOptions = {
  /** Layers 0 … smallLayers − 1. */
  small: DataArrayTexture;
  /** Layers largeBase …: a second array (the 90 cm boards), or none. */
  large?: { texture: DataArrayTexture; base: number };
  /** Self-illumination by day (×albedo): 0.18 for the plates, 0.16 for the 案内標識 as before. */
  baseGlow: number;
  alphaTest?: number;
};

export class SignFaceMaterial extends MeshStandardNodeMaterial {
  readonly isSignFace = true;

  constructor(options: SignFaceOptions) {
    super({ color: 0xffffff, roughness: 0.45, metalness: 0, alphaTest: options.alphaTest ?? 0 });
    const layer = attribute<"float">(FACE_LAYER, "float");
    const smallCount = options.small.image.depth;
    const small = texture(options.small, uv()).depth(min(layer, smallCount - 1).toInt());
    const large = options.large;
    // Both arrays are sampled and one is kept: a branch would sample in non-uniform control flow
    // (implicit LOD), which WGSL rejects (knowledge/webgpu-migration.md 落とし穴).
    const albedo = large
      ? mix(
          small,
          texture(large.texture, uv()).depth(max(layer.sub(large.base), 0).toInt()),
          step(large.base - 0.5, layer),
        )
      : small;
    this.colorNode = vec4(albedo);
    const n = normalize(normalWorld);
    const view = normalize(signGlow.observer.sub(positionWorld));
    const L = fromLamp(signGlow.lampA, n, view).add(fromLamp(signGlow.lampB, n, view));
    const retro = L.mul(RETRO_MAX.value).div(L.add(RETRO_HALF.value)).mul(signGlow.gain);
    // Layer 0 is the pool's stand-in (transparent, or the 案内標識's plain far face): no base glow,
    // as the plain far material had none.
    const isDrawn = step(0.5, layer);
    const glow = signGlow.base.mul(options.baseGlow).mul(isDrawn).add(retro);
    this.emissiveNode = vec4(albedo).rgb.mul(glow);
  }

  override setupLightingModel(): PhysicalLightingModel {
    return new SignFaceLightingModel();
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}:sign-face`;
  }
}
