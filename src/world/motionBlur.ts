import {
  FramebufferTexture,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from "three";

/**
 * ブラー: the speed and the turn blurred, as the eye and a camera see them. After the frame is drawn
 * (by whatever drew it — the driver's-seat view with its rain, mirrors and all), it is copied once and
 * drawn back smeared:
 * - Speed: each pixel is averaged along the line to the vanishing point ahead, more the farther it
 *   is from it and the faster the car, so the road rushes past at the edges and stays sharp ahead.
 * - Turning: a sideways smear in proportion to how fast the view swings.
 * Why not a velocity buffer (true per-object motion blur): it needs every material to write motion
 * vectors; why not three's AfterimagePass: it trails the whole frame, the dashboard included, and
 * reads as lag rather than speed.
 */
export type BlurLevel = "strong" | "light" | "off";

const STRENGTH: Record<BlurLevel, number> = { strong: 1, light: 0.55, off: 0 };
const TAPS = 10;

const FRAGMENT = /* glsl */ `
  uniform sampler2D frame;
  uniform vec2 focus;     // the vanishing point in uv
  uniform float radial;   // fraction of the way to the focus a pixel is smeared at the edge
  uniform vec2 swing;     // sideways smear in uv
  uniform float aspect;
  varying vec2 vUv;
  void main() {
    vec2 toFocus = focus - vUv;
    // Sharp around the focus, full at the edges (aspect-corrected distance).
    float far = smoothstep(0.12, 0.62, length(toFocus * vec2(aspect, 1.0)));
    vec2 step = (toFocus * radial * far + swing) / float(${TAPS});
    vec4 sum = vec4(0.0);
    float weights = 0.0;
    for (int i = 0; i < ${TAPS}; i++) {
      float w = 1.0 - float(i) / float(${TAPS});
      sum += texture2D(frame, vUv + step * float(i)) * w;
      weights += w;
    }
    gl_FragColor = sum / weights;
  }
`;

export class MotionBlur {
  level: BlurLevel = "light";
  private texture: FramebufferTexture | null = null;
  private readonly size = new Vector2();
  private readonly material = new ShaderMaterial({
    uniforms: {
      frame: { value: null },
      focus: { value: new Vector2(0.5, 0.5) },
      radial: { value: 0 },
      swing: { value: new Vector2() },
      aspect: { value: 1 },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private swingSmoothed = 0;

  constructor() {
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Smear the frame just drawn. `kmh` the car's speed, `focus` the vanishing point ahead in uv (null
   * when it is behind the view), `yawRate` how fast the view turns (rad/s), `isInside` the driver's
   * seat (the dashboard moves with the eye: much less).
   */
  apply(
    renderer: WebGLRenderer,
    view: { kmh: number; focus: Vector2 | null; yawRate: number; isInside: boolean; dt: number },
  ): void {
    const strength = STRENGTH[this.level] * (view.isInside ? 0.35 : 1);
    const speed = Math.max(0, Math.min(1, (Math.abs(view.kmh) - 40) / 100));
    this.swingSmoothed += (view.yawRate - this.swingSmoothed) * Math.min(1, view.dt * 8);
    const swing = Math.max(-0.03, Math.min(0.03, this.swingSmoothed * 0.012)) * strength;
    const radial = Math.pow(speed, 1.3) * 0.13 * strength;
    const isStill = radial < 0.002 && Math.abs(swing) < 0.0015;
    if (isStill) return;
    renderer.getDrawingBufferSize(this.size);
    const isResized =
      !this.texture || this.texture.image.width !== this.size.x || this.texture.image.height !== this.size.y;
    if (isResized) {
      this.texture?.dispose();
      this.texture = new FramebufferTexture(this.size.x, this.size.y);
    }
    const texture = this.texture;
    if (!texture) return;
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(texture);
    const u = this.material.uniforms;
    u.frame.value = texture;
    u.focus.value.copy(view.focus ?? new Vector2(0.5, 0.5));
    u.radial.value = view.focus ? radial : radial * 0.4;
    u.swing.value.set(swing, 0);
    u.aspect.value = this.size.x / Math.max(1, this.size.y);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
