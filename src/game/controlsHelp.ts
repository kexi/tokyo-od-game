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
};

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
  const auto = (text: string) => (assist === "easy" ? `${text}（簡単操作では自動）` : text);
  const isWasd = layout === "wasd";
  const drive: Array<[string, string]> = isWasd
    ? [
        ["W / S", "アクセル / ブレーキ（停止中はバック）"],
        ["A / D", "ハンドル（矢印キーでも操作できます）"],
        ["マウス", "視点（画面をクリックで開始、Esc で解除）"],
      ]
    : [
        ["↑ / ↓", "アクセル / ブレーキ（停止中はバック）"],
        ["← →", "ハンドル"],
      ];
  const key = (action: Parameters<typeof keyFor>[1]) => keyFor(layout, action);
  return [
    ...drive,
    ["Space", auto("サイドブレーキ")],
    [key("talk"), auto("エンジン始動・停止") + "（徒歩では近くの人に話しかける）"],
    [", / .", auto("左 / 右の方向指示器（曲がり終えると自動で戻る）")],
    [key("hazard"), "ハザードランプ"],
    [`${key("lights")} / ${key("highBeam")}`, auto("ライト（AUTO → 点灯 → 消灯）/ ハイビーム")],
    [key("wipers"), auto("ワイパー")],
    ["H", "クラクション（危険を防ぐとき以外は違反）"],
    [key("belt"), auto("シートベルト")],
    [`${key("camera")} / ${key("cameraPrev")}`, "視点の切り替え"],
    isWasd
      ? ["Z", "後ろを見る（押している間。左右はマウスで）"]
      : [IS_MAC ? "左 ⌥ / 右 ⌥ / Z" : "左 Ctrl / 右 Ctrl / Z", "左 / 右 / 後ろを見る（押している間）"],
    [key("phone"), `スマホ（119・110・タクシー・${SOCIAL_APP_NAME}）`],
    [key("taxi"), "自動運転タクシーを呼ぶ（スマホのタクシーアプリ）"],
    [key("phoneZoom"), "スマホの拡大表示 / 元に戻す（操作になるので運転中は使わない）"],
    [`${key("nav")} / ${key("minimap")}`, "ナビ / 小さな地図の表示"],
    [
      `${key("tv")} / ${key("tvChannel")}`,
      assist === "easy"
        ? "ナビのテレビ / チャンネル（映像は停車中だけ、走行中は音声のみ。簡単操作では案内中に走り出すと地図に戻る）"
        : "ナビのテレビ / チャンネル（映像は停車してサイドブレーキ（Space）かエンジン停止のときだけ、走行中は音声のみ）",
    ],
    [key("pause"), "一時停止"],
    [key("reset"), "車を起こす・その場に復帰"],
    [key("screenshot"), "スクリーンショット"],
    [key("autopilot"), "自動運転"],
    [
      key("door"),
      `車を降りる / 乗る（徒歩: WASD・Shift で走る・Space でジャンプ・${isWasd ? "マウス" : "← →"}で視点）`,
    ],
    [`${key("mission")} / ${key("home")}`, "新しい目的地 / 家に帰る（着くと一日が終わる）"],
    [`${key("time")} / ${key("weather")}`, "時間帯 / 天気"],
    [
      `${key("help")} / ${key("ground")} / ${key("mute")} / ${key("credits")}`,
      "この画面 / 地面の写真 / 音 / データ出典",
    ],
    ...(IS_MAC
      ? []
      : ([
          ["1 2 5 8 9 0", "F1・F2・F5・F8・Home・F12 と同じ（F キー・Home キーの無いキーボード向け）"],
        ] as Array<[string, string]>)),
    ["Enter", "会話・通話の入力欄へ（Esc で運転に戻る）"],
    [key("settings"), "設定（開いている間は一時停止。スマホや会話が開いていればそれを閉じる）"],
  ];
}

export function renderKeyList(list: HTMLElement, prefs: ControlPrefs): void {
  list.replaceChildren(
    ...keyRows(prefs).flatMap(([keys, what]) => {
      const dt = document.createElement("dt");
      dt.textContent = keys;
      const dd = document.createElement("dd");
      dd.textContent = what;
      return [dt, dd];
    }),
  );
}
