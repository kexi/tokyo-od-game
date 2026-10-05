/**
 * The pad's rumble as the game asks for it: short effects (a kerb, a crash, the violation stamp)
 * and one held hum (the engine idling), mixed into one frame of two bands — a low band (≈40–160
 * Hz, the "strong" motor of a dual-rumble pad) and a high band (≈160–1250 Hz, the "weak" one). The
 * Pro Controller's linear actuators play both bands at the given frequencies over WebHID
 * (procon.ts encodes them); other pads get the two amplitudes as a Gamepad API dual-rumble.
 * Pure: times are passed in (ms), so the tests drive it with numbers.
 */

export type Band = { hz: number; amp: number };
export type RumbleFrame = { low: Band; high: Band };

export const SILENT: RumbleFrame = { low: { hz: 160, amp: 0 }, high: { hz: 320, amp: 0 } };

export type RumbleKind = "bump" | "impact" | "stamp" | "test";

type Effect = { start: number; duration: number; sample: (t: number) => RumbleFrame };

const frame = (lowHz: number, lowAmp: number, highHz: number, highAmp: number): RumbleFrame => ({
  low: { hz: lowHz, amp: lowAmp },
  high: { hz: highHz, amp: highAmp },
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The effects, by kind and strength (0–1):
 * - bump (a kerb, a pothole): 50–110 ms of a low thud that fades, a little high band for the edge.
 * - impact (a crash): 150–500 ms, strong low band with a grinding high band, decaying; strength is
 *   the car's own Δv scaled so 8 m/s (≈30 km/h into a wall) is full.
 * - stamp (the 違反 seal): a hanko's two beats — the press and a softer settle.
 * - test (設定's 試す): a 400 ms sweep through both bands.
 */
export function effectFor(kind: RumbleKind, strength: number, start: number): Effect {
  const s = clamp01(strength);
  switch (kind) {
    case "bump": {
      const duration = 50 + 60 * s;
      return {
        start,
        duration,
        sample: (t) => {
          const fade = 1 - t / duration;
          return frame(90, (0.3 + 0.5 * s) * fade, 220, 0.2 * s * fade);
        },
      };
    }
    case "impact": {
      const duration = 150 + 350 * s;
      return {
        start,
        duration,
        sample: (t) => {
          const decay = Math.exp((-3 * t) / duration);
          return frame(70, (0.45 + 0.55 * s) * decay, 160, (0.15 + 0.45 * s) * decay);
        },
      };
    }
    case "stamp":
      return {
        start,
        duration: 210,
        sample: (t) => {
          const isPress = t < 60;
          const isSettle = t >= 130;
          if (isPress) return frame(120, 0.7, 300, 0.35);
          if (isSettle) return frame(100, 0.35, 250, 0.1);
          return SILENT;
        },
      };
    case "test":
      return {
        start,
        duration: 400,
        sample: (t) => {
          const k = t / 400;
          return frame(60 + 100 * k, 0.6, 200 + 600 * k, 0.4);
        },
      };
  }
}

/** Several frames played at once: amplitudes add (to 1), each band's pitch from its loudest part. */
export function mixFrames(frames: readonly RumbleFrame[]): RumbleFrame {
  let low = { ...SILENT.low };
  let high = { ...SILENT.high };
  let lowSum = 0;
  let highSum = 0;
  for (const f of frames) {
    lowSum += f.low.amp;
    highSum += f.high.amp;
    if (f.low.amp > low.amp) low = { ...f.low };
    if (f.high.amp > high.amp) high = { ...f.high };
  }
  return { low: { hz: low.hz, amp: clamp01(lowSum) }, high: { hz: high.hz, amp: clamp01(highSum) } };
}

export const isSilent = (f: RumbleFrame): boolean => f.low.amp <= 0.001 && f.high.amp <= 0.001;

/** A held effect stops by itself this long after it was last fed (a paused game stops the idle). */
const HOLD_TTL_MS = 150;

export class RumbleMixer {
  private effects: Effect[] = [];
  private readonly holds = new Map<string, { frame: RumbleFrame; until: number }>();

  play(kind: RumbleKind, strength: number, now: number): void {
    this.effects.push(effectFor(kind, strength, now));
    // A pile-up of contacts in one crash: the newest few are enough.
    if (this.effects.length > 8) this.effects.shift();
  }

  /** Keep a continuous effect going (fed every frame). */
  hold(id: string, f: RumbleFrame, now: number): void {
    this.holds.set(id, { frame: f, until: now + HOLD_TTL_MS });
  }

  release(id: string): void {
    this.holds.delete(id);
  }

  clear(): void {
    this.effects = [];
    this.holds.clear();
  }

  /** The mixed frame at `now`, scaled by the intensity setting. */
  frame(now: number, intensity = 1): RumbleFrame {
    this.effects = this.effects.filter((e) => now - e.start < e.duration);
    for (const [id, h] of this.holds) if (h.until < now) this.holds.delete(id);
    const frames = [
      ...this.effects.filter((e) => now >= e.start).map((e) => e.sample(now - e.start)),
      ...[...this.holds.values()].map((h) => h.frame),
    ];
    const mixed = mixFrames(frames);
    const k = clamp01(intensity);
    return {
      low: { hz: mixed.low.hz, amp: mixed.low.amp * k },
      high: { hz: mixed.high.hz, amp: mixed.high.amp * k },
    };
  }
}

/** The engine's idle hum (設定 › 振動 › アイドリング): very low and faint, steadier with throttle. */
export const idleFrame = (throttle: number): RumbleFrame =>
  frame(42, 0.07 + 0.05 * clamp01(throttle), 160, 0);

// A change of the car's vertical speed within one frame larger than this is a jolt (m/s); smaller
// is the suspension riding the road's slope and the springs' own bounce.
const JOLT_MIN = 0.45;
const JOLT_FULL = 2.5;

/** How hard a vertical jolt (kerb, pothole, landing) is, 0 for none, 1 for a hard one. */
export function bumpStrength(prevVy: number, vy: number): number {
  const jolt = Math.abs(vy - prevVy);
  if (jolt < JOLT_MIN) return 0;
  return clamp01((jolt - JOLT_MIN) / (JOLT_FULL - JOLT_MIN));
}
