import type { DriveInput } from "../physics/vehicle";
import type { WalkInput } from "./walker";

export type Action =
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
  | "phoneZoom"
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
  | "replay"
  | "warp"
  | "title";

export type KeyLayout = "wasd" | "ccd";

/**
 * City Car Driving's default keyboard layout (its manual, 1.5.9), so its players feel at home:
 * ↑↓←→ to drive, Space the parking brake, E the engine (and talking on foot), `,` `.` the
 * indicators, G hazards, L lights, K high beam, Tab wipers, H horn, B seat belt, C/V cameras,
 * Ctrl look left/right, Z look back, F the phone, M the navigation, O the small map, P pause,
 * R reset, F12 screenshot. The game's own actions sit on keys City Car Driving leaves free:
 * A 自動運転, Q 乗降, N 目的地, T 時間帯, Y 天気, I 出典, Home 帰宅, F1 操作, F2 地面, F8 音.
 */
const CCD_ACTIONS: Record<string, Action> = {
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
  KeyX: "warp",
  Escape: "close",
};

/**
 * WASD (the default): FPS-style, W/S accelerate and brake, A/D steer (the arrows still work), the
 * mouse looks around once the view is clicked (pointer lock; Esc releases it). 自動運転 moves off
 * A to J; everything else stays where City Car Driving has it.
 */
const WASD_ACTIONS: Record<string, Action> = Object.fromEntries([
  ...Object.entries(CCD_ACTIONS).filter(([code]) => code !== "KeyA"),
  ["KeyJ", "autopilot"],
]);

/** Shift + a key, in both layouts (Shift alone still runs on foot). */
const SHIFT_ACTIONS: Record<string, Action> = {
  KeyF: "phoneZoom",
};

/** The key that triggers an action in a layout (for hints and the help). */
export function keyFor(layout: KeyLayout, action: Action): string {
  const shifted = Object.keys(SHIFT_ACTIONS).find((c) => SHIFT_ACTIONS[c] === action);
  if (shifted) return `Shift+${shifted.replace(/^Key/, "")}`;
  const table = layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS;
  const code = Object.keys(table).find((c) => table[c] === action) ?? "";
  return code.replace(/^Key/, "").replace(/^Digit/, "");
}

/** Keys that move the player: never an action, in the car or on foot (in either layout). */
export const MOVE_KEYS: Record<KeyLayout, { drive: string[]; walk: string[] }> = {
  wasd: {
    drive: ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"],
    walk: [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "ShiftLeft",
      "ShiftRight",
    ],
  },
  ccd: {
    drive: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"],
    walk: [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "ShiftLeft",
      "ShiftRight",
    ],
  },
};

/**
 * Keys held to look aside / behind. City Car Driving's Ctrl stays in its layout, but not with WASD:
 * Ctrl+W closes the browser tab (and Ctrl+S, Ctrl+D… open the browser's own dialogs), which no page
 * can stop — so the WASD layout looks with the mouse, and Z behind.
 */
export const LOOK_KEYS: Record<KeyLayout, { left: string | null; right: string | null; back: string }> = {
  wasd: { left: null, right: null, back: "KeyZ" },
  ccd: { left: "ControlLeft", right: "ControlRight", back: "KeyZ" },
};

/** Keys whose browser default (help, reload, focus, scrolling) the game takes over. */
const BROWSER_KEYS = ["Space", "Tab", "F1", "F2", "F5", "F8", "F12"];

/**
 * The action a key press means: Shift combinations first, nothing for the keys that move the player
 * (A steers or steps left in WASD; on foot, W/A/S/D walk in either layout — in City Car Driving's
 * layout A would otherwise also switch the autopilot).
 */
export function actionFor(
  layout: KeyLayout,
  code: string,
  shift: boolean,
  onFoot: boolean,
): Action | undefined {
  const shifted = shift ? SHIFT_ACTIONS[code] : undefined;
  if (shifted) return shifted;
  const moves = onFoot ? MOVE_KEYS[layout].walk : MOVE_KEYS[layout].drive;
  if (moves.includes(code)) return undefined;
  return (layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS)[code];
}

/** Every code bound to an action in a layout (for the collision test). */
export function boundKeys(layout: KeyLayout): string[] {
  return Object.keys(layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS);
}

const LOOK_LIMIT = 2.6; // rad either way: over the shoulder, short of straight back
const LOOK_RECENTRE_S = 1.2; // the view drifts back ahead after the mouse rests this long

/** Keyboard + gamepad + on-screen touch controls merged into one analog DriveInput. */
export class Input {
  private readonly keys = new Set<string>();
  private readonly touch = { throttle: 0, brake: 0, steer: 0 };
  private readonly listeners = new Map<Action, () => void>();
  private steerSmoothed = 0;
  private dragTurn = 0;
  layout: KeyLayout = "wasd";
  /** On foot, W/A/S/D walk (and are no action); set by the game each frame. */
  onFoot = false;
  private lookYaw = 0;
  private lookIdle = 0;
  /** When the pointer lock was last released (Esc does that, and must not also close things). */
  private unlockedAt = -Infinity;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (isTyping) return;
      // Esc that released the mouse look only released it.
      const isUnlockEscape =
        e.code === "Escape" &&
        (document.pointerLockElement !== null || performance.now() - this.unlockedAt < 250);
      if (!e.repeat && !isUnlockEscape) {
        const action = actionFor(this.layout, e.code, e.shiftKey, this.onFoot);
        if (action) this.listeners.get(action)?.();
      }
      this.keys.add(e.code);
      const isGameKey = e.code.startsWith("Arrow") || BROWSER_KEYS.includes(e.code);
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

  /**
   * FPS-style mouse look: in the WASD layout a click on the view locks the pointer, and the mouse
   * then turns the walker or looks around from the driver's seat.
   */
  bindMouseLook(canvas: HTMLElement): void {
    canvas.addEventListener("click", () => {
      const isLockable = this.layout === "wasd" && document.pointerLockElement !== canvas;
      if (isLockable) canvas.requestPointerLock?.();
    });
    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.dragTurn -= e.movementX * 0.0045;
      this.lookYaw = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, this.lookYaw - e.movementX * 0.0035));
      this.lookIdle = 0;
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === canvas) return;
      this.lookYaw = 0;
      this.unlockedAt = performance.now();
    });
  }

  /**
   * Where the driver looks (yaw offset, rad) from the mouse; it drifts back ahead when the mouse
   * rests and the car is moving, as driving games do. Turning the walker is not done in the car.
   */
  look(dt: number, isMoving: boolean): number {
    this.dragTurn = 0;
    this.lookIdle += dt;
    const isRecentring = isMoving && this.lookIdle > LOOK_RECENTRE_S;
    if (isRecentring) this.lookYaw *= Math.max(0, 1 - dt * 3);
    return this.lookYaw;
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
    const isWasd = this.layout === "wasd";
    const up = isWasd ? k("ArrowUp", "KeyW") : k("ArrowUp");
    const down = isWasd ? k("ArrowDown", "KeyS") : k("ArrowDown");
    const left = isWasd ? k("ArrowLeft", "KeyA") : k("ArrowLeft");
    const right = isWasd ? k("ArrowRight", "KeyD") : k("ArrowRight");
    let throttle = Math.max(up, this.touch.throttle);
    let brake = Math.max(down, this.touch.brake);
    // Steering sign: +1 turns left (positive yaw around +Y when facing +Z).
    let steerTarget = left - right || this.touch.steer;
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
