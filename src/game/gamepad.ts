import { t, type MessageKey } from "../i18n";
import { log } from "../log";
import type { Action } from "./input";
import {
  bindingsOf,
  controlsOn,
  defaultProfile,
  isHeldControl,
  loadPadStore,
  PAD_CONTROLS,
  savePadStore,
  TOGGLABLE,
  type PadControl,
  type PadProfile,
  type Togglable,
} from "./padProfile";
import { NINTENDO_VENDOR, PRO_CONTROLLER, ProConHid, standardButtons, stickAxes } from "./procon";
import { bumpStrength, idleFrame, isSilent, RumbleMixer, type RumbleFrame, type RumbleKind } from "./rumble";
import { tiltSteer } from "./tilt";

/**
 * Gamepads through the Gamepad API (and the Pro Controller's own report through WebHID when it
 * is connected that way): the pad last used drives, its buttons do what 設定 › コントローラー
 * binds them to (padProfile.ts), its sticks steer, walk and look. Polled on its own animation
 * frame, apart from the game loop, so a press is seen while the game is paused or 設定 is open
 * (binding capture, + to close).
 */

export type PadFamily = "nintendo" | "xbox" | "playstation" | "generic" | "raw";

/** A pad as read this frame. */
export type PadSnapshot = {
  /** The profile key: "057e-2009" from the vendor and product, else the browser's id. */
  key: string;
  /**
   * This pad among those connected ("api:0", "hid"): two of the same model share a profile key
   * but not their buttons' state.
   */
  slot: string;
  id: string;
  name: string;
  family: PadFamily;
  mapping: string;
  pressed: boolean[];
  values: number[];
  axes: number[];
  source: "api" | "hid";
  vibration: GamepadHapticActuator | null;
};

/** Vendor and product from the browser's id (Chrome: "… (… Vendor: 057e Product: 2009)", Firefox: "57e-2009-…"). */
export function padIds(id: string): { vendor: number; product: number } | null {
  const chrome = /Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})/i.exec(id);
  const firefox = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  const m = chrome ?? firefox;
  return m ? { vendor: parseInt(m[1], 16), product: parseInt(m[2], 16) } : null;
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

export function padKey(id: string): string {
  const ids = padIds(id);
  return ids ? `${hex4(ids.vendor)}-${hex4(ids.product)}` : id.trim().slice(0, 120);
}

/** The pad's own name: Chrome's id before " (", Firefox's after vendor and product. */
export function padName(id: string): string {
  const firefox = /^[0-9a-f]{1,4}-[0-9a-f]{1,4}-(.+)$/i.exec(id);
  if (firefox) return firefox[1].trim();
  const cut = id.indexOf(" (");
  return (cut > 0 ? id.slice(0, cut) : id).trim() || "Gamepad";
}

export function familyOf(id: string, mapping: string): PadFamily {
  const isStandard = mapping === "standard";
  const vendor = padIds(id)?.vendor ?? null;
  if (vendor === NINTENDO_VENDOR) return isStandard ? "nintendo" : "raw";
  if (!isStandard) return "raw";
  if (vendor === 0x045e) return "xbox";
  if (vendor === 0x054c) return "playstation";
  return "generic";
}

/** Button names by standard index, as printed on each family's pads. */
const GLYPHS: Record<Exclude<PadFamily, "raw">, readonly string[]> = {
  nintendo: [
    "B",
    "A",
    "Y",
    "X",
    "L",
    "R",
    "ZL",
    "ZR",
    "−",
    "+",
    "LS",
    "RS",
    "↑",
    "↓",
    "←",
    "→",
    "Home",
    "Capture",
  ],
  xbox: [
    "A",
    "B",
    "X",
    "Y",
    "LB",
    "RB",
    "LT",
    "RT",
    "View",
    "Menu",
    "LS",
    "RS",
    "↑",
    "↓",
    "←",
    "→",
    "Xbox",
    "Share",
  ],
  playstation: [
    "✕",
    "○",
    "□",
    "△",
    "L1",
    "R1",
    "L2",
    "R2",
    "Create",
    "Options",
    "L3",
    "R3",
    "↑",
    "↓",
    "←",
    "→",
    "PS",
    "Touchpad",
  ],
  generic: [
    "A",
    "B",
    "X",
    "Y",
    "LB",
    "RB",
    "LT",
    "RT",
    "Back",
    "Start",
    "LS",
    "RS",
    "↑",
    "↓",
    "←",
    "→",
    "Guide",
  ],
};

