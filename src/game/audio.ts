/** Tiny procedural sound: an engine drone whose pitch follows speed, plus pickup chimes. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  muted = false;

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Must be called from a user gesture (autoplay policy). */
  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.engine = ctx.createOscillator();
    this.engine.type = "sawtooth";
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(this.filter).connect(this.engineGain).connect(ctx.destination);
    this.engine.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  update(speedKmh: number, throttle: number): void {
    if (!this.ctx || !this.engine || !this.engineGain || !this.filter) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + (Math.abs(speedKmh) % 45) / 45 + Math.min(Math.abs(speedKmh), 160) / 220;
    this.engine.frequency.setTargetAtTime(38 + rpm * 70, t, 0.08);
    this.filter.frequency.setTargetAtTime(300 + throttle * 700, t, 0.1);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + throttle * 0.03, t, 0.1);
  }

  chime(high = false): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const notes = high ? [784, 988, 1319, 1568] : [880, 1319];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }
}
