import { formatClock, formatDay, formatNumber } from "./format";
import { getLocale, t, type MessageKey } from "./index";
import { keysWithPrefix, matchJapanese, retranslate, translateWord } from "./reverse";

/**
 * Violation names, law references and the details booked with them, in the language in force.
 * Records keep the Japanese (stored in the browser, read by Y's posters and the AI); these
 * translate it for the screen, old records included.
 */

/** Labels with values (speedViolation, injuryViolation, chargeOwner in traffic.ts), most specific first. */
const LABEL_PATTERNS: readonly MessageKey[] = [
  "violation.pattern.speed",
  "violation.pattern.injury",
  "violation.pattern.owner",
];

/** A label's values that are Japanese words themselves: the injury's severity, the owner's offence. */
function labelValue(name: string, value: string): string {
  if (name === "injury") return translateWord(value, "violation.injury.");
  if (name === "what") return translateWord(value, "violation.owner.");
  return value;
}

/** A booked record's Japanese label ("信号無視（赤色等）") in the language in force. */
export function violationName(label: string): string {
  if (getLocale() === "ja") return label;
  const fixed = translateWord(label, "violation.label.");
  if (fixed !== label) return fixed;
  return retranslate(label, LABEL_PATTERNS, labelValue);
}

// ---------------------------------------------------------------- law references

const DIGITS = "〇一二三四五六七八九";
const NUMBER = "[0-9０-９〇一二三四五六七八九十百]+";
const LAW = new RegExp(
  "(道路交通法施行令|道路交通法施行規則|道路交通法|東京都道路交通規則|東京都環境確保条例|刑事訴訟法|軽犯罪法|施行令|道交法|都規則|同法)\\s*",
  "y",
);
// 第72条第1項前段, 第25条の2第2項, 第71条第5号の5, 第119条第1項第13号
const ARTICLE = new RegExp(
  `第(${NUMBER})条((?:の${NUMBER})*)(?:第(${NUMBER})項)?(?:第(${NUMBER})号((?:の${NUMBER})*))?(前段|後段|ただし書)?`,
  "y",
);
const TABLE = new RegExp(`別表第(${NUMBER})(?:\\s*(付加点数))?`, "y");
const TOPIC = /（([^（）]+)）/y;
const SEPARATOR = /\s*([・、，,])\s*/y;
const SPACE = /\s+/y;

/** 13, "１３", "十三", "二" → a number. */
function toNumber(text: string): number {
  const ascii = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/.test(ascii)) return Number(ascii);
  let total = 0;
  let digit = 0;
  for (const c of text) {
    const value = DIGITS.indexOf(c);
    if (value >= 0) digit = value;
    else if (c === "十" || c === "百") {
      total += (digit || 1) * (c === "十" ? 10 : 100);
      digit = 0;
    }
  }
  return total + digit;
}

