// The stable shadow materials (src/render/stableShadow.ts), two ways.
// Default: a fixture page draws the same scene with three's shared shadow override and with the
// per-source overrides, on WebGPU and WebGL2, and compares every pixel (scripts/qa/shadow-parity.html).
// QA_LIVE=1: the game at night in the rain from 東京駅 (seed 20261006), 30 s into the drive, with the
// old behaviour (A: every caster drawn with three's one shared override, whose version alpha-tested
// and opaque draws toggle) and the new (B: StableShadowNode's override per source material)
// alternated A B B A B A A B for QA_SECONDS each (8 by default) in the same page, timing
// RenderObject.getMaterialCacheKey (the cost the toggling brings back every frame) and the frame.
// How A is made in the page: StableShadowNode.materialFor returns three's shared override instead
// of its own, which is the draw three makes without this node. Why not swap the light's shadowNode
// between modes: three builds the light's shadow node once, so a swap would not take effect.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const port = Number(process.env.QA_PORT ?? 9368);
const isLive = process.env.QA_LIVE === "1";

async function fixture() {
  const out = ".qa/perf/shadow-parity";
  mkdirSync(out, { recursive: true });
  const browser = await launch(new URL("scripts/qa/shadow-parity.html", base).href, { port });
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      ready = await browser.evaluate("Boolean(window.__shadowParity)");
      if (ready) break;
      await browser.sleep(500);
    }
    if (!ready) throw new Error("shadow fixture did not load");
    const rows = await browser.evaluate("window.__shadowParity");
    const errors = browser.logs.filter((row) => row.startsWith("[error]") || row.startsWith("[exception]"));
    const report = { rows, logs: browser.logs };
    writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
    await browser.screenshot(`${out}/fixture.png`);
    const hasErrors = errors.length > 0;
    if (hasErrors) throw new Error(JSON.stringify(errors));
    process.stdout.write(JSON.stringify(report) + "\n");
  } finally {
    await browser.close();
  }
}

async function live() {
  const seconds = Number(process.env.QA_SECONDS ?? 8);
  const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-shadow-cache");
  mkdirSync(out, { recursive: true });
  const url = new URL(base);
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time: "night",
    weather: "rain",
  }))
    url.searchParams.set(key, value);
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    url: url.href,
    seconds,
    samples: [],
  };
  const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  const browser = await launch(url.href, { port });
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      ready = await browser.evaluate("window.__game?.getState() === 'ready'").catch(() => false);
      if (!ready) await browser.sleep(1000);
    }
    if (!ready) throw new Error("game did not become ready");
    await browser.evaluate("__game.start()");
    await browser.sleep(30000);
    report.context = await browser.evaluate(`(async () => {
      const G = __game;
      const { StableShadowNode } = await import(new URL('src/render/stableShadow.ts', location.href).href);
      const node = G.env.sun.shadow.shadowNode;
      const isStable = node instanceof StableShadowNode;
      if (!isStable) throw new Error('the sun has no StableShadowNode from this module');
      const materialFor = StableShadowNode.prototype.materialFor;
      window.__qaLegacy = false;
      StableShadowNode.prototype.materialFor = function (source) {
        const isLegacy = window.__qaLegacy;
        if (isLegacy) return this.getShadowMaterial();
        return materialFor.call(this, source);
      };
      const ro = G.renderer._objects._renderObjects.values().next().value;
      const proto = Object.getPrototypeOf(ro);
      const key = proto.getMaterialCacheKey;
      window.__qaKey = { ms: 0, calls: 0 };
      proto.getMaterialCacheKey = function (...args) {
        const t0 = performance.now();
        try { return key.apply(this, args); } finally { __qaKey.ms += performance.now() - t0; __qaKey.calls++; }
      };
      return { render: G.renderInfo, userAgent: navigator.userAgent,
        session: G.debug.logs.query({ event: 'session_start' }).at(-1)?.traceId };
    })()`);
    for (const mode of process.env.QA_MODES?.split(",") ?? ["A", "B", "B", "A", "B", "A", "A", "B"]) {
      const sample = await browser.evaluate(`(async () => {
        window.__qaLegacy = ${JSON.stringify(mode)} === 'A';
        // A second to settle into the mode (B builds its per-source overrides once).
        await new Promise((r) => setTimeout(r, 1000));
        __qaKey.ms = 0; __qaKey.calls = 0;
        const stamps = [];
        const until = performance.now() + ${seconds * 1000};
        await new Promise((resolve) => {
          const loop = (t) => { stamps.push(t); if (t >= until) resolve(); else requestAnimationFrame(loop); };
          requestAnimationFrame(loop);
        });
        const frames = stamps.length - 1;
        const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).toSorted((a, b) => a - b);
        return { mode: ${JSON.stringify(mode)}, frames, keyMs: __qaKey.ms, keyCalls: __qaKey.calls,
          keyMsPerFrame: __qaKey.ms / frames, keyCallsPerFrame: __qaKey.calls / frames,
          frameP50: gaps[Math.floor(gaps.length / 2)], frameMax: gaps.at(-1) };
      })()`);
      report.samples.push(sample);
      save();
      process.stdout.write(JSON.stringify(sample) + "\n");
    }
    // How many per-source overrides the node holds (each a cloned NodeMaterial: the memory #5 adds).
    report.overrides = await browser.evaluate("__game.env.sun.shadow.shadowNode.materials.size");
    report.errors = await browser.evaluate(
      "__game.debug.logs.query({event:/uncaught_error|road_network_failed|log_schema_invalid/})",
    );
    save();
    const hasErrors = report.errors.length > 0;
    if (hasErrors) throw new Error(`runtime errors: ${join(out, "report.json")}`);
    process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
  } finally {
    await browser.close();
  }
}

await (isLive ? live() : fixture());
