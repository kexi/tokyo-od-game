import type { ViolationRecord } from "./traffic";

/**
 * What to do differently, per violation, as a driving instructor would put it. Used for the
 * end-of-day advice when the on-device AI is off (and as its facts when it is on).
 */
const TIPS: Record<string, string> = {
  speed:
    "標識の数字と、標識が無い道は法定速度（一般道 60 km/h、狭い道は実質 30 km/h）を意識し、下り坂や流れに乗るときこそメーターを見ましょう。",
  signal:
    "黄色は「止まれ」の合図です。停止線で安全に止まれるなら止まり、交差点の手前から速度を落としておきましょう。",
  stopSign:
    "「止まれ」では停止線の手前で完全に止まり（タイヤの回転が止まるまで）、左右を確かめてから進みましょう。",
  noEntry:
    "一方通行の出口側から入っていました。交差点では曲がる前に、入る道の標識（白い矢印・赤い進入禁止）を見ましょう。",
  keepLeft: "道路の中央から左の部分を通行します。駐車車両を避けた後や右折の後は、すぐ左側に戻りましょう。",
  closedRoad:
    "時間帯の通行止め（通学路の歩行者用道路など）は補助標識の時刻を読み、ナビのルートにも従いましょう。",
  turnBan: "交差点の手前の青い矢印の標識が、進める方向です。曲がれない場合は、次の交差点で回り込みましょう。",
  uturn: "転回禁止の標識がある区間ではＵターンできません。ブロックを一周して戻りましょう。",
  slow: "「徐行」はすぐ止まれる速さ（おおむね 10 km/h 以下）のことです。",
  laneChange:
    "黄色の車線境界線は進路変更禁止です。交差点の手前では早めに、白い破線のうちに車線を選びましょう。",
  laneUse: "片側 2 車線以上の道路では、追越しや右折の準備のとき以外は左側の車線を走りましょう。",
  laneDirection:
    "路面の矢印が、その車線から進める方向です。ナビのレーン案内を見て、手前で車線を選びましょう。",
  phone: "走行中はスマホを手に持たないこと。操作は安全な場所に止めてからにしましょう。",
  phoneDanger: "スマホを見ながらの運転は事故に直結します。通知は運転が終わるまで見ないようにしましょう。",
  safeDriving: "前の車との車間距離を十分にとり、交差点や横断歩道の手前ではいつでも止まれる速度にしましょう。",
  injury:
    "人身事故を起こしてしまいました。横断歩道や見通しの悪い場所では、歩行者がいる前提で速度を落としましょう。",
  parking:
    "駐車禁止の道では車を離れないこと。コインパーキングや時間制限駐車区間（パーキングメーター）を使いましょう。",
};

export function tipFor(kind: string): string {
  return (
    TIPS[kind] ??
    TIPS[kind.replace(/\d+$/, "")] ??
    "標識と路面の表示を手前から確かめ、余裕を持った速度で運転しましょう。"
  );
}

/** One tip per kind of violation the driver committed today, most frequent first. */
export function adviceFor(records: readonly ViolationRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]).map(([kind]) => tipFor(kind));
}
