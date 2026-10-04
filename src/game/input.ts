import type { DriveInput } from "../physics/vehicle";

type Action = "reset" | "camera" | "ground" | "time" | "weather" | "mission" | "help" | "credits" | "mute";

const KEY_ACTIONS: Record<string, Action> = {
  KeyR: "reset",
  KeyC: "camera",
  KeyM: "ground",
  KeyT: "time",
  KeyY: "weather",
  KeyN: "mission",
  KeyH: "help",
  KeyI: "credits",
  KeyV: "mute",
};

/** Keyboard + gamepad + on-screen touch controls merged into one analog DriveInput. */
export class Input {
  private readonly keys = new Set<string>();
  private readonly touch = { throttle: 0, brake: 0, steer: 0 };
  private readonly listeners = new Map<Action, () => void>();
  private steerSmoothed = 0;

  constructor() {
    window.addEventListener("keydown", (e) => {
      const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (isTyping) return;
      if (!e.repeat) {
        const action = KEY_ACTIONS[e.code];
        if (action) this.listeners.get(action)?.();
      }
      this.keys.add(e.code);
      const isDrivingKey = e.code.startsWith("Arrow") || e.code === "Space";
      if (isDrivingKey) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  on(action: Action, fn: () => void): void {
    this.listeners.set(action, fn);
  }

  trigger(action: Action): void {
    this.listeners.get(action)?.();
  }

  bindTouch(root: HTMLElement): void {
    const bind = (selector: string, apply: (pressed: boolean) => void) => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
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
    let throttle = Math.max(k("KeyW", "ArrowUp"), this.touch.throttle);
    let brake = Math.max(k("KeyS", "ArrowDown"), this.touch.brake);
    // Steering sign: +1 turns left (positive yaw around +Y when facing +Z).
    let steerTarget = k("KeyA", "ArrowLeft") - k("KeyD", "ArrowRight") || this.touch.steer;
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
