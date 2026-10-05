import { afterEach, describe, expect, it } from "vitest";
import { setLocale, type Locale } from "../src/i18n";
import { fineText, lawRef, pointsText, recordClock, recordPlace, violationName } from "../src/i18n/law";
import { adviceFor, tipFor } from "../src/game/drivingTips";
import { renderTicketSummaryHtml } from "../src/game/ticketForm";
import {
  formatViolation,
  injuryViolation,
  speedViolation,
  TrafficLaw,
  VIOLATIONS,
  type ViolationRecord,
} from "../src/game/traffic";

const FOREIGN: readonly Locale[] = ["en", "zh"];
const hasKana = (s: string) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
const record = (v: Omit<ViolationRecord, "at" | "status">): ViolationRecord => ({
  ...v,
  at: 0,
  status: "caught",
});

afterEach(() => {
  setLocale("ja");
});

describe("違反名", () => {
  it("names every violation in English and Chinese, from the Japanese label the record keeps", () => {
    for (const locale of FOREIGN) {
      setLocale(locale);
      for (const v of Object.values(VIOLATIONS)) {
        const name = violationName(v.label);
        expect(name, `${locale} ${v.kind}`).not.toBe(v.label);
        expect(hasKana(name), `${locale} ${v.kind}: ${name}`).toBe(false);
      }
    }
  });

  it("translates the labels that carry values: speed over the limit, injury, the owner's penalty", () => {
    setLocale("en");
    expect(violationName(speedViolation(25.4)?.label ?? "")).toBe("Speeding (25 km/h over)");
    expect(violationName(injuryViolation(45).label)).toBe(
      "Injury accident, additional points (treatment of 30 days to 3 months)",
    );
    const owner = new TrafficLaw().chargeOwner(VIOLATIONS.parkingNoStop, 0);
    expect(violationName(owner.label)).toBe("Owner's penalty for an unattended car (no-stopping zone)");
    setLocale("zh");
    expect(violationName(speedViolation(31)?.label ?? "")).toBe("超速（超出 31 km/h）");
    expect(violationName(VIOLATIONS.signal.label)).toBe("闯红灯");
    expect(violationName(injuryViolation(10).label)).toBe("致人受伤事故·附加记分（治疗不足 15 天）");
  });

  it("returns the Japanese unchanged in Japanese, and unknown labels unchanged everywhere", () => {
    expect(violationName("信号無視（赤色等）")).toBe("信号無視（赤色等）");
    setLocale("en");
    expect(violationName("見たことのない違反")).toBe("見たことのない違反");
  });
});

describe("法令の参照", () => {
  const cases: Array<[string, string, string]> = [
    ["道路交通法 第7条", "Road Traffic Act Art. 7", "《道路交通法》第7条"],
    [
      "道路交通法 第22条（最高速度）",
      "Road Traffic Act Art. 22 (maximum speed)",
      "《道路交通法》第22条（最高速度）",
    ],
    [
      "道路交通法 第71条第5号の5・第117条の4",
      "Road Traffic Act Art. 71(v)-5, Art. 117-4",
      "《道路交通法》第71条第5项之5、第117条之4",
    ],
    [
      "道路交通法 第72条第1項前段",
      "Road Traffic Act Art. 72(1), first sentence",
      "《道路交通法》第72条第1款前段",
    ],
    ["道路交通法 第26条の2第3項", "Road Traffic Act Art. 26-2(3)", "《道路交通法》第26条之2第3款"],
    [
      "道路交通法 第67条第1項・第119条第1項第13号",
      "Road Traffic Act Art. 67(1), Art. 119(1)(xiii)",
      "《道路交通法》第67条第1款、第119条第1款第13项",
    ],
    [
      "施行令 別表第二 付加点数",
      "Order for Enforcement of the Road Traffic Act Appended Table 2 (additional points)",
      "《道路交通法施行令》附表2（附加记分）",
    ],
    [
      "道路交通法第55条第2項、東京都道路交通規則第8条第8号",
      "Road Traffic Act Art. 55(2); Tokyo Metropolitan Road Traffic Rules Art. 8(viii)",
      "《道路交通法》第55条第2款；《东京都道路交通规则》第8条第8项",
    ],
    ["同法 第117条第2項", "Art. 117(2) of the same Act", "同法第117条第2款"],
    ["第75条の2第2項", "Art. 75-2(2)", "第75条之2第2款"],
  ];

  it("reads each reference and writes it the English and the Chinese way", () => {
    for (const [ja, en, zh] of cases) {
      setLocale("en");
      expect(lawRef(ja)).toBe(en);
      setLocale("zh");
      expect(lawRef(ja)).toBe(zh);
    }
  });

  it("cites every article the violations use without leaving Japanese behind", () => {
    setLocale("en");
    for (const v of Object.values(VIOLATIONS)) expect(hasKana(lawRef(v.article)), v.article).toBe(false);
  });

  it("leaves Japanese as it is, and a reference it cannot read whole as it was", () => {
    expect(lawRef("道路交通法 第7条")).toBe("道路交通法 第7条");
    setLocale("en");
    expect(lawRef("東京都環境確保条例 第52条：アイドリング・ストップ")).toBe(
      "東京都環境確保条例 第52条：アイドリング・ストップ",
    );
  });
});