/** Items in lower-case roman numerals, as the Japanese Law Translation database numbers 号. */
function roman(n: number): string {
  const table: Array<[number, string]> = [
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let rest = n;
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

/** の-branches: 第25条の2 → Art. 25-2 / 第25条之2. */
function branches(base: string, chain: string | undefined): string {
  const parts = (chain ?? "").split("の").filter(Boolean);
  return parts.reduce((text, n) => t("law.branch", { base: text, n: toNumber(n) }), base);
}

/** One matched article in the language in force. */
function articleText(m: RegExpExecArray): string {
  const [, art, artBranch, paragraph, item, itemBranch, part] = m;
  let text = branches(t("law.article", { n: toNumber(art ?? "0") }), artBranch);
  if (paragraph) text = t("law.paragraph", { base: text, n: toNumber(paragraph) });
  if (item) {
    const n = toNumber(item);
    text = t("law.item", { base: text, n: getLocale() === "en" ? roman(n) : n });
    text = branches(text, itemBranch);
  }
  const partKey: Record<string, MessageKey> = {
    前段: "law.firstSentence",
    後段: "law.secondSentence",
    ただし書: "law.proviso",
  };
  if (part) text = t(partKey[part] ?? "law.firstSentence", { base: text });
  return text;
}

type Citation = { law: string | null; refs: string[] };

/** The groups of one reference string, each a law (or none) and its articles; null when unread. */
function parseReference(text: string): Citation[] | null {
  const groups: Citation[] = [];
  let at = 0;
  const tryAt = (re: RegExp) => {
    re.lastIndex = at;
    const m = re.exec(text);
    if (m) at = re.lastIndex;
    return m;
  };
  const current = () => {
    const last = groups[groups.length - 1];
    if (last) return last;
    const made: Citation = { law: null, refs: [] };
    groups.push(made);
    return made;
  };
  while (at < text.length) {
    const law = tryAt(LAW);
    if (law) {
      groups.push({ law: law[1] ?? null, refs: [] });
      continue;
    }
    const article = tryAt(ARTICLE);
    if (article) {
      current().refs.push(articleText(article));
      continue;
    }
    const table = tryAt(TABLE);
    if (table) {
      const name = t("law.table", { n: toNumber(table[1] ?? "0") });
      const topic = table[2] ? translateWord(table[2], "law.topicWord.") : null;
      current().refs.push(topic ? t("law.topic", { base: name, topic }) : name);
      continue;
    }
    const topic = tryAt(TOPIC);
    const refs = groups[groups.length - 1]?.refs;
    const hasRef = refs !== undefined && refs.length > 0;
    if (topic && hasRef) {
      const word = translateWord(topic[1] ?? "", "law.topicWord.");
      refs[refs.length - 1] = t("law.topic", { base: refs[refs.length - 1] ?? "", topic: word });
      continue;
    }
    if (tryAt(SEPARATOR) || tryAt(SPACE)) continue;
    return null;
  }
  return groups.length > 0 ? groups : null;
}

/**
 * A Japanese law reference ("道路交通法 第22条（最高速度）", "道路交通法 第67条第1項・第119条第1項第13号",
 * "施行令 別表第二 付加点数") in the language in force: "Road Traffic Act Art. 22 (maximum speed)" /
 * "《道路交通法》第22条（最高速度）". Japanese, and anything it cannot read whole, come back unchanged.
 *
 * Why not one key per reference: the same articles are cited in many combinations (records,
 * notices, the ticket), and a reference that reads part-English, part-Japanese is worse than one
 * left whole.
 */
export function lawRef(article: string): string {
  if (getLocale() === "ja") return article;
  const groups = parseReference(article.trim());
  if (!groups) return article;
  const cited = groups.map((g) => {
    const law = g.law ? translateWord(g.law, "law.name.") : "";
    const isNameOnly = g.refs.length === 0;
    if (isNameOnly) return law;
    const refs = g.refs.reduce((a, b) => t("law.and", { a, b }));
    if (g.law === "同法") return t("law.citeSame", { refs });
    if (!g.law) return refs;
    return t("law.cite", { law, refs });
  });
  return cited.reduce((a, b) => t("law.andLaw", { a, b }));
}

// ---------------------------------------------------------------- points, fines, records

/** "違反点数 2 点" / "2 points" / "违章记分 2 分"; `tight` is the form without a space before 点. */
export function pointsText(points: number, tight = false): string {
  const isOne = points === 1;
  const key: MessageKey = tight
    ? isOne
      ? "violation.pointsTightOne"
      : "violation.pointsTight"
    : isOne
      ? "violation.pointsOne"
      : "violation.points";
  return t(key, { n: points });
}

/**
 * The money side of a violation: 反則金 and its amount, none (points only), or a criminal fine
 * (no 反則金: the courts decide). `tight` is the form "反則金 9,000円" without a space before 円.
 */
export function fineText(fine: number | null, tight = false): string {
  if (fine === null) return t("fine.criminal");
  if (fine === 0) return t("fine.none");
  return t(tight ? "fine.amountTight" : "fine.amount", { n: formatNumber(fine) });
}

let detailKeys: MessageKey[] | null = null;
/** Slots of a detail that hold Japanese words (a closure's kind, the lanes' arrows, the turn). */
const WORD_SLOTS = new Set(["what", "allowed", "turn"]);

/**
 * The detail recorded with a violation (main.ts writes it with inJapanese("violationDetail.…")),
 * in the language in force, with the words inside it too — split on 「・」 and looked up one by
 * one in `violationWord.*`. A rule's hours (`note`) stay as the 補助標識 writes them; free text
 * that matches no template stays as it is.
 */
export function violationDetail(detail: string): string {
  detailKeys ??= keysWithPrefix("violationDetail.");
  const separator = getLocale() === "zh" ? "、" : " / ";
  return retranslate(detail, detailKeys, (name, value) => {
    const isWords = WORD_SLOTS.has(name);
    if (!isWords) return value;
    return value
      .split("・")
      .map((w) => translateWord(w, "violationWord."))
      .join(separator);
  });
}

const WEEKDAYS = "日月火水木金土";
const RECORD_CLOCK = /^(\d{1,2})\/(\d{1,2})\(([日月火水木金土])(・祝)?\)\s+(\d{1,2}):(\d{2})$/;

/** A record's clock as the HUD wrote it ("10/4(日) 11:30") in the language in force. */
export function recordClock(clock: string): string {
  if (getLocale() === "ja") return clock;
  const m = RECORD_CLOCK.exec(clock.trim());
  if (!m) return clock;
  const day = formatDay({ m: Number(m[1]), d: Number(m[2]) }, WEEKDAYS.indexOf(m[3] ?? "日"), Boolean(m[4]));
  return `${day} ${formatClock(Number(m[5]) * 60 + Number(m[6]))}`;
}

/**
 * A record's place ("千代田区 有楽町一丁目 （日比谷交差点付近）"): the ward and town stay as the
 * data names them, the 「…交差点付近」 around the junction is translated.
 */
export function recordPlace(place: string): string {
  if (getLocale() === "ja") return place;
  const near = /（[^（）]+交差点付近）$/.exec(place);
  if (!near) return place;
  const params = matchJapanese(near[0], "review.nearJunction");
  if (!params) return place;
  return place.slice(0, near.index) + t("review.nearJunction", params);
}
