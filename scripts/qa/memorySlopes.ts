// The slopes of a memory run (scripts/qa/memory-buildings.ts): how fast the GC heap, the array
// storage and their sum grow, in MB/s, by least squares over three windows of its samples. Pure, so
// a run's summary can be recomputed from its JSON and tested.
//
// Why three: a run whose near LRU is full most of the time and one whose LRU swings between its
// upper and lower bound are in different states at the same second, and the swing is a saw of
// 60–100 MB in the heap; a least-squares line over a window that ends on the low side of the saw
// reads flatter (X1 round 1, the phone's default 24 MiB: main swung, X1 stayed full). Comparing
// the full samples only compares like with like.

/** The fields of a sample this reads (memory-buildings.ts writes them). */
export type MemorySample = {
  t: number;
  heapGcMB?: number;
  backingMB?: number;
  near?: { mb: number; maxMb: number } | null;
};

export type Slopes = { heap: number | null; backing: number | null; total: number | null; samples: number };

export type SlopeSummary = {
  rules: { fromS: number; plateauShare: number; fullShare: number };
  /** Every sample from `fromS` on. */
  all: Slopes;
  /** From the first sample at which the near LRU holds `plateauShare` of the most it held (the cache filled). */
  plateau: Slopes & { fromS: number | null };
  /** Only the samples whose near LRU holds at least `fullShare` of its upper bound, from `fromS` on. */
  full: Slopes & { share: number };
};

/** Seconds before which a run is still starting (the first tiles of the town and the skyline). */
export const SLOPE_FROM_S = 60;
const PLATEAU_SHARE = 0.95;
const FULL_SHARE = 0.95;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The least-squares slope of `y` over `t`, or null with fewer than 3 points or no spread in t. */
export function slope(points: ReadonlyArray<readonly [number, number]>): number | null {
  const n = points.length;
  if (n < 3) return null;
  const mt = points.reduce((s, [t]) => s + t, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  const stt = points.reduce((s, [t]) => s + (t - mt) ** 2, 0);
  const isFlatInTime = stt === 0;
  if (isFlatInTime) return null;
  return round3(points.reduce((s, [t, y]) => s + (t - mt) * (y - my), 0) / stt);
}

function slopesOf(samples: readonly MemorySample[]): Slopes {
  const of = (pick: (s: MemorySample) => number | undefined) =>
    slope(samples.flatMap((s) => (pick(s) === undefined ? [] : [[s.t, pick(s) as number] as const])));
  const total = (s: MemorySample) =>
    s.heapGcMB === undefined || s.backingMB === undefined ? undefined : s.heapGcMB + s.backingMB;
  return {
    heap: of((s) => s.heapGcMB),
    backing: of((s) => s.backingMB),
    total: of(total),
    samples: samples.length,
  };
}

export function slopeSummary(samples: readonly MemorySample[]): SlopeSummary {
  const started = samples.filter((s) => s.t >= SLOPE_FROM_S);
  const held = samples.flatMap((s) => (s.near ? [s.near.mb] : []));
  const top = held.length > 0 ? Math.max(...held) : null;
  const plateauFrom =
    top === null ? null : (samples.find((s) => (s.near?.mb ?? -1) >= PLATEAU_SHARE * top)?.t ?? null);
  const plateau = plateauFrom === null ? [] : samples.filter((s) => s.t >= plateauFrom);
  const isFull = (s: MemorySample) =>
    s.near !== undefined && s.near !== null && s.near.mb >= FULL_SHARE * s.near.maxMb;
  const full = started.filter(isFull);
  const share = started.length === 0 ? 0 : round3(full.length / started.length);
  return {
    rules: { fromS: SLOPE_FROM_S, plateauShare: PLATEAU_SHARE, fullShare: FULL_SHARE },
    all: slopesOf(started),
    plateau: { ...slopesOf(plateau), fromS: plateauFrom },
    full: { ...slopesOf(full), share },
  };
}
