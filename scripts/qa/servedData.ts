import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expresswayDataDir } from "../expresswayFiles.ts";
import { XW_DATA_ENDPOINT, type XwDataServed } from "../xwDataServe.ts";

/**
 * Which expressway data the dev server at `base` serves, checked against the folder this tool reads
 * (XW_DATA_DIR else public/data/expressway, scripts/expresswayFiles.ts), before a drive (R1-5 PR A).
 * The server and the tool are two processes: one started without the variable, or from another
 * worktree, would put the car on one build's runs while the tool reads another's.
 *
 * The check is the meta.json the page itself fetches (<base>data/expressway/meta.json), hashed and
 * compared with the tool's: it holds the tile index and the build's hash, so another build differs.
 * `<base>__xw-data` (scripts/xwDataServe.ts) names the served folder for the result files; a server
 * without XW_DATA_DIR has no such path (404) and serves its own public/data/expressway.
 * Why not compare the folders' names: a dev server from another worktree serves its own
 * public/data/expressway under the same name, and a copy of the folder there (R1-1b's way, still
 * allowed) is the same data under another name.
 */

export type ServedData = {
  /** The folder the server names (__xw-data), or null: its public/data/expressway. */
  servedDir: string | null;
  /** The folder this tool reads. */
  dir: string;
  metaSha256: string;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Why the served data is not the tool's (the hashes of the two meta.json), or null. */
export function servedMismatch(pageMeta: string, want: { dir: string; metaSha256: string }): string | null {
  const isSame = pageMeta === want.metaSha256;
  if (isSame) return null;
  return `the page's meta.json (sha256 ${pageMeta}) is not ${want.dir}/meta.json (${want.metaSha256}): the dev server serves other data (XW_DATA_DIR unset or different, another worktree, or a rebuilt folder)`;
}

/** The served data, or throws when it is not the folder this tool reads. */
export async function checkServedData(base: string): Promise<ServedData> {
  const dir = resolve(expresswayDataDir());
  const want = { dir, metaSha256: sha256(readFileSync(join(dir, "meta.json"))) };
  const answer = await fetch(`${base}${XW_DATA_ENDPOINT}`);
  // A server without the path may answer its index.html (Vite's HTML fallback), not a 404.
  const isAnswered = answer.ok && (answer.headers.get("content-type") ?? "").startsWith("application/json");
  const served = isAnswered ? ((await answer.json()) as XwDataServed) : null;
  const meta = await fetch(`${base}data/expressway/meta.json`);
  if (!meta.ok) throw new Error(`${base}data/expressway/meta.json: HTTP ${meta.status}`);
  const pageMeta = sha256(new Uint8Array(await meta.arrayBuffer()));
  const why = servedMismatch(pageMeta, want);
  if (why !== null) throw new Error(why);
  return { servedDir: served?.dir ?? null, dir, metaSha256: pageMeta };
}
