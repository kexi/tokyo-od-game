// Compare the actual game's tiles with the pre-worker raster and exercise the real worker/fallback.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const baseline = "7b3a61f9a53b3baa404a50286f45e1775418247b";
const old = execFileSync("git", ["show", `${baseline}:src/world/waterGeometry.ts`], { encoding: "utf8" });
const begin = old.indexOf("/**\n * Even–odd raster");
const end = old.indexOf("/**\n * Is the edge from a to b", begin);
const found = begin >= 0 && end > begin;
if (!found) throw new Error("baseline water functions not found");
const legacy = stripTypeScriptTypes(old.slice(begin, end));
const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-water",
);
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.7101,139.8015",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const report = {
  baseline,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const browser = await launch(url.href, { port: 9362 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game not ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.result = await browser.evaluate(`(async () => {
    const G=__game;
    if(G.getState()!=='playing') throw new Error('game stopped (check for HMR)');
    const {WaterCompute} = await import(new URL('src/world/waterCompute.ts',location.href).href);
    const {frameStats,longFramesDuring} = await import(new URL('src/game/perf.ts',location.href).href);
    const blob=URL.createObjectURL(new Blob([${JSON.stringify(legacy)}],{type:'text/javascript'}));
    try {
      const {rasterize,coverage,dilate}=await import(blob);
      const tiles=[...G.water.tiles.values()].map(({x,y,polygons})=>({x,y,polygons}));
      const nonempty=tiles.filter(t=>t.polygons.length).length;
      if(tiles.length<9||nonempty<3) throw new Error('water tiles not loaded');
      const inputs=[256,512].flatMap(size=>tiles.map(t=>({...t,size})));
      const references=inputs.map(t=>({
        raster:rasterize(t.polygons,t.x,t.y,1,t.size),
        cut:dilate(coverage(t.polygons,t.x,t.y,1,t.size),t.size),
      }));
      const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
      const output=[];
      for(const mode of ['inline','worker','fallback']) {
        await new Promise(r=>setTimeout(r,1000));
        const compute=mode==='fallback'?new WaterCompute(()=>{throw new Error('QA fallback');}):new WaterCompute();
        let done=false;
        const stamps=[];
        const frames=new Promise(resolve=>{
          const loop=t=>{stamps.push(t);if(done)resolve(stamps);else requestAnimationFrame(loop);};
          requestAnimationFrame(loop);
        });
        const watchStart=performance.now();
        const watch=longFramesDuring(watchStart,frames);
        await new Promise(r=>setTimeout(r,200));
        const before=G.debug.logs.query({event:'water_masks_prepared'}).length;
        const start=performance.now();
        let masks;
        try {
          masks=mode==='inline' ? inputs.map(t=>({
            raster:rasterize(t.polygons,t.x,t.y,1,t.size),
            cut:dilate(coverage(t.polygons,t.x,t.y,1,t.size),t.size),
          })) : await Promise.all(inputs.map(t=>compute.rasterize(t.polygons,t.x,t.y,t.size)));
          const elapsed=performance.now()-start;
          const realWorker=!!compute.worker;
          if(mode==='worker'&&!realWorker) throw new Error('worker unavailable');
          if(mode==='fallback'&&realWorker) throw new Error('fallback used a worker');
          await new Promise(r=>setTimeout(r,1000));
          done=true;
          const {result,long}=await watch;
          let values=0;
          for(let i=0;i<masks.length;i++) {
            if(!same(masks[i].raster,references[i].raster)||!same(masks[i].cut,references[i].cut))
              throw new Error(mode+' differs from pre-worker bytes at tile '+i);
            values+=masks[i].raster.length+masks[i].cut.length;
          }
          const jobs=G.debug.logs.query({event:'water_masks_prepared'}).slice(before);
          const expected=mode==='worker'?'worker':'inline';
          if(mode!=='inline'&&(jobs.length!==inputs.length||jobs.some(j=>j.backend!==expected)))
            throw new Error('unexpected compute backend or missing reply');
          output.push({mode,elapsed,frames:frameStats(result),long,realWorker,parity:{matched:true,values},
            cpuMs:mode==='inline'?elapsed:jobs.reduce((a,j)=>a+j.computeMs,0),
            maxTileCpuMs:mode==='inline'?null:Math.max(...jobs.map(j=>j.computeMs))});
        } finally { compute.dispose(); }
      }
      const errors=G.debug.logs.query({event:/uncaught_error|water_tile_failed|log_schema_invalid/});
      if(errors.length) throw new Error('runtime errors: '+JSON.stringify(errors));
      return {session:G.debug.logs.query({event:'session_start'}).at(-1),userAgent:navigator.userAgent,
        render:G.renderInfo,tiles:tiles.length,nonempty,inputs:inputs.length,output,errors,
        prepared:G.debug.logs.query({event:'water_masks_prepared'}).length};
    } finally { URL.revokeObjectURL(blob); }
  })()`);
  report.host.loadAfter = loadavg();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), result: report.result }) + "\n");
} finally {
  await browser.close();
}
