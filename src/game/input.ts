import type { DriveInput } from "../physics/vehicle";
import { PadInput } from "./gamepad";
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
  | "title"
  | "taxi"
  | "tv"
  | "tvChannel"
  | "settings";

export type KeyLayout = "wasd" | "ccd";

/**
 * City Car Driving's default keyboard layout (its manual, 1.5.9), so its players feel at home:
 * ↑↓←→ to drive, Space the parking brake, E the engine (and talking on foot), `,` `.` the
 * indicators, G hazards, L lights, K high beam, Tab wipers, H horn, B seat belt, C/V cameras,
 * Ctrl look left/right, Z look back, F the phone, M the navigation, O the small map, P pause,
 * R reset, F12 screenshot. The game's own actions sit on keys City Car Driving leaves free:
 * A 自動運転, Q 乗降, N 目的地, T 時間帯, Y 天気, I 出典, Home 帰宅, F1 操作, F2 地面, F8 音,
 * U タクシー, 3 / 4 ナビのテレビ・チャンネル; Esc closes what is open, or opens 設定.
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
  KeyU: "taxi",
  // Number keys no F-key copy uses: on every keyboard, in both layouts.
  Digit3: "tv",
  Digit4: "tvChannel",
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

/**
 * Number keys that do what the F-keys and Home do, in both layouts: a Mac keyboard's F1–F12
 * change brightness and volume unless fn is held, and its laptops have no Home key. The digit is
 * the F-key's number (F1 → 1, F5 → 5); 9 is 帰宅 and 0 the screenshot (F12).
 */
const DIGIT_ACTIONS: Record<string, Action> = {
  Digit1: "help",
  Digit2: "ground",
  Digit5: "replay",
  Digit8: "mute",
  Digit9: "home",
  Digit0: "screenshot",
};

