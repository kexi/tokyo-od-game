// Controlled A/B of mirror culling and display uploads, with simulation paused but real rAF time.
// node scripts/qa/perf-fixed-scene.mjs [--seconds 12] [--live]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const durationIndex = process.argv.indexOf("--seconds");
const seconds = durationIndex < 0 ? 12 : Number(process.argv[durationIndex + 1]);
const live = process.argv.includes("--live");
const isValid = Number.isFinite(seconds) && seconds > 0;
if (!isValid) throw new Error("seconds must be positive");
const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + (live ? "-live-night" : "-fixed"),
);
mkdirSync(out, { recursive: true });
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  scope:
    "Current build; A restores all mirror slots and per-frame display uploads. " +
    (live ? "Normal gameplay with traffic and rain advancing." : "Simulation stopped in both."),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  seconds,
  scenarios: [],
};
const preload = `
  window.__qaFreeze = false;
  window.__qaSkipped = 0;
  window.__qaCallbacks = {};
  window.__qaCapture = false;
  window.__qaCpu = [];
  performance.setResourceTimingBufferSize(10000);
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const mainCallbacks = new WeakMap();
  window.requestAnimationFrame = callback => nativeRAF(time => {
    window.__qaCallbacks[callback.name] = (window.__qaCallbacks[callback.name] ?? 0) + 1;
    if (window.__qaFreeze && callback.name === 'tick') { window.__qaSkipped++; return; }
    if (!mainCallbacks.has(callback)) mainCallbacks.set(callback, callback.name === 'tick' && callback.toString().includes('step('));
    const measure = window.__qaCapture && mainCallbacks.get(callback);
    const start = measure ? performance.now() : 0;
    try { callback(time); }
    finally { if (measure) window.__qaCpu.push(performance.now() - start); }
  });
`;

const conditions = live
  ? [["night", "rain"]]
  : [
      ["night", "rain"],
      ["day", "clear"],
    ];
