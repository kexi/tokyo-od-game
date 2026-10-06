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
export async function launch(url, { port = 9334, width = 1280, height = 800, preload = null } = {}) {
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
      "about:blank",
    ],
    { stdio: "ignore" },
  );
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
  const failPending = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  ws.addEventListener("close", (event) =>
    failPending(new Error(`CDP connection closed (${event.code}): ${event.reason}`)),
  );
  ws.addEventListener("error", () => failPending(new Error("CDP connection failed")));
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
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
    new Promise((resolve, reject) => {
      const isOpen = ws.readyState === WebSocket.OPEN;
      if (!isOpen) {
        reject(new Error("CDP connection is not open"));
        return;
      }
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id: mid, method, params }));
      } catch (error) {
        pending.delete(mid);
        reject(error);
      }
    });
  await send("Runtime.enable");
  await send("Page.enable");
  // The exact viewport (the headless window's own chrome would take some height): even sizes
  // also keep the teaser's frames encodable.
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
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
    const isRunning = chrome.exitCode === null && chrome.signalCode === null;
    if (isRunning) await new Promise((r) => chrome.once("exit", r));
    rmSync(profile, { recursive: true, force: true });
  };
  return { evaluate, screenshot, sleep, logs, close, send };
}
