import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { servedMismatch } from "../scripts/qa/servedData";
import { servedDataDir, XW_DATA_ENDPOINT, xwDataMiddleware, xwDataServe } from "../scripts/xwDataServe";

// The dev server's data/expressway from XW_DATA_DIR's folder (R1-5 PR A): without the variable, and
// under vitest, the plugin adds nothing, so the server is as before and the data tests (run with
// XW_DATA_DIR) are untouched; with it, the folder's files and only them are served, and the tools
// can tell which data the page gets.

const BASE = "/tokyo-od-game/";

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xw-serve-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** A fake dev server: its base and the middlewares the plugin adds. */
function fakeServer() {
  const use = vi.fn();
  return { server: { config: { base: BASE }, middlewares: { use } }, use };
}

function configure(env: NodeJS.ProcessEnv) {
  const plugin = xwDataServe("/repo", env);
  const { server, use } = fakeServer();
  (plugin.configureServer as (s: unknown) => void)(server);
  return { plugin, use };
}

/** One request through the middleware: status, headers, body, and whether it passed it on. */
function request(dir: string, url: string) {
  const headers: Record<string, string> = {};
  let body: Buffer | string | undefined;
  const res = {
    statusCode: 200,
    setHeader: (k: string, v: string) => (headers[k] = v),
    end: (b?: Buffer | string) => (body = b),
  } as unknown as ServerResponse;
  let passed = false;
  xwDataMiddleware(dir, BASE)({ url } as IncomingMessage, res, () => (passed = true));
  return { status: res.statusCode, headers, body, passed };
}

describe("xwDataServe (the dev server's expressway data from XW_DATA_DIR)", () => {
  it("serves nothing of its own without XW_DATA_DIR, or under vitest even with it", () => {
    expect(servedDataDir({}, "/repo")).toBeNull();
    expect(servedDataDir({ XW_DATA_DIR: "" }, "/repo")).toBeNull();
    expect(servedDataDir({ XW_DATA_DIR: "/x", VITEST: "true" }, "/repo")).toBeNull();
    expect(configure({}).use).not.toHaveBeenCalled();
    expect(configure({ XW_DATA_DIR: "/nowhere", VITEST: "true" }).use).not.toHaveBeenCalled();
  });

  it("is the dev server's only: no build, preview or transform hooks", () => {
    const { plugin } = configure({});
    expect(plugin.apply).toBe("serve");
    expect(Object.keys(plugin).toSorted()).toEqual(["apply", "configureServer", "name"]);
  });

  it("takes the folder relative to the project, and refuses one with no meta.json", () => {
    expect(servedDataDir({ XW_DATA_DIR: ".cache/expressway-area/a" }, "/repo")).toBe(
      resolve("/repo/.cache/expressway-area/a"),
    );
    const empty = folder({});
    expect(() => configure({ XW_DATA_DIR: empty })).toThrow(/no meta\.json/);
    const dir = folder({ "meta.json": "{}" });
    expect(configure({ XW_DATA_DIR: dir }).use).toHaveBeenCalledTimes(1);
  });

  it("answers data/expressway from the folder, a file it has not with 404, anything else passed on", () => {
    const dir = folder({ "meta.json": '{"v":6}', "533945-394.json": '{"chunks":[]}', "LICENSE.txt": "ODbL" });
    mkdirSync(join(dir, "sub"));
    const meta = request(dir, `${BASE}data/expressway/meta.json?t=1`);
    expect(meta.passed).toBe(false);
    expect(String(meta.body)).toBe('{"v":6}');
    expect(meta.headers["Content-Type"]).toBe("application/json");
    expect(String(request(dir, `${BASE}data/expressway/533945-394.json`).body)).toBe('{"chunks":[]}');
    expect(request(dir, `${BASE}data/expressway/LICENSE.txt`).headers["Content-Type"]).toMatch(
      /^text\/plain/,
    );
    // Why 404 and not public/'s file: the folder's meta lists its own tiles.
    expect(request(dir, `${BASE}data/expressway/ledger.json`).status).toBe(404);
    expect(request(dir, `${BASE}data/expressway/..%2Fmeta.json`).status).toBe(404);
    expect(request(dir, `${BASE}data/expressway/sub`).status).toBe(404);
    expect(request(dir, `${BASE}data/roadlanes/x.json`).passed).toBe(true);
    expect(request(dir, `${BASE}src/main.ts`).passed).toBe(true);
  });

  it("names the folder and its meta.json's SHA-256 at __xw-data", () => {
    const dir = folder({ "meta.json": '{"v":6}' });
    const answer = request(dir, `${BASE}${XW_DATA_ENDPOINT}`);
    const sha = createHash("sha256").update('{"v":6}').digest("hex");
    expect(JSON.parse(String(answer.body))).toEqual({ dir, metaSha256: sha });
  });
});

describe("servedMismatch (the tools' check of the served data)", () => {
  it("passes the same meta.json and names both when they differ", () => {
    expect(servedMismatch("aa", { dir: "/d", metaSha256: "aa" })).toBeNull();
    expect(servedMismatch("bb", { dir: "/d", metaSha256: "aa" })).toMatch(/bb.*\/d\/meta\.json.*aa/);
  });
});