export function buttonName(family: PadFamily, index: number): string {
  return family === "raw" ? `#${index}` : (GLYPHS[family][index] ?? `#${index}`);
}

export type StickCurve = { deadzone: number; sensitivity: number; linearity: number };

// The last few per cent of a stick's travel count as full: worn sticks and Chrome's calibrated
// range rarely reach exactly 1.
const OUTER_DEADZONE = 0.04;

/**
 * One stick axis through the steering curve: nothing inside the dead zone, then rescaled to start
 * at 0 (no jump at its edge), raised to `linearity` (>1: finer near the centre), times
 * `sensitivity`, at most 1.
 */
export function stickCurve(v: number, curve: StickCurve): number {
  const mag = Math.abs(v);
  if (mag <= curve.deadzone) return 0;
  const span = Math.max(0.01, 1 - curve.deadzone - OUTER_DEADZONE);
  const n = Math.min(1, (mag - curve.deadzone) / span);
  return Math.sign(v) * Math.min(1, n ** curve.linearity * curve.sensitivity);
}

/** A stick's two axes with a round dead zone, rescaled to start at its edge (for walking). */
export function radialDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return [0, 0];
  const k = Math.min(1, (mag - deadzone) / (1 - deadzone)) / mag;
  return [x * k, y * k];
}

// A digital trigger lets go faster than it presses: lifting off the accelerator is quick.
const TRIGGER_RELEASE_S = 0.08;

/**
 * A pedal from a trigger: an analog trigger's value as it is; a digital one (the Pro Controller's
 * ZL/ZR report only 0 or 1) rises over `riseS` while held, so a press does not floor it.
 */
export function rampTrigger(
  current: number,
  pressed: boolean,
  value: number,
  isAnalog: boolean,
  riseS: number,
  dt: number,
): number {
  if (isAnalog) return value;
  if (!pressed) return Math.max(0, current - dt / TRIGGER_RELEASE_S);
  if (riseS <= 0) return 1;
  return Math.min(1, current + dt / riseS);
}

const WALK_DEADZONE = 0.15;
const LOOK_DEADZONE = 0.15;
const LOOK_LIMIT = 2.6;
/** A pad is the one in use when it moved this recently, or nothing else did. */
const STALE_HID_MS = 500;
const GYRO_FRESH_MS = 200;
const CAPTURE_TIMEOUT_MS = 8000;

/** Labels of the controls in 設定 and the help: the toolbar's where the action has one. */
const CONTROL_LABEL: Record<PadControl, MessageKey> = {
  throttle: "pad.control.throttle",
  brake: "pad.control.brake",
  handbrake: "pad.control.handbrake",
  horn: "pad.control.horn",
  lookBack: "pad.control.lookBack",
  jump: "pad.control.jump",
  run: "pad.control.run",
  gyroCenter: "pad.control.gyroCenter",
  reset: "toolbar.reset",
  camera: "toolbar.camera",
  cameraPrev: "pad.control.cameraPrev",
  ground: "toolbar.ground",
  time: "toolbar.time",
  weather: "toolbar.weather",
  mission: "toolbar.mission",
  help: "toolbar.help",
  credits: "toolbar.credits",
  mute: "toolbar.mute",
  talk: "toolbar.talk",
  close: "pad.control.close",
  door: "toolbar.door",
  enter: "pad.control.enter",
  phone: "toolbar.phone",
  phoneZoom: "toolbar.phoneZoom",
  autopilot: "toolbar.autopilot",
  home: "pad.control.home",
  indicatorLeft: "toolbar.indicatorLeft",
  indicatorRight: "toolbar.indicatorRight",
  hazard: "toolbar.hazard",
  lights: "toolbar.lights",
  highBeam: "toolbar.highBeam",
  wipers: "toolbar.wipers",
  belt: "toolbar.belt",
  pause: "toolbar.pause",
  nav: "toolbar.nav",
  minimap: "toolbar.minimap",
  screenshot: "toolbar.screenshot",
  replay: "toolbar.replay",
  warp: "toolbar.warp",
  title: "toolbar.title",
  taxi: "toolbar.taxi",
  tv: "toolbar.tv",
  tvChannel: "toolbar.tvChannel",
  settings: "toolbar.settings",
};
export const controlLabel = (c: PadControl): string => t(CONTROL_LABEL[c]);

