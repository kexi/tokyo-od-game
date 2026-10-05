import { t, type MessageKey } from "../i18n";
import type { Assist } from "./carControls";
import { IS_MAC, keyFor, type KeyLayout } from "./input";
import { SOCIAL_APP_NAME } from "./socialTheme";

/**
 * 設定: the key layout (WASD, FPS-style, by default; or City Car Driving's arrows), the control
 * mode (簡単操作 by default: the car works its own switches; or リアル), the seat, the screen and
 * the sound, remembered in this browser, and the key list in the help that follows them.
 */
export type ControlPrefs = {
  layout: KeyLayout;
  assist: Assist;
  /** 座席: the driver's eye above (+) the model's and behind (+) it, in metres. */
  seatUp: number;
  seatBack: number;
  /** 音量 of everything the game plays, 0–1. */
  volume: number;
  /** The small map and the junction guide (ナビ) on screen. */
  minimap: boolean;
  nav: boolean;
  /** The small map with north up (else the way ahead is up, as a car navi's default). */
  minimapNorthUp: boolean;
  /** ミラーの飾り: what hangs from the rear-view mirror (game/mirrorCharm.ts). */
  charm: CharmChoice;
};

/** ミラーの飾り: nothing, the plush bear, the お守り, or both on the one stay. */
export type CharmChoice = "none" | "plush" | "omamori" | "both";

const STORE_KEY = "tod.controls";
/** The cockpit model the stored seat was set for (2: the 2026-10-05 driving position). */
const SEAT_MODEL = 2;
/**
 * The seat as modelled: cockpit.glb's DriverEye is the eye of a 50th-percentile Japanese man in a
 * seat set where such drivers set it, and sees the road 7.6° below the horizon past the bonnet
 * (knowledge/cockpit-blender.md). The sliders are for other statures (a 5th-percentile woman sits
 * ~7.5 cm lower and ~9.6 cm further forward, a 95th-percentile man ~5 cm higher and ~5 cm back).
 */
export const DEFAULT_PREFS: ControlPrefs = {
  layout: "wasd",
  assist: "easy",
  seatUp: 0,
  seatBack: 0,
  volume: 0.8,
  minimap: true,
  nav: true,
  minimapNorthUp: false,
  // The bear: what the 飾り are for, and small (3.6 × 5.8 cm), hanging just under the mirror near
  // the left A-pillar as the driver sees it; なし is one choice away.
  charm: "plush",
};
const SEAT_UP = [-0.08, 0.16] as const;
const SEAT_BACK = [-0.1, 0.12] as const;
/** A stored or chosen seat setting, kept within the seat's travel. */
export const seatOf = (value: unknown, range: readonly [number, number], fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(range[0], Math.min(range[1], n)) : fallback;
};
export const SEAT_RANGE = { up: SEAT_UP, back: SEAT_BACK };

/** A stored or chosen 音量, 0–1. */
export const volumeOf = (value: unknown): number => seatOf(value, [0, 1], DEFAULT_PREFS.volume);

/** A stored or chosen ミラーの飾り; anything else is the default. */
export const charmOf = (value: unknown): CharmChoice =>
  value === "none" || value === "plush" || value === "omamori" || value === "both"
    ? value
    : DEFAULT_PREFS.charm;

export function loadPrefs(): ControlPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<ControlPrefs> | null;
    const layout = saved?.layout === "ccd" ? "ccd" : DEFAULT_PREFS.layout;
    const assist = saved?.assist === "real" ? "real" : DEFAULT_PREFS.assist;
    // A seat saved for the old cockpit (its eye 5 cm low, so +5 cm was the default) starts over.
    const isSeatOfOldModel = (saved as { seatModel?: number } | null)?.seatModel !== SEAT_MODEL;
    const seat = isSeatOfOldModel ? {} : (saved ?? {});
    return {
      layout,
      assist,
      seatUp: seatOf(seat.seatUp, SEAT_UP, DEFAULT_PREFS.seatUp),
      seatBack: seatOf(seat.seatBack, SEAT_BACK, DEFAULT_PREFS.seatBack),
      volume: volumeOf(saved?.volume),
      minimap: saved?.minimap !== false,
      nav: saved?.nav !== false,
      minimapNorthUp: saved?.minimapNorthUp === true,
      charm: charmOf(saved?.charm),
    };
  } catch {
    // Storage blocked (private window, previews): the defaults.
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ControlPrefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...prefs, seatModel: SEAT_MODEL }));
  } catch {
    // Not remembered when storage is blocked; the choice still applies now.
  }
}

