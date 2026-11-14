/** A shared frame budget for streamed world work; microtasks alone never give rendering a turn. */
export class FrameWork {
  private sliceMs = 0;
  maxSliceMs = 0;
  cpuMs = 0;
  yields = 0;

  constructor(
    private readonly budgetMs = 4,
    private readonly nextFrame = FrameWork.nextFrame,
    private readonly beforeFrame?: () => Promise<void>,
  ) {}

  private static nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      const hasFrames = typeof requestAnimationFrame === "function";
      if (hasFrames) requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  async yield(): Promise<void> {
    this.maxSliceMs = Math.max(this.maxSliceMs, this.sliceMs);
    this.yields++;
    const hasPreparation = this.beforeFrame !== undefined;
    if (hasPreparation) await this.beforeFrame!();
    await this.nextFrame();
    this.sliceMs = 0;
  }

  measure<T>(work: () => T): T {
    const start = performance.now();
    try {
      return work();
    } finally {
      const elapsed = performance.now() - start;
      this.cpuMs += elapsed;
      this.sliceMs += elapsed;
      this.maxSliceMs = Math.max(this.maxSliceMs, this.sliceMs);
    }
  }

  async run<T>(steps: Generator<void | boolean, T>, renderEachStep = false): Promise<T> {
    for (;;) {
      const result = this.measure(() => steps.next());
      if (result.done) return result.value;
      const exhausted = renderEachStep || result.value === true || this.sliceMs >= this.budgetMs;
      if (exhausted) await this.yield();
    }
  }
}
