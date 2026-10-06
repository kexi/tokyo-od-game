import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "a0f4fb0f9454c01010d9e9360fe67daef7f9cf3d";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-ground-queries");
const refDir = ".qa/reference/ground-queries";
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
for (const file of ["src/world/dem.ts", "src/geo/frame.ts"]) {
  const source = execFileSync("git", ["show", reference + ":" + file], { encoding: "utf8" });
  const name = file.split("/").at(-1);
  legacyHashes[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, "legacy-" + name + ".txt"), source);
  writeFileSync(
    join(refDir, name),
    source.replace(/from (["'])(\.[^"']+)\1/g, (_match, _quote, specifier) => {
      const absolute = new URL(specifier, new URL(file, url));
      return 'from "' + absolute.href + '"';
    }),
  );
}
for (const file of [
  "src/world/dem.ts",
  "src/geo/frame.ts",
  "src/main.ts",
  "scripts/qa/perf-ground-queries.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  reference,
  legacyHashes,
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const browser = await launch(url.href, { port: 9373 });
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
    const Vector3=G.camera.position.constructor;
    const {GRAPHICS}=await import(new URL('src/device.ts',location.href).href);
    const {DemStore:LegacyDem}=await import(new URL('.qa/reference/ground-queries/dem.ts',location.href).href);
    const {LocalFrame:LegacyFrame}=await import(new URL('.qa/reference/ground-queries/frame.ts',location.href).href);
    const {latToTileY,lonToTileX}=await import(new URL('src/geo/tiles.ts',location.href).href);
    const oldDem=Object.assign(Object.create(LegacyDem.prototype),{loaded:G.dem.loaded,geoid:G.dem.geoid});
    const oldGeo=LegacyFrame.prototype.toGeodetic;
    const frame=()=>new Promise(requestAnimationFrame), rows=[];
    let compared=0;
    const collect=async(region)=>{
      const local=G.getFrame(),graph=G.getRoadGraph();
      const roadsMissing=!graph||G.debug.roads.input().loading;
      if(roadsMissing)throw new Error('road data not ready');
      const points=graph.segments.flatMap(s=>s.pts.map(p=>new Vector3(p.x,0,p.z)));
      const pixels=points.map(p=>{const g=oldGeo.call(local,p);return [lonToTileX(g.lon,15)*256,latToTileY(g.lat,15)*256];});
      for(const key of G.dem.loaded.keys()){
        const [x,y]=key.split('/').map(Number);
        for(const [px,py] of [[0,0],[0.5,0.25],[127.5,128.25],[255.5,30.25],[20.5,255.75],[255.5,255.5]])
          pixels.push([x*256+px,y*256+py]);
      }
      const groundOld=(x,z)=>{
        const deck=G.water.deckAt(x,z),onBridge=deck!==null;if(onBridge)return deck;
        const g=oldGeo.call(local,new Vector3(x,0,z)),h=oldDem.heightAt(g.lat,g.lon);
        return h===null?null:local.toLocal(g.lat,g.lon,h).y;
      };
      const checks={dem:0,geodetic:0,ground:0,bridge:0,missing:0};
      const match=(a,b,label)=>{const differs=!Object.is(a,b);if(differs)throw new Error(label+' changed: '+a+'/'+b);compared++;};
      const queries={
        dem:{input:pixels,old:([x,y])=>oldDem.sampleGlobal(x,y),new:([x,y])=>G.dem.sampleGlobal(x,y)},
        geodetic:{input:points,old:p=>oldGeo.call(local,p),new:p=>local.toGeodetic(p)},
        ground:{input:points,old:p=>groundOld(p.x,p.z),new:p=>G.groundY(p.x,p.z)}
      };
      for(const [name,q] of Object.entries(queries)){
        const isGeodetic=name==='geodetic',isGround=name==='ground';
        for(const p of q.input){
          const a=q.old(p),b=q.new(p);
          if(isGeodetic)for(const key of ['lat','lon','h'])match(a[key],b[key],name);
          else match(a,b,name);
          checks[name]++;
          if(isGround){
            const onBridge=G.water.deckAt(p.x,p.z)!==null,isMissing=a===null;
            if(onBridge)checks.bridge++;
            if(isMissing)checks.missing++;
          }
        }
        const run=(mode)=>{let checksum=0;for(const p of q.input){const value=q[mode](p);checksum+=name==='geodetic'?value.h:value??0;}return checksum;};
        for(let i=0;i<4;i++){run('old');run('new');await frame();}
        const row={region,kind:name,queries:q.input.length,oldMs:[],newMs:[],matched:true};
        for(let repeat=0;repeat<24;repeat++){
          await frame();const sums={};
          for(const mode of repeat%2===0?['old','new']:['new','old']){
            const start=performance.now();sums[mode]=run(mode);row[mode+'Ms'].push(performance.now()-start);
          }
          match(sums.old,sums.new,name+' checksum');
        }
        rows.push(row);
      }
      const worldChanged=G.getFrame()!==local||G.getRoadGraph()!==graph||window.__game!==G;
      if(worldChanged)throw new Error('game/frame changed during comparison');
      return {region,points:points.length,tiles:G.dem.loaded.size,checks};
    };
    const areas=[await collect('tokyo')];
    G.debug.roads.warp({name:'QA ground Azuma',kind:'QA',lat:35.7101,lon:139.8015});
    for(let i=0;i<360;i++){
      const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
      const done=landed?.to==='QA ground Azuma'&&!G.debug.roads.input().loading,timedOut=i===359;
      if(done)break;
      if(timedOut)throw new Error('warp did not complete');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
    areas.push(await collect('azuma'));
    return {areas,rows,compared,session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
      render:G.renderInfo,graphics:GRAPHICS.settings,userAgent:navigator.userAgent,
      errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|terrain_worker_failed|terrain_build_failed|log_schema_invalid/})};
  })()`);
  report.logs = browser.logs;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      areas: report.result.areas,
      rows: report.result.rows.map((r) => ({
        region: r.region,
        kind: r.kind,
        queries: r.queries,
        oldMs: r.oldMs.reduce((a, b) => a + b, 0),
        newMs: r.newMs.reduce((a, b) => a + b, 0),
      })),
      compared: report.result.compared,
      session: report.result.session,
      errors: report.result.errors,
    }) + "\n",
  );
} finally {
  await browser.close();
}