/** The help's key list for a layout; switches the car works itself in 簡単操作 say so. */
export function keyRows(prefs: Pick<ControlPrefs, "layout" | "assist">): Array<[string, string]> {
  const { layout, assist } = prefs;
  const auto = (key: MessageKey) => (assist === "easy" ? t("help.easyAuto", { text: t(key) }) : t(key));
  const isWasd = layout === "wasd";
  const drive: Array<[string, string]> = isWasd
    ? [
        ["W / S", t("help.pedals")],
        ["A / D", t("help.steerWasd")],
        [t("help.mouse"), t("help.mouseLook")],
      ]
    : [
        ["↑ / ↓", t("help.pedals")],
        ["← →", t("help.steer")],
      ];
  const key = (action: Parameters<typeof keyFor>[1]) => keyFor(layout, action);
  return [
    ...drive,
    ["Space", auto("help.parkingBrake")],
    [key("talk"), t("help.engineRow", { engine: auto("help.engine") })],
    [", / .", auto("help.indicators")],
    [key("hazard"), t("help.hazard")],
    [`${key("lights")} / ${key("highBeam")}`, auto("help.lights")],
    [key("wipers"), auto("help.wipers")],
    ["H", t("help.horn")],
    [key("belt"), auto("help.belt")],
    [`${key("camera")} / ${key("cameraPrev")}`, t("help.camera")],
    isWasd
      ? ["Z", t("help.lookBackWasd")]
      : [t(IS_MAC ? "help.lookKeysMac" : "help.lookKeys"), t("help.look")],
    [key("phone"), t("help.phone", { app: SOCIAL_APP_NAME })],
    [key("taxi"), t("help.taxi")],
    [key("phoneZoom"), t("help.phoneZoom")],
    [`${key("nav")} / ${key("minimap")}`, t("help.navMap")],
    [`${key("tv")} / ${key("tvChannel")}`, t(assist === "easy" ? "help.tvEasy" : "help.tvReal")],
    [key("pause"), t("help.pause")],
    [key("reset"), t("help.reset")],
    [key("screenshot"), t("help.screenshot")],
    [key("autopilot"), t("help.autopilot")],
    [key("door"), t("help.door", { look: isWasd ? t("help.mouse") : "← →" })],
    [`${key("mission")} / ${key("home")}`, t("help.missionHome")],
    [`${key("time")} / ${key("weather")}`, t("help.timeWeather")],
    [`${key("help")} / ${key("ground")} / ${key("mute")} / ${key("credits")}`, t("help.misc")],
    ...(IS_MAC ? [] : ([["1 2 5 8 9 0", t("help.digits")]] as Array<[string, string]>)),
    ["Enter", t("help.enter")],
    [key("settings"), t("help.settings")],
  ];
}

const row = ([keys, what]: [string, string]) => {
  const dt = document.createElement("dt");
  dt.textContent = keys;
  const dd = document.createElement("dd");
  dd.textContent = what;
  return [dt, dd];
};

/**
 * The help's list: the keyboard's rows, then — with a pad in use — its rows under its name
 * (game/gamepad.ts helpRows(), from the buttons 設定 › コントローラー has bound).
 */
export function renderKeyList(
  list: HTMLElement,
  prefs: ControlPrefs,
  pad: { name: string; rows: Array<[string, string]> } | null = null,
): void {
  const padHead = () => {
    const dt = document.createElement("dt");
    dt.className = "help-pad-head";
    dt.textContent = `🎮 ${pad?.name ?? ""}`;
    const dd = document.createElement("dd");
    dd.className = "help-pad-head";
    dd.textContent = t("settings.pad");
    return [dt, dd];
  };
  const hasPad = pad !== null && pad.rows.length > 0;
  list.replaceChildren(
    ...keyRows(prefs).flatMap(row),
    ...(hasPad ? [...padHead(), ...pad.rows.flatMap(row)] : []),
  );
}
