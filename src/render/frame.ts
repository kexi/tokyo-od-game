import {
  type Camera,
  ColorManagement,
  DepthTexture,
  FloatType,
  FramebufferTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  type Object3D,
  RenderTarget,
  type Texture,
  type ToneMapping,
  UnsignedByteType,
  Vector2,
} from "three";
import { type Node, NodeMaterial, QuadMesh, type TextureNode, type WebGPURenderer } from "three/webgpu";
import { renderOutput, screenUV, texture, vec4 } from "three/tsl";

/**
 * A full-screen effect on the street: the world as the main camera drew it, before anything close to
 * the eye (the wiper arms, the interior, the rain on the glass) is drawn over it.
 */
export type StreetPass = {
  readonly name: string;
  /** Whether it changes the frame this time; an idle pass costs nothing. */
  isActive(): boolean;
  /** The street after this pass, from the street before it (a texture), built once. */
  build(street: TextureNode): Node<"vec4">;
};

/**
 * A linear HDR scene target: half-float colour, the renderer's MSAA, and float depth (reversed
 * depth needs depth32float; three's automatic depth buffer for a target is 24-bit). Every target
 * the scene is drawn into is made this way, so the materials share one set of pipelines (a
 * pipeline is built per colour format, depth format and sample count).
 */
export function sceneTarget(renderer: WebGPURenderer, width: number, height: number): RenderTarget {
  const target = new RenderTarget(width, height, {
    type: HalfFloatType,
    samples: renderer.samples,
    depthBuffer: true,
    resolveDepthBuffer: false,
    resolveStencilBuffer: false,
  });
  target.depthTexture = new DepthTexture(width, height, FloatType);
  return target;
}

/** Lights whose shadow maps are drawn for the main view only (see holdShadows). */
const shadowLights = new Set<{ shadow: { autoUpdate: boolean } }>();

/** Register a shadow-casting light (the sun). */
export function drawShadowsOf(light: { shadow: { autoUpdate: boolean } }): void {
  shadowLights.add(light);
}

/**
 * Run `fn` (renders from cameras other than the main one: the near camera, the mirrors, a
 * bystander's phone) with the shadow maps as they are. Why: WebGPURenderer redraws a shadow map
 * once per frame for every camera that renders a lit material, and these views would each redraw
 * the sun's (the same picture: the map follows the player, not the camera).
 */
export function holdShadows<T>(fn: () => T): T {
  const lights = [...shadowLights].filter((l) => l.shadow.autoUpdate);
  for (const l of lights) l.shadow.autoUpdate = false;
  try {
    return fn();
  } finally {
    for (const l of lights) l.shadow.autoUpdate = true;
  }
}

/**
 * The frame, drawn into one linear HDR target and tone-mapped to the canvas once at the end:
 *
 *   world (main camera, near 0.5 m)
 *   → street passes, on the street only: [bloom, lens flare — to come] → motion blur
 *   → drawn over it with the near camera (2 cm): the wiper arms
 *   → a copy for the windscreen water (street + wipers)
 *   → the interior (near camera, depth cleared), then the glass refracting the copy
 *   → present: tone mapping (ACES, the exposure the environment sets) and sRGB, to the canvas.
 *
 * Why one target and one output pass, not renderer.render() to the canvas for each step: with
 * tone mapping on, WebGPURenderer draws every render() and every clear to the canvas into an
 * internal target and runs its output pass after each (five or six full-screen passes a frame
 * here). Why not RenderPipeline with pass() nodes: each pass() owns a full-size colour and depth
 * target and draws into it from scratch, while these steps draw over one another in the same
 * target (the interior over the street, with the glass testing against the interior's depth).
 * The copies read linear HDR values: lights stay above 1 in what the motion blur smears and the
 * drops refract, as they are in the scene.
 */
