import type { Assist } from "./carControls";
import { keyFor, type KeyLayout } from "./input";
import { SOCIAL_APP_NAME } from "./socialTheme";

/**
 * 操作設定: the key layout (WASD, FPS-style, by default; or City Car Driving's arrows) and the
 * control mode (簡単操作 by default: the car works its own switches; or リアル), remembered in this
 * browser, and the key list in the help that follows them.
 */
export type ControlPrefs = { layout: KeyLayout; assist: Assist };

const STORE_KEY = "tod.controls";
export const DEFAULT_PREFS: ControlPrefs = { layout: "wasd", assist: "easy" };

export function loadPrefs(): ControlPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<ControlPrefs> | null;
    const layout = saved?.layout === "ccd" ? "ccd" : DEFAULT_PREFS.layout;
    const assist = saved?.assist === "real" ? "real" : DEFAULT_PREFS.assist;
    return { layout, assist };
  } catch {
    // Storage blocked (private window, previews): the defaults.
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ControlPrefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered when storage is blocked; the choice still applies now.
  }
}

/** The help's key list for a layout; switches the car works itself in 簡単操作 say so. */
export function keyRows(prefs: ControlPrefs): Array<[string, string]> {
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
    ["左 Ctrl / 右 Ctrl / Z", "左 / 右 / 後ろを見る（押している間）"],
    [key("phone"), `スマホ（119・110・タクシー・${SOCIAL_APP_NAME}）`],
    [key("phoneZoom"), "スマホの拡大表示 / 元に戻す（操作になるので運転中は使わない）"],
    [`${key("nav")} / ${key("minimap")}`, "ナビ / 小さな地図の表示"],
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
    ["F1 / F2 / F8 / I", "この画面 / 地面の写真 / 音 / データ出典"],
    ["Enter", "会話・通話の入力欄へ（Esc で運転に戻る）"],
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
