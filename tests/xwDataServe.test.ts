import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkServedData, folderDigest, servedMismatch } from "../scripts/qa/servedData";
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
    expect(request(dir, `${BASE}data/expressway/%E0`).status).toBe(404);
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

it("never reads a file beside the folder (an escaped ../ to a file that is there)", () => {
  const parent = mkdtempSync(join(tmpdir(), "xw-parent-"));
  writeFileSync(join(parent, "outside.json"), "{}");
  const dir = join(parent, "data");
  mkdirSync(dir);
  writeFileSync(join(dir, "meta.json"), "{}");
  expect(request(dir, `${BASE}data/expressway/..%2Foutside.json`).status).toBe(404);
  expect(request(dir, `${BASE}data/expressway/..%5Coutside.json`).status).toBe(404);
});

/** Two folders with the same meta.json over a tile that differs at the same size (s9/s10-base-default's shape). */
function twins() {
  const meta = JSON.stringify({ version: 6, tiles: ["14551-6452"], bytes: 9 });
  const a = folder({ "meta.json": meta, "14551-6452.json": '{"z":1.5}' });
  const b = folder({ "meta.json": meta, "14551-6452.json": '{"z":1.7}' });
  return { a, b };
}

/** A fake dev server over a folder: what fetch answers, the HTML fallback where the path is not served. */
function serverOf(dir: string, named: boolean) {
  return async (url: string) => {
    const path = url.slice("http://x/tokyo-od-game/".length);
    const isEndpoint = path === XW_DATA_ENDPOINT;
    if (isEndpoint)
      return named
        ? new Response(JSON.stringify({ dir, metaSha256: "" }), {
            headers: { "content-type": "application/json" },
          })
        : new Response("<html></html>", { headers: { "content-type": "text/html" } });
    try {
      return new Response(readFileSync(join(dir, path.replace("data/expressway/", ""))));
    } catch {
      return new Response("", { status: 404 });
    }
  };
}

describe("checkServedData (the tools' check of the served data)", () => {
  it("passes the same files, and names the served folder only when the server names it", async () => {
    const { a } = twins();
    const named = await checkServedData("http://x/tokyo-od-game/", serverOf(a, true), a);
    expect(named.servedDir).toBe(a);
    const fallback = await checkServedData("http://x/tokyo-od-game/", serverOf(a, false), a);
    expect(fallback.servedDir).toBeNull();
    expect(fallback.tilesSha256).toBe(named.tilesSha256);
  });

  it("refuses the same meta.json over other tiles (PR #132 review, M1)", async () => {
    const { a, b } = twins();
    expect(folderDigest(a).meta).toBe(folderDigest(b).meta);
    await expect(checkServedData("http://x/tokyo-od-game/", serverOf(b, true), a)).rejects.toThrow(
      /tile 14551-6452\.json/,
    );
  });

  it("refuses another meta.json, and a server that does not answer it", async () => {
    const { a } = twins();
    const other = folder({ "meta.json": JSON.stringify({ version: 6, tiles: [] }) });
    await expect(checkServedData("http://x/tokyo-od-game/", serverOf(other, true), a)).rejects.toThrow(
      /meta\.json/,
    );
    const down = async () => new Response("", { status: 502 });
    await expect(checkServedData("http://x/tokyo-od-game/", down, a)).rejects.toThrow(/HTTP 502/);
  });

  it("is what drive-deck.ts and street-drive.ts do before any drive", () => {
    for (const tool of ["drive-deck.ts", "street-drive.ts"]) {
      const code = readFileSync(join(import.meta.dirname, "..", "scripts", "qa", tool), "utf8");
      const check = code.indexOf("await checkServedData(base)");
      expect(check, tool).toBeGreaterThan(0);
      expect(code.indexOf("launch(url"), tool).toBeGreaterThan(check);
    }
  });
});

describe("servedMismatch", () => {
  it("passes the same digest and names the first file that differs", () => {
    const want = { dir: "/d", meta: "aa", tiles: { "1-2": "t1", "3-4": "t2" } };
    expect(servedMismatch({ meta: "aa", tiles: { "1-2": "t1", "3-4": "t2" } }, want)).toBeNull();
    expect(servedMismatch({ meta: "bb", tiles: {} }, want)).toMatch(/bb.*\/d\/meta\.json.*aa/);
    expect(servedMismatch({ meta: "aa", tiles: { "1-2": "t1", "3-4": "x" } }, want)).toMatch(
      /3-4\.json \(sha256 x\)/,
    );
    expect(servedMismatch({ meta: "aa", tiles: { "1-2": "t1" } }, want)).toMatch(/missing/);
  });
});
