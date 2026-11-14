import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "c5a6558835539039bf0478ac7eb41c4e0dd96838";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-terrain-water");
const refDir = ".qa/reference/terrain-water";
mkdirSync(out, { recursive: true });
mkdirSync(refDir, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const legacy = execFileSync("git", ["show", reference + ":src/world/terrain.ts"], { encoding: "utf8" });
writeFileSync(join(out, "terrain-legacy.ts.txt"), legacy);
writeFileSync(
  join(refDir, "terrain.ts"),
  legacy.replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, specifier) => 'from "' + new URL("src/world/" + specifier, url).href + '"',
  ),
);
const sources = {};
for (const file of [
  "src/world/terrain.ts",
  "src/world/terrainWaterTriangles.ts",
  "scripts/qa/perf-terrain-water.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  reference,
  legacyHash: createHash("sha256").update(legacy).digest("hex"),
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const browser = await launch(url.href, { port: 9372 });
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.version = (await browser.send("Browser.getVersion")).result;
  report.result = await browser.evaluate(`(async()=>{
    const G=__game;
    const {Terrain:LegacyTerrain}=await import(new URL('.qa/reference/terrain-water/terrain.ts',location.href).href);
    const old=LegacyTerrain.prototype.dryTriangles;
    const frame=()=>new Promise(requestAnimationFrame);
    const same=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
    const rows=[];
    let comparedValues=0;
    const collect=async(region)=>{
      const chunks=[...G.terrain.chunks.values()].filter(c=>c.waterMask!==null).slice(0,24);
      if(chunks.length<4)throw new Error('too few real water masks: '+region);
      for(const source of chunks){
        const chunk={...source,waterMask:source.waterMask.slice()};
        const index=new Uint32Array(source.mesh.geometry.index.array);
        const expected=old.call(null,chunk,index);
        const actual=G.terrain.dryTriangles(chunk,index);
        if(!same(actual,expected))throw new Error('terrain mask changed: '+region+'/'+source.x+'/'+source.y);
        comparedValues+=expected.length;
        for(let i=0;i<4;i++){old.call(null,chunk,index);G.terrain.dryTriangles(chunk,index);}
        const row={region,x:source.x,y:source.y,size:chunk.waterSize,
          maskHash:null,inputTriangles:index.length/3,keptTriangles:expected.length/3,
          wetPixels:chunk.waterMask.reduce((n,v)=>n+(v>=128?1:0),0),oldMs:[],newMs:[],matched:true};
        row.maskHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',chunk.waterMask)))
          .map(v=>v.toString(16).padStart(2,'0')).join('');
        for(let repeat=0;repeat<20;repeat++){
          await frame();
          const order=repeat%2===0?['old','new']:['new','old'];
          const result={};
          for(const mode of order){
            const start=performance.now();
            result[mode]=mode==='old'?old.call(null,chunk,index):G.terrain.dryTriangles(chunk,index);
            row[mode+'Ms'].push(performance.now()-start);
          }
          if(!same(result.old,result.new))throw new Error('repeated terrain mask changed');
          comparedValues+=result.old.length;
        }
        rows.push(row);
      }
    };
    await collect('tokyo');
    G.debug.roads.warp({name:'QA water Azuma',kind:'QA',lat:35.7101,lon:139.8015});
    for(let i=0;i<360;i++){
      const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
      if(landed?.to==='QA water Azuma'&&!G.debug.roads.input().loading)break;
      if(i===359)throw new Error('warp did not complete');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
    await collect('azuma');
    const boundary=[];
    const source=[...G.terrain.chunks.values()][0],index=source.mesh.geometry.index.array;
    for(const size of [1,3,4,63,64,127]){
      for(const pattern of ['dry','wet','threshold','shore','centre']){
        const mask=new Uint8Array(size*size);
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){
          mask[y*size+x]=pattern==='wet'?255:pattern==='threshold'?(x+y)%2===0?127:128:
            pattern==='shore'?(x<size/2?255:0):pattern==='centre'?(x===Math.floor(size/2)&&y===Math.floor(size/2)?0:255):0;
        }
        const chunk={...source,waterMask:mask,waterSize:size};
        const expected=old.call(null,chunk,index),actual=G.terrain.dryTriangles(chunk,index);
        if(!same(actual,expected))throw new Error('boundary mask changed: '+size+'/'+pattern);
        comparedValues+=expected.length;
        boundary.push({size,pattern,keptTriangles:actual.length/3,matched:true});
      }
    }
    return {rows,boundary,comparedValues,session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
      render:G.renderInfo,errors:G.debug.logs.query({event:/uncaught_error|terrain_worker_failed|terrain_build_failed|collider_worker_failed|log_schema_invalid/})};
  })()`);
  report.logs = browser.logs;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      rows: report.result.rows.length,
      comparedValues: report.result.comparedValues,
      session: report.result.session,
      errors: report.result.errors,
    }) + "\n",
  );
} finally {
  await browser.close();
}