describe("点数・反則金", () => {
  it("keeps the Japanese notice line exactly as before", () => {
    expect(formatViolation(VIOLATIONS.signal)).toBe(
      "信号無視（赤色等）／道路交通法 第7条／違反点数 2点・反則金 9,000円",
    );
    expect(formatViolation(VIOLATIONS.seatBelt)).toBe(
      "座席ベルト装着義務違反／道路交通法 第71条の3第1項／違反点数 1点・反則金なし（違反点数のみ）",
    );
    expect(formatViolation(VIOLATIONS.hitAndRun)).toBe(
      "救護義務違反（ひき逃げ）／道路交通法 第72条第1項前段／違反点数 35点・罰金（刑事手続）",
    );
  });

  it("writes the notice line in English and Chinese, one point in the singular", () => {
    setLocale("en");
    expect(formatViolation(VIOLATIONS.signal)).toBe(
      "Running a red light — Road Traffic Act Art. 7 — 2 points, fine ¥9,000",
    );
    expect(pointsText(1)).toBe("1 point");
    expect(fineText(null)).toBe("criminal fine (court case)");
    setLocale("zh");
    expect(formatViolation(VIOLATIONS.seatBelt)).toBe(
      "未系安全带／《道路交通法》第71条之3第1款／违章记分 1 分，无罚款（仅记分）",
    );
  });

  it("translates the clock and the junction a record kept in Japanese", () => {
    setLocale("en");
    expect(recordClock("10/4(日) 11:30")).toBe("Sun, 10/4 11:30");
    expect(recordClock("11/3(火・祝) 09:05")).toBe("Tue, 11/3 (holiday) 09:05");
    expect(recordPlace("千代田区 有楽町一丁目 （日比谷交差点付近）")).toBe(
      "千代田区 有楽町一丁目 (near the 日比谷 junction)",
    );
    setLocale("zh");
    expect(recordClock("10/4(日) 11:30")).toBe("10/4 周日 11:30");
    expect(recordPlace("港区 新橋一丁目 （新橋交差点付近）")).toBe("港区 新橋一丁目 （新橋路口附近）");
  });
});

describe("運転のアドバイス", () => {
  it("gives every tip in the language in force, Japanese unchanged", () => {
    expect(tipFor("signal")).toBe(
      "黄色は「止まれ」の合図です。停止線で安全に止まれるなら止まり、交差点の手前から速度を落としておきましょう。",
    );
    setLocale("en");
    expect(tipFor("signal")).toBe(
      "Yellow means stop. If you can stop safely at the stop line, stop — and slow down well before the junction.",
    );
    expect(tipFor("unknownKind")).toMatch(/^Check the signs/);
    setLocale("zh");
    const tips = adviceFor([record(VIOLATIONS.parking), record(VIOLATIONS.seatBelt)]);
    expect(tips).toHaveLength(2);
    for (const tip of tips) expect(hasKana(tip)).toBe(false);
  });
});

describe("切符の要約", () => {
  const blue = [record(VIOLATIONS.signal), record(VIOLATIONS.seatBelt)];
  const red = [record(speedViolation(35) ?? VIOLATIONS.signal)];

  it("adds nothing in Japanese: the form is the ticket", () => {
    expect(renderTicketSummaryHtml(blue)).toBe("");
  });

  it("says in English what the blue ticket is, the offenses, points, fine and how to pay", () => {
    setLocale("en");
    const html = renderTicketSummaryHtml(blue);
    expect(html).toContain("Traffic Violation Notice (blue ticket)");
    expect(html).toContain("Running a red light (Road Traffic Act Art. 7) — 2 points, ¥9,000");
    expect(html).toContain("Not wearing a seatbelt (Road Traffic Act Art. 71-3(1)) — 1 point, no fine");
    expect(html).toContain("Total: 3 points, fine ¥9,000");
    expect(html).toContain("within 7 days");
    expect(html).toContain('lang="en"');
  });

  it("says in Chinese that the red ticket has no fine to pay and goes to court", () => {
    setLocale("zh");
    const html = renderTicketSummaryHtml(red);
    expect(html).toContain("红单");
    expect(html).toContain("超速（超出 35 km/h）");
    expect(html).toContain("违章记分 6 分");
    expect(html).toContain("不适用罚款");
    expect(html).toContain("目前无需缴纳罚款");
    expect(html).toContain("ticket-summary-red");
  });
});
