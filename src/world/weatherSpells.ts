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

/** 「雨」 and おまかせ's rain: a steady 本降り (mm/h). */
export const STEADY_RAIN_MM_H = 8;

/**
 * How hard it rains (mm/h) for the windscreen's drops and the rain heard in the cabin, given
 * whether the scene rains. 現在の天気 rains only when AMeDAS reports some (precip10m > 0, its
 * 10-minute total ×6); 「雨」, おまかせ and a replay's moment have no measurement: 本降り.
 * Why not the measurement alone, as before: おまかせ and replays rained in the scene with a
 * measurement of 0, and the glass stayed dry under the falling rain.
 */
export function rainRateMmH(isRaining: boolean, isMeasured: boolean, precip10m: number | null): number {
  if (!isRaining) return 0;
  if (!isMeasured) return STEADY_RAIN_MM_H;
  return Math.max(0, (precip10m ?? 0) * 6);
}
