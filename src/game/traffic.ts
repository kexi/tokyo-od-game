import { t } from "../i18n";
import { fineText, lawRef, pointsText, violationName } from "../i18n/law";
import { log, spanOf, traceId, type Span } from "../log";
import type { ReplayClip } from "./replayClip";
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
  | "laneUse" // 通行帯違反
  | "laneDirection" // 指定通行区分違反
  | "phoneDanger" // 携帯電話使用等（交通の危険）
  | "signalOmission" // 合図不履行
  | "noLights" // 無灯火
  | "hornMisuse" // 警音器使用制限違反
  | "seatBelt" // 座席ベルト装着義務違反
  | "keepLeft" // 通行区分違反（右側通行）
  | "speed" // 速度超過
  | "pedestrianCrossing" // 横断歩行者等妨害等
  | "safeDriving" // 安全運転義務違反
  | "injury" // 人身事故の付加点数（軽傷・不注意の程度が重い場合の最小）
  | "hitAndRun" // 救護義務違反（ひき逃げ）
  | "unlicensed" // 無免許運転（免許停止中）
  | "ignoredStop" // 警察官の停止に従わなかった（無免許などの疑いでの停止）
  | "phone" // 携帯電話使用等（保持）
  | "parking" // 放置駐車違反（駐車禁止場所等）
  | "parkingNoStop" // 放置駐車違反（駐停車禁止場所等）
  | "negligentInjury" // 過失運転致傷（自動車運転死傷処罰法 第5条）
  | "dangerousInjury" // 危険運転致傷（同法 第2条）
  | "obstruction" // 公務執行妨害（刑法 第95条第1項）
  | "propertyDamage"; // 器物損壊（刑法 第261条）

