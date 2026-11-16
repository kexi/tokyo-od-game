// 画質 › シェーダーの事前作成 on or off, measured from one load: when the loading screen closed (the
// game's state "ready", ms from navigation) and how long precompile took (pipelines_compiled), then
// the first seconds of a drive (frames over 50, 100 and 250 ms, the longest gap, the pipelines built
// in them), and three first moments with the longest gap within a second either side and the
// pipelines built in it: the driver's seat's first frames (play starts in the cockpit, so that is
// start()), the first violation (debug.perf.violation: the bystanders' phones and the shot) and the
// first rain (env.weather = "rain": the drops, the rain glass, the wet roads).
//
// How: a page-side script, installed before the page's own, keeps every frame's time (rAF) from
// navigation, wraps console for the pipelines_compiled / pipelines_skipped lines (src/log.ts writes
// one JSON line a console call) and wraps the backend's createRenderPipeline (pipelineCount.ts) as
// soon as the renderer is there, so the loading screen's own pipelines are counted too. The drive is
// the game's 自動運転 (KeyJ, as drive.mjs), from 東京駅 by day; the cars and people that come into
// view on it are what an "off" load builds in play. The moments come after the drive's window, one
// at a time, so that window holds no staged hitch.
// Why not perf-buildings.ts's window: it opens once the town has gone quiet, long after the first
// frames, where the pipelines an "off" load leaves to play are built.
//
//   just measure-shader-prebuild label base [args]
//   pnpm exec tsx scripts/qa/shader-prebuild.ts --label L [--base URL] --prebuild on|off
//     [--seconds 30] [--mobile] [--start lat,lon]
//
// --mobile gives the page an Android user agent, so src/device.ts picks the phone's quality (低).
// Output: .qa/shader-prebuild/<label>.json (the summary and the raw frame times) and the summary as
// one JSON line on stdout.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { COUNT_PIPELINES } from "./pipelineCount.ts";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const prebuild = flag("prebuild") ?? "on";
const seconds = Number(flag("seconds") ?? 30);
const start = flag("start") ?? "35.68075,139.76345";
const isMobile = argv.includes("--mobile");
/** A second either side of a moment. */
const AROUND_MS = 1000;
/** Thresholds for long frames (ms). */
const LONG_MS = [50, 100, 250] as const;
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

