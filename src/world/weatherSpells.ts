/**
 * おまかせの天気: spells of fair weather and rain taking turns, in game minutes. With the clock at
 * a minute a second they are 4–12 game hours of fair weather and 2–6 of rain, much as Tokyo's
 * autumn has them, and 4–12 / 2–6 real minutes: a drive of a quarter of an hour sees it turn.
 */
export const SPELL_MINUTES = { clear: [240, 720], rain: [120, 360] } as const;

/** How long the next spell lasts (game minutes), `random` in [0, 1). */
export function spellMinutes(isRain: boolean, random: number): number {
  const [min, max] = isRain ? SPELL_MINUTES.rain : SPELL_MINUTES.clear;
  return min + (max - min) * Math.max(0, Math.min(1, random));
}