/** The key that triggers an action in a layout (for hints and the help). */
export function keyFor(layout: KeyLayout, action: Action, mac = IS_MAC): string {
  // 設定 is what Esc does when nothing is open to close.
  if (action === "settings") return keyFor(layout, "close", mac);
  const digit = Object.keys(DIGIT_ACTIONS).find((c) => DIGIT_ACTIONS[c] === action);
  if (mac && digit) return digit.replace("Digit", "");
  const shifted = Object.keys(SHIFT_ACTIONS).find((c) => SHIFT_ACTIONS[c] === action);
  if (shifted) return `Shift+${shifted.replace(/^Key/, "")}`;
  const table = layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS;
  const code = Object.keys(table).find((c) => table[c] === action) ?? "";
  // As printed on the keycap.
  const printed: Record<string, string> = { Comma: ",", Period: ".", Escape: "Esc", Enter: "Enter" };
  return printed[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "");
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

/** A Mac (or iPad) keyboard: its labels show the number keys and ⌥ for Option. */
export const IS_MAC = (() => {
  const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  const platform = nav?.userAgentData?.platform ?? nav?.platform ?? "";
  return /Mac|iPhone|iPad/i.test(platform);
})();

/**
 * Keys held to look aside / behind. City Car Driving's Ctrl stays in its layout, but not with WASD:
 * Ctrl+W closes the browser tab (and Ctrl+S, Ctrl+D… open the browser's own dialogs), which no page
 * can stop — so the WASD layout looks with the mouse, and Z behind.
 */
export const LOOK_KEYS: Record<KeyLayout, { left: string | null; right: string | null; back: string }> = {
  wasd: { left: null, right: null, back: "KeyZ" },
  // On a Mac ⌃+← / ⌃+→ switch desktops and ⌃+↑ opens Mission Control, before the page sees them,
  // and the arrows drive in this layout: Option (⌥) looks there instead.
  ccd: IS_MAC
    ? { left: "AltLeft", right: "AltRight", back: "KeyZ" }
    : { left: "ControlLeft", right: "ControlRight", back: "KeyZ" },
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
  return (layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS)[code] ?? DIGIT_ACTIONS[code];
}

/** Every code bound to an action in a layout (for the collision test). */
export function boundKeys(layout: KeyLayout): string[] {
  return Object.keys(layout === "wasd" ? WASD_ACTIONS : CCD_ACTIONS);
}

const LOOK_LIMIT = 2.6; // rad either way: over the shoulder, short of straight back
/**
 * From the driver's seat the view tilts only a little (rad): up to signals and signs over the road,
 * down to the bonnet. Why not as far as on foot: the roof lining and the dashboard fill the view.
 */
const CAR_PITCH = { up: 0.25, down: 0.12 };
const clampPitch = (p: number) => Math.max(-CAR_PITCH.down, Math.min(CAR_PITCH.up, p));
const LOOK_RECENTRE_S = 1.2; // the view drifts back ahead after the mouse rests this long

/** Keyboard + gamepad + on-screen touch controls merged into one analog DriveInput. */
export class Input {
  /** Gamepads (game/gamepad.ts): polled on their own frame, their buttons fire the same actions. */
  readonly pad: PadInput;
  private readonly keys = new Set<string>();
  private readonly touch = { throttle: 0, brake: 0, steer: 0 };
  private readonly listeners = new Map<Action, () => void>();
  private steerSmoothed = 0;
  private dragTurn = 0;
  layout: KeyLayout = "wasd";
  /** On foot, W/A/S/D walk (and are no action); set by the game each frame. */
  onFoot = false;
  private lookYaw = 0;
  /** The driver's look up (+) / down, rad, in CAR_PITCH; the walker's is a rate (dragPitch). */
  private lookPitch = 0;
  private dragPitch = 0;
  private lookIdle = 0;
  /** The view was turned by the right stick (it springs back when the stick is let go). */
  private padLooked = false;
  private padPitched = false;
  /** When the pointer lock was last released (Esc does that, and must not also close things). */
  private unlockedAt = -Infinity;

  constructor() {
    this.pad = new PadInput({
      trigger: (action) => this.listeners.get(action)?.(),
      onFoot: () => this.onFoot,
    });
    window.addEventListener("keydown", (e) => {
      this.pad.noteKeyboard();
      const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      // A dialog over the game (設定, the ticket, 移動…) takes the keys: nothing drives or switches
      // under it, and its own Esc closes it rather than opening 設定.
      const isDialogOpen = document.querySelector("dialog:modal") !== null;
      if (isTyping) return;
      if (isDialogOpen) {
        // Still not the browser's help or reload; Tab and Space keep moving through the dialog.
        const isFunctionKey = /^F\d+$/.test(e.code) && BROWSER_KEYS.includes(e.code);
        if (isFunctionKey) e.preventDefault();
        return;
      }
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
      // Looking aside with Ctrl (City Car Driving's layout off a Mac) while pressing a game key: the
      // browser would take Ctrl+R (reload), Ctrl+F (find), Ctrl+P (print), Ctrl+L, Ctrl+U… — they
      // stay the game's. Ctrl+N, Ctrl+T, Ctrl+W and Ctrl+Tab no page can take from the browser.
      const isLookCombo = e.ctrlKey && actionFor(this.layout, e.code, e.shiftKey, this.onFoot) !== undefined;
      if (isGameKey || isLookCombo) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** Whether a key is held down now (horn H, look Ctrl / Z). */
  held(code: string): boolean {
    return this.keys.has(code);
  }

  /** The horn (H, or its pad button) held now. */
  horn(): boolean {
    return this.keys.has("KeyH") || this.pad.held("horn");
  }

  /** The pad's 後ろを見る held (or latched) now. */
  padLookBack(): boolean {
    return this.pad.held("lookBack");
  }

  /**
   * What to press for an action, for hints and the toolbar: the pad's button when a pad was the
   * last input, else (or when the pad has none for it) the key in the layout in force — a hint
   * never names nothing.
   */
  label(action: Action): string {
    return this.pad.label(action) || keyFor(this.layout, action);
  }

  on(action: Action, fn: () => void): void {
    this.listeners.set(action, fn);
  }

  trigger(action: Action): void {
    this.listeners.get(action)?.();
  }

  /** Drag on the 3D view to swing the on-foot camera (sideways turns it, up and down tilts it). */
  bindDrag(canvas: HTMLElement): void {
    let last: { x: number; y: number } | null = null;
    canvas.addEventListener("pointerdown", (e) => (last = { x: e.clientX, y: e.clientY }));
    window.addEventListener("pointerup", () => (last = null));
    window.addEventListener("pointermove", (e) => {
      if (last === null) return;
      this.dragTurn -= (e.clientX - last.x) * 0.006;
      // Dragging the view down looks up, as a map or a photo sphere is pulled.
      this.dragPitch += (e.clientY - last.y) * 0.006;
      last = { x: e.clientX, y: e.clientY };
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
      // The mouse moved up (movementY < 0) looks up.
      this.dragPitch -= e.movementY * 0.0045;
      this.lookPitch = clampPitch(this.lookPitch - e.movementY * 0.0035);
      this.lookIdle = 0;
      this.padLooked = false;
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === canvas) return;
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.unlockedAt = performance.now();
    });
  }

  /**
   * Where the driver looks (yaw offset, rad) from the mouse; it drifts back ahead when the mouse
   * rests and the car is moving, as driving games do. Turning the walker is not done in the car.
   */
  look(dt: number, isMoving: boolean): number {
    this.dragTurn = 0;
    this.dragPitch = 0;
    this.lookUp(dt, isMoving);
    // The right stick looks while pushed and lets the view swing back ahead when released.
    // The stick is a position, not a turn: released, the view comes back ahead at once, moving or
    // not (the mouse's view stays put until the car moves).
    const stick = this.pad.lookYaw();
    if (stick !== null) {
      this.lookYaw = stick;
      this.padLooked = true;
      this.lookIdle = 0;
      return this.lookYaw;
    }
    this.lookIdle += dt;
    const isRecentring = this.padLooked || (isMoving && this.lookIdle > LOOK_RECENTRE_S);
    if (isRecentring) this.lookYaw *= Math.max(0, 1 - dt * (this.padLooked ? 10 : 3));
    if (Math.abs(this.lookYaw) < 0.01) this.padLooked = false;
    return this.lookYaw;
  }

  /** How far up (+) / down the driver looks now (rad), as look() last left it. */
  get pitch(): number {
    return this.lookPitch;
  }

  /**
   * The driver's look up / down: the right stick's push (springing back when let go) or the
   * mouse's, which drifts back level once the car moves, as the look aside does.
   */
  private lookUp(dt: number, isMoving: boolean): void {
    const stick = this.pad.lookPitch();
    if (stick !== null) {
      this.lookPitch = stick > 0 ? stick * CAR_PITCH.up : -stick * CAR_PITCH.down;
      this.padPitched = true;
      return;
    }
    const isRecentring = this.padPitched || (isMoving && this.lookIdle > LOOK_RECENTRE_S);
    if (isRecentring) this.lookPitch *= Math.max(0, 1 - dt * (this.padPitched ? 10 : 3));
    if (Math.abs(this.lookPitch) < 0.005) this.padPitched = false;
  }

  /** On-foot controls: WASD/↑↓ move relative to the camera, ←/→ or drag turn the camera. */
  readWalk(): WalkInput {
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    let forward =
      Math.max(k("KeyW", "ArrowUp"), this.touch.throttle) -
      Math.max(k("KeyS", "ArrowDown"), this.touch.brake);
    let right = k("KeyD") - k("KeyA");
    let turn = k("ArrowLeft") - k("ArrowRight") + this.touch.steer;
    const pad = this.pad.walk();
    forward = forward || pad.forward;
    right = right || pad.right;
    turn = turn || pad.turn;
    // Drag is a per-frame delta expressed as a turn rate (consumed once).
    const drag = this.dragTurn * 30;
    this.dragTurn = 0;
    const dragPitch = this.dragPitch * 30;
    this.dragPitch = 0;
    return {
      forward,
      right,
      run: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || pad.run,
      jump: this.keys.has("Space") || pad.jump,
      turn: turn + drag,
      pitch: pad.pitch + dragPitch,
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

    const pad = this.pad.drive();
    throttle = Math.max(throttle, pad.throttle);
    brake = Math.max(brake, pad.brake);
    const isPadSteering = pad.steer !== null && (pad.steer !== 0 || steerTarget === 0);
    if (isPadSteering) steerTarget = pad.steer as number;
    handbrake ||= pad.handbrake;

    // Keyboard steering is digital; ease it so the car does not twitch. A stick or the gyro is
    // already analog: followed closely (a little easing still hides the stick's own jitter).
    const rate = isPadSteering ? 14 : steerTarget === 0 ? 6 : 3.5;
    this.steerSmoothed += (steerTarget - this.steerSmoothed) * Math.min(1, dt * rate);
    return { throttle, brake, steer: this.steerSmoothed, handbrake };
  }
}
