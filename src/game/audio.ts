import { SpatialAudio } from "./spatialAudio";

/**
 * Procedural sound. The player's engine, road noise and horn, and everything heard from a place
 * in the world, go through the spatial layer (game/spatialAudio.ts); the indicator relay and
 * the pickup chimes stay plain (a relay inside the dashboard, a game cue).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  muted = false;
  /** 音量 (設定), 0–1, over everything; muted (F8) silences it all the same. */
  volume = 1;
  readonly spatial = new SpatialAudio(
    () => this.muted,
    () => this.volume,
  );

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Must be called from a user gesture (autoplay policy). */
  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.spatial.init(ctx);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  update(speedKmh: number, throttle: number, engineOff = false): void {
    this.spatial.playerCar(speedKmh, throttle, engineOff);
  }

  private lastTick = false;

  /** 警音器: the two-tone car horn while held, from the front of the car. */
  horn(isOn: boolean): void {
    this.spatial.horn(isOn && !this.muted);
  }

  /** The indicator relay: a click on each change of the flasher. */
  tick(isLit: boolean): void {
    if (isLit === this.lastTick) return;
    this.lastTick = isLit;
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = isLit ? 1800 : 1400;
    gain.gain.setValueAtTime(0.05 * this.volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  }

  chime(high = false): void {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const ctx = this.ctx;
    const notes = high ? [784, 988, 1319, 1568] : [880, 1319];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18 * this.volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }
}
