// Minimal headless-Chrome driver over the DevTools Protocol (Node's built-in WebSocket), for the
// QA scripts. Each run uses a throwaway profile that is deleted afterwards: profiles cache
// hundreds of MB of map tiles (90 left behind once filled the disk with 35 GB).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launch(url, { port = 9334, width = 1280, height = 800 } = {}) {
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
    new Promise((r) => {
      const mid = ++id;
      pending.set(mid, r);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  // The exact viewport (the headless window's own chrome would take some height): even sizes
  // also keep the teaser's frames encodable.
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails)
      throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return res.result?.result?.value;
  };
  const screenshot = async (file, quality = 75) => {
    const res = await send("Page.captureScreenshot", { format: "jpeg", quality });
    writeFileSync(file, Buffer.from(res.result.data, "base64"));
    return file;
  };
  const close = async () => {
    ws.close();
    chrome.kill();
    await new Promise((r) => chrome.once("exit", r));
    rmSync(profile, { recursive: true, force: true });
  };
  return { evaluate, screenshot, sleep, logs, close };
}