export type Violation = {
  kind: ViolationKind;
  /**
   * In Japanese, as stored and as Y's posters and the AI read it; violationName() and lawRef()
   * (src/i18n/law.ts) translate label and article for the screen.
   */
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
    label: "通行禁止違反",
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
  // 車両通行帯のある道路で、右端の通行帯を走り続けた（追越し・右折の準備を除く）。
  laneUse: {
    kind: "laneUse",
    label: "通行帯違反",
    article: "道路交通法 第20条第1項",
    points: 1,
    fine: 6000,
  },
  // 進行方向別通行区分のある交差点で、その車線に指定されていない方向へ進んだ。
  laneDirection: {
    kind: "laneDirection",
    label: "指定通行区分違反",
    article: "道路交通法 第35条第1項",
    points: 1,
    fine: 6000,
  },
  // スマホを使いながらの運転で事故など交通の危険を生じさせた（反則金の対象外、刑事手続）。
  phoneDanger: {
    kind: "phoneDanger",
    label: "携帯電話使用等（交通の危険）",
    article: "道路交通法 第71条第5号の5・第117条の4",
    points: 6,
    fine: null,
  },
  // 右左折・進路変更の前に方向指示器を出さなかった（右左折は 30m 手前から、施行令 第21条）。
  signalOmission: {
    kind: "signalOmission",
    label: "合図不履行",
    article: "道路交通法 第53条第1項",
    points: 1,
    fine: 6000,
  },
  // 夜間（日没から日の出まで）に前照灯をつけずに走った。
  noLights: {
    kind: "noLights",
    label: "無灯火",
    article: "道路交通法 第52条第1項",
    points: 1,
    fine: 6000,
  },
  // 危険を防止するためやむを得ない場合以外に警音器を鳴らした（点数なし）。
  hornMisuse: {
    kind: "hornMisuse",
    label: "警音器使用制限違反",
    article: "道路交通法 第54条第2項",
    points: 0,
    fine: 3000,
  },
  // 運転者が座席ベルトを着けずに運転した（反則金なし・点数のみ）。
  seatBelt: {
    kind: "seatBelt",
    label: "座席ベルト装着義務違反",
    article: "道路交通法 第71条の3第1項",
    points: 1,
    fine: 0,
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
  // 免許の効力が停止されている間の運転は無免許運転（非反則・刑事手続）。
  unlicensed: {
    kind: "unlicensed",
    label: "無免許運転（免許停止中）",
    article: "道路交通法 第64条第1項",
    points: 25,
    fine: null,
  },
  // 第67条第1項（無免許・酒気帯び・過労運転などの疑い）による停止に従わず逃げた。点数は無く刑罰のみ
  // （第119条第1項第13号：三月以下の拘禁刑又は五万円以下の罰金）。
  ignoredStop: {
    kind: "ignoredStop",
    label: "停止命令違反（警察官の停止に従わない）",
    article: "道路交通法 第67条第1項・第119条第1項第13号",
    points: 0,
    fine: null,
  },
  hitAndRun: {
    kind: "hitAndRun",
    label: "救護義務違反（ひき逃げ）",
    article: "道路交通法 第72条第1項前段",
    points: 35,
    fine: null,
  },
  // 追跡中に人を負傷させた（運転上必要な注意を怠った）。点数は安全運転義務違反と付加点数で数えるので
  // この記録自体は 0 点（警視庁「交通事故の付加点数」）。七年以下の拘禁刑又は百万円以下の罰金。
  negligentInjury: {
    kind: "negligentInjury",
    label: "過失運転致傷",
    article: "自動車運転死傷処罰法 第5条",
    points: 0,
    fine: null,
  },
  // 第2条の危険運転で人を負傷させた（十五年以下の拘禁刑）。特定違反行為の基礎点数（施行令 別表第二）は
  // 治療期間で 45・48・51・55 点で、安全運転義務違反と付加点数に代わる（dangerousInjuryViolation）。
  dangerousInjury: {
    kind: "dangerousInjury",
    label: "危険運転致傷（治療15日未満）",
    article: "自動車運転死傷処罰法 第2条第4号",
    points: 45,
    fine: null,
  },
  // 職務中の警察官に車をぶつける・向けるなどの暴行（三年以下の拘禁刑又は五十万円以下の罰金）。点数は無い。
  obstruction: {
    kind: "obstruction",
    label: "公務執行妨害",
    article: "刑法 第95条第1項",
    points: 0,
    fine: null,
  },
  // わざとぶつけて警察車両を壊した（三年以下の拘禁刑又は三十万円以下の罰金若しくは科料）。
  // 親告罪（刑法 第264条）なので、起訴には車両を管理する側の告訴が要る。
  propertyDamage: {
    kind: "propertyDamage",
    label: "器物損壊（警察車両）",
    article: "刑法 第261条",
    points: 0,
    fine: null,
  },
};

/** 違反点数 at which the licence is revoked (前歴なし, 15 点以上で取消). */
export const REVOCATION_POINTS = 15;

/** What was happening when a violation was booked, for the review screen and the QA logs. */
export type ViolationContext = {
  /** Game date and time as the HUD shows it ("10/4(日) 11:30"). */
  clock: string;
  /** 区・町名, and the junction name when near one. */
  place: string;
  lat: number;
  lon: number;
  kmh: number;
  /** Limit in force (km/h) and whether posted (標識) or statutory (法定). */
  limit: number | null;
  limitKind: string | null;
  /** What exactly went wrong ("右折専用の車線から直進" …), when the check knows. */
  detail?: string;
  /** JPEG data URL of the screen at that moment (filled in after the next frame is drawn). */
  snapshot?: string;
};

/**
 * Who caught it. A violation only counts once someone does: a patrol car or 白バイ that saw it
 * (現認, ticket on the spot), an orbis photo (the notice comes by post), or the police called to
 * an accident. Until then it is only the player's own record (未検挙).
 */
export type Detector = "patrol" | "officer" | "orbis" | "orbisPortable" | "accident" | "parking" | "sns";
export type ViolationStatus = "uncaught" | "caught" | "notice";
export type ViolationRecord = Violation & {
  /** Game-loop time (ms since the page loaded): replays and cool-downs use it. */
  at: number;
  /** Stable key in the saved history ("<wall-clock ms>-<n>", zero-padded so it sorts by time). */
  id?: string;
  /** Wall-clock time it happened, and the page session, so saved records outlive a reload. */
  savedAt?: number;
  session?: string;
  /** 5 s either side, to play it again after a reload (cut once the after part is recorded). */
  replay?: ReplayClip;
  context?: ViolationContext;
  status: ViolationStatus;
  by?: Detector;
  /**
   * Why it left the 反則金 procedure, in Japanese (inJapanese("procedure.…")): the driver fled
   * (道路交通法 第126条第1項第2号・第130条第1号) or had no valid licence (第125条第2項第1号). The
   * 反則金 is gone then (fine: null) and the case goes the criminal way (赤切符・略式).
   */
  procedure?: string;
  /** The record whose points include this one's (危険運転致傷 takes in the accident's). */
  absorbedBy?: string;
};

/**
 * This page load: records from earlier sessions cannot be replayed (the buffer is gone). It is the
 * logs' traceId, so a saved record leads to the lines of the session it happened in.
 */
export const SESSION = traceId;

/** The span of a violation and of everything it leads to (logs: `vio-<record id>`). */
export const violationSpan = (record: { id?: string }): Span | undefined =>
  record.id === undefined ? undefined : spanOf("vio", record.id);
let recordCount = 0;

export type LicenseState = {
  /** Points of caught violations (orbis notices count once the day ends and the post comes). */
  points: number;
  fines: number;
  log: ViolationRecord[];
  /** 行政処分 decided (免許停止・取消): set at the end of the day, or at once on arrest. */
  suspended: boolean;
};

export class TrafficLaw {
  readonly state: LicenseState = { points: 0, fines: 0, log: [], suspended: false };
  private readonly cooldown = new Map<ViolationKind, number>();
  /** 放置違反金 orders so far (repeated orders can lead to a vehicle 使用制限命令). */
  ownerOrders = 0;

  /**
   * Records a violation the driver committed (未検挙) unless the same kind was recorded within
   * `cooldownMs` (one offence, not one per frame). It counts only once caught (`cite`/`notice`).
   */
  commit(v: Violation, now: number, cooldownMs = 8000, context?: ViolationContext): ViolationRecord | null {
    const until = this.cooldown.get(v.kind) ?? 0;
    if (now < until) return null;
    this.cooldown.set(v.kind, now + cooldownMs);
    const savedAt = Date.now();
    const id = `${String(savedAt).padStart(15, "0")}-${String(++recordCount).padStart(4, "0")}`;
    const record: ViolationRecord = {
      ...v,
      at: now,
      id,
      savedAt,
      session: SESSION,
      context,
      status: "uncaught",
    };
    this.state.log.push(record);
    return record;
  }

  /** Caught on the spot (現認・事故): points and the 反則金 (or a criminal case) now. */
  cite(record: ViolationRecord, by: Detector): void {
    if (record.status === "caught") return;
    record.status = "caught";
    record.by = by;
    this.state.points += record.points;
    this.state.fines += record.fine ?? 0;
    this.logCited(record, "spot");
  }

  /** Photographed (orbis): the 出頭通知書 comes by post, and the points with it (`deliverNotices`). */
  notice(record: ViolationRecord, by: Detector): void {
    if (record.status !== "uncaught") return;
    record.status = "notice";
    record.by = by;
    log("violation_noticed", { violationId: record.id ?? "", kind: record.kind, by }, violationSpan(record));
  }

  /** The post at the end of the day: the notices become caught violations. */
  deliverNotices(): ViolationRecord[] {
    const delivered = this.state.log.filter((r) => r.status === "notice");
    for (const r of delivered) {
      r.status = "caught";
      this.state.points += r.points;
      this.state.fines += r.fine ?? 0;
      this.logCited(r, "post");
    }
    return delivered;
  }

  private logCited(record: ViolationRecord, via: "spot" | "post"): void {
    log(
      "violation_cited",
      {
        violationId: record.id ?? "",
        kind: record.kind,
        by: record.by ?? "",
        via,
        points: record.points,
        totalPoints: this.state.points,
      },
      violationSpan(record),
    );
  }

  /** Whether the points caught so far reach a 行政処分 (前歴なし: 6 停止, 15 取消). */
  get isSanctioned(): boolean {
    return this.state.points >= SUSPENSION_POINTS;
  }

  /** Committed and caught at once (an accident the police attend, an arrest). */
  book(
    v: Violation,
    now: number,
    cooldownMs = 8000,
    context?: ViolationContext,
    by: Detector = "accident",
  ): ViolationRecord | null {
    const record = this.commit(v, now, cooldownMs, context);
    if (record) this.cite(record, by);
    return record;
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
    this.state.log.push({ ...owner, at: now, status: "caught", by: "parking" });
    this.ownerOrders++;
    return owner;
  }

  /**
   * The 反則金 procedure no longer applies (`why`, a procedure.* text): a criminal case instead.
   * Points stay (the 行政処分 counts them either way); a 反則金 already counted is taken back.
   * Records that never had one (points only, or already criminal) are left as they are.
   */
  toCriminal(record: ViolationRecord, why: string): boolean {
    const isPenalty = record.fine !== null && record.fine > 0;
    if (!isPenalty) return false;
    if (record.status === "caught") this.state.fines -= record.fine ?? 0;
    record.fine = null;
    record.procedure = why;
    return true;
  }

  /**
   * `into` (危険運転致傷) is scored instead of `records` (the accident's 安全運転義務違反 and
   * 付加点数): their points and 反則金 come off the total and they keep a pointer to it.
   */
  absorb(records: readonly ViolationRecord[], into: ViolationRecord): void {
    for (const r of records) {
      if (r === into || r.absorbedBy) continue;
      if (r.status === "caught") {
        this.state.points -= r.points;
        this.state.fines -= r.fine ?? 0;
      }
      r.points = 0;
      r.fine = null;
      r.absorbedBy = into.id ?? "";
    }
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
 * estimated from the victim's Δv: the speed the blow gave them, from both masses
 * (physics/massContacts.ts), so a bus at 30 km/h hurts more than a motorbike at 30 km/h, and a
 * car that creeps into someone barely does (the game never models fatalities). The tiers are the
 * ones the impact speed had: for a pedestrian struck by a car the two nearly agree (Δv ≈ 0.96 v).
 * A crash that follows a 反則行為 is not eligible for 反則金 (法第125条第2項第3号), hence fine: null.
 */
export function injuryViolation(victimDeltaVKmh: number): Violation {
  const [points, injury] =
    victimDeltaVKmh >= 60
      ? [13, "治療3か月以上"]
      : victimDeltaVKmh >= 40
        ? [9, "治療30日以上3か月未満"]
        : victimDeltaVKmh >= 20
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

/** 危険運転致傷's 特定違反行為 points by the injury's 付加点数 tier (施行令 別表第二). */
const DANGEROUS_POINTS: Record<number, [number, string]> = {
  3: [45, "治療15日未満"],
  6: [48, "治療15日以上30日未満"],
  9: [51, "治療30日以上3か月未満"],
  13: [55, "治療3か月以上"],
};

/**
 * 危険運転致傷 (自動車運転死傷処罰法 第2条): `item` 4 (the numeric high speed) or 10 (a red signal
 * 殊更に無視, at a seriously dangerous speed), points by how badly the person was hurt — the same
 * tiers injuryViolation estimates from the impact.
 */
export function dangerousInjuryViolation(item: 3 | 4 | 10, injuryPoints: number): Violation {
  const [points, injury] = DANGEROUS_POINTS[injuryPoints] ?? DANGEROUS_POINTS[3];
  return {
    kind: "dangerousInjury",
    label: `危険運転致傷（${injury}）`,
    article: `自動車運転死傷処罰法 第2条第${item}号`,
    points,
    fine: null,
  };
}

/**
 * One line for the notice when a violation is caught, in the language in force:
 * 「信号無視（赤色等）／道路交通法 第7条／違反点数 2点・反則金 9,000円」.
 */
export function formatViolation(v: Violation): string {
  return t("violation.summaryLine", {
    label: violationName(v.label),
    article: lawRef(v.article),
    points: pointsText(v.points, true),
    fine: fineText(v.fine, true),
  });
}
