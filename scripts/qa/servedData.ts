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
 * The check is every file the page itself fetches: meta.json and each tile it lists, from the
 * server, hashed and compared with the tool's own. Why the tiles too: meta.json holds the tile index,
 * the counts and the bytes, no hash of the build, and two builds whose heights alone differ have the
 * same one (s9-base-default and s10-base-default: one meta.json, tiles 14551-6452 and 14552-6455
 * differ at the same sizes; PR #132 review, M1).
 * `<base>__xw-data` (scripts/xwDataServe.ts) names the served folder for the result files; a server
 * without XW_DATA_DIR has no such path and serves its own public/data/expressway.
 * Why not compare the folders' names: a dev server from another worktree serves its own
 * public/data/expressway under the same name, and a copy of the folder there (R1-1b's way, still
 * allowed) is the same data under another name.
 */

/** SHA-256 (hex) of meta.json and of each tile it lists, by tile key. */
export type DataDigest = { meta: string; tiles: Record<string, string> };

export type ServedData = {
  /** The folder the server names (__xw-data), or null: its public/data/expressway. */
  servedDir: string | null;
  /** The folder this tool reads. */
  dir: string;
  metaSha256: string;
  /** SHA-256 of the tiles' hashes in meta's order: one value for the whole data, for the results. */
  tilesSha256: string;
};

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** The tile keys a meta.json lists. */
const tileKeys = (meta: Uint8Array) =>
  (JSON.parse(Buffer.from(meta).toString("utf8")) as { tiles: string[] }).tiles;

/** The digest of a folder on disk. */
export function folderDigest(dir: string): DataDigest {
  const meta = readFileSync(join(dir, "meta.json"));
  const tiles: Record<string, string> = {};
  for (const key of tileKeys(meta)) tiles[key] = sha256(readFileSync(join(dir, `${key}.json`)));
  return { meta: sha256(meta), tiles };
}

/** One hash for the whole data (meta and tiles in meta's order). */
export const digestSha256 = (d: DataDigest) =>
  sha256(
    Object.entries(d.tiles)
      .map(([k, v]) => `${k}:${v}`)
      .join("\n"),
  );

/** Why the served data is not the tool's (the first file that differs), or null. */
export function servedMismatch(page: DataDigest, want: DataDigest & { dir: string }): string | null {
  const isOtherMeta = page.meta !== want.meta;
  if (isOtherMeta)
    return `the page's meta.json (sha256 ${page.meta}) is not ${want.dir}/meta.json (${want.meta}): the dev server serves other data (XW_DATA_DIR unset or different, another worktree, or a rebuilt folder)`;
  for (const [key, sha] of Object.entries(want.tiles)) {
    const isOtherTile = page.tiles[key] !== sha;
    if (isOtherTile)
      return `the page's tile ${key}.json (sha256 ${page.tiles[key] ?? "missing"}) is not ${want.dir}/${key}.json (${sha}): the same meta.json over other tiles, another build`;
  }
  return null;
}

type Fetch = (url: string) => Promise<Response>;

/** The bytes of `url`, or throws on an HTTP failure. */
async function bytesOf(fetchFn: Fetch, url: string): Promise<Uint8Array> {
  const answer = await fetchFn(url);
  const isFailed = !answer.ok;
  if (isFailed) throw new Error(`${url}: HTTP ${answer.status}`);
  return new Uint8Array(await answer.arrayBuffer());
}

/** The served data, or throws when it is not the folder this tool reads. */
export async function checkServedData(
  base: string,
  fetchFn: Fetch = fetch,
  dir = resolve(expresswayDataDir()),
): Promise<ServedData> {
  const want = { ...folderDigest(dir), dir };
  const answer = await fetchFn(`${base}${XW_DATA_ENDPOINT}`);
  // A server without the path may answer its index.html (Vite's HTML fallback), not a 404.
  const isAnswered = answer.ok && (answer.headers.get("content-type") ?? "").startsWith("application/json");
  const served = isAnswered ? ((await answer.json()) as XwDataServed) : null;
  const meta = await bytesOf(fetchFn, `${base}data/expressway/meta.json`);
  const page: DataDigest = { meta: sha256(meta), tiles: {} };
  // The tiles only once the meta is the same: another meta lists other tiles, which would 404.
  const isSameMeta = page.meta === want.meta;
  for (const key of isSameMeta ? Object.keys(want.tiles) : []) {
    const tile = await fetchFn(`${base}data/expressway/${key}.json`);
    page.tiles[key] = tile.ok ? sha256(new Uint8Array(await tile.arrayBuffer())) : `HTTP ${tile.status}`;
  }
  const why = servedMismatch(page, want);
  const isMismatch = why !== null;
  if (isMismatch) throw new Error(why);
  return { servedDir: served?.dir ?? null, dir, metaSha256: page.meta, tilesSha256: digestSha256(page) };
}
