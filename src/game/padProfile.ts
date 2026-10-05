import { z } from "zod";
import type { Action } from "./input";

/**
 * 設定 › コントローラー: which pad button does what, the stick and trigger feel, the gyro and the
 * rumble, saved per controller (knowledge/gamepad-and-procon.md). Pure: no DOM, no navigator, so
 * the tests run it in Node.
 *
 * Buttons are the indices of the Gamepad API's `buttons` array. Chrome reports the Switch Pro
 * Controller already in the W3C standard order (device/gamepad/nintendo_controller.cc), so the
 * same index means the same place on every standard pad: 0 is the bottom face button (Pro
 * Controller B, Xbox A), 7 the right trigger (ZR, RT).
 */

/** What a pad button can do: every keyboard action, plus the pedals and the held controls. */
export type PadControl =
  | Action
  | "throttle"
  | "brake"
  | "handbrake"
  | "horn"
  | "lookBack"
  | "jump"
  | "run"
  | "gyroCenter";

/** Where a control works: in the car, on foot, or both (two controls conflict when these meet). */
export type PadContext = "car" | "foot" | "any";

const CAR_ACTIONS: ReadonlySet<PadControl> = new Set<PadControl>([
  "throttle",
  "brake",
  "handbrake",
  "horn",
  "lookBack",
  "indicatorLeft",
  "indicatorRight",
  "hazard",
  "lights",
  "highBeam",
  "wipers",
  "belt",
  "tv",
  "tvChannel",
  "autopilot",
]);
const FOOT_ACTIONS: ReadonlySet<PadControl> = new Set<PadControl>(["jump", "run"]);

export const contextOf = (control: PadControl): PadContext =>
  CAR_ACTIONS.has(control) ? "car" : FOOT_ACTIONS.has(control) ? "foot" : "any";

/** Whether two contexts can be in force at once (a button may then do only one of them). */
export const contextsMeet = (a: PadContext, b: PadContext): boolean => a === "any" || b === "any" || a === b;

/**
 * The bindable controls in the order the settings list them: driving, on foot, then the keyboard's
 * actions as the help lists them. 設定 itself is not here: + (閉じる) opens it when nothing is open,
 * as Esc does.
 */
export const PAD_CONTROLS: readonly PadControl[] = [
  "throttle",
  "brake",
  "handbrake",
  "horn",
  "lookBack",
  "jump",
  "run",
  "door",
  "talk",
  "phone",
  "close",
  "mission",
  "indicatorLeft",
  "indicatorRight",
  "hazard",
  "lights",
  "highBeam",
  "wipers",
  "belt",
  "camera",
  "cameraPrev",
  "screenshot",
  "autopilot",
  "taxi",
  "phoneZoom",
  "enter",
  "nav",
  "minimap",
  "tv",
  "tvChannel",
  "pause",
  "reset",
  "home",
  "warp",
  "replay",
  "time",
  "weather",
  "ground",
  "mute",
  "help",
  "credits",
  "title",
  "gyroCenter",
];

/** Controls that act while held (or, with the toggle setting, flip on each press). */
export const HELD_CONTROLS = ["throttle", "brake", "handbrake", "horn", "lookBack", "jump", "run"] as const;
export type HeldControl = (typeof HELD_CONTROLS)[number];
export const isHeldControl = (c: PadControl): c is HeldControl =>
  (HELD_CONTROLS as readonly string[]).includes(c);

/** The held controls that may be switched to 押すたびに切り替え. */
export const TOGGLABLE = ["handbrake", "run", "lookBack"] as const;
export type Togglable = (typeof TOGGLABLE)[number];

export type Bindings = Partial<Record<PadControl, number | null>>;

/**
 * The default layout, by standard-mapping index (Pro Controller names; Xbox in brackets):
 *
 * | button        | in the car                | on foot        |
 * |---------------|---------------------------|----------------|
 * | ZR 7 [RT]     | アクセル                   | —              |
 * | ZL 6 [LT]     | ブレーキ・停止中はバック    | —              |
 * | B 0 [A]       | サイドブレーキ             | ジャンプ        |
 * | A 1 [B]       | 降りる                     | 乗る           |
 * | Y 2 [X]       | エンジン                   | 話す           |
 * | X 3 [Y]       | スマホ                     | スマホ         |
 * | L 4 / R 5     | 左 / 右の合図              | — / 走る       |
 * | LS 10 (押す)  | クラクション               | —              |
 * | RS 11 (押す)  | 後ろを見る                 | —              |
 * | ↑ 12 / ↓ 13   | ライト / ワイパー           | —              |
 * | ← 14          | ハザード                   | —              |
 * | → 15          | 視点の切り替え             | 視点の切り替え  |
 * | − 8           | 目的地                     | 目的地         |
 * | + 9           | 閉じる・設定               | 閉じる・設定    |
 * | Capture 17    | スクリーンショット          | 同じ           |
 *
 * Why the bottom button is the parking brake and the triggers the pedals: the driving games on the
 * same pads (Forza, Gran Turismo, Mario Kart's ZR/ZL) put them there, so hands already know them.
 * Home (16) is left free: macOS and Windows game overlays may take it before the page sees it.
 */