const PRELOAD = `
try { localStorage.setItem("tod.graphics", JSON.stringify({ shaderPrebuild: ${JSON.stringify(prebuild)} })); } catch {}
(() => {
  const S = (window.__sp = { frames: [], readyAt: null, compiled: null, skipped: false });
  for (const k of ["log", "info", "warn"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      const line = String(a[0] ?? "");
      if (line.includes('"event":"pipelines_compiled"')) { try { S.compiled = JSON.parse(line).durationMs; } catch {} }
      if (line.includes('"event":"pipelines_skipped"')) S.skipped = true;
      return orig(...a);
    };
  }
  const tick = (now) => {
    S.frames.push(now);
    ${COUNT_PIPELINES};
    if (S.readyAt === null && window.__game?.getState?.() === "ready") S.readyAt = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

type Page = {
  frames: number[];
  readyAt: number | null;
  compiled: number | null;
  skipped: boolean;
  pipelines?: { n: number; at: number[] };
};

/** Frame gaps (ms) whose frame ends within [from, to), the long ones counted, and the pipelines built then. */
export function windowStats(page: Page, from: number, to: number) {
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < page.frames.length; i++) {
    const t = page.frames[i];
    const isInside = t >= from && t < to;
    if (isInside) gaps.push([t, t - page.frames[i - 1]]);
  }
  const longest = gaps.reduce<[number, number] | null>((a, g) => (a === null || g[1] > a[1] ? g : a), null);
  const over = Object.fromEntries(LONG_MS.map((ms) => [`over${ms}`, gaps.filter(([, d]) => d > ms).length]));
  const built = (page.pipelines?.at ?? []).filter((t) => t >= from && t < to).length;
  return {
    frames: gaps.length,
    ...over,
    longestMs: longest ? Math.round(longest[1] * 10) / 10 : null,
    longestAtMs: longest ? Math.round(longest[0] - from) : null,
    pipelines: built,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261117`;
  const port = await freePort();
  const b = await launch("about:blank", { width: 1280, height: 720, port, preload: PRELOAD });
  try {
    if (isMobile) await b.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA });
    await b.send("Page.navigate", { url });
    for (let i = 0; i < 480; i++) {
      await b.sleep(250);
      if ((await b.evaluate("window.__game?.getState()").catch(() => null)) === "ready") break;
    }
    const now = () => b.evaluate<number>("performance.now()");
    const startAt = await b.evaluate<number>(
      "(() => { const t = performance.now(); window.__game.start(); return t; })()",
    );
    const dir = join(ROOT, ".qa", "shader-prebuild");
    mkdirSync(dir, { recursive: true });
    await b.sleep(2000);
    // 自動運転 once the car is on a street: asked again each second until it takes (the roads load
    // after start(); before them the game only toasts "roads loading").
    const POS = "(() => { const p = window.__game.vehicle.position(); return [p.x, p.z]; })()";
    const from = await b.evaluate<[number, number]>(POS);
    let autopilotAt: number | null = null;
    for (let i = 0; i < 20 && autopilotAt === null; i++) {
      await b.evaluate(
        "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }))",
      );
      await b.sleep(1000);
      const isOn = await b.evaluate<boolean>("!!window.__game.getAutopilot()");
      if (isOn) autopilotAt = (await now()) - startAt;
    }
    const toasts = await b.evaluate<string[]>(
      "[...document.querySelectorAll('.toast')].map((t) => t.textContent)",
    );
    const driveEnd = startAt + seconds * 1000;
    const left = driveEnd - (await now());
    if (left > 0) await b.sleep(left);
    const to = await b.evaluate<[number, number]>(POS);
    const movedM = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]));
    // The driver's seat after the drive (a broken or black cockpit is a stop, not a hitch). Why not
    // at once: a screenshot is a frame of its own in the drive's window.
    await b.screenshot(join(dir, `${label}.cockpit.jpg`), 85);
    await b.sleep(1500);
    // The first violation: debug.perf.violation books it after watching a second of frames.
    const violationCall = await now();
    const violation = await b.evaluate<Record<string, unknown>>(
      `window.__game.debug.perf.violation("signal", "photo", 3).then((r) => ({ booked: r.booked ?? null, error: r.error ?? null, post: r.post ?? null, afterLongestMs: r.after?.longest ?? null }))`,
    );
    const violationAt = violationCall + 1000;
    await b.screenshot(join(dir, `${label}.violation.jpg`), 85);
    await b.sleep(1500);
    const rainAt = await b.evaluate<number>(
      `(() => { const t = performance.now(); window.__game.env.weather = "rain"; return t; })()`,
    );
    await b.sleep(AROUND_MS + 1500);
    const raining = await b.evaluate<boolean>("window.__game.env.isRaining()");
    await b.screenshot(join(dir, `${label}.rain.jpg`), 85);
    const page = await b.evaluate<Page>("({ ...window.__sp, pipelines: window.__pipelines })");
    const around = (t: number) => windowStats(page, t - AROUND_MS, t + AROUND_MS);
    const summary = {
      label,
      prebuild,
      isMobile,
      start,
      readyAtMs: page.readyAt === null ? null : Math.round(page.readyAt),
      compiledMs: page.compiled,
      skipped: page.skipped,
      pipelinesBeforeStart: (page.pipelines?.at ?? []).filter((t) => t < startAt).length,
      autopilotAtMs: autopilotAt === null ? null : Math.round(autopilotAt),
      toasts: autopilotAt === null ? toasts : undefined,
      movedM,
      drive: windowStats(page, startAt, driveEnd),
      cockpit: around(startAt),
      violation: { ...around(violationAt), ...violation },
      rain: { ...around(rainAt), raining },
      pipelinesTotal: page.pipelines?.n ?? null,
    };
    writeFileSync(
      join(dir, `${label}.json`),
      `${JSON.stringify({ url, summary, startAt, violationAt, rainAt, frames: page.frames.map((t) => Math.round(t * 10) / 10) })}\n`,
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await b.close();
  }
}
