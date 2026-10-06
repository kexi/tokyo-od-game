// Reparse the game's actual near/far tiles, keeping every GLB byte and decoded mesh unchanged.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-building-metadata",
);
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [k, v] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(k, v);
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
};
const browser = await launch(url.href, { port: 9368 });
try {
  for (let i = 0; i < 120; i++) {
    const ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    const timedOut = i === 119;
    if (timedOut) throw new Error("game not ready");
    await browser.sleep(1000);
  }
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.result = await browser.evaluate(`(async()=>{
    const G=__game;
    const isPlaying=G.getState()==='playing';
    if(!isPlaying)throw new Error('game stopped (check HMR)');
    const {omitBuildingBatchTable}=await import(new URL('src/world/buildingMetadata.ts',location.href).href);
    const {B3DMLoaderBase}=await import(new URL('node_modules/3d-tiles-renderer/src/core/renderer/loaders/B3DMLoaderBase.js',location.href).href);
    const {B3DMLoader}=await import(new URL('node_modules/3d-tiles-renderer/src/three/renderer/loaders/B3DMLoader.js',location.href).href);
    const {frameStats,longFramesDuring}=await import(new URL('src/game/perf.ts',location.href).href);
    const collect=(renderer,kind)=>{
      const urls=[];
      renderer?.forEachLoadedModel((scene,tile)=>{
        const isB3dm=tile.content?.uri?.endsWith('.b3dm');
        if(isB3dm) urls.push({kind,url:new URL(tile.content.uri,tile.internal.basePath+'/').href});
      });
      return urls.slice(0,24);
    };
    const unique=new Map([...collect(G.buildings.tiles,'near'),...collect(G.buildings.far,'far')].map(t=>[t.url,t]));
    const inputs=[];
    for(const t of unique.values()){
      const r=await fetch(t.url);const isFetched=r.ok;if(!isFetched)throw new Error('tile fetch '+r.status);
      const buffer=await r.arrayBuffer();
      const compact=omitBuildingBatchTable(buffer);
      const isCompacted=compact!==buffer;
      if(!isCompacted)throw new Error('published b3dm not compacted: '+t.url);
      const digest=await crypto.subtle.digest('SHA-256',buffer);
      inputs.push({...t,buffer,compact,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')});
    }
    const hasBothRanges=inputs.length>=6&&inputs.some(t=>t.kind==='near')&&inputs.some(t=>t.kind==='far');
    if(!hasBothRanges)throw new Error('near/far tiles unavailable');
    const base=new B3DMLoaderBase();
    const bytesEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
    const arraysEqual=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
    const rows=[];
    let glbValues=0,geometryValues=0,meshes=0;
    for(const t of inputs){
      const before=base.parse(t.buffer),after=base.parse(t.compact);
      const length=new DataView(before.glbBytes.buffer,before.glbBytes.byteOffset).getUint32(8,true);
      const sameGlb=bytesEqual(before.glbBytes.subarray(0,length),after.glbBytes.subarray(0,length));
      if(!sameGlb)throw new Error('GLB bytes differ');
      const sameFeatures=JSON.stringify(before.featureTable.header)===JSON.stringify(after.featureTable.header);
      if(!sameFeatures)throw new Error('feature semantics differ');
      glbValues+=length;
      const loader=new B3DMLoader(G.buildings.tiles.manager);
      const original=await loader.parse(t.buffer),compacted=await loader.parse(t.compact);
      original.scene.updateMatrixWorld(true);compacted.scene.updateMatrixWorld(true);
      const a=[],b=[];original.scene.traverse(o=>a.push(o));compacted.scene.traverse(o=>b.push(o));
      const sameNodes=a.length===b.length;
      if(!sameNodes)throw new Error('scene nodes differ');
      for(let i=0;i<a.length;i++){
        const sameTransform=a[i].type===b[i].type&&arraysEqual(a[i].matrixWorld.elements,b[i].matrixWorld.elements);
        if(!sameTransform)throw new Error('world transforms differ');
        geometryValues+=16;
        if(!a[i].isMesh)continue;
        meshes++;
        const x=a[i].geometry,y=b[i].geometry;
        const sameGroups=JSON.stringify(x.groups)===JSON.stringify(y.groups);
        if(!sameGroups)throw new Error('mesh groups differ');
        const names=Object.keys(x.attributes).sort();
        const sameNames=JSON.stringify(names)===JSON.stringify(Object.keys(y.attributes).sort());
        if(!sameNames)throw new Error('attribute names differ');
        for(const name of names){
          const l=x.attributes[name],r=y.attributes[name];
          const sameLayout=l.itemSize===r.itemSize&&l.count===r.count&&l.normalized===r.normalized;
          if(!sameLayout)throw new Error('attribute layout differs');
          const la=l.isInterleavedBufferAttribute?l.data.array:l.array,ra=r.isInterleavedBufferAttribute?r.data.array:r.array;
          const sameVertices=arraysEqual(la,ra);
          if(!sameVertices)throw new Error('vertex data differs: '+name);
          geometryValues+=la.length;
        }
        const sameIndices=!!x.index===!!y.index&&(!x.index||arraysEqual(x.index.array,y.index.array));
        if(!sameIndices)throw new Error('mesh indices differ');
        geometryValues+=x.index?.array.length??0;
      }
      for(const result of [original,compacted])result.scene.traverse(o=>{
        if(!o.isMesh)return;o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();
      });
      rows.push({kind:t.kind,url:t.url,sha256:t.sha256,bytesBefore:t.buffer.byteLength,bytesAfter:t.compact.byteLength,
        glbBytes:length,buildings:before.batchTable.count,propertyKeys:before.batchTable.getKeys().length,
        featureBinaryBytesBefore:before.featureTable.binLength,featureBinaryBytesAfter:after.featureTable.binLength,matched:true});
      await new Promise(r=>setTimeout(r,10));
    }
    const samples=[];
    for(let round=0;round<4;round++)for(const mode of round%2===0?['original','compact']:['compact','original']){
      let done=false;const stamps=[];
      const frames=new Promise(resolve=>{const loop=t=>{stamps.push(t);if(done)resolve(stamps);else requestAnimationFrame(loop);};requestAnimationFrame(loop);});
      const watch=longFramesDuring(performance.now(),frames);
      await new Promise(r=>setTimeout(r,200));
      const start=performance.now();let maxTileCpuMs=0;
      for(const t of inputs){
        const begin=performance.now();
        base.parse(mode==='original'?t.buffer:omitBuildingBatchTable(t.buffer));
        maxTileCpuMs=Math.max(maxTileCpuMs,performance.now()-begin);
      }
      const cpuMs=performance.now()-start;
      await new Promise(r=>setTimeout(r,1000));done=true;
      const {result,long}=await watch;
      samples.push({round,mode,cpuMs,maxTileCpuMs,frames:frameStats(result),long});
    }
    const errors=G.debug.logs.query({event:/uncaught_error|log_schema_invalid/});
    const hasErrors=errors.length>0;
    if(hasErrors)throw new Error('runtime errors: '+JSON.stringify(errors));
    return {session:G.debug.logs.query({event:'session_start'}).at(-1),userAgent:navigator.userAgent,render:G.renderInfo,
      rows,samples,parity:{matched:true,glbValues,geometryValues,meshes},errors,
      skipped:G.debug.logs.query({event:'building_batch_table_skipped'})};
  })()`);
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      parity: report.result.parity,
      tiles: report.result.rows.length,
      samples: report.result.samples,
    }) + "\n",
  );
} finally {
  await browser.close();
}
