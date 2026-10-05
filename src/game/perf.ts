import { log } from "../log";

/**
 * Timings of the work around a violation, in dev builds only (production calls straight through):
 * each phase of main's book(), of the post published later, of a bystander's shot and of the
 * screen grab, as performance.now() differences. A phase over LOG_OVER_MS is logged as
 * {"event":"perf","phase":…,"ms":…,"blocking":…}; window.__game.debug.perf reads the rest.
 *
 * `blocking` tells the two kinds apart: true for work done on the main thread in one go (it adds
 * to the frame it lands in), false for a span that waits on the GPU or a worker (from the request
 * to the answer; the main thread is free meanwhile).
 */
export type PhaseTime = { phase: string; ms: number; at: number; blocking: boolean };

const LOG_OVER_MS = 2;
const KEEP = 400;

export class PerfPhases {
  readonly recent: PhaseTime[] = [];

  constructor(readonly isOn: boolean) {}

  /** Runs `fn`, timing it as `phase` (main-thread work). */
  time<T>(phase: string, fn: () => T): T {
    if (!this.isOn) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.add(phase, performance.now() - start, true, start);
    }
  }

  /** Times `work` from now until it settles, as `phase` (a wait on the GPU or a worker). */
  span<T>(phase: string, work: Promise<T>): Promise<T> {
    if (!this.isOn) return work;
    const start = performance.now();
    const done = () => this.add(phase, performance.now() - start, false, start);
    work.then(done, done);
    return work;
  }

  add(phase: string, ms: number, blocking: boolean, at = performance.now()): void {
    if (!this.isOn) return;
    this.recent.push({ phase, ms, at, blocking });
    if (this.recent.length > KEEP) this.recent.splice(0, this.recent.length - KEEP);
    if (ms > LOG_OVER_MS) log("perf", { phase, ms: Math.round(ms * 10) / 10, blocking });
  }

  /** Phases that started at or after `t` (performance.now()). */
  since(t: number): PhaseTime[] {
    return this.recent.filter((p) => p.at >= t);
  }
}

/** The one instance the game and its modules time with. */
// Optional chaining: outside Vite (a tsx script importing a game module) there is no env.
export const perf = new PerfPhases(import.meta.env?.DEV === true);

export type FrameStats = {
  frames: number;
  /** The longest gap between two frames (ms) and when it ended, from the start of the watch. */
  longest: number;
  longestAt: number;
  p50: number;
  p95: number;
  /** Frames longer than 25 ms (a hitch at 60 Hz) and 50 ms. */
  over25: number;
  over50: number;
};

/** Frame-to-frame gaps (ms) summed up. */
export function frameStats(stamps: readonly number[]): FrameStats {
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  const sorted = gaps.toSorted((a, b) => a - b);
  const at = (q: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  let longest = 0;
  let longestAt = 0;
  gaps.forEach((g, i) => {
    if (g <= longest) return;
    longest = g;
    longestAt = stamps[i + 1] - stamps[0];
  });
  return {
    frames: gaps.length,
    longest: round(longest),
    longestAt: round(longestAt),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    over25: gaps.filter((g) => g > 25).length,
    over50: gaps.filter((g) => g > 50).length,
  };
}

/** Milliseconds to a tenth. */
export const round = (ms: number) => Math.round(ms * 10) / 10;

/** The rAF timestamps for `ms` from now (the browser's frames, whatever the game does in them). */
export function watchFrames(ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const start = performance.now();
    const loop = (t: number) => {
      stamps.push(t);
      if (t - start < ms) requestAnimationFrame(loop);
      else resolve(stamps);
    };
    requestAnimationFrame(loop);
  });
}

export type LongFrame = {
  at: number;
  ms: number;
  blockingMs: number;
  scripts: { what: string; ms: number }[];
};

/**
 * Chrome's long animation frames (over 50 ms) while `watch` runs, with the scripts that took the
 * longest in each: where a hitch came from, past what the phases cover. Empty where unsupported.
 */
export async function longFramesDuring<T>(
  t0: number,
  watch: Promise<T>,
): Promise<{ result: T; long: LongFrame[] }> {
  const long: LongFrame[] = [];
  const isSupported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("long-animation-frame");
  type Script = { invoker?: string; sourceFunctionName?: string; sourceURL?: string; duration: number };
  type Entry = PerformanceEntry & { blockingDuration?: number; scripts?: Script[] };
  const keep = (entries: PerformanceEntryList) => {
    for (const e of entries as Entry[]) {
      long.push({
        at: round(e.startTime - t0),
        ms: round(e.duration),
        blockingMs: round(e.blockingDuration ?? 0),
        scripts: (e.scripts ?? [])
          .toSorted((a, b) => b.duration - a.duration)
          .slice(0, 4)
          .map((s) => ({
            what: [s.invoker, s.sourceFunctionName, s.sourceURL?.split("/").pop()].filter(Boolean).join(" "),
            ms: round(s.duration),
          })),
      });
    }
  };
  const observer = isSupported ? new PerformanceObserver((list) => keep(list.getEntries())) : null;
  observer?.observe({ type: "long-animation-frame", buffered: false });
  try {
    const result = await watch;
    return { result, long };
  } finally {
    // Entries still queued for the callback (the last frames of the watch).
    if (observer) keep(observer.takeRecords());
    observer?.disconnect();
  }
}
