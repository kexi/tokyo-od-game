// The JS heap after a forced GC and the array storage outside it, on any build, the public one
// included: nothing here reads window.__game (production builds strip it). How: the page is opened at
// 東京駅 with the view distance set before load (localStorage tod.graphics), the title's start button
// is clicked, then the autopilot key is sent as a player would press it; every second the page adds
// up the distance from the speedometer's readout (km/h), and every EVERY seconds the heap is read
// after HeapProfiler.collectGarbage. A car stopped for STUCK seconds gets the autopilot again (off and
// on when it is still on), and a modal dialog (a ticket) is closed with Esc so the keys reach the car.
// Why not the warp loop of memory-buildings.ts: it calls debug.roads.warp, which only a DEV build has.
// Why the distance from the readout and not the car's position: that too is only on __game.
//
//   pnpm exec tsx scripts/qa/memory-plain.ts --label L --base URL [--seconds 1200] [--every 10]
//     [--view far] [--still] [--stuck 30]
//
// --still starts the game and leaves the car where it is (the stopped comparison of the town's
// array storage). Output: one JSON line a sample on stdout and .qa/memory-plain/<label>.json.
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
const base = flag("base") ?? "http://localhost:4174/tokyo-od-game/";
const seconds = Number(flag("seconds") ?? 1200);
const every = Number(flag("every") ?? 10);
const view = flag("view") ?? "far";
const isStill = argv.includes("--still");
const stuckS = Number(flag("stuck") ?? 30);
const url = `${base}?start=35.6812,139.7671&time=day&weather=clear&seed=20261115`;
const preload = `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}`;
/** The autopilot's key in either layout (City Car Driving's A, WASD's J): sent until its chip shows. */
const AUTOPILOT_KEYS = [
  { code: "KeyA", key: "a", windowsVirtualKeyCode: 65 },
  { code: "KeyJ", key: "j", windowsVirtualKeyCode: 74 },
];

/** Page-side: distance from the speedometer every second, how long the car has been at 0, the place shown. */
const WATCH = `(() => {
  if (window.__plain) return;
  const p = (window.__plain = { km: 0, stillS: 0, kmh: 0, last: performance.now() });
  setInterval(() => {
    const now = performance.now();
    const kmh = Number(document.querySelector("#hud-speed .readout")?.textContent ?? 0) || 0;
    p.km += (kmh * (now - p.last)) / 3_600_000;
    p.stillS = kmh < 1 ? p.stillS + (now - p.last) / 1000 : 0;
    p.kmh = kmh;
    p.last = now;
  }, 1000);
})()`;
const READ = `(() => {
  const p = window.__plain;
  const text = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
  return { km: Math.round(p.km * 1000) / 1000, kmh: p.kmh, stillS: Math.round(p.stillS),
    autopilot: document.querySelector("#autopilot-chip")?.hidden === false,
    dialog: document.querySelector("dialog:modal")?.id ?? null, ward: text("#ward"), town: text("#town") };
})()`;

const mb = (bytes: unknown) => (bytes == null ? null : Math.round(Number(bytes) / 1e6));
const outDir = join(ROOT, ".qa", "memory-plain");
mkdirSync(outDir, { recursive: true });
const port = await freePort();
const b = await launch("about:blank", { width: 1280, height: 720, port, preload });
const samples: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];
let failure: string | null = null;

const press = async (k: { code: string; key: string; windowsVirtualKeyCode: number }) => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
};
const read = () => b.evaluate<Record<string, unknown>>(READ);
/** What the page says back (the toasts: 道路を読み込み中, 目的地なし…), for the record of a key that did nothing. */
const toasts = () => b.evaluate<string>(`document.querySelector("#toasts")?.textContent?.trim() ?? ""`);
/**
 * Presses the autopilot key until its chip shows, for up to `waitS` seconds; false when no key turned
 * it on. Why retry: right after the start the streets may still be loading (the key then only says so).
 */
const autopilotOn = async (waitS = 120): Promise<boolean> => {
  const until = Date.now() + waitS * 1000;
  while (Date.now() < until) {
    for (const k of AUTOPILOT_KEYS) {
      await press(k);
      await b.sleep(1500);
      const isOn = (await read()).autopilot === true;
      if (isOn) return true;
      events.push({ event: "autopilot_key_ignored", code: k.code, toasts: await toasts() });
    }
    await b.sleep(5000);
  }
  return false;
};

try {
  await b.send("Page.navigate", { url });
  let isStartable = false;
  for (let i = 0; i < 240 && !isStartable; i++) {
    await b.sleep(1000);
    isStartable =
      (await b
        .evaluate<boolean>(`document.querySelector("#start")?.disabled === false`)
        .catch(() => false)) === true;
  }
  if (!isStartable) throw new Error("the start button never became enabled");
  await b.evaluate(`document.querySelector("#start").click()`);
  await b.sleep(8000);
  const isHudShown = await b.evaluate<boolean>(`document.querySelector("#hud")?.hidden === false`);
  events.push({ event: "started", isHudShown });
  await b.evaluate(WATCH);
  if (!isStill) {
    const isOn = await autopilotOn();
    events.push({ t: 0, event: "autopilot_key", isOn });
    if (!isOn) throw new Error("no autopilot key turned the autopilot on");
  }
  const t0 = Date.now();
  let nextSample = every;
  while (Date.now() - t0 < seconds * 1000) {
    await b.sleep(1000);
    const t = Math.round((Date.now() - t0) / 1000);
    const state = await read();
    if (!isStill && state.dialog) {
      await press({ code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
      events.push({ t, event: "dialog_closed", dialog: state.dialog });
    }
    const isStuck = !isStill && Number(state.stillS) >= stuckS;
    if (isStuck) {
      if (state.autopilot) await press(AUTOPILOT_KEYS[0]).then(() => b.sleep(500));
      const isOn = await autopilotOn();
      events.push({ t, event: "restarted", isOn, km: state.km, ward: state.ward, town: state.town });
      await b.evaluate("window.__plain.stillS = 0");
    }
    if (t < nextSample) continue;
    nextSample = t + every;
    await b.send("HeapProfiler.collectGarbage");
    const usage = (await b.send("Runtime.getHeapUsage")).result;
    const sample = {
      t,
      heapGcMB: mb(usage.usedSize),
      backingMB: mb(usage.backingStorageSize),
      ...(await read()),
    };
    samples.push(sample);
    process.stdout.write(`${JSON.stringify(sample)}\n`);
  }
} catch (error) {
  failure = String(error);
  process.stdout.write(`${JSON.stringify({ failure })}\n`);
} finally {
  await b.close();
}
const out = {
  label,
  base,
  url,
  at: new Date().toISOString(),
  view,
  isStill,
  every,
  stuckS,
  failure,
  events,
  samples,
};
writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
