import { en } from "../i18n/en";
import { ja } from "../i18n/ja";

/**
 * The name layer of the 都市高速 (knowledge/road-redesign-plan.md 4.8): every name a board, a
 * notice or a data file shows of the urban expressway passes through here. The operator is the
 * fictional 「都市高速」 (i18n key `guide.operator`, no logo); route names (「都心環状線」), route
 * symbols (C1, in the form of 118の3, never the operator's own shield) and the names of exits,
 * entrances and junctions are the real ones from OSM.
 *
 * This file is the only one under src/ allowed to spell the real operator's name: it has to, to
 * recognise and drop it (tests/roadNames.test.ts reads every other file of src/ and
 * public/data/expressway and fails on any of OPERATOR_PATTERNS).
 *
 * Pure (no DOM, no three.js): the build (scripts/expressway.ts through src/expressway/network.ts),
 * the planner and the game share it.
 */

/** i18n key of the fictional operator's name (「都市高速」 / "TOSHI EXPWY"). */
export const OPERATOR_KEY = "guide.operator" as const;

/**
 * Words that name the real operator, as the data writes them. Longest first, so a prefix strip
 * takes 「首都高速道路」 whole before 「首都高」.
 */
export const OPERATOR_WORDS = [
  "首都高速道路",
  "首都高速",
  "首都高",
  "Metropolitan Expressway",
  "Shuto Expressway",
  "Shutoko Expressway",
  "Shuto Expwy",
  "Shutoko Expwy",
  "Shutoko",
  "Shuto",
] as const;

/**
 * The same as patterns for the scans (tests/roadNames.test.ts). "Shuto" only as a word, or as the
 * first word of a camelCase or SCREAMING name (shutoExpressway, SHUTO_EXPWY): 「首都圏」 is
 * "shutoken" in romaji (an account handle has it) and names no operator.
 */
export const OPERATOR_PATTERNS: readonly RegExp[] = [
  /首都高/,
  /metropolitan[\s_-]*expressway/i,
  /(^|[^A-Za-z])(shuto|Shuto|SHUTO)(ko|kou|KO|KOU)?($|[^a-z])/,
];

/** Whether a text names the real operator. */
export function hasOperatorWord(text: string): boolean {
  return OPERATOR_PATTERNS.some((p) => p.test(text));
}

const OPERATOR_PREFIX = new RegExp(
  `^\\s*(?:${OPERATOR_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})(?:\\s+|・)?`,
  "i",
);

/**
 * A route's name without the operator before it: 「首都高速都心環状線」 → 「都心環状線」,
 * "Shuto Expressway Route 1 Haneda Line" → "Route 1 Haneda Line". Null when nothing usable is
 * left, or the operator is still named inside (the name is dropped, never shown).
 */
export function routeName(text: string | null | undefined): string | null {
  const isEmpty = text === null || text === undefined || text.trim() === "";
  if (isEmpty) return null;
  const stripped = text.replace(OPERATOR_PREFIX, "").trim();
  const isUsable = stripped !== "" && !hasOperatorWord(stripped);
  return isUsable ? stripped : null;
}

/**
 * A route symbol for the 118の3 frame (高速道路番号: a white frame, green ground): OSM refs like
 * "C1", "1", "11", "K1", "B". Null for anything else (a ref with spaces or a name in it).
 */
export function routeSymbol(ref: string | null | undefined): string | null {
  const isEmpty = ref === null || ref === undefined;
  if (isEmpty) return null;
  const trimmed = ref.trim();
  const isSymbol = /^[A-Z]{0,2}\d{0,3}$/.test(trimmed) && trimmed !== "";
  return isSymbol ? trimmed : null;
}

/**
 * A route's symbol from its ref, or from the number its name begins with where the way has no ref
 * (「1号羽田線」 → "1": OSM tags the ref on some ways of a route only).
 */
export function routeSymbolOf(
  ref: string | null | undefined,
  name: string | null | undefined,
): string | null {
  const fromRef = routeSymbol(ref);
  if (fromRef !== null) return fromRef;
  const numbered = /^(\d{1,3})号/.exec(routeName(name) ?? "");
  return numbered ? numbered[1] : null;
}

/**
 * The place a route name points to, for a board's 方面 where OSM gives no destination: the route
 * name itself (「1号羽田線」), as the operator's boards name a route by its own name.
 */
export function routeDirection(name: string | null): string | null {
  return routeName(name);
}

/**
 * An exit's or an entrance's own name for a board: 「芝公園出口」 → 「芝公園」 (the board says
 * 出口 / 入口 itself). A JCT keeps its 「JCT」. Null for an empty or operator-named name.
 */
export function facilityName(text: string | null | undefined): string | null {
  const name = routeName(text);
  if (name === null) return null;
  const bare = name.replace(/\s*(出口|入口|出入口)$/, "").trim();
  return bare === "" ? null : bare;
}

/** The English of a facility: OSM name:en without the operator, "Exit"/"Entrance" dropped. */
export function facilityNameEn(text: string | null | undefined): string | null {
  const name = routeName(text);
  if (name === null) return null;
  const bare = name.replace(/\s*\b(exit|entrance|ramp)$/i, "").trim();
  return bare === "" ? null : bare;
}

/**
 * Any text to show (a destination, a junction's name from the street data): the real operator's
 * name replaced by the fictional one, in the language of `lang`. 「首都高銀座入口」 → 「都市高速銀座入口」.
 */
export function displayPlace(text: string, lang: "ja" | "en" = "ja"): string {
  if (!hasOperatorWord(text)) return text;
  const operator = lang === "ja" ? ja[OPERATOR_KEY] : en[OPERATOR_KEY];
  let out = text;
  for (const w of OPERATOR_WORDS) out = out.replace(new RegExp(w.replace(/ /g, "\\s+"), "gi"), operator);
  // "Shuto Expwy" became "TOSHI EXPWY" whole; a word the operator's name already ends with is not
  // said twice ("TOSHI EXPWY Expressway").
  return out.replace(new RegExp(`(${operator})\\s+(Expressway|Expwy|高速道路|高速)`, "gi"), "$1");
}

/**
 * 高速道路等の名前 shown in a green box on a blue board (別表第二 備考一(三)1(13) ただし書): the
 * operator (real or fictional), 高速・自動車道, the named national expressways, a JCT or IC, an
 * expressway route symbol (E1, C2).
 */
export function isExpresswayName(text: string): boolean {
  const fictional = ja[OPERATOR_KEY];
  const isOperator = hasOperatorWord(text) || text.includes(fictional);
  if (isOperator) return true;
  return /(高速|自動車道|東名|中央道|関越道|東北道|常磐道|京葉道|外環|第三京浜|湾岸線|JCT$|IC$|^[EC]\d+)/.test(
    text,
  );
}