export const DEFAULT_BINDINGS: Readonly<Record<PadControl, number | null>> = {
  throttle: 7,
  brake: 6,
  handbrake: 0,
  horn: 10,
  lookBack: 11,
  jump: 0,
  run: 5,
  door: 1,
  talk: 2,
  phone: 3,
  close: 9,
  mission: 8,
  indicatorLeft: 4,
  indicatorRight: 5,
  hazard: 14,
  lights: 12,
  highBeam: null,
  wipers: 13,
  belt: null,
  camera: 15,
  cameraPrev: null,
  screenshot: 17,
  autopilot: null,
  taxi: null,
  phoneZoom: null,
  enter: null,
  nav: null,
  minimap: null,
  tv: null,
  tvChannel: null,
  pause: null,
  reset: null,
  home: null,
  warp: null,
  replay: null,
  time: null,
  weather: null,
  ground: null,
  mute: null,
  help: null,
  credits: null,
  title: null,
  gyroCenter: null,
  // Not bindable (see PAD_CONTROLS); here so the table covers every Action.
  settings: null,
};

export type ConflictMode = "swap" | "clear";

/** Ranges of the sliders (the stored values are clamped to them). */
export const RANGES = {
  deadzone: [0, 0.4],
  sensitivity: [0.5, 2],
  linearity: [1, 3],
  triggerRampS: [0, 1.5],
  gyroRangeDeg: [20, 120],
  rumbleIntensity: [0, 1],
} as const;

const clamped = (range: readonly [number, number], fallback: number) =>
  z
    .number()
    .transform((n) => Math.min(range[1], Math.max(range[0], n)))
    .catch(fallback);
const flag = (fallback: boolean) => z.boolean().catch(fallback);

export const DEFAULT_PROFILE = {
  /** Only the controls changed from DEFAULT_BINDINGS are stored; resolve with bindingsOf(). */
  bindings: {} as Bindings,
  steer: { deadzone: 0.1, sensitivity: 1, linearity: 1.5 },
  /** Time for a digital ZR to reach full throttle (s); ZL takes half of it. */
  triggerRampS: 0.45,
  invertLookX: false,
  toggles: { handbrake: false, run: false, lookBack: false } as Record<Togglable, boolean>,
  conflict: "swap" as ConflictMode,
  gyro: { enabled: false, rangeDeg: 60, invert: false },
  // Off by default for the idle: a pad that hums at every red light gets put down.
  rumble: { enabled: true, intensity: 0.7, engineIdle: false },
};
export type PadProfile = typeof DEFAULT_PROFILE;

const bindingValue = z.number().int().min(0).max(63).nullable();
/**
 * One controller's profile. Every field falls back to its default on its own (`.catch`), so a
 * value from an older or hand-edited store costs only itself, not the whole profile.
 */
const profileSchema = z.object({
  bindings: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((raw) => {
      const out: Bindings = {};
      for (const [key, value] of Object.entries(raw)) {
        const isKnown = (PAD_CONTROLS as readonly string[]).includes(key);
        const parsed = bindingValue.safeParse(value);
        if (isKnown && parsed.success) out[key as PadControl] = parsed.data;
      }
      return out;
    }),
  steer: z
    .object({
      deadzone: clamped(RANGES.deadzone, DEFAULT_PROFILE.steer.deadzone),
      sensitivity: clamped(RANGES.sensitivity, DEFAULT_PROFILE.steer.sensitivity),
      linearity: clamped(RANGES.linearity, DEFAULT_PROFILE.steer.linearity),
    })
    .catch(DEFAULT_PROFILE.steer),
  triggerRampS: clamped(RANGES.triggerRampS, DEFAULT_PROFILE.triggerRampS),
  invertLookX: flag(false),
  toggles: z
    .object({ handbrake: flag(false), run: flag(false), lookBack: flag(false) })
    .catch(DEFAULT_PROFILE.toggles),
  conflict: z.enum(["swap", "clear"]).catch("swap"),
  gyro: z
    .object({
      enabled: flag(false),
      rangeDeg: clamped(RANGES.gyroRangeDeg, DEFAULT_PROFILE.gyro.rangeDeg),
      invert: flag(false),
    })
    .catch(DEFAULT_PROFILE.gyro),
  rumble: z
    .object({
      enabled: flag(true),
      intensity: clamped(RANGES.rumbleIntensity, DEFAULT_PROFILE.rumble.intensity),
      engineIdle: flag(false),
    })
    .catch(DEFAULT_PROFILE.rumble),
});

