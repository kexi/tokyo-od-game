// Frame intervals with the player's car on an expressway deck (24402611:15), day and rain at night,
// for the A/B of the deck's materials (knowledge/road-textures.md「性能」). Run it against two dev
// servers (the change and its base on another port) and compare the JSON. Headless Chrome paces
// frames in steps of 16.7 ms, so only large changes show.
//
//   just measure-perf-deck after http://localhost:5173/tokyo-od-game/
//   pnpm exec tsx scripts/qa/perf-deck.ts [--label L] [--base URL] [--seconds S]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const seconds = Number(flag("seconds") ?? 12);
const looks = [
  { id: "day", query: "time=day&weather=clear" },
  { id: "rain-night", query: "time=night&weather=rain" },
];
type Stats = { frames: number; p50: number; p95: number; p99: number; max: number; heapMB: number | null };
const results: Array<{ look: string } & Stats> = [];
for (const look of looks) {
  const url = `${base}?start=35.6537,139.7508&${look.query}&seed=20261110&expressway`;
  const b = await launch(url, { width: 1280, height: 720, port: await freePort() });
  const until = async <T>(expr: string, tries = 180): Promise<T> => {
    for (let i = 0; i < tries; i++) {
      const v = await b.evaluate<T>(expr).catch(() => null);
      if (v) return v;
      await b.sleep(1000);
    }
    throw new Error(`timeout: ${expr}`);
  };
  try {
    await until("window.__game?.getState() === 'ready'");
    await b.evaluate("window.__game.start()");
    await until("__game.debug.settled().isSettled", 120);
    await until(`__game.debug.expressway.place("24402611:15", 0.6, 0)`, 90);
    await until("__game.debug.settled().isSettled", 120);
    await b.sleep(3000);
    const stats = await b.evaluate<Stats>(`new Promise((resolve) => {
      const xs = []; let last = performance.now(); const end = last + ${seconds * 1000};
      const tick = (t) => { xs.push(t - last); last = t; if (t < end) { requestAnimationFrame(tick); return; }
        xs.sort((a, b) => a - b);
        const q = (k) => Math.round(xs[Math.min(xs.length - 1, Math.floor(k * xs.length))] * 10) / 10;
        resolve({ frames: xs.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(xs.at(-1) * 10) / 10,
          heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null });
      };
      requestAnimationFrame(tick);
    })`);
    results.push({ look: look.id, ...stats });
  } finally {
    await b.close();
  }
}
const out = { label, base, at: new Date().toISOString(), seconds, results };
mkdirSync(join(ROOT, ".qa"), { recursive: true });
writeFileSync(join(ROOT, ".qa", `perf-deck-${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(out)}\n`);
