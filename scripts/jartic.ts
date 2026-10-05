// JARTIC 交通規制情報 (typeD, 拡張版 K 2.1) CSV helpers, shared by the build script and tests.
import { CLOSURE, MAX_CLOSURE_AREA_KM2, ringAreaKm2, type ClosureKind } from "../src/world/closures.ts";
import type { RuleTime, Window } from "../src/world/ruleTime.ts";

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const toMin = (hhmm: string) => Math.floor(Number(hhmm) / 100) * 60 + (Number(hhmm) % 100);

/**
 * Streaming RFC 4180 parser over Shift_JIS bytes: the Tokyo file is ~400 MB, so rows are handed
 * to `onRow` as they complete instead of materialising one huge string.
 */
export function streamCsv(bytes: Uint8Array, onRow: (row: string[]) => void, chunk = 8 * 1024 * 1024): void {
  const decoder = new TextDecoder("shift_jis");
  const CHUNK = chunk;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside quotes; next char decides escape vs close
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const text = decoder.decode(bytes.subarray(off, off + CHUNK), { stream: off + CHUNK < bytes.length });
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          field += '"';
          continue;
        }
        inQuotes = false;
      }
      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        onRow(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    onRow(row);
  }
}

/** JARTIC 「経度 緯度;経度 緯度;…」 → [lon, lat, …], rounded to ~0.1 m. */
export function parseCoords(s: string): number[] {
  const out: number[] = [];
  for (const pair of s.split(";")) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push(round(lon), round(lat));
  }
  return out;
}

// Category A digits (from the right) that cover an ordinary passenger car: 1 車両, 10 自動車,
// 100 乗用, 1000 普乗, 10000 普通.
const CAR_DIGITS = [0, 1, 2, 3, 4];

/**
 * Whether a 対象車両 condition includes an ordinary passenger car (普通乗用自動車, the player's car).
 * The spec's 対象コード (別記2 共通コード表 10) sorts vehicles into categories A 乗用車・小型・中型,
 * B 大型・バス, C 貨物・特殊 and D その他; each cell is the sum of one-digit codes, so a cell is a
 * row of 0/1 flags. A condition naming no vehicle binds everyone. One naming only B–D does not
 * bind the car: C 100100100 (特定中貨＋大貨＋大特 = 大型貨物自動車等) is the 環七・環八 truck ban,
 * whose empty category A was once read as 「通行止め」 for all traffic.
 */
export function bindsCar(a: string, b = "", c = "", d = ""): boolean {
  const namesNoVehicle = !a && !b && !c && !d;
  if (namesNoVehicle) return true;
  // Digits other than 0/1 are undefined in the spec: never bind the car on a guess.
  const isFlags = /^[01]+$/.test(a);
  if (!isFlags) return false;
  return CAR_DIGITS.some((i) => a[a.length - 1 - i] === "1");
}

// 曜日コード: 1–6 as in the spec; 99 (その他, spelled out in free text) is taken as every day.
const dayCode = (v: string) => (v === "" || v === "99" ? 0 : Number(v));
// For most rules 対象車両 says who must obey. For these it says whom the lane or the permission is
// for (専用通行帯 of 路線バス or 普通自転車, 駐車可 of タクシー …), so they keep reading category A
// only, as before. Why not all four categories: a bus or bicycle lane binds the car exactly
// because the car is not listed, and every 専用通行帯 would be dropped.
const BENEFICIARY_CODES = new Set(["111", "24", "70", "71", "116", "72", "81"]);

/** How a rule binds an ordinary car, or why it is not used. */
export type RuleUse =
  | {
      time: RuleTime;
      /** Category A of the first condition that binds the car ("" when it names no vehicle). */
      target: string;
    }
  | { skip: "vehicles" | "period" };

/**
 * When a rule with 共通規制種別コード `code` applies to an ordinary car, from its 対象 1–5 and
 * 除外 1–5 conditions (`cell` reads a column of the row by its header). Skipped when no condition
 * binds the car (e.g. 大型貨物自動車等 only) or a condition is limited to dates (対象期間,
 * seasonal — not modelled).
 */