export class FrameComposer {
  readonly target: RenderTarget;
  /** Effects on the street, in order. Bloom and the lens flare go before the motion blur. */
  readonly streetPasses: StreetPass[] = [];
  private readonly size = new Vector2();
  // A stand-in until the first copy: a street pass must never be built sampling the target it
  // draws into.
  private streetCopy = halfFloatCopy(1, 1, false);
  private glassCopy: FramebufferTexture | null = null;
  // Between two street passes (the last one draws into the frame itself).
  private readonly between = [0, 1].map(
    () => new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }),
  );
  private readonly streetQuads = new Map<StreetPass, { quad: QuadMesh; input: TextureNode }>();
  private readonly output: { quad: QuadMesh; input: TextureNode };
  private readonly develop: { quad: QuadMesh; input: TextureNode };
  // By size: a bystander's probes and photo alternate sizes, and resizing would reallocate each time.
  private readonly developTargets = new Map<string, RenderTarget>();

  constructor(private readonly renderer: WebGPURenderer) {
    this.target = sceneTarget(renderer, 1, 1);
    this.output = this.outputQuad(renderer.toneMapping, renderer.outputColorSpace);
    this.develop = this.outputQuad(renderer.toneMapping, renderer.outputColorSpace);
  }

  /** The scene target sized to the canvas (in device pixels) and bound for drawing. */
  begin(): void {
    const { width, height } = this.renderer.getDrawingBufferSize(this.size);
    const isResized = this.target.width !== width || this.target.height !== height;
    if (isResized) {
      // The depth texture follows (three resizes a depth texture its target owns).
      this.target.setSize(width, height);
      for (const t of this.between) t.setSize(width, height);
    }
    this.renderer.setRenderTarget(this.target);
  }

  /** The world from the main camera, over a cleared target. */
  drawWorld(scene: Object3D, camera: Camera): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    const autoClear = r.autoClear;
    r.autoClear = true;
    r.render(scene, camera);
    r.autoClear = autoClear;
  }

  /**
   * Draw `scene` from `camera` over what is there, on a cleared depth buffer (what is close to the
   * eye, drawn with a near plane of a few centimetres, never clipped by the street's depth).
   * `keepDepth`: test against the depth the last draw left (the glass behind the interior).
   */
  drawOver(scene: Object3D, camera: Camera, keepDepth = false): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    const { autoClear, autoClearColor, autoClearDepth, autoClearStencil } = r;
    // How: one render pass that clears its depth as it begins (renderer.clearDepth() would be a
    // pass of its own).
    r.autoClear = !keepDepth;
    r.autoClearColor = false;
    r.autoClearDepth = true;
    r.autoClearStencil = false;
    holdShadows(() => r.render(scene, camera));
    Object.assign(r, { autoClear, autoClearColor, autoClearDepth, autoClearStencil });
  }

  /**
   * The street passes: the street is copied once, each active pass draws the next stage, the last
   * one back into the frame. Nothing runs (no copy either) when none is active.
   */
  street(): void {
    const active = this.streetPasses.filter((p) => p.isActive());
    if (active.length === 0) return;
    const r = this.renderer;
    this.streetCopy = this.copyInto(this.streetCopy, false);
    let source: Texture = this.streetCopy;
    const autoClear = r.autoClear;
    r.autoClear = false;
    active.forEach((pass, i) => {
      const isLast = i === active.length - 1;
      const into = isLast ? this.target : this.between[i % 2];
      const { quad, input } = this.streetQuad(pass);
      input.value = source;
      r.setRenderTarget(into);
      quad.render(r);
      source = into.texture;
    });
    r.autoClear = autoClear;
    r.setRenderTarget(this.target);
  }

  /** A copy of the frame so far, with mipmaps (the windscreen's drops sample it minified). */
  copyForGlass(): FramebufferTexture {
    this.glassCopy = this.copyInto(this.glassCopy, true);
    return this.glassCopy;
  }

  /** Tone-map the frame to the canvas. */
  present(): void {
    const r = this.renderer;
    r.setRenderTarget(null);
    this.output.input.value = this.target.texture;
    this.drawOutput(this.output.quad);
  }

  /**
   * Tone-map `source` (linear HDR) into an 8-bit target of its size, as the screen shows it (for a
   * picture that is read back: a bystander's photo). The returned target is reused.
   */
  toDisplay(source: Texture, width: number, height: number): RenderTarget {
    const r = this.renderer;
    const key = `${width}x${height}`;
    let t = this.developTargets.get(key);
    if (!t) {
      t = new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false });
      // Encoded by the output node: an -srgb format would encode a second time.
      t.texture.colorSpace = NoColorSpace;
      this.developTargets.set(key, t);
    }
    this.develop.input.value = source;
    r.setRenderTarget(t);
    this.drawOutput(this.develop.quad);
    return t;
  }

  /** Build the street passes' pipelines before they first run (into the frame's target). */
  async precompile(): Promise<void> {
    const r = this.renderer;
    const pending = this.streetPasses.map((pass) => {
      const { quad } = this.streetQuad(pass);
      r.setRenderTarget(this.target);
      return r.compileAsync(quad, quad.camera);
    });
    r.setRenderTarget(null);
    await Promise.all(pending);
  }

  private drawOutput(quad: QuadMesh): void {
    const r = this.renderer;
    // The node does the tone mapping and the colour space; the renderer must not do them again.
    const toneMapping = r.toneMapping;
    const colorSpace = r.outputColorSpace;
    r.toneMapping = NoToneMapping;
    r.outputColorSpace = ColorManagement.workingColorSpace;
    quad.render(r);
    r.toneMapping = toneMapping;
    r.outputColorSpace = colorSpace;
  }

  private outputQuad(toneMapping: ToneMapping, colorSpace: string): { quad: QuadMesh; input: TextureNode } {
    const input = texture(this.target.texture, screenUV);
    const material = new NodeMaterial();
    // Opaque: the canvas is, and so is a photo.
    material.fragmentNode = vec4(renderOutput(input, toneMapping, colorSpace).rgb, 1);
    material.blending = NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
    material.name = "frame-output";
    return { quad: new QuadMesh(material), input };
  }

  private streetQuad(pass: StreetPass): { quad: QuadMesh; input: TextureNode } {
    let q = this.streetQuads.get(pass);
    if (q) return q;
    const input = texture(this.streetCopy, screenUV);
    const material = new NodeMaterial();
    material.fragmentNode = pass.build(input);
    material.blending = NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
    material.name = `street-${pass.name}`;
    q = { quad: new QuadMesh(material), input };
    this.streetQuads.set(pass, q);
    return q;
  }

  /** Copy the target's (resolved) colour into a half-float texture of its size. */
  private copyInto(copy: FramebufferTexture | null, hasMips: boolean): FramebufferTexture {
    const r = this.renderer;
    const { width, height } = this.target;
    const isResized = !copy || copy.image.width !== width || copy.image.height !== height;
    if (isResized) copy?.dispose();
    const into = isResized || !copy ? halfFloatCopy(width, height, hasMips) : copy;
    r.setRenderTarget(this.target);
    r.copyFramebufferToTexture(into);
    return into;
  }
}

/** A texture to copy the frame into: half float like the target (a copy needs the same format). */
function halfFloatCopy(width: number, height: number, hasMips: boolean): FramebufferTexture {
  const copy = new FramebufferTexture(width, height);
  copy.type = HalfFloatType;
  copy.magFilter = LinearFilter;
  copy.minFilter = hasMips ? LinearMipmapLinearFilter : LinearFilter;
  copy.generateMipmaps = hasMips;
  return copy;
}
