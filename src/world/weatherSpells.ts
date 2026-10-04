/**
 * おまかせの天気: spells of fair weather and rain taking turns, in game minutes. Tokyo's autumn
 * gives showers of an hour or two between longer dry spells; here they are shorter than real ones
 * (and the clock runs 10× fast), so a drive of a quarter of an hour sees the weather turn.
 * Fair: 40–120 min (4–12 real minutes); rain: 20–60 min (2–6 real minutes).
 */
export const SPELL_MINUTES = { clear: [40, 120], rain: [20, 60] } as const;

/** How long the next spell lasts (game minutes), `random` in [0, 1). */
export function spellMinutes(isRain: boolean, random: number): number {
  const [min, max] = isRain ? SPELL_MINUTES.rain : SPELL_MINUTES.clear;
  return min + (max - min) * Math.max(0, Math.min(1, random));
}
