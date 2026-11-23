import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { log } from "../src/log.ts";

/**
 * The dev server's expressway data from a measurement folder (P2.7 R1-5 PR A): with XW_DATA_DIR set,
 * `<base>data/expressway/<file>` is answered from that folder (the same variable the tools read with
 * scripts/expresswayFiles.ts), and `<base>__xw-data` answers which folder it is and the SHA-256 of its
 * meta.json, so a tool can refuse to drive when the server serves other data than it reads
 * (scripts/qa/servedData.ts).
 *
 * Only the dev server (`vite`, `just serve-dev`): not `vite build` (apply "serve"), not `vite preview`
 * (`just serve-qa-bundle` serves dist-qa's copy of public/data/expressway, as before), not vitest
 * (which calls configureServer too, measured: the data tests run with XW_DATA_DIR set and must not
 * read or log anything here). Without the variable the plugin adds nothing: the server is as it was.
 *
 * Why not copy the folder into another worktree's public/data/expressway (R1-1b's r1b_qa_setup2.sh,
 * 7c1): the copy is forgotten or left behind, and 7c1 put both back by hand.
 * Why a file missing from the folder is a 404 and not public/'s file: the folder's meta.json lists its
 * own tiles, and a default tile filling in for one would mix two builds in one drive.
 */

/** The path under the base that answers which folder is served. */
export const XW_DATA_ENDPOINT = "__xw-data";
const DATA_PREFIX = "data/expressway/";
/** A file name in the folder: one path segment, no `..`. */
const FILE_NAME = /^[\w-][\w.-]*$/;

export type XwDataServed = { dir: string; metaSha256: string };

/**
 * The folder the dev server serves its expressway data from, absolute, or null when it serves
 * public/data/expressway as ever (no XW_DATA_DIR) or runs under vitest.
 */
export function servedDataDir(env: NodeJS.ProcessEnv, root: string): string | null {
  const isTest = Boolean(env.VITEST);
  if (isTest) return null;
  const dir = env.XW_DATA_DIR;
  const isUnset = dir === undefined || dir === "";
  if (isUnset) return null;
  return resolve(root, dir);
}

/** SHA-256 (hex) of a folder's meta.json. */
export function metaSha256(dir: string): string {
  return createHash("sha256")
    .update(readFileSync(join(dir, "meta.json")))
    .digest("hex");
}

const contentType = (name: string) =>
  name.endsWith(".json")
    ? "application/json"
    : name.endsWith(".txt")
      ? "text/plain; charset=utf-8"
      : "application/octet-stream";

/** The middleware serving `dir` under `base` (see the module's comment). */
export function xwDataMiddleware(dir: string, base: string) {
  const prefix = `${base}${DATA_PREFIX}`;
  const endpoint = `${base}${XW_DATA_ENDPOINT}`;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split("?")[0] ?? "";
    const isEndpoint = path === endpoint;
    if (isEndpoint) {
      const served: XwDataServed = { dir, metaSha256: metaSha256(dir) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(served));
      return;
    }
    const isData = path.startsWith(prefix);
    if (!isData) return next();
    const name = decodeURIComponent(path.slice(prefix.length));
    const file = join(dir, name);
    const isServable = FILE_NAME.test(name) && existsSync(file) && statSync(file).isFile();
    if (!isServable) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", contentType(name));
    res.setHeader("Cache-Control", "no-cache");
    res.end(readFileSync(file));
  };
}

export function xwDataServe(root: string, env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: "xw-data-serve",
    apply: "serve",
    configureServer(server) {
      const dir = servedDataDir(env, root);
      if (dir === null) return;
      const hasMeta = existsSync(join(dir, "meta.json"));
      if (!hasMeta) throw new Error(`XW_DATA_DIR ${dir} has no meta.json`);
      server.middlewares.use(xwDataMiddleware(dir, server.config.base));
      log("xw_data_served", { dir, metaSha256: metaSha256(dir) });
    },
  };
}
