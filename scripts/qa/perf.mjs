// Real-time performance samples, without the virtual clock used by drive.mjs.
// node scripts/qa/perf.mjs --label before [--seconds 20 --runs 3 --warmup 30]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg, platform, release } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs),
      [],
    ),
);
const seconds = Number(args.seconds ?? 20);
const runs = Number(args.runs ?? 3);
const warmup = Number(args.warmup ?? 30);
const isValid = [seconds, runs, warmup].every((n) => Number.isFinite(n) && n > 0) && Number.isInteger(runs);
if (!isValid) throw new Error("seconds, runs and warmup must be positive (runs an integer)");
const label = args.label ?? "sample";
const isSafeLabel = /^[a-zA-Z0-9_-]+$/.test(label);
if (!isSafeLabel) throw new Error("label must contain only letters, digits, _ or -");
const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`,
);
mkdirSync(out, { recursive: true });
const git = (...params) => execFileSync("git", params, { encoding: "utf8" }).trim();
const report = {
  label,
  commit: git("rev-parse", "HEAD"),
  diff: git("diff", "--stat"),
  host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, load: loadavg() },
  seconds,
  runs,
  warmup,
  viewport: { width: 1280, height: 800, dpr: 1 },
  scenarios: [],
};

for (const [time, weather] of [
  ["day", "clear"],
  ["night", "rain"],
]) {
  const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time,
    weather,
  }))
    url.searchParams.set(key, value);
  const b = await launch(url.href, { port: Number(args.port ?? 9351) });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await b.evaluate("window.__game?.getState() === 'ready'");
      if (ready) break;
      await b.sleep(1000);
    }
    if (!ready) throw new Error("game did not become ready in 120 seconds");
    await b.evaluate("window.__game.start()");
    await b.sleep(warmup * 1000);
    const scenario = {
      time,
      weather,
      url: url.href,
      context: await b.evaluate(`(async () => {
        const G = __game;
        const { GRAPHICS } = await import(new URL('src/device.ts', location.href).href);
        return { backend: G.renderInfo, graphics: GRAPHICS.settings, hidden: document.hidden,
          userAgent: navigator.userAgent, position: G.getFrame().toGeodetic(G.vehicle.position()),
          gameTime: G.env.now().toISOString(), state: G.getState(), memory: G.renderer.info.memory };
      })()`),
      samples: [],
    };
    for (let run = 0; run < runs; run++) {
      // Keep instrumentation out of the frame samples; collect CPU details separately below.
      const sample = await b.evaluate(`(async () => {
        const { watchFrames, frameStats, longFramesDuring } = await import(new URL('src/game/perf.ts', location.href).href);
        const start = performance.now();
        const { result, long } = await longFramesDuring(start, watchFrames(${seconds * 1000}));
        return { ...frameStats(result), elapsed: result.at(-1) - result[0], long };
      })()`);
      scenario.samples.push(sample);
    }
    scenario.details = await b.evaluate(`(async () => {
      const G = __game, r = G.renderer, totals = {}, restore = [];
      const wrap = (obj, key, label) => {
        const old = obj[key], t = totals[label] = { calls: 0, ms: 0 };
        let depth = 0;
        obj[key] = function(...args) {
          if (depth) return old.apply(this, args);
          depth++;
          const start = performance.now();
          try { return old.apply(this, args); }
          finally { t.calls++; t.ms += performance.now() - start; depth--; }
        };
        restore.push(() => obj[key] = old);
      };
      wrap(G.composer, 'drawWorld', 'world');
      wrap(G.scene, 'updateMatrixWorld', 'sceneMatrices');
      wrap(G.world, 'step', 'physics');
      let shadowChecks = 0, shadowVersionMisses = 0, frames = 0;
      // Private three r186 diagnostics only; these are not application behavior or GPU timings.
      for (const ro of r._objects._renderObjects) {
        if (ro.material.name !== 'ShadowMaterial') continue;
        const old = ro.getMaterialCacheKey;
        ro.getMaterialCacheKey = function() {
          shadowChecks++;
          if (this.version !== this.material.version) shadowVersionMisses++;
          return old.call(this);
        };
        restore.push(() => ro.getMaterialCacheKey = old);
      }
      const mirror = totals.mirrors = { calls: 0, ms: 0 };
      const original = r.render;
      r.render = function(scene, camera) {
        const isMirror = scene === G.scene && camera.isPerspectiveCamera && camera.far === 400;
        const start = performance.now();
        try { return original.call(this, scene, camera); }
        finally { if (isMirror) { mirror.calls++; mirror.ms += performance.now() - start; } }
      };
      restore.push(() => r.render = original);
      let display;
      G.scene.getObjectByName('Display_Center')?.traverse(o => { if (o.material?.map) display = o.material.map; });
      const version = display?.version ?? 0;
      const start = performance.now();
      try {
        await new Promise(resolve => { const tick = t => {
          frames++;
          if (t - start < 6000) requestAnimationFrame(tick); else resolve();
        }; requestAnimationFrame(tick); });
        return { frames, elapsed: performance.now() - start, totals, shadowChecks, shadowVersionMisses,
          displayUploadsRequested: (display?.version ?? 0) - version, render: { ...r.info.render } };
      } finally { restore.reverse().forEach(fn => fn()); }
    })()`);
    await b.screenshot(join(out, `${time}-${weather}.png`));
    scenario.errors = await b.evaluate("__game.debug.logs.query({event: 'uncaught_error'})");
    report.scenarios.push(scenario);
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(
      JSON.stringify({
        report: join(out, "report.json"),
        scenario: `${time}-${weather}`,
        samples: scenario.samples.map(({ long: _long, ...s }) => s),
      }) + "\n",
    );
  } finally {
    await b.close();
  }
}
