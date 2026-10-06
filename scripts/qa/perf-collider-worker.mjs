import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "024a0678488885a7efb6681c342f921c04816dec";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-collider-worker");
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const refDir = ".qa/reference/collider-worker";
mkdirSync(refDir, { recursive: true });
const legacyHashes = {};
for (const name of ["terrain", "buildings"]) {
  const source = execFileSync("git", ["show", reference + ":src/world/" + name + ".ts"], {
    encoding: "utf8",
  });
  legacyHashes[name] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, name + "-legacy.ts.txt"), source);
  writeFileSync(
    join(refDir, name + ".ts"),
    source.replace(
      /from (["'])(\.[^"']+)\1/g,
      (_match, _quote, specifier) => 'from "' + new URL("src/world/" + specifier, url).href + '"',
    ),
  );
}
writeFileSync(
  join(refDir, "probe.ts"),
  [
    'export {default as RAPIER} from "@dimforge/rapier3d-compat";',
    'export {ColliderCompute} from "' + new URL("src/physics/colliderCompute.ts", url).href + '";',
    'export {installCollider} from "' + new URL("src/physics/colliderSnapshot.ts", url).href + '";',
    'export {Terrain as LegacyTerrain} from "./terrain";',
    'export {Buildings as LegacyBuildings} from "./buildings";',
  ].join("\n"),
);
const sources = {};
for (const file of [
  "src/world/terrain.ts",
  "src/world/terrainWaterTriangles.ts",
  "src/world/buildings.ts",
  "src/physics/colliderSnapshot.ts",
  "src/physics/colliderCompute.ts",
  "src/physics/collider.worker.ts",
  "scripts/qa/perf-collider-worker.mjs",
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
const browser = await launch(url.href, { port: 9371 });
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
    const {RAPIER:R,ColliderCompute,installCollider,LegacyTerrain,LegacyBuildings} =
      await import(new URL('.qa/reference/collider-worker/probe.ts',location.href).href);
    const compute=new ColliderCompute();
    const inline=new ColliderCompute(()=>{throw new Error('QA intentional collider fallback');});
    const frame=()=>new Promise(requestAnimationFrame);
    const same=(a,b)=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
    const rows=[];
    const triangles=model=>{
      let count=0;
      model.scene.traverse(object=>{
        if(!object.isMesh)return;
        count+=(object.geometry.index?.count??object.geometry.attributes.position?.count??0)/3;
      });
      return count;
    };
    const collect=async(region)=>{
      const candidates=[
        ...[...G.terrain.chunks.values()].filter(chunk=>chunk.mesh.visible).slice(0,12).map(chunk=>({kind:'terrain',value:chunk})),
        ...[...G.buildings.models.values()].filter(model=>model.visible).toSorted((a,b)=>
          triangles(b)-triangles(a)).slice(0,12).map(model=>({kind:'building',value:model})),
      ];
      for(let i=0;i<candidates.length;i++){
        await frame();
        const candidate=candidates[i], oldWorld=new R.World({x:0,y:0,z:0});
        const legacy=Object.create(candidate.kind==='terrain'?LegacyTerrain.prototype:LegacyBuildings.prototype);
        legacy.world=oldWorld;legacy.frame=G.getFrame();legacy.tiles=G.buildings.tiles;
        const source=candidate.kind==='terrain'?G.terrain:G.buildings;
        const clone={...candidate.value,collider:null,colliderWork:null};
        try{
          const start=performance.now();
          legacy.createCollider(clone);
          const oldMs=performance.now()-start;
          const baseline=clone.collider;
          if(!baseline)continue;
          const oldMesh=baseline.shape;
          const prepareStart=performance.now(), mesh=source.colliderMesh(candidate.value), prepareMs=performance.now()-prepareStart;
          const identicalInput=same(mesh.vertices,oldMesh.vertices)&&same(mesh.indices,oldMesh.indices);
          if(!identicalInput)throw new Error('production collider input differs from previous code: '+region+'/'+i);
          const expectedVertices=baseline.vertices(),expectedIndices=baseline.indices();
          const sampleRays=[];
          for(let t=0;t<16;t++){
            const offset=Math.floor((expectedIndices.length/3-1)*t/15)*3;
            const a=expectedIndices[offset]*3,b=expectedIndices[offset+1]*3,c=expectedIndices[offset+2]*3;
            const v=expectedVertices;
            const ab=[v[b]-v[a],v[b+1]-v[a+1],v[b+2]-v[a+2]],ac=[v[c]-v[a],v[c+1]-v[a+1],v[c+2]-v[a+2]];
            const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...n);
            if(length===0)continue;
            const direction={x:-n[0]/length,y:-n[1]/length,z:-n[2]/length};
            const origin={x:(v[a]+v[b]+v[c])/3-direction.x*2,y:(v[a+1]+v[b+1]+v[c+1])/3-direction.y*2,z:(v[a+2]+v[b+2]+v[c+2])/3-direction.z*2};
            sampleRays.push(new R.Ray(origin,direction));
          }
          const packedHit=hit=>hit?{timeOfImpact:hit.timeOfImpact,normal:hit.normal,featureType:hit.featureType,featureId:hit.featureId}:null;
          const expectedHits=sampleRays.map(ray=>packedHit(baseline.castRayAndGetNormal(ray,10,true)));
          const result={region,kind:candidate.kind,vertices:mesh.vertices.length/3,triangles:mesh.indices.length/3,
            values:expectedVertices.length+expectedIndices.length,inputValues:mesh.vertices.length+mesh.indices.length,
            identicalInput,oldMs,prepareMs,rays:sampleRays.length,hits:expectedHits.filter(Boolean).length};
          for(const [backend,engine] of [['worker',compute],['inline',inline]]){
            const callStart=performance.now(),pending=engine.prepare(mesh,'qa-collider-'+region+'-'+i+'-'+backend),callMs=performance.now()-callStart;
            const data=await pending;
            if(backend==='worker'&&(!engine.worker||!data.snapshot))throw new Error('native collider Worker missing');
            await frame();
            const world=new R.World({x:0,y:0,z:0});
            try{
              const installStart=performance.now(),actual=installCollider(world,data,candidate.kind==='terrain'?1:.6),installMs=performance.now()-installStart;
              const matched=same(actual.vertices(),expectedVertices)&&same(actual.indices(),expectedIndices)&&
                JSON.stringify(sampleRays.map(ray=>packedHit(actual.castRayAndGetNormal(ray,10,true))))===JSON.stringify(expectedHits);
              if(!matched)throw new Error('actual physics shape or ray differs: '+region+'/'+i+'/'+backend);
              const entry=G.debug.logs.query({event:'collider_shape_prepared'}).findLast(row=>row.key==='qa-collider-'+region+'-'+i+'-'+backend);
              result[backend]={matched,callMs,installMs,mainMs:prepareMs+callMs+installMs,bytes:data.snapshot?.bytes.byteLength??0,
                computeMs:entry.computeMs,durationMs:entry.durationMs};
            }finally{world.free();}
          }
          rows.push(result);
        }finally{oldWorld.free();}
      }
    };
    try{
      await collect('tokyo');
      G.debug.roads.warp({name:'QA collider Azuma',kind:'QA',lat:35.7101,lon:139.8015});
      for(let i=0;i<360;i++){
        const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
        if(landed?.to==='QA collider Azuma'&&!G.debug.roads.input().loading)break;
        if(i===359)throw new Error('warp did not complete');
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      await new Promise(resolve=>setTimeout(resolve,15000));
      await collect('azuma');
      const actualChunk=[...G.terrain.chunks.values()][0];
      const wet={...actualChunk,waterMask:new Uint8Array(16).fill(255),waterSize:4,collider:null,colliderEmpty:false,colliderWork:null};
      const pendingBefore=G.terrain.colliderCompute.jobs.size;
      G.terrain.prepareCollider(wet);
      if(!wet.colliderEmpty||wet.colliderWork||G.terrain.colliderCompute.jobs.size!==pendingBefore)
        throw new Error('fully wet ground requested an invalid empty trimesh');
      const emptyWorld=new R.World({x:0,y:-9.81,z:0});
      let waterBoundary;
      try{
        const host=Object.create(Object.getPrototypeOf(G.terrain));host.world=emptyWorld;
        host.createCollider(wet);
        if(emptyWorld.colliders.len()!==0)throw new Error('fully wet ground acquired a solid collider');
        const body=emptyWorld.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,3,0));
        emptyWorld.createCollider(R.ColliderDesc.cuboid(.5,.25,.5),body);
        for(let step=0;step<30;step++)emptyWorld.step();
        if(body.translation().y>=2)throw new Error('known water did not allow falling');
        waterBoundary={ready:wet.colliderEmpty,triangles:host.colliderMesh(wet).indices.length/3,afterY:body.translation().y};
      }finally{emptyWorld.free();}
      if(rows.filter(row=>row.kind==='terrain').length<12||rows.filter(row=>row.kind==='building').length<12)
        throw new Error('too few real collider fixtures');
      return {rows,waterBoundary,session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
        render:G.renderInfo,values:rows.reduce((n,row)=>n+row.values,0),inputValues:rows.reduce((n,row)=>n+row.inputValues,0)};
    }finally{compute.dispose();inline.dispose();}
  })()`);
  report.logs = browser.logs;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      rows: report.result.rows.length,
      values: report.result.values,
      inputValues: report.result.inputValues,
      session: report.result.session,
    }) + "\n",
  );
} finally {
  await browser.close();
}