export type PadDrive = { throttle: number; brake: number; steer: number | null; handbrake: boolean };
export type PadWalk = {
  forward: number;
  right: number;
  turn: number;
  pitch: number;
  run: boolean;
  jump: boolean;
};
export type CarFrame = {
  inCar: boolean;
  engineOn: boolean;
  kmh: number;
  throttle: number;
  verticalSpeed: number;
};

type Capture = {
  until: number;
  baseline: Map<string, boolean[]>;
  onButton: (index: number, pad: PadSnapshot) => void;
  onCancel: () => void;
};

export type PadInputOptions = {
  /** Fire a keyboard action (Input's listeners). */
  trigger: (action: Action) => void;
  /** Whether the player is on foot now (W/A/S/D and the pad's on-foot bindings). */
  onFoot: () => boolean;
  /** Poll on requestAnimationFrame (off in the tests, which call step()). */
  autoStart?: boolean;
  storage?: Storage | null;
};

export class PadInput {
  readonly procon = new ProConHid();
  readonly rumbleMixer = new RumbleMixer();
  /** The input used last: the toolbar and hints name its buttons. */
  source: "keyboard" | "pad" = "keyboard";
  private active: PadSnapshot | null = null;
  private pads: PadSnapshot[] = [];
  private readonly profiles: Map<string, PadProfile>;
  private readonly previous = new Map<string, boolean[]>();
  private readonly previousAxes = new Map<string, number[]>();
  private readonly lastUsed = new Map<string, number>();
  private readonly analog = new Set<string>();
  private readonly latches: Record<Togglable, boolean> = { handbrake: false, run: false, lookBack: false };
  private readonly listeners = new Set<() => void>();
  private capture: Capture | null = null;
  private throttle = 0;
  private brake = 0;
  private lastStep = -Infinity;
  private lastVy: number | null = null;
  private lastBumpAt = -Infinity;
  private rumbleWasSilent = true;
  private lastVibrationAt = -Infinity;
  private now = 0;
  /** A dialog is open over the game: the pad does not drive or walk under it (keys do not either). */
  private isUnderDialog = false;

