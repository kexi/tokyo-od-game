import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freePort } from "../scripts/qa/ports";

/**
 * scripts/qa/browser.mjs launch() when Chrome does not offer its page. What this guarantees: launch
 * fails, tries once more, and leaves no child behind (a Chrome left running kept drive-deck.ts alive
 * after its results and loaded the machine for the other QA runs).
 */

type Launch = (url: string, options?: { port?: number; startMs?: number }) => Promise<unknown>;

/** browser.mjs reads CHROME as it loads: load it afresh with `chrome`. */
async function launchWith(chrome: string): Promise<Launch> {
  vi.stubEnv("CHROME", chrome);
  vi.resetModules();
  const mod = (await import("../scripts/qa/browser.mjs")) as { launch: Launch };
  return mod.launch;
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("QA's launch when Chrome does not start (scripts/qa/browser.mjs)", () => {
  it("fails at once for a command that cannot run", async () => {
    const launch = await launchWith("/nonexistent/chrome");
    const started = Date.now();
    await expect(launch("about:blank", { port: await freePort() })).rejects.toThrow("Chrome did not start");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops a Chrome that offers no page in time, tries one more, and leaves neither running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-launch-"));
    dirs.push(dir);
    const pids = join(dir, "pids");
    // A "Chrome" that runs and never opens its DevTools port.
    const fake = join(dir, "chrome.sh");
    writeFileSync(fake, `#!/bin/sh\necho $$ >> "${pids}"\nexec sleep 600\n`);
    chmodSync(fake, 0o755);
    const launch = await launchWith(fake);
    await expect(launch("about:blank", { port: await freePort(), startMs: 600 })).rejects.toThrow(
      "Chrome did not start",
    );
    const started = readFileSync(pids, "utf8").trim().split("\n").map(Number);
    expect(started).toHaveLength(2);
    expect(started.filter(isAlive)).toEqual([]);
  });
});
