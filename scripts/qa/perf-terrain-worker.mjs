import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "05e60e86882a92f83a386cfe32431b99c0408213";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-terrain-worker");
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const frozen = {};
const refDir = ".qa/reference/terrain-worker";
mkdirSync(refDir, { recursive: true });
for (const file of ["src/world/terrain.ts", "src/world/dem.ts", "src/geo/geoid.ts"]) {
  const source = execFileSync("git", ["show", reference + ":" + file], { encoding: "utf8" });
  frozen[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + "-legacy.txt"), source);
  const isTerrain = file === "src/world/terrain.ts";
  let module = source;
  if (isTerrain) {
    const begin = source.indexOf("    const midLat ="),
      end = source.indexOf("    const material =", begin);
    const isMissing = begin < 0 || end < 0;
    if (isMissing) throw new Error("fixed original terrain preparation not found");
    module = `import {BufferAttribute,BufferGeometry,Vector3} from 'three';
      import {TERRAIN_SEGMENTS as S,TERRAIN_ZOOM} from '../../src/config';
      import {geodeticToEcef} from '../../src/geo/ellipsoid';
      import {tileXToLon,tileYToLat} from '../../src/geo/tiles';
      export function legacyTerrain(x,y,dem){
        ${source.slice(begin, end).replaceAll("this.dem", "dem")}
        geometry.computeBoundingBox();
        return {positions,uvs,indices,normals:geometry.getAttribute('normal').array,
          centerEcef:centerEcef.toArray(),box:{min:geometry.boundingBox.min.toArray(),max:geometry.boundingBox.max.toArray()},
          sphere:{center:geometry.boundingSphere.center.toArray(),radius:geometry.boundingSphere.radius}};
      }`;
    module = module.replace(
      /from 'three'/g,
      `from '${new URL("node_modules/.vite/deps/three.js", url).href}'`,
    );
    module = module.replaceAll("../../src/", new URL("src/", url).href);
  } else {
    const directory = file.slice(0, file.lastIndexOf("/") + 1);
    module = module.replace(
      /from (["'])(\.[^"']+)\1/g,
      (_match, _quote, specifier) => `from "${new URL(directory + specifier, url).href}"`,
    );
  }
  writeFileSync(join(refDir, file.split("/").at(-1)), module);
}
const sources = {};
for (const file of [
  "src/world/terrain.ts",
  "src/world/terrainData.ts",
  "src/world/terrainCompute.ts",
  "src/world/terrain.worker.ts",
  "src/world/dem.ts",
  "src/geo/geoid.ts",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  reference,
  frozen,
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9369 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  const isUnavailable = !ready;
  if (isUnavailable) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.result = await browser.evaluate(`(async()=>{
    const G=__game;
    const {TerrainCompute}=await import(new URL('src/world/terrainCompute.ts',location.href).href);
    const {legacyTerrain}=await import(new URL('.qa/reference/terrain-worker/terrain.ts',location.href).href);
    const {DemStore}=await import(new URL('.qa/reference/terrain-worker/dem.ts',location.href).href);
    const {Geoid}=await import(new URL('.qa/reference/terrain-worker/geoid.ts',location.href).href);
    const {frameStats,longFramesDuring}=await import(new URL('src/game/perf.ts',location.href).href);
    const compute=new TerrainCompute(),inline=new TerrainCompute(()=>{throw new Error('QA intentional terrain-worker fallback');});
    const sameArray=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
    const fields=['positions','uvs','indices','normals'];
    const flat=d=>[...d.centerEcef,...d.box.min,...d.box.max,...d.sphere.center,d.sphere.radius];
    const same=(a,b)=>fields.every(f=>sameArray(a[f],b[f]))&&sameArray(flat(a),flat(b));
    const frame=()=>new Promise(requestAnimationFrame);
    const rows=[],inputs=[];
    const collect=async region=>{
      const chunks=[...G.terrain.chunks.values()].filter(c=>c.mesh.visible).slice(0,25);
      for(const chunk of chunks){
        const input=await G.terrain.dem.loadTerrainInput(chunk.x,chunk.y);
        const dem=new DemStore(new Geoid(input.geoid));
        dem.loaded=new Map(input.tiles.map((tile,i)=>[(input.x+i%2)+'/'+(input.y+Math.floor(i/2)),tile]));
        const geometry=chunk.mesh.geometry;
        const installed={positions:geometry.getAttribute('position').array,uvs:geometry.getAttribute('uv').array,
          normals:geometry.getAttribute('normal').array,indices:geometry.getIndex().array,centerEcef:chunk.centerEcef.toArray(),
          box:{min:geometry.boundingBox.min.toArray(),max:geometry.boundingBox.max.toArray()},
          sphere:{center:geometry.boundingSphere.center.toArray(),radius:geometry.boundingSphere.radius}};
        inputs.push({region,input,dem,installed});
      }
    };
    try{
      await collect('tokyo');
      G.debug.roads.warp({name:'QA terrain Azuma',kind:'QA',lat:35.7101,lon:139.8015});
      for(let i=0;i<240;i++){
        const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
        const isLanded=landed?.to==='QA terrain Azuma'&&!G.debug.roads.input().loading;
        if(isLanded)break;
        const isTimedOut=i===239;
        if(isTimedOut)throw new Error('warp not finished');
        await new Promise(r=>setTimeout(r,250));
      }
      await new Promise(r=>setTimeout(r,15000));await collect('azuma');
      const hasTooFew=inputs.length<18;
      if(hasTooFew)throw new Error('not enough actual terrain chunks');
      let values=0;
      for(let i=0;i<inputs.length;i++){
        const fixture=inputs[i],{input,dem}=fixture;
        const expected=legacyTerrain(input.x,input.y,dem),key='qa-terrain-parity-'+i;
        const worker=await compute.prepare(input,key),fallback=await inline.prepare(input,key+'-inline');
        const differs=!same(worker,expected)||!same(fallback,expected)||!same(fixture.installed,expected);
        if(differs)throw new Error('terrain Worker/fallback/production differs from legacy: '+i);
        const bytes=new Uint8Array(input.tiles.reduce((sum,t)=>sum+t.byteLength,0));let offset=0;
        for(const tile of input.tiles){bytes.set(new Uint8Array(tile.buffer,tile.byteOffset,tile.byteLength),offset);offset+=tile.byteLength;}
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const geoidDigest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input.geoid)));
        rows.push({region:fixture.region,x:input.x,y:input.y,segments:input.segments,vertices:expected.positions.length/3,
          sourceSha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),
          geoidSha256:[...new Uint8Array(geoidDigest)].map(v=>v.toString(16).padStart(2,'0')).join(''),matched:true});
        values+=fields.reduce((n,f)=>n+expected[f].length,0)+flat(expected).length;
        fixture.expected=expected;await frame();
      }
      const samples=[];
      for(let round=0;round<4;round++)for(const mode of round%2===0?['sync','worker','inline']:['inline','worker','sync']){
        const stamps=[];let done=false;
        const frames=new Promise(resolve=>{const loop=t=>{stamps.push(t);if(done)resolve(stamps);else requestAnimationFrame(loop);};requestAnimationFrame(loop);});
        const watch=longFramesDuring(performance.now(),frames);
        await new Promise(r=>setTimeout(r,200));
        const measurements=[],outputs=[];
        for(let i=0;i<inputs.length;i++){
          const fixture=inputs[i],key='qa-terrain-sample-'+round+'-'+mode+'-'+i,start=performance.now();
          let data,metrics;
          const isSync=mode==='sync';
          if(isSync){data=legacyTerrain(fixture.input.x,fixture.input.y,fixture.dem);const mainMs=performance.now()-start;metrics={mainMs,computeMs:mainMs};}
          else{
            const pending=(mode==='worker'?compute:inline).prepare(fixture.input,key),callMs=performance.now()-start;
            data=await pending;
            const entry=G.debug.logs.query({event:'terrain_chunk_prepared'}).findLast(e=>e.key===key);
            const missing=!entry||entry.backend!==mode;
            if(missing)throw new Error('own terrain job metrics missing');
            metrics={...entry,callMs};
          }
          measurements.push({...metrics,latencyMs:performance.now()-start});outputs.push(data);await frame();
        }
        await new Promise(r=>setTimeout(r,500));done=true;
        const {result,long}=await watch;
        for(let i=0;i<inputs.length;i++){
          const differs=!same(outputs[i],inputs[i].expected);
          if(differs)throw new Error('timed terrain output differs');
        }
        const main=measurements.map(r=>r.mainMs).toSorted((a,b)=>a-b);
        samples.push({round,mode,mainMs:main.reduce((a,b)=>a+b,0),maxMainMs:main.at(-1),p95MainMs:main[Math.floor(main.length*.95)],
          frames:frameStats(result),long,measurements});
      }
      const errors=G.debug.logs.query({event:/uncaught_error|log_schema_invalid|terrain_build_failed/});
      const hasErrors=errors.length>0;
      if(hasErrors)throw new Error('runtime errors');
      return{session:G.debug.logs.query({limit:1}).at(-1)?.traceId,userAgent:navigator.userAgent,render:G.renderInfo,rows,
        parity:{values,matched:true,production:true,worker:true,inline:true},samples,errors,
        expectedFailures:G.debug.logs.query({event:'terrain_worker_failed'}).filter(e=>e.error==='Error: QA intentional terrain-worker fallback')};
    }finally{compute.dispose();inline.dispose();}
  })()`);
  save();
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      parity: report.result.parity,
      chunks: report.result.rows.length,
      samples: report.result.samples.map(({ round, mode, mainMs, maxMainMs, frames }) => ({
        round,
        mode,
        mainMs,
        maxMainMs,
        frames,
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}
