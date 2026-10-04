/**
 * 移動（どこへでも）: the places the car can be sent to — home, the game's spots (stations and the
 * open-data POIs), landmarks, police stations and the licence centres (for 出頭) — and the search
 * over their names, plus where home is, remembered in this browser.
 */
export type Place = { name: string; kind: string; lat: number; lon: number; ward?: string };

/** Fold widths and case (ＪＲ → jr) so typing on a phone keyboard or a PC finds the same names. */
const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/**
 * Places whose name (or ward) contains every word of the query: names starting with it first,
 * then shorter names (the station rather than the shop named after it).
 */
export function searchPlaces(places: readonly Place[], query: string, limit = 20): Place[] {
  const words = query.split(/\s+/).map(fold).filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<{ p: Place; score: number }> = [];
  for (const p of places) {
    const name = fold(p.name);
    const hay = `${name}${fold(p.ward ?? "")}${fold(p.kind)}`;
    const isMatch = words.every((w) => hay.includes(w));
    if (!isMatch) continue;
    const isPrefix = name.startsWith(words[0]);
    scored.push({ p, score: (isPrefix ? 0 : 1000) + name.length });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.p);
}

const HOME_KEY = "tod.home";

export type Home = { lat: number; lon: number; label?: string };

export function loadHome(): Home | null {
  try {
    const saved = JSON.parse(localStorage.getItem(HOME_KEY) ?? "null") as Home | null;
    const isValid = saved !== null && Number.isFinite(saved.lat) && Number.isFinite(saved.lon);
    return isValid ? saved : null;
  } catch {
    // Storage blocked: home is chosen again this session.
    return null;
  }
}

export function saveHome(home: Home): void {
  try {
    localStorage.setItem(HOME_KEY, JSON.stringify(home));
  } catch {
    // Not remembered when storage is blocked; home still holds for this session.
  }
}
