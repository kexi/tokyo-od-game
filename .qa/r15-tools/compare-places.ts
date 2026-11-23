// R1-5 PR A: the 18 places' points from the copy's at() (.qa/street-drive.mts of 7c, its code as is)
// and from streetPlaces.ts placeLatLon, on the data under test. Prints the largest difference (deg).
import { readdirSync, readFileSync } from "node:fs";
import { expresswayDataDir, readExpresswayFiles } from "../../scripts/expresswayFiles.ts";
import { placeLatLon, STREET_PLACES } from "../../scripts/qa/streetPlaces.ts";

const dir = `${expresswayDataDir()}/`;
type Chunk = { id: string; run: string; k: number; st: number[] };
const chunks: Chunk[] = [];
for (const f of readdirSync(dir).filter((f) => /^\d+-\d+\.json$/.test(f)))
  chunks.push(...JSON.parse(readFileSync(dir + f, "utf8")).chunks);
function at(run: string, s: number, left = 0) {
  const list = chunks.filter((c) => c.run === run).sort((a, b) => a.k - b.k);
  if (list.length === 0) throw new Error(`no run ${run}`);
  const st = list.flatMap((c) => {
    const rows: number[][] = [];
    for (let i = 0; i < c.st.length; i += 7) rows.push(c.st.slice(i, i + 7));
    return rows;
  });
  let i = 0;
  while (i + 2 < st.length && st[i + 1][0] < s) i++;
  const [a, b] = [st[i], st[i + 1]];
  const t = Math.max(0, Math.min(1, (s - a[0]) / (b[0] - a[0] || 1)));
  const lat = a[2] + (b[2] - a[2]) * t;
  const lon = a[1] + (b[1] - a[1]) * t;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ex = (b[1] - a[1]) * kx;
  const ny = (b[2] - a[2]) * 110574;
  const n = Math.hypot(ex, ny) || 1;
  return { lat: lat + ((ex / n) * left) / 110574, lon: lon - ((ny / n) * left) / kx };
}
const files = readExpresswayFiles();
let worst = 0;
for (const p of STREET_PLACES) {
  const mine = placeLatLon(files.byRun, p.at)!;
  const theirs = "run" in p.at ? at(p.at.run, p.at.s, p.at.left ?? 0) : p.at;
  const d = Math.max(Math.abs(mine.lat - theirs.lat), Math.abs(mine.lon - theirs.lon));
  worst = Math.max(worst, d);
  process.stdout.write(`${p.id} ${mine.lat.toFixed(7)},${mine.lon.toFixed(7)} d=${d}\n`);
}
process.stdout.write(`worst ${worst}\n`);