for (const [time, weather] of conditions) {
  const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time,
    weather,
  }))
    url.searchParams.set(key, value);
  const browser = await launch(url.href, { port: 9354, preload });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await browser.evaluate("window.__game?.getState() === 'ready'");
      if (ready) break;
      await browser.sleep(1000);
    }
    if (!ready) throw new Error("game did not become ready");
    await browser.evaluate(`(async () => {
      window.__qaModule = path => performance.getEntriesByType('resource')
        .find(e => new URL(e.name).pathname.endsWith('/' + path))?.name ?? new URL(path, location.href).href;
      const { Cockpit } = await import(__qaModule('src/game/cockpit.ts'));
      const original = Cockpit.prototype.render;
      Cockpit.prototype.render = function(...args) { window.__qaCockpit = this; return original.apply(this, args); };
      __game.start();
    })()`);
    await browser.sleep(30000);
    if (!live) await browser.evaluate("__game.phone.close(); window.__qaFreeze = true");
    await browser.sleep(3000);
    const setup = await browser.evaluate(`(async () => {
      if ((${!live} && __qaSkipped < 1) || !window.__qaCockpit?.active) throw new Error('unexpected game loop state: ' + JSON.stringify({skipped:__qaSkipped, active:window.__qaCockpit?.active, callbacks:__qaCallbacks}));
      const G = __game, cockpit = __qaCockpit;
      const { GRAPHICS } = await import(new URL('src/device.ts', location.href).href);
      const { frameStats, watchFrames } = await import(new URL('src/game/perf.ts', location.href).href);
      const actualNext = cockpit.mirrorUpdates.next;
      let legacy = false, slot = 0, mirrorCalls = 0, lastUpload = -Infinity;
      cockpit.mirrorUpdates.next = function(surfaces, camera) {
        return legacy ? slot++ % surfaces.length : actualNext.call(this, surfaces, camera);
      };
      const actualRender = G.renderer.render;
      G.renderer.render = function(scene, camera) {
        if (scene === G.scene && camera.isPerspectiveCamera && camera.far === 400) mirrorCalls++;
        return actualRender.call(this, scene, camera);
      };
      const display = cockpit.displayTexture;
      if (!display) throw new Error('display texture missing');
      const drawCpu = [];
      if (${live}) {
        const render = cockpit.render, refresh = cockpit.refreshDisplay;
        cockpit.refreshDisplay = function() { if (!legacy) refresh.call(this); };
        cockpit.render = function(...args) {
          if (legacy) display.needsUpdate = true;
          const start = performance.now();
          try { return render.apply(this, args); }
          finally { if (__qaCapture) drawCpu.push(performance.now() - start); }
        };
      }
      const fingerprint = () => {
        const objects = [];
        G.scene.traverse(o => objects.push([o.uuid, o.visible, ...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]));
        const json = JSON.stringify(objects);
        let hash = 2166136261;
        for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
        return { objects: objects.length, hash: hash >>> 0 };
      };
      const summary = values => {
        const sorted = values.toSorted((a,b) => a-b);
        return { mean: values.reduce((a,b) => a+b,0) / values.length,
          p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] };
      };
      window.__qaSample = async (mode, seconds) => {
        legacy = mode === 'A'; slot = 0; cockpit.mirrorUpdates.reset();
        if (${live}) {
          await new Promise(r => setTimeout(r, 2000));
          mirrorCalls = 0; __qaCpu = []; drawCpu.length = 0;
          const version = display.version, before = fingerprint();
          let stamps;
          __qaCapture = true;
          try { stamps = await watchFrames(seconds * 1000); }
          finally { __qaCapture = false; }
          const elapsed = stamps.at(-1) - stamps[0], renders = drawCpu.length;
          if (__qaCpu.length !== renders || !renders) throw new Error('main frame instrumentation mismatch');
          if (legacy && (mirrorCalls !== renders || display.version - version !== renders)) throw new Error('legacy updates were not applied once per frame');
          return { mode, ...frameStats(stamps), elapsed, fps: (stamps.length - 1) * 1000 / elapsed,
            cpu: summary(__qaCpu), drawCpu: summary(drawCpu), renders, mirrorCalls,
            uploads: display.version - version, before, after: fingerprint(), gameTime: G.env.now().toISOString() };
        }
        const before = fingerprint(), stamps = [], cpu = [];
        let version = display.version, start = null;
        const blockStart = performance.now();
        await new Promise(resolve => {
          const draw = t => {
            const measuring = t - blockStart >= 2000;
            if (measuring && start === null) { start = t; mirrorCalls = 0; version = display.version; }
            const begin = performance.now();
            if (legacy || t - lastUpload >= 120) { display.needsUpdate = true; lastUpload = t; }
            cockpit.render(G.composer, G.renderer, G.scene, G.camera);
            G.composer.present();
            if (measuring) { stamps.push(t); cpu.push(performance.now() - begin); }
            if (start !== null && t - start >= seconds * 1000) resolve(); else requestAnimationFrame(draw);
          };
          requestAnimationFrame(draw);
        });
        const elapsed = stamps.at(-1) - stamps[0];
        const after = fingerprint();
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('scene changed during sample');
        if (legacy && mirrorCalls !== cpu.length) throw new Error('legacy mirror override was not applied: ' + JSON.stringify({mirrors:mirrorCalls, renders:cpu.length}));
        return { mode, ...frameStats(stamps), elapsed, fps: (stamps.length - 1) * 1000 / elapsed,
          cpu: summary(cpu), renders: cpu.length, mirrorCalls, uploads: display.version - version, before, after };
      };
      return { backend: G.renderInfo, graphics: GRAPHICS.settings, userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, scene: fingerprint() };
    })()`);
    const scenario = { time, weather, setup, samples: [] };
    report.scenarios.push(scenario);
    for (const mode of ["A", "B", "B", "A", "B", "A", "A", "B"]) {
      const sample = await browser.evaluate(`__qaSample(${JSON.stringify(mode)}, ${seconds})`);
      const isUnchanged = JSON.stringify(sample.before) === JSON.stringify(setup.scene);
      if (!live && !isUnchanged) throw new Error("scene changed between samples");
      scenario.samples.push(sample);
      writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
      process.stdout.write(JSON.stringify({ scenario: `${time}-${weather}`, ...sample }) + "\n");
    }
    scenario.date = await browser.evaluate(`(async () => {
      const { tokyoDate } = await import(new URL('src/world/ruleTime.ts', location.href).href);
      const old = date => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' })
          .formatToParts(date).reduce((acc,p) => (acc[p.type] = p.value, acc), {});
        return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
      };
      const dates = Array.from({length:1000}, (_,i) => new Date(Date.UTC(2025,0,1) + i * 86400000));
      const results = [];
      for (const mode of ['A','B','B','A','B','A','A','B']) {
        const fn = mode === 'A' ? old : tokyoDate;
        const start = performance.now(); const values = dates.map(fn); const ms = performance.now() - start;
        results.push({mode, ms, calls:dates.length, checksum: JSON.stringify(values)});
        await new Promise(r => setTimeout(r, 50));
      }
      const equal = results.every(r => r.checksum === results[0].checksum);
      if (!equal) throw new Error('date results differ');
      return { equal, samples: results.map(({checksum: _checksum, ...r}) => r) };
    })()`);
    scenario.errors = await browser.evaluate("__game.debug.logs.query({event:'uncaught_error'})");
    await browser.screenshot(join(out, `${time}-${weather}.png`));
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}
process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
