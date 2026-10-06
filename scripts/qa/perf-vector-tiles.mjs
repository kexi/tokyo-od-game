import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { launch } from "./browser.mjs";

const captured = process.env.QA_VECTOR_INPUT;
const missing = !captured;
if (missing) throw new Error("Set QA_VECTOR_INPUT to a QA_CAPTURE_VECTOR streaming report.json");
const inputReport = JSON.parse(readFileSync(captured, "utf8"));
const inputs = inputReport.vectorTiles;
const unavailable = !inputs?.length;
if (unavailable) throw new Error("The report has no captured vector tile bytes");
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-vector-tiles");
const refDir = ".qa/reference/vector-tiles";
mkdirSync(out, { recursive: true });
mkdirSync(refDir, { recursive: true });
const reference = "a9daf5991c5b61343f2e8c04b33ad858f01b5b20";
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
const frozen = {};
const old = {};
for (const name of ["roadTiles", "pavements", "water", "waterGeometry"]) {
  const file = "src/world/" + name + ".ts";
  const source = execFileSync("git", ["show", reference + ":" + file], { encoding: "utf8" });
  frozen[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, name + "-legacy.txt"), source);
  old[name] = source;
}
const extract = (source, start, end) => {
  const first = source.indexOf(start),
    last = source.indexOf(end, first);
  const invalid = first < 0 || last < first;
  if (invalid) throw new Error("Reference source boundaries changed");
  return source.slice(first, last);
};
const legacy = `import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {tileXToLon,tileYToLat} from '${new URL("src/geo/tiles.ts", url).href}';
const ZOOM=16;
${extract(old.roadTiles, "const WIDTH_BY_RANK", "export class RoadTiles")}
${extract(old.pavements, "type Pt =", "/** Procedural interlocking paving")}
${extract(old.waterGeometry, "export function waterPolygons", "/** Triangles").replace(": WaterPolygon[]", "")}
function roads(tile:any,x:number,y:number){
${extract(old.roadTiles, "    const layer = tile?.layers.road;", "    return lines;")}
return lines;}
function pavements(tile:any,x:number,y:number){
${extract(old.pavements, "  const out: PavementPolygon[]", "  return out;")}
return out;}
function water(vt:any,x:number,y:number){
${extract(old.water, "    const layer = vt?.layers.waterarea;", "    const { raster, cut }")}
return polygons;}
export function decode(input:any){
 const tile=new VectorTile(new Pbf(new Uint8Array(input.buffer)));
 const {x,y}=input;
 return input.source==='gsi'?{source:'gsi',roads:roads(tile,x,y),water:water(tile,x,y)}:
 {source:'pavement',polygons:pavements(tile,x,y)};
}`;
// Type-only imports in the extracted methods are erased; no runtime dependency on current parsers.
writeFileSync(join(refDir, "legacy.ts"), legacy);
writeFileSync(join(out, "legacy.ts.txt"), legacy);
const sources = {};
for (const file of [
  "src/world/vectorTileData.ts",
  "src/world/vectorTilePolygons.ts",
  "src/world/vectorTileCompute.ts",
  "src/world/vectorTile.worker.ts",
  "src/world/gsiVectorTiles.ts",
  "src/world/roadTiles.ts",
  "src/world/pavements.ts",
  "src/world/water.ts",
  "src/world/waterGeometry.ts",
  "src/geo/tiles.ts",
  "src/logEvents.ts",
  "src/game/frameWork.ts",
  "src/game/serialWork.ts",
  "scripts/qa/perf-vector-tiles.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const tiles = inputs.map((tile, index) => {
  const path = join(dirname(captured), tile.file);
  const buffer = readFileSync(path);
  const file = "vector-" + index + ".bin";
  writeFileSync(join(out, file), buffer);
  return { ...tile, file, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
});
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const report = {
  reference,
  frozen,
  inputReport: captured,
  inputs: tiles,
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9375 });
try {
  report.browser = (await browser.send("Browser.getVersion")).result;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  const notReady = !ready;
  if (notReady) throw new Error("game not ready");
  await browser.evaluate("__game.start();window.__qaGame=__game");
  await browser.sleep(30000);
  report.context = await browser.evaluate(
    `({render:__game.renderInfo,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})`,
  );
  report.result = await browser.evaluate(`(async()=>{
    const {decode:legacy}=await import(new URL('${refDir}/legacy.ts',location.href).href);
    const {VectorTileCompute}=await import(new URL('src/world/vectorTileCompute.ts',location.href).href);
    const {frameStats,longFramesDuring}=await import(new URL('src/game/perf.ts',location.href).href);
    const metadata=${JSON.stringify(tiles.map(({ source, z, x, y, file }) => ({ source, z, x, y, file })))},inputs=[];
    for(const tile of metadata){const response=await fetch(new URL('${out}/'+tile.file,location.href));
      if(!response.ok)throw new Error('captured tile missing');inputs.push({...tile,buffer:await response.arrayBuffer()});}
    const expected=inputs.map(legacy),outputs=[],rows=[],captures=[];
    const worker=new VectorTileCompute(),inline=new VectorTileCompute();inline.inline=true;
    let stopped=false;
    try {
      // Worker module startup and parser JIT are warmed separately from the measured requests.
      await worker.decode(inputs[0]);await inline.decode(inputs[0]);
      for(let round=0;round<4;round++){
        const order=round%2?['inline','worker','legacy']:['legacy','worker','inline'];
        for(const mode of order){
          const stamps=[];stopped=false;
          const frames=new Promise(resolve=>{const tick=t=>{stamps.push(t);if(stopped)resolve(stamps);else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
          const watch=longFramesDuring(performance.now(),frames);
          await new Promise(r=>setTimeout(r,250));
          for(let i=0;i<inputs.length;i++){
            const at=performance.now(),input=inputs[i];let output,callMs,metrics=null;
            if(mode==='legacy'){output=legacy(input);callMs=performance.now()-at;}
            else{
              const compute=mode==='worker'?worker:inline;
              const pending=compute.decode(input),span=compute.jobs.get(compute.serial)?.span.spanId;
              callMs=performance.now()-at;output=await pending;
              metrics=__game.debug.logs.query({event:'vector_tile_prepared'}).findLast(e=>e.spanId===span);
              if(!metrics||metrics.backend!==mode)throw new Error('actual Worker/fallback metrics missing');
            }
            rows.push({round,mode,index:i,source:input.source,callMs,latencyMs:performance.now()-at,...metrics});
            outputs.push({mode,index:i,output});await new Promise(requestAnimationFrame);
          }
          await new Promise(r=>setTimeout(r,250));stopped=true;
          const {result,long}=await watch;captures.push({round,mode,frames:frameStats(result),long});
        }
      }
      let values=0;const valuesByMode={legacy:0,worker:0,inline:0};
      const same=(a,b)=>{
        if(typeof a==='number')values++;
        if(Object.is(a,b))return true;
        const objects=a!==null&&b!==null&&typeof a==='object'&&typeof b==='object';
        if(!objects||a.constructor.name!==b.constructor.name)return false;
        const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
      };
      for(const {mode,index,output} of outputs){const before=values;if(!same(output,expected[index]))throw new Error('tile output differs: '+mode+'/'+index);valuesByMode[mode]+=values-before;}
      if(__game!==__qaGame)throw new Error('game changed during measurement');
      return {matched:true,values,valuesByMode,rows,captures,tiles:inputs.length,
        session:__game.debug.logs.query({limit:1}).at(-1)?.traceId,
        retained:inputs.map(i=>i.buffer.byteLength),
        livePrepared:__game.debug.logs.query({event:'vector_tile_prepared'}).filter(e=>!rows.some(r=>r.spanId===e.spanId))};
    }finally{stopped=true;worker.dispose();inline.dispose();}
  })()`);
  report.errors = await browser.evaluate(
    "__game.debug.logs.query({event:/uncaught_error|vector_tile_worker_failed|water_tile_failed|road_network_failed|log_schema_invalid/})",
  );
  report.sourcesUnchanged = Object.fromEntries(
    Object.entries(sources).map(([file, hash]) => [
      file,
      createHash("sha256").update(readFileSync(file)).digest("hex") === hash,
    ]),
  );
  save();
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      matched: report.result.matched,
      values: report.result.values,
      valuesByMode: report.result.valuesByMode,
      errors: report.errors,
    }) + "\n",
  );
} catch (error) {
  report.failure = String(error);
  save();
  throw error;
} finally {
  await browser.close();
}
