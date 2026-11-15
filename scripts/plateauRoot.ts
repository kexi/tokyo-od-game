// The root tileset joining the prefectures' PLATEAU buildings (src/world/plateauRoot.ts), written to
// public/data/plateau/tileset.json from PLATEAU_SOURCES and the gated prefectures' roots, read from
// the service: their municipalities' regions become the gates. The file is committed, so the build
// and CI never fetch. `--check` writes nothing: it reads the four prefecture tilesets and fails
// (exit 1) when one is not 200 with CORS `*`, its geometricError is coarser than the root's, a
// municipality's region leaves the prefecture's box, a municipality's tileset is not open data
// (`_op_` in its URI), or a gated prefecture's municipalities' regions are no longer the bundled
// gate (the signal to run `just make-plateau-root` again); it logs each prefecture's municipality
// codes.
// Run: pnpm exec tsx scripts/plateauRoot.ts [--check]   (just make-plateau-root / check-plateau-root)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { PLATEAU_SOURCES } from "../src/config.ts";
import { log } from "../src/log.ts";
import {
  gatesOf,
  normalizeGate,
  plateauRootText,
  ROOT_GEOMETRIC_ERROR,
  type DegreeBox,
  type PlateauSource,
  type Region,
  type RootTileset,
} from "../src/world/plateauRoot.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "data", "plateau", "tileset.json");
// Any origin will do: the check is whether the service answers a cross-origin page with `*`.
const ORIGIN = "http://localhost";

type RemoteTile = {
  boundingVolume?: { region?: number[] };
  geometricError?: number;
  content?: { uri?: string };
  children?: RemoteTile[];
};
type RemoteTileset = { geometricError?: number; root?: RemoteTile };

const toDegrees = (rad: number) => (rad * 180) / Math.PI;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The region's west, south, east, north in degrees, or null when the tile has no region. */
function regionDegrees(tile: RemoteTile): number[] | null {
  const region = tile.boundingVolume?.region;
  const hasRegion = Array.isArray(region) && region.length >= 4;
  if (!hasRegion) return null;
  return region.slice(0, 4).map(toDegrees);
}

function isInside(deg: number[] | null, box: DegreeBox): boolean {
  if (!deg) return false;
  const [west, south, east, north] = deg;
  return west >= box.west && south >= box.south && east <= box.east && north <= box.north;
}

/** The 5-digit municipality code a PLATEAU tileset URI's file folder starts with ("14130_…"). */
function municipalityCode(uri: string): string {
  const folder = uri.split("/").at(-2) ?? "";
  return /^(\d{5})_/.exec(folder)?.[1] ?? "?";
}

/** A prefecture root as the service serves it now. */
async function fetchSource(source: PlateauSource) {
  const res = await fetch(source.url, { headers: { Origin: ORIGIN } });
  const cors = res.headers.get("access-control-allow-origin") ?? "";
  const body = res.ok ? ((await res.json()) as RemoteTileset) : {};
  return { status: res.status, cors, body };
}

/** A gated prefecture's gate: its municipalities' regions, in the gate's fixed order. */
function gateOf(body: RemoteTileset): Region[] {
  const regions = (body.root?.children ?? []).map((c) => c.boundingVolume?.region ?? []);
  return normalizeGate(regions.filter((r) => r.length === 6));
}

const sameGate = (a: readonly Region[], b: readonly Region[]) => JSON.stringify(a) === JSON.stringify(b);

async function checkSource(source: PlateauSource, bundled: readonly Region[] | undefined): Promise<boolean> {
  const { status, cors, body } = await fetchSource(source);
  const root = body.root ?? {};
  const children = root.children ?? [];
  const geometricError = Math.max(body.geometricError ?? 0, root.geometricError ?? 0);
  const rootDeg = regionDegrees(root);
  const uris = children.map((c) => c.content?.uri ?? "");
  const outside = children
    .filter((c) => !isInside(regionDegrees(c), source.box))
    .map((c) => c.content?.uri ?? "");
  const notOpen = uris.filter((u) => !u.includes("_op_"));
  const notTileset = uris.filter((u) => !/^https:\/\/.+tileset\.json$/.test(u));
  const problems: string[] = [];
  const isNotOk = status !== 200;
  if (isNotOk) problems.push(`HTTP ${status}`);
  const isNotCors = cors !== "*";
  if (isNotCors) problems.push(`access-control-allow-origin "${cors}"`);
  const isCoarserThanRoot = geometricError > ROOT_GEOMETRIC_ERROR;
  if (isCoarserThanRoot) problems.push(`geometricError ${geometricError} > ${ROOT_GEOMETRIC_ERROR}`);
  const isRootOutside = !isInside(rootDeg, source.box);
  if (isRootOutside) problems.push("the prefecture's region leaves its box");
  for (const u of outside) problems.push(`outside the box: ${u}`);
  for (const u of notOpen) problems.push(`not open data (no _op_): ${u}`);
  for (const u of notTileset) problems.push(`not an https tileset.json: ${u}`);
  const isEmpty = children.length === 0;
  if (isEmpty) problems.push("no municipalities");
  const isGateStale = source.gated && !sameGate(gateOf(body), bundled ?? []);
  if (isGateStale)
    problems.push("the municipalities' regions are not the bundled gate: run just make-plateau-root");
  const ok = problems.length === 0;
  log("plateau_root_checked", {
    code: source.code,
    name: source.name,
    url: source.url,
    status,
    cors,
    geometricError,
    regionDeg: rootDeg ? rootDeg.map(round4) : [],
    children: children.length,
    codes: [...new Set(uris.map(municipalityCode))].toSorted(),
    problems,
    ok,
  });
  return ok;
}

async function check(): Promise<void> {
  const bundled = gatesOf(JSON.parse(await readFile(OUT, "utf8")) as RootTileset, PLATEAU_SOURCES);
  const results: boolean[] = [];
  // One after another: four small JSON requests, and the log reads in the table's order.
  for (const source of PLATEAU_SOURCES) results.push(await checkSource(source, bundled[source.code]));
  const isFailed = results.includes(false);
  if (isFailed) process.exitCode = 1;
}

async function write(): Promise<void> {
  const gates: Record<string, Region[]> = {};
  for (const source of PLATEAU_SOURCES.filter((s) => s.gated)) {
    const { status, body } = await fetchSource(source);
    const isNotOk = status !== 200;
    // Why not write without it: a root missing a prefecture's gate would leave that prefecture shut.
    if (isNotOk) throw new Error(`${source.url}: HTTP ${status}; nothing written`);
    gates[source.code] = gateOf(body);
  }
  const text = plateauRootText(PLATEAU_SOURCES, gates);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, text);
  log("plateau_root_written", {
    file: relative(ROOT, OUT),
    sources: PLATEAU_SOURCES.map((s) => s.code),
    gates: Object.fromEntries(Object.entries(gates).map(([code, g]) => [code, g.length])),
    bytes: Buffer.byteLength(text),
  });
}

const isCheck = process.argv.includes("--check");
await (isCheck ? check() : write());
