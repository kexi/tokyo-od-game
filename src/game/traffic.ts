/**
 * Road Traffic Act (道路交通法) scoring for the player's car: 違反点数 and 反則金 for 普通車.
 * Values follow the National Police Agency tables (see LAW_SOURCES); penalties above the
 * 反則金 range (e.g. ≥30 km/h over on ordinary roads) are 非反則行為 handled by criminal fines,
 * so the game shows them as 「罰金（刑事手続）」 instead of an amount.
 */
export type ViolationKind =
  | "signal" // 信号無視（赤色等）
  | "stopSign" // 指定場所一時不停止等
  | "noEntry" // 通行禁止違反（一方通行の逆走）
  | "turnBan" // 通行禁止違反（指定方向外進行禁止）
  | "closedRoad" // 通行禁止違反（車両通行止め・歩行者用道路）
  | "uturn" // 指定横断等禁止違反（転回禁止）
  | "slow" // 徐行場所違反
  | "laneChange" // 進路変更禁止違反
  | "keepLeft" // 通行区分違反（右側通行）
  | "speed" // 速度超過
  | "pedestrianCrossing" // 横断歩行者等妨害等
  | "safeDriving" // 安全運転義務違反
  | "injury" // 人身事故の付加点数（軽傷・不注意の程度が重い場合の最小）
  | "hitAndRun" // 救護義務違反（ひき逃げ）
  | "phone" // 携帯電話使用等（保持）
  | "parking" // 放置駐車違反（駐車禁止場所等）
  | "parkingNoStop"; // 放置駐車違反（駐停車禁止場所等）

export type Violation = {
  kind: ViolationKind;
  label: string;
  article: string;
  points: number;
  fine: number | null;
};

// Checked 2026-10-04 against the primary sources below (反則金一覧 updated 2026-04-01).
export const LAW_SOURCES = [
  "https://laws.e-gov.go.jp/law/335AC0000000105", // 道路交通法
  "https://laws.e-gov.go.jp/law/335CO0000000270", // 道路交通法施行令
  "https://www.keishicho.metro.tokyo.lg.jp/menkyo/torishimari/tetsuzuki/hansoku.html",
  "https://www.keishicho.metro.tokyo.lg.jp/menkyo/torishimari/gyosei/seido/tensu.html",
  "https://www.keishicho.metro.tokyo.lg.jp/menkyo/torishimari/gyosei/seido/gyosei16.html", // ひき逃げ 35点
  "https://www.keishicho.metro.tokyo.lg.jp/menkyo/torishimari/gyosei/seido/gyosei21.html", // 付加点数
];

/**
 * 法定速度 on ordinary roads without speed signs (施行令 第11条, as amended 2026-09-01):
 * 60 km/h where there is a centre line, marked lanes or a divided carriageway; 30 km/h otherwise.
 */
export const STATUTORY_SPEED = { major: 60, residential: 30 } as const;

/** 違反点数 at which a driver without prior record has the licence suspended (前歴なし). */
export const SUSPENSION_POINTS = 6;

export function speedViolation(overKmh: number): Violation | null {
  const over = Math.floor(overKmh);
  if (over < 1) return null;
  const article = "道路交通法 第22条（最高速度）";
  if (over < 15)
    return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 1, fine: 9000 };
  if (over < 20)
    return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 1, fine: 12000 };
  if (over < 25)
    return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 2, fine: 15000 };
  if (over < 30)
    return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 3, fine: 18000 };
  if (over < 50)
    return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 6, fine: null };
  return { kind: "speed", label: `速度超過（${over}km/h超過）`, article, points: 12, fine: null };
}

