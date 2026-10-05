import { getLocale, interpolate, t, type Params } from "./index";
import { ja, type MessageKey } from "./ja";

/**
 * Records that outlive a language switch keep their text in Japanese: the violation records are
 * stored in the browser and read back after a reload, and Y's posters and the on-device AI read
 * them in Japanese. Code writes that text with inJapanese(key); the screen turns it back into the
 * key and its values with retranslate() and shows it in the language in force — old records too,
 * as long as their wording matches a template.
 */

/** A key's Japanese text, whatever language is in force. */
export function inJapanese(key: MessageKey, params?: Params): string {
  return interpolate(ja[key], params);
}

type Pattern = { re: RegExp; names: string[] };
const patterns = new Map<MessageKey, Pattern>();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patternOf(key: MessageKey): Pattern {
  const cached = patterns.get(key);
  if (cached) return cached;
  const names: string[] = [];
  const parts = ja[key].split(/\{(\w+)\}/);
  // split() with a group alternates literal text and slot names: even = literal, odd = slot.
  const source = parts
    .map((part, i) => (i % 2 === 0 ? escapeRe(part) : (names.push(part), "(.+?)")))
    .join("");
  const made = { re: new RegExp(`^${source}$`, "s"), names };
  patterns.set(key, made);
  return made;
}

/** The values of `key`'s slots when `text` is its Japanese, else null. */
export function matchJapanese(text: string, key: MessageKey): Params | null {
  const { re, names } = patternOf(key);
  const m = re.exec(text);
  if (!m) return null;
  return Object.fromEntries(names.map((name, i) => [name, m[i + 1] ?? ""]));
}

/**
 * Japanese text made by one of `keys` (inJapanese), in the language in force: the first key whose
 * template matches is rendered again with the same values, each value passed through `nested`
 * first (a value can itself be Japanese to translate, e.g. a closure's kind). The text itself when
 * nothing matches, and always in Japanese.
 */
export function retranslate(
  text: string,
  keys: readonly MessageKey[],
  nested: (name: string, value: string) => string = (_name, value) => value,
): string {
  if (getLocale() === "ja") return text;
  for (const key of keys) {
    const params = matchJapanese(text, key);
    if (!params) continue;
    const values = Object.fromEntries(
      Object.entries(params).map(([name, v]) => [name, nested(name, String(v))]),
    );
    return t(key, values);
  }
  return text;
}

/** Keys of the dictionary that start with `prefix`, for retranslate(). */
export function keysWithPrefix(prefix: string): MessageKey[] {
  return (Object.keys(ja) as MessageKey[]).filter((k) => k.startsWith(prefix));
}

/**
 * A Japanese word from data or a record ("車両通行止め") in the language in force, through the
 * key under `prefix` whose Japanese is exactly that word; the word itself when none is.
 */
export function translateWord(word: string, prefix: string): string {
  if (getLocale() === "ja") return word;
  const key = keysWithPrefix(prefix).find((k) => ja[k] === word);
  return key ? t(key) : word;
}
