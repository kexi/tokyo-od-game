import type { DriveInput } from "../physics/vehicle";
import type { WalkInput } from "./walker";

type Action =
  | "reset"
  | "camera"
  | "cameraPrev"
  | "ground"
  | "time"
  | "weather"
  | "mission"
  | "help"
  | "credits"
  | "mute"
  | "talk"
  | "close"
  | "door"
  | "enter"
  | "phone"
  | "autopilot"
  | "home"
  | "indicatorLeft"
  | "indicatorRight"
  | "hazard"
  | "lights"
  | "highBeam"
  | "wipers"
  | "belt"
  | "pause"
  | "nav"
  | "minimap"
  | "screenshot"
  | "replay";

/**
 * City Car Driving's default keyboard layout (its manual, 1.5.9), so its players feel at home:
 * ↑↓←→ to drive, Space the parking brake, E the engine (and talking on foot), `,` `.` the
 * indicators, G hazards, L lights, K high beam, Tab wipers, H horn, B seat belt, C/V cameras,
 * Ctrl look left/right, Z look back, F the phone, M the navigation, O the small map, P pause,
 * R reset, F12 screenshot. The game's own actions sit on keys City Car Driving leaves free:
 * A 自動運転, Q 乗降, N 目的地, T 時間帯, Y 天気, I 出典, Home 帰宅, F1 操作, F2 地面, F8 音.
 */
const KEY_ACTIONS: Record<string, Action> = {
  KeyR: "reset",
  KeyC: "camera",
  KeyV: "cameraPrev",
  F2: "ground",
  KeyT: "time",
  KeyY: "weather",
  KeyN: "mission",
  F1: "help",
  KeyI: "credits",
  F8: "mute",
  KeyE: "talk",
  KeyQ: "door",
  Enter: "enter",
  KeyF: "phone",
  KeyA: "autopilot",
  Home: "home",
  Comma: "indicatorLeft",
  Period: "indicatorRight",
  KeyG: "hazard",
  KeyL: "lights",
  KeyK: "highBeam",
  Tab: "wipers",
  KeyB: "belt",
  KeyP: "pause",
  KeyM: "nav",
  KeyO: "minimap",
  F12: "screenshot",
  F5: "replay",
  Escape: "close",
};

/** Keyboard + gamepad + on-screen touch controls merged into one analog DriveInput. */
export class Input {
  private readonly keys = new Set<string>();
  private readonly touch = { throttle: 0, brake: 0, steer: 0 };
  private readonly listeners = new Map<Action, () => void>();
  private steerSmoothed = 0;
  private dragTurn = 0;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (isTyping) return;
      if (!e.repeat) {
        const action = KEY_ACTIONS[e.code];
        if (action) this.listeners.get(action)?.();
      }
      this.keys.add(e.code);
      const isGameKey =
        e.code.startsWith("Arrow") || ["Space", "Tab", "F1", "F2", "F8", "F12"].includes(e.code);
      if (isGameKey) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** Whether a key is held down now (horn H, look Ctrl / Z). */
  held(code: string): boolean {
    return this.keys.has(code);
  }

  on(action: Action, fn: () => void): void {
    this.listeners.set(action, fn);
  }

  trigger(action: Action): void {
    this.listeners.get(action)?.();
  }

  /** Drag on the 3D view to swing the on-foot camera. */
  bindDrag(canvas: HTMLElement): void {
    let lastX: number | null = null;
    canvas.addEventListener("pointerdown", (e) => (lastX = e.clientX));
    window.addEventListener("pointerup", () => (lastX = null));
    window.addEventListener("pointermove", (e) => {
      if (lastX === null) return;
      this.dragTurn -= (e.clientX - lastX) * 0.006;
      lastX = e.clientX;
    });
  }

  /** On-foot controls: WASD/↑↓ move relative to the camera, ←/→ or drag turn the camera. */
  readWalk(): WalkInput {
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let forward =
      Math.max(k("KeyW", "ArrowUp"), this.touch.throttle) -
      Math.max(k("KeyS", "ArrowDown"), this.touch.brake);
    let right = k("KeyD") - k("KeyA");
    let turn = k("ArrowLeft") - k("ArrowRight") + this.touch.steer;
    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      forward = forward || -dz(pad.axes[1] ?? 0);
      right = right || dz(pad.axes[0] ?? 0);
      turn = turn || -dz(pad.axes[2] ?? 0);
    }
    // Drag is a per-frame delta expressed as a turn rate (consumed once).
    const drag = this.dragTurn * 30;
    this.dragTurn = 0;
    return {
      forward,
      right,
      run: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || Boolean(pad?.buttons[5]?.pressed),
      jump: this.keys.has("Space") || Boolean(pad?.buttons[0]?.pressed),
      turn: turn + drag,
    };
  }

  bindTouch(root: HTMLElement): void {
    const bind = (selector: string, apply: (pressed: boolean) => void) => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic or already-released pointers cannot be captured; the press still counts.
        }
        apply(true);
      });
      const release = () => apply(false);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
    };
    bind("[data-touch=left]", (p) => (this.touch.steer = p ? 1 : 0));
    bind("[data-touch=right]", (p) => (this.touch.steer = p ? -1 : 0));
    bind("[data-touch=gas]", (p) => (this.touch.throttle = p ? 1 : 0));
    bind("[data-touch=brake]", (p) => (this.touch.brake = p ? 1 : 0));
  }

  read(dt: number): DriveInput {
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let throttle = Math.max(k("ArrowUp"), this.touch.throttle);
    let brake = Math.max(k("ArrowDown"), this.touch.brake);
    // Steering sign: +1 turns left (positive yaw around +Y when facing +Z).
    let steerTarget = k("ArrowLeft") - k("ArrowRight") || this.touch.steer;
    let handbrake = this.keys.has("Space");

    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    if (pad) {
      const deadzone = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      const stick = -deadzone(pad.axes[0] ?? 0);
      if (stick !== 0) steerTarget = stick;
      handbrake ||= pad.buttons[0]?.pressed ?? false;
    }

    // Keyboard steering is digital; ease it so the car does not twitch.
    const rate = steerTarget === 0 ? 6 : 3.5;
    this.steerSmoothed += (steerTarget - this.steerSmoothed) * Math.min(1, dt * rate);
    return { throttle, brake, steer: this.steerSmoothed, handbrake };
  }
}