export const VIOLATIONS: Record<Exclude<ViolationKind, "speed">, Violation> = {
  signal: { kind: "signal", label: "信号無視（赤色等）", article: "道路交通法 第7条", points: 2, fine: 9000 },
  // 「止まれ」の標識（JARTIC 一時停止）がある停止線の直前で停止しなかった。
  stopSign: {
    kind: "stopSign",
    label: "指定場所一時不停止等",
    article: "道路交通法 第43条",
    points: 2,
    fine: 7000,
  },
  // 一方通行（JARTIC）を指定方向と逆に通行した。一方通行は逆方向の通行禁止として扱われる。
  noEntry: {
    kind: "noEntry",
    label: "通行禁止違反（一方通行）",
    article: "道路交通法 第8条第1項",
    points: 2,
    fine: 7000,
  },
  // 指定方向外進行禁止の標識に従わず、指定された方向以外へ進んだ（通行禁止の一種）。
  turnBan: {
    kind: "turnBan",
    label: "通行禁止違反（指定方向外進行禁止）",
    article: "道路交通法 第8条第1項",
    points: 2,
    fine: 7000,
  },
  // 通行止めの時間帯（通学路・歩行者用道路など）に、その道路へ入った。
  closedRoad: {
    kind: "closedRoad",
    label: "通行禁止違反（車両通行止め）",
    article: "道路交通法 第8条第1項",
    points: 2,
    fine: 7000,
  },
  // 転回禁止の区間で U ターンした。
  uturn: {
    kind: "uturn",
    label: "指定横断等禁止違反（転回禁止）",
    article: "道路交通法 第25条の2第2項",
    points: 1,
    fine: 6000,
  },
  // 徐行の標識がある区間を、直ちに停止できる速度（おおむね 10km/h）を超えて走った。
  slow: {
    kind: "slow",
    label: "徐行場所違反",
    article: "道路交通法 第42条",
    points: 2,
    fine: 7000,
  },
  // 黄色の車線境界線（進路変更禁止）をまたいで車線を変えた。
  laneChange: {
    kind: "laneChange",
    label: "進路変更禁止違反",
    article: "道路交通法 第26条の2第3項",
    points: 1,
    fine: 6000,
  },
  keepLeft: {
    kind: "keepLeft",
    label: "通行区分違反（右側通行）",
    article: "道路交通法 第17条",
    points: 2,
    fine: 9000,
  },
  pedestrianCrossing: {
    kind: "pedestrianCrossing",
    label: "横断歩行者等妨害等",
    article: "道路交通法 第38条",
    points: 2,
    fine: 9000,
  },
  safeDriving: {
    kind: "safeDriving",
    label: "安全運転義務違反",
    article: "道路交通法 第70条",
    points: 2,
    fine: 9000,
  },
  injury: {
    kind: "injury",
    label: "人身事故（付加点数・軽傷）",
    article: "施行令 別表第二 付加点数",
    points: 3,
    fine: null,
  },
  // 走行中のスマホ保持・注視。傷病者の救護のため緊急やむを得ない通話は同号ただし書で除外される。
  phone: {
    kind: "phone",
    label: "携帯電話使用等（保持）",
    article: "道路交通法 第71条第5号の5",
    points: 3,
    fine: 18000,
  },
  // 運転者が車を離れて直ちに運転できない状態（放置）。都内の車道の多くは駐車禁止。
  parking: {
    kind: "parking",
    label: "放置駐車違反（駐車禁止場所等）",
    article: "道路交通法 第45条",
    points: 2,
    fine: 15000,
  },
  // 交差点とその側端から 5m 以内などは駐停車禁止。
  parkingNoStop: {
    kind: "parkingNoStop",
    label: "放置駐車違反（駐停車禁止場所等）",
    article: "道路交通法 第44条",
    points: 3,
    fine: 18000,
  },
  hitAndRun: {
    kind: "hitAndRun",
    label: "救護義務違反（ひき逃げ）",
    article: "道路交通法 第72条第1項前段",
    points: 35,
    fine: null,
  },
};

/** 違反点数 at which the licence is revoked (前歴なし, 15 点以上で取消). */
export const REVOCATION_POINTS = 15;

export type LicenseState = {
  points: number;
  fines: number;
  log: Array<Violation & { at: number }>;
  suspended: boolean;
};

export class TrafficLaw {
  readonly state: LicenseState = { points: 0, fines: 0, log: [], suspended: false };
  private readonly cooldown = new Map<ViolationKind, number>();
  /** 放置違反金 orders so far (repeated orders can lead to a vehicle 使用制限命令). */
  ownerOrders = 0;

  /** Records a violation unless the same kind was booked within `cooldownMs` (one stop per offence). */
  book(v: Violation, now: number, cooldownMs = 8000): Violation | null {
    const until = this.cooldown.get(v.kind) ?? 0;
    // Keep booking while suspended: an offence committed before the screen appears (e.g. fleeing
    // after the crash that crossed 6 points) still counts.
    if (now < until) return null;
    this.cooldown.set(v.kind, now + cooldownMs);
    this.state.points += v.points;
    this.state.fines += v.fine ?? 0;
    this.state.log.push({ ...v, at: now });
    if (this.state.points >= SUSPENSION_POINTS) this.state.suspended = true;
    return v;
  }

  /**
   * 放置違反金: when the driver does not come forward after a 確認標章, the vehicle's user (使用者)
   * is ordered to pay the same amount, with no licence points (道路交通法 第51条の4).
   */
  chargeOwner(v: Violation, now: number): Violation {
    const owner: Violation = {
      ...v,
      label: `放置違反金（${v.label.replace(/^放置駐車違反/, "放置駐車")}）`,
      points: 0,
    };
    this.state.fines += owner.fine ?? 0;
    this.state.log.push({ ...owner, at: now });
    this.ownerOrders++;
    return owner;
  }

  /** Back to a clean licence (after the suspension screen). */
  reset(): void {
    this.state.points = 0;
    this.state.fines = 0;
    this.state.log = [];
    this.state.suspended = false;
    this.cooldown.clear();
  }
}

/**
 * 付加点数 for an injury accident caused solely by the driver's carelessness, with severity
 * estimated from impact speed (the game never models fatalities). A crash that follows a
 * 反則行為 is not eligible for 反則金 (法第125条第2項第3号), hence fine: null.
 */
export function injuryViolation(impactKmh: number): Violation {
  const [points, injury] =
    impactKmh >= 60
      ? [13, "治療3か月以上"]
      : impactKmh >= 40
        ? [9, "治療30日以上3か月未満"]
        : impactKmh >= 20
          ? [6, "治療15日以上30日未満"]
          : [3, "治療15日未満"];
  return {
    kind: "injury",
    label: `人身事故・付加点数（${injury}）`,
    article: "施行令 別表第二",
    points,
    fine: null,
  };
}

export function formatViolation(v: Violation): string {
  const fine = v.fine === null ? "罰金（刑事手続）" : `反則金 ${v.fine.toLocaleString()}円`;
  return `${v.label}／${v.article}／違反点数 ${v.points}点・${fine}`;
}
