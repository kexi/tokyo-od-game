/**
 * U3, the tiles' budget: a decision of the user (2026-11-18), not a law or an assumption. The gzip
 * of public/data/expressway's tiles, all of them and the largest one, with every district published
 * (R4): 1.6 MB in all and 72 KB for one tile. The range is not cut to meet it: a build over either
 * stops the publishing (the stage's rebuild) and is reported.
 * - Why two numbers: the game reads only the tiles near the car, so what a player feels is one
 *   tile's size; the total weighs on the repository and the deploy.
 * - Measured when decided (R1-1a, ship/all with --run-borders cut, devshell node): 1.40 MB in all, the
 *   largest 61.7 KB (tile 14553-6451). The caps leave about 15 % for S7's below ground and R1–R4.
 * - Bytes in powers of ten (1 MB = 1,000,000 B), as the scorecard's sizes are reported.
 */
export const TILE_BUDGET = { totalGzipBytes: 1_600_000, tileGzipBytes: 72_000 } as const;