export const STORE_KEY = "tod.pad";
/** The store's format; a different version starts over from the defaults (no migration yet). */
export const STORE_VERSION = 1;
const storeSchema = z.object({
  version: z.literal(STORE_VERSION),
  profiles: z.record(z.string().max(160), z.unknown()),
});

export const cloneProfile = (p: PadProfile): PadProfile => structuredClone(p);
export const defaultProfile = (): PadProfile => cloneProfile(DEFAULT_PROFILE);

/** A stored profile read back: whatever is valid kept, the rest defaults. */
export function parseProfile(raw: unknown): PadProfile {
  const parsed = profileSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as PadProfile) : defaultProfile();
}

/** Every stored profile, by controller key; an unreadable or other-version store is none. */
export function parseStore(text: string | null): Map<string, PadProfile> {
  const out = new Map<string, PadProfile>();
  if (!text) return out;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return out;
  }
  const store = storeSchema.safeParse(json);
  if (!store.success) return out;
  for (const [key, raw] of Object.entries(store.data.profiles)) out.set(key, parseProfile(raw));
  return out;
}

export function serializeStore(profiles: ReadonlyMap<string, PadProfile>): string {
  return JSON.stringify({ version: STORE_VERSION, profiles: Object.fromEntries(profiles) });
}

export function loadPadStore(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): Map<string, PadProfile> {
  try {
    return parseStore(storage?.getItem(STORE_KEY) ?? null);
  } catch {
    // Storage blocked (a private window, previews): nothing remembered, defaults apply.
    return new Map();
  }
}

export function savePadStore(
  profiles: ReadonlyMap<string, PadProfile>,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(STORE_KEY, serializeStore(profiles));
  } catch {
    // Not remembered when storage is blocked or full; the choice still applies now.
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The full binding table: the profile's own choices over the defaults. */
export function bindingsOf(profile: PadProfile): Record<PadControl, number | null> {
  return { ...DEFAULT_BINDINGS, ...profile.bindings };
}

/** Controls on `button` that would be in force together with `control`. */
export function conflictsOf(
  table: Readonly<Record<PadControl, number | null>>,
  control: PadControl,
  button: number,
): PadControl[] {
  const ctx = contextOf(control);
  return PAD_CONTROLS.filter(
    (other) => other !== control && table[other] === button && contextsMeet(ctx, contextOf(other)),
  );
}

export type BindResult = {
  profile: PadProfile;
  /** Controls that moved to the old button (swap) or lost theirs (clear, or a swap that would clash). */
  swapped: PadControl[];
  cleared: PadControl[];
};

/**
 * Put `control` on `button`. A control already there in an overlapping context either takes the
 * old button of `control` (swap) or loses its binding (clear); a swap that would make a new clash
 * for it (e.g. B was ジャンプ on foot and サイドブレーキ in the car, and 乗降 swaps onto it) clears
 * instead, so the result never has two controls on one button in one context.
 */
export function bindControl(
  profile: PadProfile,
  control: PadControl,
  button: number,
  mode: ConflictMode = profile.conflict,
): BindResult {
  const table = bindingsOf(profile);
  const previous = table[control];
  const others = conflictsOf(table, control, button);
  const next = { ...table, [control]: button };
  const swapped: PadControl[] = [];
  const cleared: PadControl[] = [];
  for (const other of others) {
    const canSwap = mode === "swap" && previous !== null && previous !== button;
    next[other] = canSwap ? previous : null;
    const clashes = canSwap && conflictsOf(next, other, previous).length > 0;
    if (clashes) next[other] = null;
    (next[other] === null ? cleared : swapped).push(other);
  }
  return { profile: withBindings(profile, next), swapped, cleared };
}

export function clearControl(profile: PadProfile, control: PadControl): PadProfile {
  return withBindings(profile, { ...bindingsOf(profile), [control]: null });
}

export function resetBindings(profile: PadProfile): PadProfile {
  return { ...cloneProfile(profile), bindings: {} };
}

/** Store only what differs from the defaults (a later default change then reaches everyone else). */
function withBindings(profile: PadProfile, table: Record<PadControl, number | null>): PadProfile {
  const bindings: Bindings = {};
  for (const control of PAD_CONTROLS) {
    const isChanged = table[control] !== DEFAULT_BINDINGS[control];
    if (isChanged) bindings[control] = table[control];
  }
  return { ...cloneProfile(profile), bindings };
}

/** The controls bound to `button` that are in force where the player is. */
export function controlsOn(
  table: Readonly<Record<PadControl, number | null>>,
  button: number,
  onFoot: boolean,
): PadControl[] {
  return PAD_CONTROLS.filter((c) => {
    const ctx = contextOf(c);
    const isInForce = ctx === "any" || (onFoot ? ctx === "foot" : ctx === "car");
    return table[c] === button && isInForce;
  });
}
