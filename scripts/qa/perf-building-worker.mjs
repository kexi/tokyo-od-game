import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "7fe758a04a83835bd9667cef99b34cb21525a7a6";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-building-worker");
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const legacy = execFileSync("git", ["show", reference + ":src/world/facade.ts"], { encoding: "utf8" });
mkdirSync(".qa/reference/building-worker", { recursive: true });
writeFileSync(
  ".qa/reference/building-worker/facade.ts",
  legacy.replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, specifier) => `from "${new URL("src/world/" + specifier, url).href}"`,
  ),
);
writeFileSync(join(out, "legacy-facade.ts.txt"), legacy);
const sources = {};
for (const file of [
  "src/world/buildings.ts",
  "src/world/facade.ts",
  "src/world/facadeData.ts",
  "src/world/buildingFacadeData.ts",
  "src/world/buildingFacadeCompute.ts",
  "src/world/buildingFacade.worker.ts",
  "src/world/buildingFacadePlugin.ts",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  reference,
  legacySha256: createHash("sha256").update(legacy).digest("hex"),
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9368 });
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
  report.result = await browser.evaluate(`(async () => {
    const G = __game;
    const {BuildingFacadeCompute} = await import(new URL('src/world/buildingFacadeCompute.ts',location.href).href);
    const legacy = await import(new URL('.qa/reference/building-worker/facade.ts',location.href).href);
    const T = await import(new URL('node_modules/.vite/deps/three.js',location.href).href);
    const {frameStats,longFramesDuring} = await import(new URL('src/game/perf.ts',location.href).href);
    const frame = () => new Promise(requestAnimationFrame);
    const same = (a,b) => a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
    const compute = new BuildingFacadeCompute();
    const inline = new BuildingFacadeCompute(() => { throw new Error('QA intentional building-worker fallback'); });
    const rows = [], inputs = [];
    const oldPrepare = (input) => {
      const {geometry,matrix} = input, pos = geometry.getAttribute('position');
      const ecef = new Float32Array(pos.count*3), v = new T.Vector3();
      for(let i=0;i<pos.count;i++) { v.fromBufferAttribute(pos,i).applyMatrix4(matrix); ecef.set([v.x,v.y,v.z],i*3); }
      const ids = geometry.getAttribute('_batchid') ?? geometry.getAttribute('_feature_id_0');
      const stand = new T.BufferGeometry(); stand.setAttribute('position',pos);
      legacy.addFacadeAttribute(stand,ecef,ids ? i=>ids.getX(i) : null);
      const facade = stand.getAttribute('facade').array; stand.dispose();
      return {ecef,facade};
    };
    const collect = (region) => {
      const candidates = [];
      G.buildings.tiles.forEachLoadedModel((scene,tile) => {
        const walk = (object,parentMatrix) => {
          const matrix = parentMatrix ? new T.Matrix4().multiplyMatrices(parentMatrix,object.matrix) : object.matrix.clone();
          const isPreparedMesh=object.isMesh && object.geometry.hasAttribute('facade');
          if(isPreparedMesh) candidates.push({geometry:object.geometry,matrix,
            url:new URL(tile.content.uri,tile.internal.basePath+'/').href, region});
          for(const child of object.children) walk(child,matrix);
        };
        walk(scene,null);
      });
      return candidates.toSorted((a,b)=>b.geometry.getAttribute('position').count-a.geometry.getAttribute('position').count).slice(0,16);
    };
    try {
      inputs.push(...collect('tokyo'));
      G.debug.roads.warp({name:'QA building Azuma',kind:'QA',lat:35.7101,lon:139.8015});
      for(let i=0;i<240;i++) {
        const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
        const isLanded=landed?.to==='QA building Azuma'&&!G.debug.roads.input().loading;
        if(isLanded)break;
        const isTimedOut=i===239;
        if(isTimedOut)throw new Error('warp not finished');
        await new Promise(r=>setTimeout(r,250));
      }
      await new Promise(r=>setTimeout(r,15000));
      inputs.push(...collect('azuma'));
      const hasTooFewInputs=inputs.length<12;
      if(hasTooFewInputs)throw new Error('not enough actual building meshes');
      let values=0,productionValues=0;
      for(let i=0;i<inputs.length;i++) {
        const input=inputs[i], expected=oldPrepare(input);
        const key='qa-building-parity-'+i;
        const actual=await compute.prepare(input.geometry,input.matrix,key);
        const fallback=await inline.prepare(input.geometry,input.matrix,key+'-inline');
        const hasDifferentOutput=!same(expected.ecef,actual.ecef)||!same(expected.facade,actual.facade)||!same(expected.ecef,fallback.ecef)||!same(expected.facade,fallback.facade);
        if(hasDifferentOutput)
          throw new Error('building worker/fallback values differ: '+i);
        const installed=input.geometry.getAttribute('facade').array;
        const hasDifferentInstalledAttribute=!same(expected.facade,installed);
        if(hasDifferentInstalledAttribute)throw new Error('installed production attribute differs from legacy: '+i);
        const pos=input.geometry.getAttribute('position'), ids=input.geometry.getAttribute('_batchid')??input.geometry.getAttribute('_feature_id_0');
        const arrays=[pos.isInterleavedBufferAttribute?pos.data.array:pos.array,ids?(ids.isInterleavedBufferAttribute?ids.data.array:ids.array):new Uint8Array()];
        const bytes=new Uint8Array(arrays.reduce((a,b)=>a+b.byteLength,0));let offset=0;
        for(const array of arrays){bytes.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),offset);offset+=array.byteLength;}
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        rows.push({region:input.region,url:input.url,vertices:pos.count,positionType:pos.array?.constructor.name??pos.data.array.constructor.name,
          interleaved:!!pos.isInterleavedBufferAttribute,normalized:pos.normalized,idAttribute:ids?(input.geometry.hasAttribute('_batchid')?'_batchid':'_feature_id_0'):null,
          sourceSha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),matrix:input.matrix.elements,matched:true});
        input.expected=expected; values+=expected.ecef.length+expected.facade.length;productionValues+=installed.length;
        await frame();
      }
      const samples=[];
      for(let round=0;round<4;round++)for(const mode of round%2===0?['sync','worker','inline']:['inline','worker','sync']) {
        const stamps=[];let done=false;
        const frames=new Promise(resolve=>{const loop=t=>{stamps.push(t);if(done)resolve(stamps);else requestAnimationFrame(loop);};requestAnimationFrame(loop);});
        const watch=longFramesDuring(performance.now(),frames);
        await new Promise(r=>setTimeout(r,200));
        const measurements=[],outputs=[];
        for(let i=0;i<inputs.length;i++) {
          const input=inputs[i],key='qa-building-sample-'+round+'-'+mode+'-'+i,start=performance.now();
          let data,mainMs,metrics;
          const isSynchronous=mode==='sync';
          if(isSynchronous){data=oldPrepare(input);mainMs=performance.now()-start;metrics={mainMs,computeMs:mainMs};}
          else {
            const pending=(mode==='worker'?compute:inline).prepare(input.geometry,input.matrix,key);
            const callMs=performance.now()-start;
            data=await pending;
            const entry=G.debug.logs.query({event:'building_facade_prepared'}).findLast(e=>e.key===key);
            const hasMissingMetrics=!entry||entry.backend!==mode;
            if(hasMissingMetrics)throw new Error('own job metrics missing');
            metrics={...entry,callMs};mainMs=entry.mainMs;
          }
          measurements.push({...metrics,latencyMs:performance.now()-start});outputs.push(data);
          await frame();
        }
        await new Promise(r=>setTimeout(r,500));done=true;
        const {result,long}=await watch;
        for(let i=0;i<inputs.length;i++) {
          const hasDifferentTimedOutput=!same(outputs[i].ecef,inputs[i].expected.ecef)||!same(outputs[i].facade,inputs[i].expected.facade);
          if(hasDifferentTimedOutput)throw new Error('timed result differs');
        }
        const main=measurements.map(r=>r.mainMs).toSorted((a,b)=>a-b);
        samples.push({round,mode,mainMs:main.reduce((a,b)=>a+b,0),maxMainMs:main.at(-1),p95MainMs:main[Math.floor(main.length*.95)],
          frames:frameStats(result),long,measurements});
      }
      const actualErrors=G.debug.logs.query({event:/uncaught_error|log_schema_invalid/});
      const hasRuntimeErrors=actualErrors.length>0;
      if(hasRuntimeErrors)throw new Error('runtime errors');
      return {session:G.debug.logs.query({limit:1}).at(-1)?.traceId,userAgent:navigator.userAgent,render:G.renderInfo,
        rows,parity:{values,productionValues,matched:true},samples,errors:actualErrors,
        expectedFailures:G.debug.logs.query({event:'building_worker_failed'}).filter(e=>e.error==='Error: QA intentional building-worker fallback')};
    } finally { compute.dispose();inline.dispose(); }
  })()`);
  save();
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      parity: report.result.parity,
      meshes: report.result.rows.length,
      samples: report.result.samples.map(({ round, mode, mainMs, maxMainMs, p95MainMs, frames }) => ({
        round,
        mode,
        mainMs,
        maxMainMs,
        p95MainMs,
        frames,
      })),
    }) + "\n",
  );
} finally {
  await browser.close();
}
