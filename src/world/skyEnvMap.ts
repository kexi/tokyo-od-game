import { CubeCamera, HalfFloatType, type RenderTarget, Scene, type Texture } from "three";
import { CubeRenderTarget, PMREMGenerator, type WebGPURenderer } from "three/webgpu";
import { type SkyLook, TokyoSky } from "./skyShader";

/** What the environment map was drawn for; a new one is drawn when this has moved enough. */
export type EnvState = {
  /** Sun elevation and azimuth (degrees). */
  elevation: number;
  azimuth: number;
  /** Cloud cover, 0–1 (eased by Environment). */
  overcast: number;
};

/** Below this the sun's place no longer shows in the sky (the night is the city's glow). */
const DEEP_NIGHT = -12;

/**
 * Whether the sky has moved enough since `drawn` to draw the environment map again: 1° of sun
 * elevation, 2° of azimuth (while the sun shows at all) or 6% of cloud, times `step`. With the game
 * clock at 60× (GAME_TIME_SCALE) the sun moves ~15° a real minute, so at step 1 that is about one
 * map every 4 s (高; 低's step 3 and 3 s gap: one every 12 s); weather turning over ~25 s gives one
 * every 1.5 s while it lasts.
 */
export function isEnvStale(drawn: EnvState | null, now: EnvState, step = 1): boolean {
  if (!drawn) return true;
  const isBothDeepNight = drawn.elevation < DEEP_NIGHT && now.elevation < DEEP_NIGHT;
  const dAzimuth = Math.abs(((now.azimuth - drawn.azimuth + 540) % 360) - 180);
  const isSunMoved =
    !isBothDeepNight && (Math.abs(now.elevation - drawn.elevation) >= step || dAzimuth >= 2 * step);
  return isSunMoved || Math.abs(now.overcast - drawn.overcast) >= 0.06 * step;
}

/**
 * The scene's environment map drawn from the game's own sky: the same patched Preetham sky with a
 * ground and skyline under it (skyShader.ts), into a small cube, filtered by PMREM into one render
 * target that is reused, so `scene.environment` stays the same texture object. Why that matters:
 * three works out every material's program parameters again when the environment texture changes
 * identity (WebGLRenderer: `materialProperties.envMap !== envMap`), on the frame after each draw.
 *
 * Why not RoomEnvironment (as before): a studio, so car paint and glass towers reflected softboxes
 * at any time of day. Why not PMREMGenerator.fromScene: it allocates a new target per call.
 *
 * On WebGPU: three/webgpu's PMREMGenerator and CubeRenderTarget; the sky is the game's TSL sky
 * (skyShader.ts) with its ground and skyline on (uGround.w, set by Environment's syncEnvSky).
 */
export class SkyEnvMap {
  private readonly pmrem: PMREMGenerator;
  private readonly cube: CubeRenderTarget;
  private readonly cubeCamera: CubeCamera;
  private readonly scene = new Scene();
  private readonly sky = new TokyoSky();
  readonly look: SkyLook = this.sky.look;
  private target: RenderTarget | null = null;
  private drawn: EnvState | null = null;
  private drawnAt = -Infinity;
  /** CPU milliseconds of the last draw (issuing the passes; the GPU runs them afterwards). */
  lastCost = 0;
  /** Draws so far (to check the rate in the console). */
  draws = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    readonly size: number,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    this.cube = new CubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false });
    this.cubeCamera = new CubeCamera(1, 1000, this.cube);
    this.sky.scale.setScalar(500);
    this.sky.frustumCulled = false;
    // The sun's disc stays out: the DirectionalLight's highlight is the sun on glossy surfaces, and
    // a disc of radiance ~10⁴ would ring through the filtered mips.
    this.sky.showSunDisc.value = 0;
    this.scene.add(this.sky);
  }

  /** The PMREM texture; null until the first draw. */
  get texture(): Texture | null {
    return this.target?.texture ?? null;
  }

  /**
   * Draw again when the sky has moved (isEnvStale with `step`) and at most every `minGapMs`. `sync`
   * copies the game sky's uniforms (sun, clouds, glow) into this sky just before drawing.
   */
  update(now: EnvState, nowMs: number, sync: (sky: TokyoSky) => void, step = 1, minGapMs = 400): boolean {
    const isDue = isEnvStale(this.drawn, now, step) && nowMs - this.drawnAt >= minGapMs;
    if (!isDue) return false;
    const t0 = performance.now();
    sync(this.sky);
    this.cubeCamera.update(this.renderer, this.scene);
    this.target = this.pmrem.fromCubemap(this.cube.texture, this.target);
    this.lastCost = performance.now() - t0;
    this.drawn = { ...now };
    this.drawnAt = nowMs;
    this.draws++;
    return true;
  }

  dispose(): void {
    this.pmrem.dispose();
    this.cube.dispose();
    this.target?.dispose();
    this.sky.dispose();
  }
}
