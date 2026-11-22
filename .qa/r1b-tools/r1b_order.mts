// R1-1b A4 6 (in Node): every end chunk built with only the tiles the game reads before it (the 3 × 3
// round its middle station, expresswayDeck.ts tilesAround), against built with every tile: its end
// walls' boxes the same? The game builds a chunk once (no rebuild when a tile comes later), so the
// wall is as the tiles read by then make it.
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b_order.mts [dir]
import { ST, STATION_STRIDE } from "../../src/expressway/format.ts";
import { tileKey } from "../../src/expressway/geo.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const files = readExpresswayFiles(process.argv[2]);
const zoom = files.meta.zoom;
const fullRuns = new Map<string, { id: string; cls: string; start: unknown; end: unknown }>();
for (const t of files.tiles.values()) for (const r of t.runs) fullRuns.set(r.id, r);
const full = new DeckIndex(fullRuns as never);
for (const c of files.chunks) full.add(c);
let walls = 0;
const differ: string[] = [];
for (const c of files.chunks) {
  if (c.prev !== null && c.next !== null) continue;
  const mid = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  const [cx, cy] = tileKey(c.st[mid + ST.lon], c.st[mid + ST.lat], zoom).split("-").map(Number);
  const runs = new Map<string, never>();
  const chunks: typeof files.chunks = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const tile = files.tiles.get(`${cx + dx}-${cy + dy}`);
      if (!tile) continue;
      for (const r of tile.runs) runs.set(r.id, r as never);
      chunks.push(...tile.chunks);
    }
  const part = new DeckIndex(runs);
  for (const k of chunks) part.add(k);
  const frame = new LocalFrame(c.st[ST.lat], c.st[ST.lon], 40);
  const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
  const build = (index: DeckIndex) => {
    const steps = deckArraySteps(c, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
  };
  const a = build(full);
  if (a.endWalls.length === 0) continue;
  walls += a.endWalls.length;
  const b = build(part);
  const isSame =
    JSON.stringify(a.endWalls) === JSON.stringify(b.endWalls) &&
    a.collider.position.length === b.collider.position.length &&
    a.collider.position.every((v, i) => v === b.collider.position[i]);
  if (!isSame) differ.push(c.id);
}
console.log(JSON.stringify({ dir: files.dir, walls, differ }));
