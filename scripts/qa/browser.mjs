// Minimal headless-Chrome driver over the DevTools Protocol (Node's built-in WebSocket), for the
// QA scripts. Each run uses a throwaway profile that is deleted afterwards: profiles cache
// hundreds of MB of map tiles (90 left behind once filled the disk with 35 GB).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Open `url` in a fresh headless Chrome. `preload` is page-side JS run in every document before the
 * page's own scripts (Page.addScriptToEvaluateOnNewDocument): the teaser's virtual clock.
 */
/**
 * The Chromes this process started and has not closed. A run that ends another way than close() (an
 * exception past its finally, a timeout's or a stop's SIGTERM, Ctrl-C) used to leave its headless
 * Chrome running for hours, on its GPU and memory (three were found 10–12 h old, S6 PR 7c): they are
 * killed when the process exits or is told to. Why not detach and leave it to the OS: a headless
 * Chrome does not die with its parent. A SIGKILL still leaves one behind (nothing runs then).
 */
const live = new Set();
let isReaperInstalled = false;
function installReaper() {
  if (isReaperInstalled) return;
  isReaperInstalled = true;
  const reap = () => {
    for (const c of live) c.kill();
    live.clear();
  };
  process.on("exit", reap);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ])
    process.on(signal, () => {
      reap();
      process.exit(code);
    });
}

/**
 * How long one DevTools call may take before it fails (ms). A page whose promise never settles (the
 * game waiting on a tileset whose fetch failed: PLATEAU's root tileset over a flaky network, S6 PR
 * 7c's drives hung 80 min on `__game.advance`) used to hang its caller for good.
 */
export const CALL_TIMEOUT_MS = 180_000;

/**
 * Page-side: speechSynthesis that speaks to no one. `--mute-audio` does not reach it: on macOS
 * Chrome's browser process speaks through the OS synthesiser and opens the speakers itself (seen
 * in `pmset -g assertions` with the flag on). speak() queues the utterance as the real one would,
 * fires `start`, then `end` after about as long as the line would take (callers that wait on `end`,
 * naviTv's newsreader, go on), and `speaking` / `pending` / cancel() follow the queue (cancel()
 * fires `error` as Chrome does: `interrupted` for the line being read, `canceled` behind it). Why not
 * utterance.volume = 0 on the real one: the OS synthesiser would still run (and with headless
 * Chrome's voices that come and go, its timing would be the OS's, not the page's).
 * Serialised into the page with addScriptToEvaluateOnNewDocument, so it uses nothing from here.
 */
export function quietSpeech() {
  const synth = globalThis.speechSynthesis;
  const hasSpeech = synth !== undefined;
  if (!hasSpeech) return;
  const nativeCancel = synth.cancel.bind(synth);
  const queue = [];
  let current = null;
  let timer = null;
  const fire = (u, type) => {
    const hasEvent = typeof SpeechSynthesisEvent === "function";
    u.dispatchEvent(hasEvent ? new SpeechSynthesisEvent(type, { utterance: u }) : new Event(type));
  };
  const fail = (u, error) => {
    const hasEvent = typeof SpeechSynthesisErrorEvent === "function";
    const event = hasEvent
      ? new SpeechSynthesisErrorEvent("error", { utterance: u, error })
      : new Event("error");
    u.dispatchEvent(event);
  };
  const next = () => {
    current = queue.shift() ?? null;
    if (!current) return;
    const u = current;
    setTimeout(() => {
      const wasCanceled = current !== u;
      if (wasCanceled) return;
      fire(u, "start");
      // About 8 characters a second at rate 1, as the OS voices read Japanese.
      const ms = Math.max(200, (String(u.text).length * 125) / (u.rate || 1));
      timer = setTimeout(() => {
        const wasCanceled = current !== u;
        if (wasCanceled) return;
        fire(u, "end");
        next();
      }, ms);
    }, 0);
  };
  Object.defineProperty(synth, "speaking", { configurable: true, get: () => current !== null });
  Object.defineProperty(synth, "pending", { configurable: true, get: () => queue.length > 0 });
  synth.speak = (u) => {
    queue.push(u);
    const isIdle = current === null;
    if (isIdle) next();
  };
  synth.cancel = () => {
    const speaking = current;
    const queued = [...queue];
    queue.length = 0;
    current = null;
    clearTimeout(timer);
    // As Chrome does: the line being read is interrupted, the ones behind it canceled.
    if (speaking) setTimeout(() => fail(speaking, "interrupted"), 0);
    for (const u of queued) setTimeout(() => fail(u, "canceled"), 0);
    nativeCancel();
  };
}

export async function launch(
  url,
  { port = 9334, width = 1280, height = 800, preload = null, callTimeoutMs = CALL_TIMEOUT_MS } = {},
) {
  // A Chrome left behind on the port (a run that crashed) would answer instead of the new one.
  const isTaken = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then(() => true)
    .catch(() => false);
  if (isTaken) throw new Error(`port ${port} is already in use (an earlier Chrome still running?)`);
  const profile = mkdtempSync(join(tmpdir(), "tokyo-qa-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "--enable-gpu",
      "--use-angle=metal",
      "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required",
      // Silent: QA runs (several at once, for hours) played the engine, effects and sirens out of
      // the Mac's speakers. Why not drop the autoplay flag instead: the AudioContext would then stay
      // suspended and the game's sound graph (spatialAudio's nodes and timers) would take another
      // path than a player's. Muting cuts the output alone; everything the tests read runs as is.
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  installReaper();
  live.add(chrome);
  chrome.once("exit", () => live.delete(chrome));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === "page"); i++) {
    targets = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json())
      .catch(() => []);
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome did not start (set CHROME to its path)");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.push(
        `[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
      );
    }
  });
  const send = (method, params = {}) =>
    new Promise((r, reject) => {
      const mid = ++id;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error(`DevTools ${method} took over ${callTimeoutMs} ms (the page never answered)`));
      }, callTimeoutMs);
      pending.set(mid, (msg) => {
        clearTimeout(timer);
        r(msg);
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  // The exact viewport (the headless window's own chrome would take some height): even sizes
  // also keep the teaser's frames encodable.
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${quietSpeech})();` });
  if (preload) await send("Page.addScriptToEvaluateOnNewDocument", { source: preload });
  await send("Page.navigate", { url });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails)
      throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return res.result?.result?.value;
  };
  /** A .png file is written losslessly (the share card is cut from it); anything else as JPEG. */
  const screenshot = async (file, quality = 75) => {
    const isPng = file.endsWith(".png");
    const res = await send("Page.captureScreenshot", isPng ? { format: "png" } : { format: "jpeg", quality });
    writeFileSync(file, Buffer.from(res.result.data, "base64"));
    return file;
  };
  const close = async () => {
    ws.close();
    chrome.kill();
    await new Promise((r) => chrome.once("exit", r));
    rmSync(profile, { recursive: true, force: true });
  };
  return { evaluate, screenshot, sleep, logs, close, send };
}