export function ruleUse(cell: (header: string) => string, code: string): RuleUse {
  const allCategories = !BENEFICIARY_CODES.has(code);
  const on: Window[] = [];
  const off: Window[] = [];
  let target: string | null = null;
  for (let k = 1; k <= 5; k++) {
    const start = cell(`規制時間${k}_開始`);
    const end = cell(`規制時間${k}_終了`);
    const day = cell(`規制曜日コード${k}`);
    const a = cell(`対象車両コード${k}_A`);
    const others = allCategories ? ["B", "C", "D"].map((c) => cell(`対象車両コード${k}_${c}`)) : [];
    const namesVehicle = a !== "" || others.some((v) => v !== "");
    const isEmpty = !start && !day && !namesVehicle && !cell(`対象期間${k}_開始`);
    if (isEmpty && k > 1) continue;
    if (cell(`対象期間${k}_開始`)) return { skip: "period" };
    if (!bindsCar(a, ...others)) continue;
    target ??= a;
    on.push([start ? toMin(start) : 0, start ? toMin(end) : 1440, dayCode(day)]);
  }
  for (let k = 1; k <= 5; k++) {
    const start = cell(`除外時間${k}_開始`);
    const day = cell(`除外曜日コード${k}`);
    const vehicle = cell(`除外車両コード${k}_A`);
    if (!start && !day && !cell(`除外期間${k}_開始`)) continue;
    // Exclusions for other vehicles (許可車両, 路線バス …) do not free an ordinary car. Only
    // category A is read: one 除外 set often packs two separate exclusions, e.g. 除外曜日 2 with
    // 除外車両 D 100 is 「土・日・休日を除く」 and 「自転車を除く」 (about 5,500 school-run rows of
    // 歩行者用道路 and 通行止め). Why not B–D as for 対象: those streets would close at weekends too.
    if (cell(`除外期間${k}_開始`) || (vehicle !== "" && !bindsCar(vehicle))) continue;
    off.push([start ? toMin(start) : 0, start ? toMin(cell(`除外時間${k}_終了`)) : 1440, dayCode(day)]);
  }
  return on.length ? { time: { on, off }, target: target ?? "" } : { skip: "vehicles" };
}

/** What a 通行禁止 record (共通規制種別コード 1 or 4) becomes in the game, or why it is dropped. */
export type ClosureUse =
  | { kind: ClosureKind }
  | { skip: "point" | "expressway" | "undefined" }
  | { skip: "area"; areaKm2: number };

/**
 * Spec 表 4: 1 is 歩行者用道路 (mostly school-run hours), 4 通行止め, whose 対象車両 category A
 * (`target`, from ruleUse: "" all traffic, 1 車両, 10 自動車) picks the sign: 301, 302 or
 * 自動車通行止め. `exempt` is 除外車両 1 as "A|B|C|D". Lines (shape 2) and areas (3) only: points
 * are entrances to closed zones.
 */
export function closureUse(
  code: string,
  shape: string,
  coords: number[],
  target: string,
  exempt: string,
): ClosureUse {
  if (shape !== "2" && shape !== "3") return { skip: "point" };
  // 車両 closed except category D 15 (その他) is how the expressways' 自動車専用 is encoded
  // (lines of 30–78 km); they run above surface roads, which must not inherit it.
  const isExpressway = exempt.split("|")[3] === "100000000000000";
  if (isExpressway) return { skip: "expressway" };
  // Codes with digits other than 0/1 are undefined in the spec: skip rather than close a street.
  const isUndefined = /[^01|]/.test(exempt) || /[^01]/.test(target);
  if (isUndefined) return { skip: "undefined" };
  // A guard, whatever the reason the record was misread: no real 通行禁止 area is this large.
  const areaKm2 = shape === "3" ? ringAreaKm2(coords) : 0;
  if (areaKm2 > MAX_CLOSURE_AREA_KM2) return { skip: "area", areaKm2 };
  if (code === "1") return { kind: CLOSURE.pedestrianRoad };
  if (target === "") return { kind: CLOSURE.all };
  // 1 車両 covers every vehicle; otherwise the condition names 自動車 or a narrower class of cars.
  const namesAllVehicles = target.endsWith("1");
  return { kind: namesAllVehicles ? CLOSURE.vehicles : CLOSURE.motor };
}

export { anchors, M_LAT, M_LON, reversed, turnMask } from "../src/world/anchors.ts";
