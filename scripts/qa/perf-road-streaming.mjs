// Measure the complete streamed install, including the frames after new GPU data is published.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-streaming",
);
const detailed = process.env.QA_TIMING_ONLY !== "1";
const captureVector = process.env.QA_CAPTURE_VECTOR === "1";
const captureBindings = process.env.QA_BINDINGS === "1";
const coalesceBindings = process.env.QA_COALESCE === "1";
const capturePedestrians = process.env.QA_PEDESTRIANS === "1";
mkdirSync(out, { recursive: true });
const currentSources = {};
for (const file of [
  "src/main.ts",
  "src/game/frameWork.ts",
  "src/game/serialWork.ts",
  "src/game/witnessShot.ts",
  "src/render/frame.ts",
  "src/render/renderer.ts",
  "scripts/qa/uniformUploads.ts",
  "src/render/streamedInstanceShaders.ts",
  "src/world/roadInstances.ts",
  "src/game/autoDriver.ts",
  "src/world/human.ts",
  "src/world/humanParts.ts",
  "src/world/pedestrians.ts",
  "src/game/policePatrol.ts",
  "src/game/robotaxi.ts",
  "src/game/drivingRoute.ts",
  "src/game/drivingRouteData.ts",
  "src/game/drivingRoutePlanner.ts",
  "src/game/drivingRoute.worker.ts",
  "src/world/buildings.ts",
  "src/world/buildingFootprints.ts",
  "src/world/facade.ts",
  "src/world/buildingGpuUnload.ts",
  "src/world/facadeData.ts",
  "src/world/buildingFacadeData.ts",
  "src/world/buildingFacadeCompute.ts",
  "src/world/buildingFacade.worker.ts",
  "src/world/buildingFacadePlugin.ts",
  "src/world/buildingShaders.ts",
  "src/world/facadeShaderLayouts.ts",
  "src/world/terrain.ts",
  "src/world/terrainWaterTriangles.ts",
  "src/world/terrainMaterial.ts",
  "src/world/terrainData.ts",
  "src/world/terrainCompute.ts",
  "src/world/terrain.worker.ts",
  "src/world/dem.ts",
  "src/world/water.ts",
  "src/world/waterGeometry.ts",
  "src/world/pavements.ts",
  "src/world/roadTiles.ts",
  "src/world/gsiVectorTiles.ts",
  "src/world/vectorTileData.ts",
  "src/world/vectorTileCompute.ts",
  "src/world/vectorTile.worker.ts",
  "src/world/vectorTilePolygons.ts",
  "src/geo/frame.ts",
  "src/geo/geoid.ts",
  "src/physics/colliderSnapshot.ts",
  "src/physics/colliderCompute.ts",
  "src/physics/collider.worker.ts",
  "src/world/roadNetworkBuilder.ts",
  "src/world/roadNetworkData.ts",
  "src/world/roadNetwork.worker.ts",
  "src/world/roadNetworkPacket.ts",
  "src/world/roads.ts",
  "src/logEvents.ts",
]) {
  const source = readFileSync(file, "utf8");
  currentSources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  currentSources,
  measurement: {
    detailed,
    cpuProfiler: !!process.env.QA_PROFILE,
    captureVector,
    captureBindings,
    coalesceBindings,
    capturePedestrians,
  },
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
  samples: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const preload = captureVector
  ? `{
  window.__qaVectorTiles=[];window.__qaVectorInput=new WeakMap();
  const fetchTile=window.fetch.bind(window);
  window.fetch=(input,...args)=>{
    const url=typeof input==='string'?input:input.url??String(input);
    const vector=/\\/(\\d+)\\/(\\d+)\\/(\\d+)\\.(pbf|mvt)$/.exec(url);
    if(!vector)return fetchTile(input,...args);
    return fetchTile(input,...args).then(response=>{
      const read=response.arrayBuffer.bind(response);
      response.arrayBuffer=()=>read().then(buffer=>{
        const entry={url,z:Number(vector[1]),x:Number(vector[2]),y:Number(vector[3]),
          source:vector[4]==='pbf'?'gsi':'pavement',buffer,
          geometryMs:0,geometryCalls:0,geometryMaxMs:0,featureMs:0,featureCalls:0,featureMaxMs:0};
        __qaVectorTiles.push(entry);__qaVectorInput.set(buffer,entry);return buffer;
      });return response;
    });
  };
}`
  : null;
const browser = await launch(url.href, { port: 9359, preload });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  if (captureVector) {
    await browser.evaluate(`(async()=>{
      const path=performance.getEntriesByType('resource').find(e=>e.name.includes('/@mapbox_vector-tile.js'))?.name;
      if(!path)throw new Error('actual vector-tile module missing');
      const {VectorTileFeature,VectorTileLayer}=await import(path);
      const wrap=(object,method,phase)=>{
        const original=object[method];
        object[method]=function(...args){
          const at=performance.now();
          try{return original.apply(this,args);}
          finally{
            const ms=performance.now()-at,entry=__qaVectorInput.get(this._pbf.buf.buffer);
            if(entry){entry[phase+'Ms']+=ms;entry[phase+'Calls']++;entry[phase+'MaxMs']=Math.max(entry[phase+'MaxMs'],ms);}
          }
        };
      };
      wrap(VectorTileFeature.prototype,'loadGeometry','geometry');
      wrap(VectorTileLayer.prototype,'feature','feature');
    })()`);
  }
  report.demParity = await browser.evaluate(`(async () => {
    const {DemCompute} = await import(new URL('src/world/demCompute.ts',location.href).href);
    const {smoothGround,parseDemText} = await import(new URL('src/world/demData.ts',location.href).href);
    const compute = new DemCompute();
    try {
      const src = Float32Array.from({length:65536}, (_,i) => Math.sin(i*.17)*10 + (i%73===0?12:0));
      const ground = await compute.smooth(src), expected = smoothGround(src);
      const text = '1.5,e,0\\n-3,4';
      const surveyed = await compute.parse(text), reference = parseDemText(text);
      const same = (a,b) => {
        const x=new Uint32Array(a.buffer), y=new Uint32Array(b.buffer);
        return x.every((v,i)=>v===y[i]);
      };
      const matched = same(ground,expected) && same(surveyed,reference);
      if (!matched || !compute.worker) throw new Error('actual DEM worker output differs from inline');
      return {matched,groundValues:ground.length,surveyedValues:surveyed.length,worker:true};
    } finally { compute.worker?.terminate(); }
  })()`);
  await browser.evaluate("__game.start()");
  const started = await browser.evaluate("__game.getState() === 'playing'");
  if (!started) throw new Error("game did not enter playing state");
  await browser.sleep(30000);
  const warmed = await browser.evaluate(`__game.getState() === 'playing' &&
    __game.debug.roads.input().lines.length > 100 &&
    __game.debug.logs.query({event:'road_network_built'}).at(-1)?.segments > 100 &&
    !__game.debug.roads.input().loading`);
  if (!warmed) throw new Error("game or road data not ready after warmup (check for HMR)");
  report.context = await browser.evaluate(`(async () => {
    const { GRAPHICS } = await import(new URL('src/device.ts', location.href).href);
    return { render:__game.renderInfo, graphics:GRAPHICS.settings, userAgent:navigator.userAgent,
      input:__game.debug.roads.input().lines.length, initial:__game.debug.logs.query({event:'road_network_built'}).at(-1),
      session:__game.debug.logs.query({limit:1}).at(-1)?.traceId };
  })()`);
  if (process.env.QA_PROFILE) {
    await browser.send("Performance.enable", { timeDomain: "timeTicks" });
    const before = await browser.evaluate("performance.now()");
    const metrics = await browser.send("Performance.getMetrics");
    const after = await browser.evaluate("performance.now()");
    const clock = Object.fromEntries(metrics.result.metrics.map((m) => [m.name, m.value]));
    const mapped = (clock.Timestamp - clock.NavigationStart) * 1000;
    const isSameClock = mapped >= before - 1 && mapped <= after + 1;
    if (!isSameClock) throw new Error("CDP and page clock mapping differs");
    report.clock = { navigationStart: clock.NavigationStart, before, after, mapped };
  }
  await browser.evaluate(`window.__qaGame=__game; window.__qaMeshes = () => {
    const G = __game;
    return [...G.debug.roads.surface.meshes.values(), ...G.control.meshes, ...G.control.plates,
      ...G.guideSigns.meshes, G.streetLights.metal, G.streetLights.lens,
      ...G.orbis.meshes, ...G.furniture.group.children].filter(Boolean);
  }`);
  await browser.evaluate(`window.__qaCpu=[];window.__qaShaders=[];
    window.__qaAsyncShaders=[];window.__qaKeptMetadata=[];window.__qaPavements=[];
    window.__qaWorldWork=[];window.__qaWitness=[];`);
  if (capturePedestrians) {
    await browser.evaluate(`(async()=>{
      const path=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/src/world/pedestrians.ts'))?.name;
      if(!path)throw new Error('actual pedestrians module missing');
      const {Pedestrians}=await import(path),prototype=Pedestrians.prototype;
      window.__qaPedestrians=[];
      for(const method of ['spawn','fill']){
        const original=prototype[method];
        if(typeof original!=='function')throw new Error('pedestrian '+method+' missing');
        prototype[method]=function(...args){
          const at=performance.now(),before=this.list.length;
          try{return original.apply(this,args);}
          finally{__qaPedestrians.push({at,method,ms:performance.now()-at,before,after:this.list.length});}
        };
      }
    })()`);
  }
  if (coalesceBindings) {
    await browser.evaluate(`(async()=>{
      const {coalesceUniformUploads}=await import(new URL('scripts/qa/uniformUploads.ts',location.href).href);
      const control=coalesceUniformUploads(__game.renderer);
      if(!control)throw new Error('QA WebGPU upload experiment unavailable');
    })()`);
  }
  if (captureBindings) {
    await browser.evaluate(`{
      const backend=__game.renderer.backend;
      const unavailable=!backend.isWebGPUBackend||!backend.bindingUtils?.updateBinding;
      if(unavailable)throw new Error('WebGPU binding updates unavailable');
      const original=backend.bindingUtils.updateBinding;
      const empty=()=>({calls:0,ms:0,nativeWrites:0,nativeBytes:0,legacyWrites:0,legacyBytes:0,coalescible:0,coalescibleWrites:0,coalescibleBytes:0,
        coalescedBytes:0,maxSpanBytes:0,maxRanges:0,maxMs:0});
      let frame=empty(),uniformUpload=false;window.__qaUniformFrames=[];
      const queue=backend.device.queue,write=queue.writeBuffer;
      queue.writeBuffer=function(...args){
        const result=write.apply(this,args);
        if(uniformUpload){
          const data=args[2],unit=data.BYTES_PER_ELEMENT??1,start=args[3]??0;
          const bytes=args[4]===undefined?data.byteLength-start*unit:args[4]*unit;
          frame.nativeWrites++;frame.nativeBytes+=bytes;
        }
        return result;
      };
      const flush=at=>{__qaUniformFrames.push({at,...frame});frame=empty();requestAnimationFrame(flush);};
      requestAnimationFrame(flush);
      backend.bindingUtils.updateBinding=function(binding){
        const at=performance.now(),isUniform=binding.isUniformsGroup===true,previous=uniformUpload;
        uniformUpload=isUniform;
        try{return original.call(this,binding);}
        finally{
          const ms=performance.now()-at;uniformUpload=previous;
          if(isUniform){
            const ranges=binding.updateRanges,array=binding.buffer;
            let writes=1,values=0,first=Infinity,last=0;
            for(let i=0;i<ranges.length;i++){
              const range=ranges[i],end=range.start+range.count;
              first=Math.min(first,range.start);last=Math.max(last,end);values+=range.count;
              const separated=i>0&&ranges[i-1].start+ranges[i-1].count!==range.start;
              if(separated)writes++;
            }
            const bytes=ranges.length?values*4:array.byteLength;
            frame.calls++;frame.ms+=ms;frame.legacyWrites+=writes;frame.legacyBytes+=bytes;
            frame.maxMs=Math.max(frame.maxMs,ms);frame.maxRanges=Math.max(frame.maxRanges,ranges.length);
            const span=(last-first)*4;
            const canCoalesce=writes>1&&span<=4096&&array instanceof Float32Array;
            if(canCoalesce){frame.coalescible++;frame.coalescibleWrites+=writes;
              frame.coalescibleBytes+=bytes;frame.coalescedBytes+=span;frame.maxSpanBytes=Math.max(frame.maxSpanBytes,span);}
          }
        }
      };
    }`);
  }
  if (detailed) {
    await browser.evaluate(`(async()=>{
      const {WitnessShot}=await import(new URL('src/game/witnessShot.ts',location.href).href);
      let active=null;
      const draw=WitnessShot.prototype.draw;
      WitnessShot.prototype.draw=function(w,h){
        const previous=active;
        active={w,h,kind:w===64?'probe':'photo'};
        const at=performance.now();
        try{return draw.call(this,w,h);}
        finally{__qaWitness.push({phase:'draw',at,ms:performance.now()-at,...active});active=previous;}
      };
      const wrap=(object,method,phase,detail=()=>({}))=>{
        const original=object[method];
        object[method]=function(...args){
          const context=active,at=performance.now();
          try{return original.apply(this,args);}
          finally{if(context)__qaWitness.push({phase,at,ms:performance.now()-at,...context,...detail(args)});}
        };
      };
      wrap(__game.renderer,'render','render');
      wrap(__game.composer,'toDisplay','toDisplay');
      wrap(__game.renderer,'readRenderTargetPixelsAsync','readSubmit');
      wrap(__game.scene,'updateMatrixWorld','matrices');
      wrap(__game.renderer.backend,'createRenderPipeline','pipeline',args=>({material:args[0].material.name,async:!!args[1]}));
      wrap(__game.renderer.backend,'updateTexture','textureUpdate',args=>({name:args[0].name}));
      wrap(__game.renderer.backend,'createTexture','textureCreate',args=>({name:args[0].name}));
    })()`);
    await browser.evaluate(`{
      const queue=__game.water.tileWork,run=queue.run;
      let active=0;
      queue.run=function(task){
        const caller=new Error().stack??'',queuedAt=performance.now();
        const isShore=caller.includes('/world/water.ts');
        const kind=isShore?'shore':'roads';
        return run.call(this,async()=>{
          const at=performance.now(),overlap=++active;
          try{return await task();}
          finally{active--;__qaWorldWork.push({kind,queuedAt,at,end:performance.now(),overlap});}
        });
      };
    }`);
    await browser.evaluate(`(async () => {
    const {BuildingMetadataPlugin}=await import(new URL('src/world/buildingMetadata.ts',location.href).href);
    const original=BuildingMetadataPlugin.prototype.parseTile;
    window.__qaKeptMetadata=[];
    BuildingMetadataPlugin.prototype.parseTile=function(buffer,...args){
      const result=original.call(this,buffer,...args);
      const hasHeader=buffer.byteLength>=28;
      if(result!==null||!hasHeader)return result;
      const header=new DataView(buffer);
      const hasBatch=header.getUint32(0,true)===0x6d643362&&header.getUint32(20,true)>0;
      if(!hasBatch)return result;
      __qaKeptMetadata.push({url:args[2],bytes:buffer.byteLength,
        header:Array.from({length:6},(_,i)=>header.getUint32((i+1)*4,true))});
      return result;
    };
  })()`);
    await browser.evaluate(`window.__qaCpu = []; window.__qaWrap = (object, method, phase) => {
    const original = object[method];
    object[method] = function(...args) {
      const start = performance.now();
      try { return original.apply(this,args); }
      finally {
        const ms=performance.now()-start;
        const isRender=phase==='render';
        const view=isRender ? {world:args[0]===__game.scene,far:args[1]?.far,layers:args[1]?.layers?.mask} : undefined;
        __qaCpu.push({phase,at:start,ms,view});
      }
    };
  };
  __qaWrap(__game.world,'step','physics');
  __qaWrap(__game.renderer,'render','render');
  __qaWrap(__game.terrain,'update','terrain');
  __qaWrap(__game.buildings,'update','buildings');
  __qaWrap(__game.buildings,'cutFootprints','buildingCutFootprints');
  __qaWrap(__game.terrain,'createCollider','terrainColliderInstall');
  __qaWrap(__game.terrain,'prepareCollider','terrainColliderPrepare');
  __qaWrap(__game.terrain,'applyWater','terrainWaterRefresh');
  __qaWrap(__game.buildings,'createCollider','buildingColliderInstall');
  __qaWrap(__game.buildings,'prepareCollider','buildingColliderPrepare');
  __qaWrap(__game.streetLights,'update','lights');
  __qaWrap(__game.nav,'update','nav');
  for (const [object,method,phase] of [
    [__game.pedestrians,'update','pedestrians'], [__game.traffic,'update','traffic'],
    [__game.field,'refresh','poiRefresh'], [__game.field,'update','poiDraw'],
    [__game.env,'update','environment'], [__game.water,'renderReflection','reflection'],
    [__game.transit,'update','transit'], [__game.control,'update','control'],
    [__game.guideSigns,'update','guideSigns'], [__game.orbis,'update','orbis'],
  ]) __qaWrap(object,method,phase);`);
    await browser.evaluate(`const pavements=__game.pavements,rebuild=pavements.rebuildAsync;
    pavements.rebuildAsync=function(polys,frame,work){
      const at=performance.now();
      return rebuild.call(this,polys,frame,work).finally(()=>{
        __qaPavements.push({at,polygons:polys.length,durationMs:performance.now()-at,
          cpuMs:work.cpuMs,maxSliceMs:work.maxSliceMs,yields:work.yields});
      });
    };`);
    await browser.evaluate(`window.__qaShaders=[];window.__qaAsyncShaders=[];
    const original=__game.renderer.debug.onNodeBuilderCreated;
    __game.renderer.debug.onNodeBuilderCreated=(builder,renderObject)=>{
      original?.(builder,renderObject);
      const build=builder.build;
      builder.build=function(...args){
        const start=performance.now();
        try{return build.apply(this,args);}
        finally{
          const m=this.material,g=this.object?.geometry;
          __qaShaders.push({at:start,ms:performance.now()-start,name:m?.name,type:m?.type,
            constructor:m?.constructor.name,windows:m?.windows,shadow:m?.isShadowPassMaterial===true,
            objectName:this.object?.name,world:this.scene===__game.scene,
            attributes:Object.keys(g?.attributes??{}),vertices:g?.attributes.position?.count,indexed:!!g?.index});
        }
      };
      const buildAsync=builder.buildAsync;
      if(buildAsync)builder.buildAsync=async function(...args){
        const start=performance.now(),m=this.material,g=this.object?.geometry;
        try{return await buildAsync.apply(this,args);}
        finally{__qaAsyncShaders.push({at:start,durationMs:performance.now()-start,name:m?.name,
          constructor:m?.constructor.name,windows:m?.windows,objectName:this.object?.name,
          geometryKey:renderObject.getGeometryCacheKey(),cacheKey:renderObject.initialCacheKey,
          layout:Object.fromEntries(Object.entries(g?.attributes??{}).map(([key,a])=>[key,
            {size:a.itemSize,normalized:a.normalized,type:a.array.constructor.name,
             stride:a.data?.stride,offset:a.offset,count:a.count}])),indexed:!!g?.index});}
      };
    };`);
  }
  const modes = process.env.QA_MODES?.split(",") ?? [
    "baseline",
    "update",
    "baseline",
    "update",
    "update",
    "recenter",
    "coldWarp",
    "latestWarp",
  ];
  for (const mode of modes) {
    if (process.env.QA_PROFILE) {
      await browser.send("Profiler.enable");
      await browser.send("Profiler.setSamplingInterval", { interval: 1000 });
      await browser.send("Profiler.start");
      await browser.sleep(3000);
    }
    const sample = await browser.evaluate(`(async () => {
      const G = __game;
      const {frameStats, longFramesDuring} = await import(new URL('src/game/perf.ts', location.href).href);
      const stamps = [];
      let finished = false;
      const frames = new Promise(resolve => {
        const loop = t => { stamps.push(t); if(finished) resolve(stamps); else requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      });
      const watchStart = performance.now();
      const watchDate = new Date().toISOString();
      const beforeWaterCount=G.debug.logs.query({event:'water_masks_prepared'}).length;
      const beforeMetadataCount=G.debug.logs.query({event:'building_batch_table_skipped'}).length;
      const beforeKeptMetadata=__qaKeptMetadata.length;
      const watch = longFramesDuring(watchStart, frames);
      await new Promise(r => setTimeout(r, 150));
      const beforeMeshes = new Set(__qaMeshes()), beforeParked = new Set(G.traffic.parkedPoses().map(p=>p.key));
      const beforeLines = G.debug.roads.input().lines;
      const beforeFrame = G.getFrame(), beforeGeo = beforeFrame.toGeodetic(G.vehicle.position());
      const start = performance.now();
      __qaCpu = [];
      __qaShaders = [];
      __qaAsyncShaders = [];
      let heldUntilReady = null, landed = null;
      if (${JSON.stringify(mode)} === 'baseline') await new Promise(r => setTimeout(r, 6000));
      else if (${JSON.stringify(mode)} === 'update') {
        if (!await G.debug.roads.rebuild()) throw new Error('rebuild discarded');
      } else if (${JSON.stringify(mode)} === 'recenter') {
        const pending = G.debug.roads.recenter();
        heldUntilReady = G.getFrame() === beforeFrame;
        await pending;
      } else {
        const cold = ${JSON.stringify(mode)} === 'coldWarp';
        if (!cold) G.debug.roads.warp({name:'QA obsolete', kind:'QA', lat:35.6896, lon:139.6917});
        const goal = cold ? {lat:35.7101,lon:139.8015} : {lat:35.6813,lon:139.7671};
        const label = cold ? 'QA cold Azuma bridge' : 'QA latest';
        G.debug.roads.warp({name:label,kind:'QA',...goal});
        for (let i = 0; i < 360; i++) {
          const input = G.debug.roads.input();
          landed = G.debug.logs.query({event:'warp_landed'}).at(-1);
          const near = Math.abs(input.center.lat-goal.lat)<0.002 && Math.abs(input.center.lon-goal.lon)<0.002;
          const done = landed?.to === label && input.lines !== beforeLines && near && !input.loading;
          if (done) break;
          if (i === 359) throw new Error('warp or new road data did not finish');
          await new Promise(r=>setTimeout(r,250));
        }
        const origin = G.getFrame().origin;
        if(Math.abs(origin.lat-goal.lat)>0.00001 || Math.abs(origin.lon-goal.lon)>0.00001)
          throw new Error('obsolete warp changed the final origin');
        await new Promise(r => setTimeout(r, 10000));
      }
      const elapsed = performance.now() - start;
      await new Promise(r => setTimeout(r,2000));
      finished = true;
      const {result,long} = await watch;
      const afterMeshes = __qaMeshes(), afterParked = G.traffic.parkedPoses();
      const reused = afterMeshes.filter(m=>beforeMeshes.has(m)).length;
      const parkedReused = afterParked.filter(p=>beforeParked.has(p.key)).length;
      const phases = Object.fromEntries([...new Set(__qaCpu.map(r=>r.phase))].map(phase=>{
        const rows = __qaCpu.filter(r=>r.phase===phase).map(r=>r.ms).toSorted((a,b)=>a-b);
        return [phase,{calls:rows.length,mean:rows.reduce((a,b)=>a+b,0)/rows.length,max:rows.at(-1),p95:rows[Math.floor(rows.length*.95)]}];
      }));
      if (${JSON.stringify(mode)} === 'update' && (reused !== afterMeshes.length || parkedReused !== afterParked.length))
        throw new Error('unchanged road data recreated render objects');
      const framePeaks=result.slice(1).map((end,i)=>({start:result[i],end,ms:end-result[i]})).toSorted((a,b)=>b.ms-a.ms).slice(0,12);
      const slow=__qaCpu.filter(r=>r.ms>=20).toSorted((a,b)=>b.ms-a.ms).slice(0,40);
      const worldWork=__qaWorldWork.filter(row=>row.end>=watchStart);
      const overlapped=worldWork.some(row=>row.overlap!==1);
      if(overlapped)throw new Error('shared world install work overlapped');
      return {mode:${JSON.stringify(mode)},elapsed,watchStart,framePeaks,slow,frames:frameStats(result),long,phases,reused,meshCount:afterMeshes.length,
        worldWork,
        witness:__qaWitness.filter(row=>row.at>=watchStart),
        parkedReused,parkedCount:afterParked.length,heldUntilReady,landed,beforeGeo,
        afterGeo:G.getFrame().toGeodetic(G.vehicle.position()),
        recentered:G.debug.logs.query({event:'frame_recentered'}).at(-1),
        installed:G.debug.logs.query({event:'road_network_built'}).at(-1),
        sameGame:G===window.__qaGame,
        routes:G.debug.logs.query({event:/route_plan_prepared|route_plan_applied|route_plan_discarded/}).filter(e=>e.ts>=watchDate),
        session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
        water:G.debug.logs.query({event:'water_masks_prepared'}).slice(beforeWaterCount),
        buildingMetadata:G.debug.logs.query({event:'building_batch_table_skipped'}).slice(beforeMetadataCount),
        buildingMetadataKept:__qaKeptMetadata.slice(beforeKeptMetadata),
        shaders:__qaShaders,
        asyncShaders:__qaAsyncShaders,
        pavementPreparation:__qaPavements.filter(entry=>entry.at>=watchStart),
        buildingPreparation:G.debug.logs.query({event:'building_facade_prepared'}).filter(e=>e.ts>=watchDate),
        buildingShaders:G.debug.logs.query({event:'building_shader_prepared'}).filter(e=>e.ts>=watchDate),
        terrainPreparation:G.debug.logs.query({event:'terrain_chunk_prepared'}).filter(e=>e.ts>=watchDate),
        colliderPreparation:G.debug.logs.query({event:'collider_shape_prepared'}).filter(e=>e.ts>=watchDate),
        roadPreparation:G.debug.logs.query({event:'road_network_prepared'}).filter(e=>e.ts>=watchDate),
        uniformFrames:${captureBindings}?__qaUniformFrames.filter(e=>e.at>=watchStart):undefined,
        pedestrianCalls:${capturePedestrians}?__qaPedestrians.filter(e=>e.at>=watchStart):undefined,
        instanceShaders:G.debug.logs.query({event:'streamed_shaders_prepared'}).filter(e=>e.ts>=watchDate),
        errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|road_worker_failed|vector_tile_worker_failed|route_worker_failed|water_worker_failed|water_tile_failed|building_worker_failed|building_shader_failed|streamed_shader_failed|terrain_worker_failed|terrain_build_failed|collider_worker_failed|log_schema_invalid/})};
    })()`);
    if (process.env.QA_PROFILE) {
      const profile = await browser.send("Profiler.stop");
      writeFileSync(join(out, `${mode}.cpuprofile`), JSON.stringify(profile.result.profile));
    }
    report.samples.push(sample);
    save();
    const isSameSession = sample.sameGame && sample.session === report.context.session;
    if (!isSameSession) throw new Error("HMR changed the measured session");
    if (sample.errors.length) throw new Error(`${mode} logged a runtime failure; see ${out}/report.json`);
    process.stdout.write(
      JSON.stringify({
        mode,
        frames: sample.frames,
        elapsed: sample.elapsed,
        installed: sample.installed,
        errors: sample.errors,
      }) + "\n",
    );
    await browser.sleep(1000);
  }
  if (captureVector) {
    report.vectorTiles = await browser.evaluate(
      `__qaVectorTiles.map(({buffer,...entry})=>({...entry,bytes:buffer.byteLength}))`,
    );
    for (let i = 0; i < report.vectorTiles.length; i++) {
      const entry = report.vectorTiles[i],
        file = `vector-${i}.bin`;
      const chunks = [];
      for (let offset = 0; offset < entry.bytes; offset += 32768) {
        const encoded = await browser.evaluate(
          `btoa(String.fromCharCode(...new Uint8Array(__qaVectorTiles[${i}].buffer,${offset},Math.min(32768,__qaVectorTiles[${i}].buffer.byteLength-${offset}))))`,
        );
        chunks.push(Buffer.from(encoded, "base64"));
      }
      writeFileSync(join(out, file), Buffer.concat(chunks));
      entry.file = file;
    }
    save();
  }
  await browser.screenshot(join(out, "night-rain.png"));
  report.host.loadAfter = loadavg();
  save();
  process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
} finally {
  await browser.close();
}
