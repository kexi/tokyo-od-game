/**
 * Which face holds which layer of a FaceLayerPool (signFaces.ts), as plain bookkeeping with no
 * texture, fetch or clock of its own: the pool tells it what is wanted, what it decodes and what
 * failed, and asks it what to decode next and where a decoded face goes. Kept apart so the rules
 * are tested without a GPU (tests/faceLayerSlots.test.ts).
 *
 * - Layer 0 is the stand-in; faces take layers 1 … capacity.
 * - Only the `capacity` most wanted faces (smallest priority) are decoded: when more are wanted
 *   than fit, the rest are never decoded (they would only be dropped again), and the shortage is
 *   reported once per wanted set.
 * - A decoded face takes a free layer, else the layer of the face unwanted the longest, else that
 *   of a wanted face less wanted than itself. The face it evicts shows layer 0 from then on.
 * - A face whose picture failed is not tried again before its back-off is over (doubling from
 *   BACKOFF_MS, at most BACKOFF_MAX_MS).
 * Why not decode every missing face and sort it out on upload (the first version): with too few
 * layers it decoded the same faces every frame and threw them away, and retried a failed one every
 * frame (review C1: 102 decodes and 2 uploads in 100 frames for 3 faces in 2 layers).
 */

export const BACKOFF_MS = 2000;
export const BACKOFF_MAX_MS = 60_000;

type Slot = { key: string | null; lastWanted: number };
type Failure = { until: number; wait: number };

export class FaceLayerSlots {
  private readonly slots: Slot[];
  private readonly resident = new Map<string, number>();
  private wanted = new Map<string, number>();
  /** The faces worth decoding now: the `capacity` most wanted. */
  private top = new Set<string>();
  private readonly busy = new Set<string>();
  private readonly failures = new Map<string, Failure>();
  private tick = 0;
  private lastShortSize = -1;

  constructor(readonly capacity: number) {
    this.slots = Array.from({ length: capacity + 1 }, (_, i) => ({
      key: i === 0 ? "" : null,
      lastWanted: -1,
    }));
  }

  get used(): number {
    return this.resident.size;
  }

  layerOf(key: string): number {
    return this.resident.get(key) ?? 0;
  }

  has(key: string): boolean {
    return this.resident.has(key);
  }

  /**
   * The faces wanted from now on with their priorities. Returns the size of a shortage the first
   * time a wanted set of that size does not fit (else null), for the caller to log.
   */
  want(entries: ReadonlyMap<string, number>): number | null {
    this.tick++;
    this.wanted = new Map(entries);
    for (const key of entries.keys()) {
      const layer = this.resident.get(key);
      if (layer !== undefined) this.slots[layer].lastWanted = this.tick;
    }
    const ranked = [...entries].toSorted((a, b) => a[1] - b[1]).slice(0, this.capacity);
    this.top = new Set(ranked.map(([key]) => key));
    const isShort = entries.size > this.capacity;
    if (!isShort) {
      this.lastShortSize = -1;
      return null;
    }
    if (this.lastShortSize === entries.size) return null;
    this.lastShortSize = entries.size;
    return entries.size;
  }

  /**
   * Up to `max` faces to decode now, most wanted first: among the `capacity` most wanted, not in,
   * not being decoded or waiting to be placed, and not backing off from a failure at `now`.
   */
  toDecode(max: number, now: number): string[] {
    const room = Math.max(0, max);
    if (room === 0) return [];
    return [...this.top]
      .filter((key) => !this.resident.has(key) && !this.busy.has(key) && !this.isBackingOff(key, now))
      .toSorted((a, b) => (this.wanted.get(a) ?? 0) - (this.wanted.get(b) ?? 0))
      .slice(0, room);
  }

  /** The face's decode has started (it stays busy until placed, dropped or failed). */
  started(key: string): void {
    this.busy.add(key);
  }

  /** Its picture could not be had: back off before trying again. */
  failed(key: string, now: number): void {
    this.busy.delete(key);
    const wait = Math.min((this.failures.get(key)?.wait ?? BACKOFF_MS / 2) * 2, BACKOFF_MAX_MS);
    this.failures.set(key, { until: now + wait, wait });
  }

  /**
   * A layer for a decoded face, or null when it is no longer among the most wanted (drop it). The
   * face evicted for it, if any, shows layer 0 from now on.
   */
  place(key: string): number | null {
    this.busy.delete(key);
    const isWorth = this.top.has(key) && !this.resident.has(key);
    if (!isWorth) return null;
    const layer = this.freeLayer(key);
    if (layer === null) return null;
    this.slots[layer] = { key, lastWanted: this.tick };
    this.resident.set(key, layer);
    this.failures.delete(key);
    return layer;
  }

  private isBackingOff(key: string, now: number): boolean {
    const f = this.failures.get(key);
    return f !== undefined && now < f.until;
  }

  private freeLayer(key: string): number | null {
    const free = this.slots.findIndex((s, i) => i > 0 && s.key === null);
    if (free > 0) return free;
    const priority = this.wanted.get(key) ?? Infinity;
    let best: number | null = null;
    let bestRank = -Infinity;
    for (let i = 1; i < this.slots.length; i++) {
      const held = this.slots[i].key ?? "";
      const heldPriority = this.wanted.get(held);
      const isWanted = heldPriority !== undefined;
      // Unwanted faces rank above every wanted one, the longest unwanted first.
      const rank = isWanted ? heldPriority : Number.MAX_SAFE_INTEGER - this.slots[i].lastWanted;
      const isWorse = !isWanted || heldPriority > priority;
      if (isWorse && rank > bestRank) {
        best = i;
        bestRank = rank;
      }
    }
    if (best === null) return null;
    const evicted = this.slots[best].key;
    if (evicted) this.resident.delete(evicted);
    return best;
  }
}
