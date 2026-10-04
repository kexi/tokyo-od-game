import { Vector2 } from "three";
import type { Node, TextureNode } from "three/webgpu";
import { float, length, screenUV, smoothstep, uniform, vec2, vec4 } from "three/tsl";
import type { StreetPass } from "../render/frame";

/**
 * ブラー: the speed and the turn blurred, as the eye and a camera see them. A street pass of the
 * frame (render/frame.ts): it smears the street as the main camera drew it, before the wiper arms
 * and the interior are drawn over it, so the dashboard moving with the eye stays sharp.
 * - Speed: each pixel is averaged along the line to the vanishing point ahead, more the farther it
 *   is from it and the faster the car, so the road rushes past at the edges and stays sharp ahead.
 * - Turning: a sideways smear in proportion to how fast the view swings.
 * Why not a velocity buffer (true per-object motion blur): it needs every material to write motion
 * vectors; why not an afterimage (frame feedback): it trails the whole frame and reads as lag
 * rather than speed. The frame is linear HDR here, so a street light smears into a bright streak.
 */
export type BlurLevel = "strong" | "light" | "off";

const STRENGTH: Record<BlurLevel, number> = { strong: 1, light: 0.55, off: 0 };
const TAPS = 10;

export type BlurView = {
  /** The car's speed. */
  kmh: number;
  /** The vanishing point ahead in screen uv (origin top left), null when it is behind the view. */
  focus: Vector2 | null;
  /** How fast the view turns (rad/s). */
  yawRate: number;
  dt: number;
  /** Whether to blur at all this frame (in the car, not on a phone). */
  isOn: boolean;
};

export class MotionBlur implements StreetPass {
  readonly name = "motion-blur";
  level: BlurLevel = "light";
  private readonly focus = uniform(new Vector2(0.5, 0.5));
  private readonly radial = uniform(0);
  private readonly swing = uniform(new Vector2());
  private readonly aspect = uniform(1);
  private swingSmoothed = 0;
  private isOn = false;

  /** The view this frame (before the frame is drawn). */
  update(view: BlurView, width: number, height: number): void {
    const strength = STRENGTH[this.level];
    const speed = Math.max(0, Math.min(1, (Math.abs(view.kmh) - 40) / 100));
    this.swingSmoothed += (view.yawRate - this.swingSmoothed) * Math.min(1, view.dt * 8);
    const swing = Math.max(-0.03, Math.min(0.03, this.swingSmoothed * 0.012)) * strength;
    const radial = Math.pow(speed, 1.3) * 0.13 * strength;
    const isStill = radial < 0.002 && Math.abs(swing) < 0.0015;
    this.isOn = view.isOn && !isStill;
    if (!this.isOn) return;
    this.focus.value.copy(view.focus ?? new Vector2(0.5, 0.5));
    this.radial.value = view.focus ? radial : radial * 0.4;
    this.swing.value.set(swing, 0);
    this.aspect.value = width / Math.max(1, height);
  }

  /** No blur until the next update (views that do not blur: the loading screen, a replay). */
  stop(): void {
    this.isOn = false;
  }

  isActive(): boolean {
    return this.isOn;
  }

  build(street: TextureNode): Node<"vec4"> {
    const toFocus = this.focus.sub(screenUV);
    // Sharp around the focus, full at the edges (aspect-corrected distance).
    const far = smoothstep(0.12, 0.62, length(toFocus.mul(vec2(this.aspect, 1))));
    const step = toFocus.mul(this.radial).mul(far).add(this.swing).div(TAPS);
    // How: the taps unrolled at build time, nearer ones weighted more (a tail behind each pixel).
    let sum: Node<"vec4"> = vec4(0, 0, 0, 0);
    let weights = 0;
    for (let i = 0; i < TAPS; i++) {
      const w = 1 - i / TAPS;
      sum = sum.add(street.sample(screenUV.add(step.mul(float(i)))).mul(w));
      weights += w;
    }
    return sum.div(weights);
  }
}
