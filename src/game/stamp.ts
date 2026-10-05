/**
 * Hanko (判子) stamped on the screen for each violation: a red double-framed seal slams down at
 * a slight angle with a thud, lingers, then fades. Successive stamps land at different spots so
 * a run of offences looks like a sheet stamped over and over.
 */
export class Stamps {
  private count = 0;

  constructor(
    private readonly layer: HTMLElement,
    private readonly audio: () => AudioContext | null,
    private readonly shake: HTMLElement,
  ) {}

  /**
   * `main` is the large word (逮捕, 確認標章 …); `detail` the small line under it. A violation
   * (main 違反) is stamped with its own name instead — 信号無視, 指定通行区分違反 — as the one large
   * word: the generic 違反 said nothing the red seal does not already say. `reading` is what the
   * seal says in the language in force, written small under it (empty in Japanese): the seal
   * itself stays in Japanese, like a hanko, but a player who reads English or Chinese still learns
   * what they did.
   */
  stamp(main: string, detail = "", severe = false, reading = ""): void {
    const isViolation = main === "違反" && detail !== "";
    const big = isViolation ? detail : main;
    const small = isViolation ? "" : detail;
    const n = this.count++;
    const el = document.createElement("div");
    el.className = severe ? "stamp severe" : "stamp";
    // Scatter around the centre; alternate sides so overlapping stamps stay legible.
    const dx = ((n * 137) % 220) - 110;
    const dy = ((n * 89) % 120) - 60;
    const angle = -14 + ((n * 23) % 22);
    el.style.setProperty("--dx", `${dx}px`);
    el.style.setProperty("--dy", `${dy}px`);
    el.style.setProperty("--angle", `${angle}deg`);
    const word = document.createElement("div");
    word.className = "stamp-main";
    word.textContent = big;
    // The CSS shrinks a long name (救護義務違反 …) so it stays on one line inside the frame.
    word.style.setProperty("--len", String([...big].length));
    el.append(word);
    if (small) {
      const sub = document.createElement("div");
      sub.className = "stamp-sub";
      sub.textContent = small;
      el.append(sub);
    }
    if (reading) {
      const line = document.createElement("div");
      line.className = "stamp-reading";
      line.textContent = reading;
      el.append(line);
    }
    this.layer.append(el);
    // The thud lands when the seal reaches the paper (the 35 % keyframe of the slam).
    setTimeout(() => this.thud(severe), 120);
    setTimeout(() => {
      this.shake.classList.remove("stamp-shake");
      void this.shake.offsetWidth; // restart the animation
      this.shake.classList.add("stamp-shake");
    }, 120);
    setTimeout(() => el.classList.add("fade"), severe ? 3600 : 2200);
    setTimeout(() => el.remove(), severe ? 4400 : 3000);
  }

  private thud(severe: boolean): void {
    const ctx = this.audio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Low body of the impact…
    const osc = ctx.createOscillator();
    const body = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(severe ? 120 : 150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    body.gain.setValueAtTime(severe ? 0.9 : 0.6, t);
    body.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(body).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
    // …and the slap of rubber on paper.
    const frames = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const slap = ctx.createGain();
    slap.gain.value = 0.35;
    noise.connect(slap).connect(ctx.destination);
    noise.start(t);
  }
}

/** 「信号無視（赤色等）」→「信号無視」: the seal has room for the core name only. */
export function shortLabel(label: string): string {
  return label.replace(/（.*?）/g, "").trim();
}
