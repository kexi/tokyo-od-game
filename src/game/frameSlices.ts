/**
 * Spreading the work that follows a violation over the frames after it, so that the frame of the
 * violation (and every frame after) stays about as light as the others.
 *
 * - FrameGate: one turn per frame. Work that renders off screen (a bystander's probe or photo)
 *   waits for a turn before each render, so at most one such render lands in a frame however many
 *   posts are being shot.
 * - DueQueue: things that happen a moment later (a bystander's post a few seconds after what they
 *   saw), handed out no sooner than due, one a frame, in the order they were queued.
 * - Busy: whether anything of a kind is still in flight (the shots), so the on-device AI waits
 *   until they are done before it takes the GPU.
 */

/**
 * Hands out one turn per frame (tick), first come first served, and never in the frame the turn
 * was asked for: work queued while a frame is being made (a violation in the game's update) starts
 * after the next frame, not on top of the one it was asked in.
 */
export class FrameGate {
  /** Off: every turn is granted at once (everything in the frame that asks, as before slicing). */
  isOpen = false;
  private ticks = 0;
  private readonly waiting: Array<{ since: number; go: () => void }> = [];

  /** Resolves on this caller's turn: a later frame's tick, with nobody ahead of it. */
  turn(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    return new Promise((go) => this.waiting.push({ since: this.ticks, go }));
  }

  /**
   * A frame is done: the first in line goes if it has waited past a tick. Its work runs in the
   * microtasks right after the caller's task (that frame's), before the next frame. Returns
   * whether anyone went.
   */
  tick(): boolean {
    const next = this.waiting[0];
    const hasWaited = next !== undefined && next.since < this.ticks;
    this.ticks++;
    if (!hasWaited) return false;
    this.waiting.shift();
    next.go();
    return true;
  }

  /** How many are waiting for a turn. */
  get queued(): number {
    return this.waiting.length;
  }
}

/**
 * Items released at their due time (any clock in ms; the game passes performance.now()), at most
 * one per take(), and never before one queued earlier: a later item with a shorter delay waits for
 * those ahead of it, so the player sees them in the order they happened.
 */
export class DueQueue<T> {
  private readonly items: Array<{ item: T; due: number }> = [];

  /** Queues `item` to come out no sooner than `due`. */
  push(item: T, due: number): void {
    this.items.push({ item, due });
  }

  /** The first item if it is due at `now` (it leaves the queue), else null. */
  take(now: number): T | null {
    const first = this.items[0];
    const isDue = first !== undefined && first.due <= now;
    if (!isDue) return null;
    this.items.shift();
    return first.item;
  }

  /** Everything still queued leaves at once, in order (the caller does it all now). */
  drain(): T[] {
    return this.items.splice(0).map((x) => x.item);
  }

  get size(): number {
    return this.items.length;
  }
}

/** Counts work in flight; idle() resolves once none is left (at once when none is). */
export class Busy {
  private count = 0;
  private waiters: Array<() => void> = [];

  /** Counts `work` until it settles (either way); returns it. */
  track<T>(work: Promise<T>): Promise<T> {
    this.count++;
    const done = () => {
      this.count--;
      if (this.count > 0) return;
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w();
    };
    work.then(done, done);
    return work;
  }

  get active(): number {
    return this.count;
  }

  idle(): Promise<void> {
    if (this.count === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
