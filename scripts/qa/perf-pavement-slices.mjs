import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "bcaffe09690df55bcaec39f744f33778dbfc22a8";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-pavement-slices");
const refDir = ".qa/reference/pavement-slices";
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
const legacy = execFileSync("git", ["show", reference + ":src/world/pavements.ts"], { encoding: "utf8" });
writeFileSync(join(out, "pavements-legacy.ts.txt"), legacy);
writeFileSync(
  join(refDir, "pavements.ts"),
  legacy.replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, specifier) =>
      'from "' + new URL(specifier, new URL("src/world/pavements.ts", url)).href + '"',
  ) + "\nexport {toLocalRing,densify};\n",
);
writeFileSync(
  join(refDir, "probe.ts"),
  `export {Scene,ShapeUtils} from 'three';
export {default as RAPIER} from '@dimforge/rapier3d-compat';
export {Pavements,PavementTiles,KERB,liftedHeights,liftedHeightSteps} from '${new URL("src/world/pavements.ts", url).href}';
export {FrameWork} from '${new URL("src/game/frameWork.ts", url).href}';
export {GRAPHICS} from '${new URL("src/device.ts", url).href}';`,
);
const sources = {};
for (const file of [
  "src/world/pavements.ts",
  "src/game/frameWork.ts",
  "scripts/qa/perf-pavement-slices.mjs",
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
const browser = await launch(url.href, { port: 9374 });
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
    const {Scene,ShapeUtils,RAPIER:R,Pavements,PavementTiles,KERB,liftedHeights,liftedHeightSteps,FrameWork,GRAPHICS}=
      await import(new URL('.qa/reference/pavement-slices/probe.ts',location.href).href);
    const legacy=await import(new URL('.qa/reference/pavement-slices/pavements.ts',location.href).href);
    const frame=()=>new Promise(requestAnimationFrame);
    const rows=[],areas=[];let compared=0,queries=0;
    const same=(a,b,label)=>{
      const lengthDiffers=a.length!==b.length;
      if(lengthDiffers)throw new Error(label+' length changed');
      for(let i=0;i<a.length;i++){
        const differs=!Object.is(a[i],b[i]);
        if(differs)throw new Error(label+' value changed at '+i);
        compared++;
      }
    };
    const capture=(p,world)=>{
      const colliders=[];
      world.colliders.forEach(c=>colliders.push({vertices:Array.from(c.vertices()),indices:Array.from(c.indices())}));
      return {
      geometry:p.meshes.map(m=>({attributes:Object.fromEntries(Object.entries(m.geometry.attributes).map(([k,a])=>[k,Array.from(a.array)])),index:Array.from(m.geometry.index.array)})),
      colliders,
      count:p.count
      };
    };
    const compare=(a,b)=>{
      const countDiffers=a.count!==b.count||a.geometry.length!==b.geometry.length||a.colliders.length!==b.colliders.length;
      if(countDiffers)throw new Error('mesh/collider/polygon count changed');
      for(let i=0;i<a.geometry.length;i++){
        same(a.geometry[i].index,b.geometry[i].index,'draw indices');
        for(const [key,values] of Object.entries(a.geometry[i].attributes))same(values,b.geometry[i].attributes[key],key);
      }
      for(let i=0;i<a.colliders.length;i++){
        same(a.colliders[i].vertices,b.colliders[i].vertices,'physical vertices');
        same(a.colliders[i].indices,b.colliders[i].indices,'physical indices');
      }
    };
    const cleanup=(p,world)=>{
      p.clear();
      for(const material of [...Object.values(p.materials),p.kerbMaterial]){
        material.map?.dispose();material.dispose();
      }
      world.free();
    };
    const collect=async(region,wards)=>{
      const local=G.getFrame(),origin=local.origin;
      const all=await new PavementTiles().around(origin.lat,origin.lon,wards);
      const selected=all.toSorted((a,b)=>b.rings.reduce((n,r)=>n+r.length,0)-a.rings.reduce((n,r)=>n+r.length,0)).slice(0,48);
      const tooFew=selected.length<8;
      if(tooFew)throw new Error('too few real polygons: '+region);
      const field=new Map();
      const record=(x,z)=>{
        const key=x+','+z;
        let h=field.get(key);
        const missing=h===undefined;
        if(missing){h=G.groundY(x,z)??0;field.set(key,h);}
        return h;
      };
      const frozen=(x,z)=>{
        const key=x+','+z,missing=!field.has(key);
        if(missing)throw new Error('new height coordinate: '+key);
        queries++;return field.get(key);
      };
      const high=[];
      for(const poly of selected){
        const rings=poly.rings.map(r=>legacy.densify(legacy.toLocalRing(r,local)));
        const points=rings.flat(),tris=ShapeUtils.triangulateShape(rings[0],rings.slice(1));
        const expected=legacy.liftedHeights(points,tris,(x,z)=>record(x,z)+KERB);
        const actual=liftedHeights(points,tris,(x,z)=>frozen(x,z)+KERB);
        same(expected,actual,'double heights');
        const work=new FrameWork(4);
        const prepared=await work.run(liftedHeightSteps(points,tris,(x,z)=>frozen(x,z)+KERB));
        same(expected,prepared,'cooperative double heights');
        high.push({vertices:points.length,triangles:tris.length,cpuMs:work.cpuMs,maxSliceMs:work.maxSliceMs,yields:work.yields});
        await frame();
      }
      const baselineWorld=new R.World({x:0,y:0,z:0}),baseline=new legacy.Pavements(new Scene(),baselineWorld,record);
      let expected;
      try{baseline.rebuild(selected,local);expected=capture(baseline,baselineWorld);}
      finally{cleanup(baseline,baselineWorld);}
      for(let repeat=0;repeat<4;repeat++){
        for(const mode of repeat%2===0?['old','new']:['new','old']){
          await frame();
          const world=new R.World({x:0,y:0,z:0}),p=new (mode==='old'?legacy.Pavements:Pavements)(new Scene(),world,(x,z)=>G.groundY(x,z)??0);
          const work=new FrameWork(4),start=performance.now();
          try{
            await p.rebuildAsync(selected,local,work);
            const elapsed=performance.now()-start;
            compare(expected,capture(p,world));
            rows.push({region,mode,repeat,sampler:'live-game-ground',polygons:selected.length,cpuMs:work.cpuMs,maxSliceMs:work.maxSliceMs,yields:work.yields,elapsed,matched:true});
          }finally{cleanup(p,world);}
        }
      }
      const changed=G.getFrame()!==local||window.__game!==G;
      if(changed)throw new Error('world/frame changed during comparison');
      areas.push({region,inputPolygons:all.length,selected,heights:high,fieldSamples:[...field],drawMeshes:expected.geometry.length,colliders:expected.colliders.length});
    };
    await collect('tokyo',['千代田区','中央区']);
    G.debug.roads.warp({name:'QA pavement Azuma',kind:'QA',lat:35.7101,lon:139.8015});
    for(let i=0;i<360;i++){
      const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
      const done=landed?.to==='QA pavement Azuma'&&!G.debug.roads.input().loading,timedOut=i===359;
      if(done)break;
      if(timedOut)throw new Error('warp did not finish');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
    await collect('azuma',['墨田区','台東区']);
    return {areas,rows,compared,queries,session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
      render:G.renderInfo,graphics:GRAPHICS.settings,
      errors:G.debug.logs.query({event:/uncaught_error|pavement_tile_failed|road_network_failed|terrain_build_failed|log_schema_invalid/})};
  })()`);
  report.logs = browser.logs;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      compared: report.result.compared,
      rows: report.result.rows,
      areas: report.result.areas.map((a) => ({
        region: a.region,
        input: a.inputPolygons,
        selected: a.selected.length,
        maxVertices: Math.max(...a.heights.map((h) => h.vertices)),
        colliders: a.colliders,
      })),
      session: report.result.session,
      errors: report.result.errors,
    }) + "\n",
  );
} finally {
  await browser.close();
}