  constructor(private readonly options: PadInputOptions) {
    this.profiles = loadPadStore(options.storage);
    this.procon.onChange = () => this.emit();
    const canPoll = options.autoStart !== false && typeof requestAnimationFrame === "function";
    if (!canPoll) return;
    const loop = (now: number) => {
      this.step(now, navigator.getGamepads?.() ?? []);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener("gamepaddisconnected", () => this.emit());
    void this.procon.restore();
  }

  /** Called on a pad coming or going, a profile change, the input source changing. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** A key was pressed: hints go back to naming keys. */
  noteKeyboard(): void {
    if (this.source === "keyboard") return;
    this.source = "keyboard";
    this.emit();
  }

  get pad(): PadSnapshot | null {
    return this.active;
  }

  get connectedPads(): readonly PadSnapshot[] {
    return this.pads;
  }

  profileFor(key: string): PadProfile {
    return this.profiles.get(key) ?? defaultProfile();
  }

  /** The profile of the pad in use (its defaults when none is). */
  get profile(): PadProfile {
    return this.active ? this.profileFor(this.active.key) : defaultProfile();
  }

  /**
   * Keep (and save) a pad's profile. `isFinal` false while a slider is dragged: applied and saved,
   * but not logged nor announced (the settings would be rebuilt under the pointer).
   */
  setProfile(key: string, profile: PadProfile, isFinal = true): void {
    this.profiles.set(key, profile);
    savePadStore(this.profiles, this.options.storage);
    if (!isFinal) return;
    const table = bindingsOf(profile);
    log("pad_profile_changed", {
      padId: key,
      changedBindings: Object.keys(profile.bindings).length,
      gyro: profile.gyro.enabled,
      rumble: profile.rumble.enabled,
      steerDeadzone: profile.steer.deadzone,
      throttleButton: table.throttle ?? -1,
    });
    this.emit();
  }

  /**
   * The next button newly pressed on any pad goes to `onButton` (binding it in 設定); nothing else
   * acts meanwhile. Cancelled by cancelCapture() (Esc in 設定) or after 8 s.
   */
  startCapture(onButton: (index: number, pad: PadSnapshot) => void, onCancel: () => void): void {
    this.cancelCapture();
    // Buttons held when capture starts (the one that clicked "割り当て" with A, say) do not count
    // until released and pressed again.
    const baseline = new Map<string, boolean[]>();
    for (const p of this.pads) baseline.set(p.slot, [...p.pressed]);
    this.capture = { until: this.now + CAPTURE_TIMEOUT_MS, baseline, onButton, onCancel };
  }

  cancelCapture(): void {
    const c = this.capture;
    this.capture = null;
    c?.onCancel();
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  /** One poll: read the pads, pick the one in use, fire actions on new presses, ramp, rumble. */
  step(now: number, raw: ReadonlyArray<Gamepad | null>): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastStep) / 1000));
    this.lastStep = now;
    this.now = now;
    this.isUnderDialog = typeof document !== "undefined" && document.querySelector("dialog:modal") !== null;
    const pads = raw.filter((g): g is Gamepad => g !== null && g.connected).map(snapshotOf);
    const hasApiProCon = pads.some((p) => p.key === PRO_CON_KEY);
    const hid = this.procon;
    const isHidLive = hid.connected && hid.report !== null && now - hid.reportAt < STALE_HID_MS;
    // The same controller through both: its buttons and sticks from the Gamepad API (Chrome's
    // calibrated sticks), only the gyro and rumble through WebHID — never both as two pads.
    if (isHidLive && !hasApiProCon) pads.push(hidSnapshot(hid));
    const wasSlots = this.pads.map((p) => p.slot).join("|");
    this.pads = pads;
    const isPadSetChanged = wasSlots !== pads.map((p) => p.slot).join("|");

    let usedNow = false;
    for (const p of pads) {
      const isUsed = activityOf(p, this.previous.get(p.slot), this.previousAxes.get(p.slot));
      if (isUsed) this.lastUsed.set(p.slot, now);
      if (isUsed && p.slot === this.active?.slot) usedNow = true;
      p.values.forEach((v, i) => {
        const isBetween = v > 0.02 && v < 0.98;
        if (isBetween) this.analog.add(`${p.slot}#${i}`);
      });
    }
    const previousSlot = this.active?.slot ?? null;
    const previousKey = this.active?.key ?? null;
    this.active = pads.reduce<PadSnapshot | null>((best, p) => {
      if (!best) return p;
      return (this.lastUsed.get(p.slot) ?? -1) > (this.lastUsed.get(best.slot) ?? -1) ? p : best;
    }, null);
    const isActiveChanged = (this.active?.slot ?? null) !== previousSlot;
    if (isActiveChanged && this.active) {
      const a = this.active;
      log("pad_connected", {
        padId: a.key,
        name: a.name,
        mapping: a.mapping,
        family: a.family,
        source: a.source,
      });
    }
    if (isActiveChanged && !this.active && previousKey) log("pad_disconnected", { padId: previousKey });
    const isNewlyUsed =
      this.active !== null && (usedNow || (isActiveChanged && this.lastUsed.has(this.active.slot)));
    const isSourceChanged = isNewlyUsed && this.source !== "pad";
    if (isNewlyUsed) this.source = "pad";

    this.handlePresses(now, pads);
    this.ramp(dt);
    this.outputRumble(now);

    for (const p of pads) {
      this.previous.set(p.slot, [...p.pressed]);
      this.previousAxes.set(p.slot, [...p.axes]);
    }
    if (isPadSetChanged || isActiveChanged || isSourceChanged) this.emit();
  }

  private handlePresses(now: number, pads: readonly PadSnapshot[]): void {
    const c = this.capture;
    if (c) {
      for (const p of pads) {
        const base = c.baseline.get(p.slot) ?? [];
        const index = p.pressed.findIndex((down, i) => down && !base[i] && !this.previous.get(p.slot)?.[i]);
        // A button held at the start counts once let go.
        c.baseline.set(
          p.slot,
          base.map((was, i) => was && p.pressed[i]),
        );
        if (index < 0) continue;
        this.capture = null;
        c.onButton(index, p);
        return;
      }
      if (now > c.until) this.cancelCapture();
      return;
    }
    const a = this.active;
    if (!a) return;
    const before = this.previous.get(a.slot) ?? [];
    const table = bindingsOf(this.profileFor(a.key));
    const onFoot = this.options.onFoot();
    a.pressed.forEach((down, index) => {
      const isNewPress = down && !before[index];
      if (!isNewPress) return;
      for (const control of controlsOn(table, index, onFoot)) this.press(control);
    });
  }

  private press(control: PadControl): void {
    const profile = this.profile;
    const isToggle =
      (TOGGLABLE as readonly string[]).includes(control) && profile.toggles[control as Togglable];
    if (isToggle) {
      this.latches[control as Togglable] = !this.latches[control as Togglable];
      return;
    }
    if (control === "gyroCenter") {
      this.procon.centre();
      return;
    }
    if (isHeldControl(control)) return;
    this.dispatch(control as Action);
  }

  /**
   * An action from the pad: as its key would, except with a dialog open over the game, where the
   * pad only closes it (閉じる on +), the way Esc does — the dialog's own cancel handling decides.
   */
  private dispatch(action: Action): void {
    const modal =
      typeof document === "undefined" ? null : document.querySelector<HTMLDialogElement>("dialog:modal");
    if (!modal) {
      this.options.trigger(action);
      return;
    }
    const isClose = action === "close" || action === "settings";
    if (!isClose) return;
    const closable = modal as HTMLDialogElement & { requestClose?: () => void };
    if (typeof closable.requestClose === "function") closable.requestClose();
    else modal.close();
  }

  private isAnalog(index: number | null): boolean {
    return index !== null && this.active !== null && this.analog.has(`${this.active.slot}#${index}`);
  }

  private ramp(dt: number): void {
    const a = this.active;
    const profile = this.profile;
    const table = bindingsOf(profile);
    const button = (index: number | null) => ({
      pressed: index !== null && (a?.pressed[index] ?? false),
      value: index === null ? 0 : (a?.values[index] ?? 0),
    });
    const throttle = button(table.throttle);
    const brake = button(table.brake);
    this.throttle = rampTrigger(
      this.throttle,
      throttle.pressed,
      throttle.value,
      this.isAnalog(table.throttle),
      profile.triggerRampS,
      dt,
    );
    this.brake = rampTrigger(
      this.brake,
      brake.pressed,
      brake.value,
      this.isAnalog(table.brake),
      profile.triggerRampS / 2,
      dt,
    );
  }

  /** Whether a held control's button is down now (or its toggle latched on). */
  held(control: PadControl): boolean {
    const isToggle =
      (TOGGLABLE as readonly string[]).includes(control) && this.profile.toggles[control as Togglable];
    if (isToggle) return this.latches[control as Togglable];
    const a = this.active;
    if (!a) return false;
    const index = bindingsOf(this.profileFor(a.key))[control];
    return index !== null && (a.pressed[index] ?? false);
  }

  /** The car's pedals and steering from the pad (steer null: the pad is not steering). */
  drive(): PadDrive {
    if (this.isUnderDialog) return { throttle: 0, brake: 0, steer: null, handbrake: this.held("handbrake") };
    const a = this.active;
    const profile = this.profile;
    const stick = a ? -stickCurve(a.axes[0] ?? 0, profile.steer) : 0;
    const isGyroLive = profile.gyro.enabled && this.now - this.procon.imuAt < GYRO_FRESH_MS;
    const gyro = isGyroLive
      ? tiltSteer(this.procon.tilt.roll, profile.gyro.rangeDeg, profile.gyro.invert)
      : 0;
    // The stick takes over from the gyro while it is pushed (a quick correction, a parking turn).
    const steer = stick !== 0 ? stick : isGyroLive ? gyro : null;
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: a || isGyroLive ? steer : null,
      handbrake: this.held("handbrake"),
    };
  }

  /** Walking from the left stick, the camera from the right stick's sideways. */
  walk(): PadWalk {
    const a = this.active;
    if (!a || this.isUnderDialog) return { forward: 0, right: 0, turn: 0, pitch: 0, run: false, jump: false };
    const [x, y] = radialDeadzone(a.axes[0] ?? 0, a.axes[1] ?? 0, WALK_DEADZONE);
    const rx = Math.abs(a.axes[2] ?? 0) < LOOK_DEADZONE ? 0 : (a.axes[2] ?? 0);
    const ry = Math.abs(a.axes[3] ?? 0) < LOOK_DEADZONE ? 0 : (a.axes[3] ?? 0);
    const invert = this.profile.invertLookX ? -1 : 1;
    // The stick pushed up (axis 3 negative) looks up.
    return {
      forward: -y,
      right: x,
      turn: -rx * invert,
      pitch: -ry,
      run: this.held("run"),
      jump: this.held("jump"),
    };
  }

  /**
   * How far up (+) or down the driver looks with the right stick, as a share of the way (-1..1;
   * null when it rests): pushed up looks up.
   */
  lookPitch(): number | null {
    const ry = this.active?.axes[3] ?? 0;
    if (Math.abs(ry) < LOOK_DEADZONE) return null;
    const n = (Math.abs(ry) - LOOK_DEADZONE) / (1 - LOOK_DEADZONE);
    return -Math.sign(ry) * Math.min(1, n);
  }

  /** Where the driver looks with the right stick (yaw, rad; null when it rests). */
  lookYaw(): number | null {
    const rx = this.active?.axes[2] ?? 0;
    if (Math.abs(rx) < LOOK_DEADZONE) return null;
    const invert = this.profile.invertLookX ? -1 : 1;
    const n = (Math.abs(rx) - LOOK_DEADZONE) / (1 - LOOK_DEADZONE);
    return -Math.sign(rx) * Math.min(1, n) * LOOK_LIMIT * invert;
  }

  /** The pad button bound to an action, by its printed name ("" unbound), when a pad was used last. */
  label(action: Action): string | null {
    const a = this.active;
    if (!a || this.source !== "pad") return null;
    const control: PadControl = action === "settings" ? "close" : action;
    const index = bindingsOf(this.profileFor(a.key))[control];
    return index === null ? "" : buttonName(a.family, index);
  }

  /** The help's pad rows for the pad in use (none without one). */
  helpRows(): Array<[string, string]> {
    const a = this.active;
    if (!a) return [];
    const table = bindingsOf(this.profileFor(a.key));
    const name = (c: PadControl) => (table[c] === null ? "—" : buttonName(a.family, table[c] as number));
    const rows: Array<[string, string]> = [
      [`${name("throttle")} / ${name("brake")}`, t("help.pedals")],
      [t("pad.help.leftStick"), t("pad.help.steerWalk")],
      [t("pad.help.rightStick"), t("pad.help.look")],
      [name("handbrake"), t("pad.help.handbrakeJump", { jump: name("jump") })],
      [name("horn"), t("help.horn")],
      [name("lookBack"), t("pad.control.lookBack")],
      [name("run"), t("pad.help.run")],
    ];
    for (const control of PAD_CONTROLS) {
      const index = table[control];
      if (index === null || isHeldControl(control)) continue;
      rows.push([buttonName(a.family, index), controlLabel(control)]);
    }
    if (this.procon.connected) rows.push([t("pad.help.gyro"), t("pad.help.gyroHow")]);
    return rows;
  }

  // ---------------------------------------------------------------- rumble

  /** A one-off effect (strength 0–1). */
  rumble(kind: RumbleKind, strength = 1): void {
    if (!this.profile.rumble.enabled) return;
    this.rumbleMixer.play(kind, strength, this.now);
  }

  /** A contact of the player's car: a kerb's bump or a crash by the car's own Δv (m/s). */
  contact(kind: "bump" | "impact", dvMs: number): void {
    // A kerb is felt by the speed it is hit at, full at ≈43 km/h (12 m/s); a crash by the car's
    // own change of speed, full at 8 m/s (≈30 km/h into a wall).
    const strength = kind === "bump" ? Math.min(1, dvMs / 12) : Math.min(1, dvMs / 8);
    this.rumble(kind, strength);
  }

  /** Each game frame in the car: kerb jolts from the vertical speed, and the idle hum if chosen. */
  carFrame(f: CarFrame): void {
    const vy = f.verticalSpeed;
    const isJolt = f.inCar && this.lastVy !== null && this.now - this.lastBumpAt > 120;
    const strength = isJolt ? bumpStrength(this.lastVy as number, vy) : 0;
    this.lastVy = f.inCar ? vy : null;
    if (strength > 0) {
      this.lastBumpAt = this.now;
      this.rumble("bump", strength);
    }
    const isIdling = f.inCar && f.engineOn && f.kmh < 3 && this.profile.rumble.engineIdle;
    if (isIdling) this.rumbleMixer.hold("idle", idleFrame(f.throttle), this.now);
    else this.rumbleMixer.release("idle");
  }

  private outputRumble(now: number): void {
    const profile = this.profile;
    const frame: RumbleFrame = this.rumbleMixer.frame(
      now,
      profile.rumble.enabled ? profile.rumble.intensity : 0,
    );
    const silent = isSilent(frame);
    const isStillSilent = silent && this.rumbleWasSilent;
    this.rumbleWasSilent = silent;
    if (isStillSilent) return;
    // HD rumble through WebHID only when the Pro Controller is the pad in use (another pad in the
    // hands while the Pro Controller lies connected on the desk should rumble itself).
    const isProConInUse = this.procon.connected && this.active?.key === PRO_CON_KEY;
    if (isProConInUse) {
      this.procon.rumble(frame, now);
      return;
    }
    const actuator = this.active?.vibration ?? null;
    if (!actuator) return;
    if (silent) {
      void actuator.reset?.().catch(() => {});
      return;
    }
    const isDue = now - this.lastVibrationAt > 80;
    if (!isDue) return;
    this.lastVibrationAt = now;
    // Gamepad API dual-rumble: the low band as the strong motor, the high band as the weak one.
    void actuator
      .playEffect("dual-rumble", {
        duration: 100,
        startDelay: 0,
        strongMagnitude: frame.low.amp,
        weakMagnitude: frame.high.amp,
      })
      .catch(() => {});
  }
}

