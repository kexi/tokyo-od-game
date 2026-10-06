import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = process.env.QA_REFERENCE ?? "b0106a2b8d732c71bf92b4c191600a8e638706f5";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-water-samples");
const refDir = ".qa/reference/water-samples";
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
const sources = {},
  legacyHashes = {};
for (const file of ["src/world/water.ts", "src/world/dem.ts"]) {
  const source = execFileSync("git", ["show", reference + ":" + file], { encoding: "utf8" });
  const name = file.split("/").at(-1);
  legacyHashes[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, "legacy-" + name + ".txt"), source);
  writeFileSync(
    join(refDir, name),
    source.replace(
      /from (["'])(\.[^"']+)\1/g,
      (_match, _quote, specifier) => 'from "' + new URL(specifier, new URL(file, url)).href + '"',
    ),
  );
}
for (const file of [
  "src/world/water.ts",
  "src/world/dem.ts",
  "src/world/waterGeometry.ts",
  "scripts/qa/perf-water-samples.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  reference,
  sources,
  legacyHashes,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const browser = await launch(url.href, { port: 9377 });
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  const timedOut = !ready;
  if (timedOut) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.version = (await browser.send("Browser.getVersion")).result;
  report.result = await browser.evaluate(`(async()=>{
    const G=__game;
    const {WaterLayer:OldWater}=await import(new URL('.qa/reference/water-samples/water.ts',location.href).href);
    const {DemStore:OldDem}=await import(new URL('.qa/reference/water-samples/dem.ts',location.href).href);
    const {WaterLayer}=await import(new URL('src/world/water.ts',location.href).href);
    const {DemStore}=await import(new URL('src/world/dem.ts',location.href).href);
    const {GRAPHICS}=await import(new URL('src/device.ts',location.href).href);
    const frame=()=>new Promise(requestAnimationFrame);
    const rows=[],areas=[];let compared=0;
    const same=(a,b,label)=>{
      const lengthDiffers=a.length!==b.length;
      if(lengthDiffers)throw new Error(label+' length differs');
      for(let i=0;i<a.length;i++){
        const differs=!Object.is(a[i],b[i]);
        if(differs)throw new Error(label+' changed at '+i);
        compared++;
      }
    };
    const drain=async(steps)=>{
      let cpuMs=0,maxStepMs=0,slice=0;
      for(;;){
        const start=performance.now(),result=steps.next(),ms=performance.now()-start;
        cpuMs+=ms;maxStepMs=Math.max(maxStepMs,ms);slice+=ms;
        const complete=result.done;
        if(complete)return {value:result.value,cpuMs,maxStepMs};
        const exhausted=slice>=4;
        if(exhausted){await frame();slice=0;}
      }
    };
    const collect=async(region)=>{
      const tiles=new Map(G.water.tiles);
      const loaded=new Map(G.dem.loaded),surveyedReady=new Map(G.dem.surveyedReady);
      const rings=[...tiles.values()].flatMap(t=>t.polygons.flat()).toSorted((a,b)=>b.length-a.length).slice(0,16);
      const insufficient=rings.length<8||[...surveyedReady.values()].filter(Boolean).length<4;
      if(insufficient)throw new Error('water or surveyed DEM not loaded: '+region);
      const make=(waterProto,demProto)=>{
        const dem=Object.assign(Object.create(demProto),{loaded,surveyedReady,surveyedTile:null});
        return Object.assign(Object.create(waterProto),{tiles,dem,waterTile:undefined,
          bay:{...G.water.bay},gaugeList:[...G.water.gaugeList]});
      };
      const old=make(OldWater.prototype,OldDem.prototype),current=make(WaterLayer.prototype,DemStore.prototype);
      const points=[],inputs=[],counts={surveyed:0,filled:0,land:0};
      for(const ring of rings){
        const a=(await drain(old.shoreRingSteps(ring))).value;
        const b=(await drain(current.shoreRingSteps(ring))).value;
        for(const key of ['pts','level','tide'])same(a[key],b[key],region+' shore '+key);
        inputs.push({ring:[...ring],pts:a.pts,level:Array.from(a.level),tide:Array.from(a.tide)});
        for(let i=0;i<a.pts.length;i+=2)points.push([a.pts[i],a.pts[i+1]]);
      }
      for(const [x,y] of points){
        const a=old.samplesAt(x,y),b=current.samplesAt(x,y);
        for(const key of ['surveyed','filled','land']){
          same(a[key],b[key],region+' samples '+key);counts[key]+=a[key].length;
        }
        const la=old.levelAt(x,y),lb=current.levelAt(x,y);
        same([la.level,la.tide,la.source,la.surveyed],[lb.level,lb.tide,lb.source,lb.surveyed],'level choice');
      }
      const pixels=[];
      for(const tile of tiles.values())for(const [dx,dy] of [[0,0],[.5,.5],[1-1/512,1-1/512],[1,1]]){
        const x=tile.x+dx,y=tile.y+dy;
        same([old.isWater(x,y)],[current.isWater(x,y)],'water boundary');
        pixels.push([x,y]);
      }
      const run=async(mode)=>{
        const water=mode==='old'?old:current;
        let cpuMs=0,maxStepMs=0,checksum=0;
        for(const ring of rings){
          const measured=await drain(water.shoreRingSteps(ring));
          cpuMs+=measured.cpuMs;maxStepMs=Math.max(maxStepMs,measured.maxStepMs);
          for(const v of measured.value.level)checksum+=v;
        }
        return {cpuMs,maxStepMs,checksum};
      };
      await run('old');await run('new');
      const row={region,rings:rings.length,points:points.length,old:[],new:[]};
      for(let repeat=0;repeat<4;repeat++){
        const checks={};
        for(const mode of repeat%2===0?['old','new']:['new','old']){
          await frame();const result=await run(mode);row[mode].push(result);checks[mode]=result.checksum;
        }
        same([checks.old],[checks.new],'shore checksum');
      }
      rows.push(row);
      return {region,waterTiles:tiles.size,surveyedTiles:surveyedReady.size,
        nonemptySurveyedTiles:[...surveyedReady.values()].filter(Boolean).length,counts,inputs,pixels};
    };
    areas.push(await collect('tokyo'));
    G.debug.roads.warp({name:'QA water Azuma',kind:'QA',lat:35.7101,lon:139.8015});
    for(let i=0;i<360;i++){
      const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
      const done=landed?.to==='QA water Azuma'&&!G.debug.roads.input().loading,expired=i===359;
      if(done)break;
      if(expired)throw new Error('warp did not complete');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
    areas.push(await collect('azuma'));
    return {areas,rows,compared,session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
      graphics:GRAPHICS.settings,render:G.renderInfo,userAgent:navigator.userAgent,
      errors:G.debug.logs.query({event:/uncaught_error|water_tile_failed|log_schema_invalid|road_network_failed/})};
  })()`);
  report.logs = browser.logs;
  report.host.loadAfter = loadavg();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      compared: report.result.compared,
      session: report.result.session,
      errors: report.result.errors,
      rows: report.result.rows.map((r) => ({
        region: r.region,
        rings: r.rings,
        points: r.points,
        oldMs: r.old.reduce((n, v) => n + v.cpuMs, 0),
        newMs: r.new.reduce((n, v) => n + v.cpuMs, 0),
        oldMaxStep: Math.max(...r.old.map((v) => v.maxStepMs)),
        newMaxStep: Math.max(...r.new.map((v) => v.maxStepMs)),
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}