export const PRO_CON_KEY = `${hex4(NINTENDO_VENDOR)}-${hex4(PRO_CONTROLLER)}`;

function snapshotOf(g: Gamepad): PadSnapshot {
  const key = padKey(g.id);
  return {
    key,
    slot: `api:${g.index}`,
    id: g.id,
    name: padName(g.id),
    family: familyOf(g.id, g.mapping),
    mapping: g.mapping,
    pressed: g.buttons.map((b) => b.pressed),
    values: g.buttons.map((b) => b.value),
    axes: [...g.axes],
    source: "api",
    vibration:
      (g as Gamepad & { vibrationActuator?: GamepadHapticActuator | null }).vibrationActuator ?? null,
  };
}

function hidSnapshot(hid: ProConHid): PadSnapshot {
  const report = hid.report;
  const pressed = report ? standardButtons(report.buttons) : [];
  return {
    key: PRO_CON_KEY,
    slot: "hid",
    id: `${hid.name} (WebHID Vendor: 057e Product: 2009)`,
    name: hid.name,
    family: "nintendo",
    mapping: "standard",
    pressed,
    values: pressed.map((p) => (p ? 1 : 0)),
    axes: report ? stickAxes(report.sticks) : [0, 0, 0, 0],
    source: "hid",
    vibration: null,
  };
}

/** A button newly pressed or a stick pushed past half way: the pad is in someone's hands. */
function activityOf(
  p: PadSnapshot,
  before: boolean[] | undefined,
  axesBefore: number[] | undefined,
): boolean {
  const isPressed = p.pressed.some((down, i) => down && !before?.[i]);
  const isPushed = p.axes.some((v, i) => Math.abs(v) > 0.5 && Math.abs(axesBefore?.[i] ?? 0) <= 0.5);
  return isPressed || isPushed;
}
