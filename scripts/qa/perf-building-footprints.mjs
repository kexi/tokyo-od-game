import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "88e0281ccc3b04b0fe65281423c950ebb595110b";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-building-footprints");
const refDir = ".qa/reference/building-footprints";
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
const legacy = execFileSync("git", ["show", reference + ":src/world/buildings.ts"], { encoding: "utf8" });
writeFileSync(join(out, "buildings-legacy.ts.txt"), legacy);
writeFileSync(
  join(refDir, "buildings.ts"),
  legacy.replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, specifier) =>
      'from "' + new URL(specifier, new URL("src/world/buildings.ts", url)).href + '"',
  ),
);
writeFileSync(
  join(refDir, "probe.ts"),
  `export {Matrix4,Vector3} from 'three';
export {BuildingFootprints} from '${new URL("src/world/buildingFootprints.ts", url).href}';
export {GRAPHICS} from '${new URL("src/device.ts", url).href}';`,
);
const sources = {};
for (const file of [
  "src/world/buildings.ts",
  "src/world/buildingFootprints.ts",
  "scripts/qa/perf-building-footprints.mjs",
  "scripts/qa/browser.mjs",
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
const browser = await launch(url.href, { port: 9375 });
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
    const {Matrix4,Vector3,BuildingFootprints,GRAPHICS}=await import(new URL('.qa/reference/building-footprints/probe.ts',location.href).href);
    const {Buildings}=await import(new URL('.qa/reference/building-footprints/buildings.ts',location.href).href);
    const oldCut=Reflect.get(Buildings.prototype,'cutFootprints');
    const frame=()=>new Promise(requestAnimationFrame);
    const inputs=[],areas=[],samples=[];let compared=0;
    const same=(a,b,label)=>{
      const differs=a.length!==b.length;
      if(differs)throw new Error(label+' length changed');
      for(let i=0;i<a.length;i++){
        const differs=!Object.is(a[i],b[i]);
        if(differs)throw new Error(label+' value changed at '+i);
        compared++;
      }
    };
    const arrays=g=>({index:Array.from(g.index?.array??[]),
      attributes:Object.fromEntries(Object.entries(g.attributes).map(([key,a])=>[key,Array.from(a.array)])),
      indexVersion:g.index?.version??0,positionVersion:g.getAttribute('position').version??g.getAttribute('position').data?.version});
    const compare=(a,b)=>{
      same(a.index,b.index,'indices');
      for(const [key,values] of Object.entries(a.attributes))same(values,b.attributes[key],key);
      const versionDiffers=a.indexVersion!==b.indexVersion||a.positionVersion!==b.positionVersion;
      if(versionDiffers)throw new Error('GPU dirty versions changed');
    };
    const collect=region=>{
      const local=G.getFrame(),rings=G.buildings.hidden.map(r=>r.map(p=>p.clone()));
      const cutter=new BuildingFootprints();cutter.setRings(rings);
      const host={frame:{ecefToLocal:local.ecefToLocal},hidden:rings};
      let count=0;
      for(const [detail,tiles,limit] of [['near',G.buildings.tiles,16],['far',G.buildings.far,8]]){
        const candidates=[];
        tiles?.forEachLoadedModel((scene,tile)=>{
          const walk=(o,parent)=>{
            const matrix=parent?new Matrix4().multiplyMatrices(parent,o.matrix):o.matrix.clone();
            const isPrepared=o.isMesh&&o.geometry.hasAttribute('facade');
            if(isPrepared)candidates.push({geometry:o.geometry,matrix,
              url:new URL(tile.content.uri,tile.internal.basePath+'/').href});
            for(const child of o.children)walk(child,matrix);
          };walk(scene,null);
        });
        const selected=candidates.toSorted((a,b)=>b.geometry.getAttribute('position').count-a.geometry.getAttribute('position').count).slice(0,limit);
        for(const item of selected){
          const position=item.geometry.getAttribute('position'),ecef=new Float32Array(position.count*3),p=new Vector3();
          for(let i=0;i<position.count;i++){
            p.fromBufferAttribute(position,i).applyMatrix4(item.matrix);
            ecef.set([p.x,p.y,p.z],i*3);
          }
          inputs.push({...item,region,detail,ecef,cutter,host,matrix:local.ecefToLocal.clone()});count++;
        }
      }
      const tooFew=count<12;
      if(tooFew)throw new Error('too few real building meshes: '+region);
      areas.push({region,meshes:count,frame:{...local.origin},rings:rings.map(r=>r.map(p=>p.toArray()))});
    };
    collect('tokyo');
    G.debug.roads.warp({name:'QA footprints Azuma',kind:'QA',lat:35.7101,lon:139.8015});
    for(let i=0;i<360;i++){
      const landed=G.debug.logs.query({event:'warp_landed'}).at(-1);
      const done=landed?.to==='QA footprints Azuma'&&!G.debug.roads.input().loading,timedOut=i===359;
      if(done)break;
      if(timedOut)throw new Error('warp did not finish');
      await new Promise(r=>setTimeout(r,250));
    }
    await new Promise(r=>setTimeout(r,15000));collect('azuma');
    const stableFrame=G.getFrame(),rows=[];
    for(const input of inputs){
      const {geometry,ecef,host,cutter,matrix}=input;
      const original=arrays(geometry),before=Array.from(ecef);
      const expected=geometry.clone(),actual=geometry.clone();
      oldCut.call(host,expected,ecef);
      const cuts=cutter.cut(actual,ecef,matrix);
      compare(arrays(expected),arrays(actual));compare(original,arrays(geometry));same(before,ecef,'input ECEF');
      expected.dispose();actual.dispose();
      const index=geometry.index,n=ecef.length/3,tris=index?index.count/3:n/3;
      let chosen=null;
      for(let t=0;t<tris;t++){
        const a=index?index.getX(t*3):t*3,b=index?index.getX(t*3+1):t*3+1,c=index?index.getX(t*3+2):t*3+2;
        const usable=a!==b&&a!==c&&b!==c;
        if(usable){chosen=[a,b,c];break;}
      }
      const missing=!chosen;
      if(missing)throw new Error('mesh has no noncollapsed triangle');
      const rounded=chosen.map(i=>new Vector3(...ecef.slice(i*3,i*3+3)).applyMatrix4(matrix));
      const x=rounded.reduce((sum,p)=>sum+Math.fround(p.x),0)/3,z=rounded.reduce((sum,p)=>sum+Math.fround(p.z),0)/3;
      const synthetic=[[new Vector3(x-2,0,z-2),new Vector3(x+2,0,z-2),new Vector3(x+2,0,z+2),new Vector3(x-2,0,z+2)]];
      const probe=new BuildingFootprints();probe.setRings(synthetic);
      const forcedOld=geometry.clone(),forcedNew=geometry.clone();
      oldCut.call({frame:{ecefToLocal:matrix},hidden:synthetic},forcedOld,ecef);
      const forcedCuts=probe.cut(forcedNew,ecef,matrix);
      compare(arrays(forcedOld),arrays(forcedNew));
      const noCuts=forcedCuts===0;
      if(noCuts)throw new Error('forced real-triangle centre was not removed');
      forcedOld.dispose();forcedNew.dispose();
      const inputBytes=new Uint8Array(ecef.buffer),digest=await crypto.subtle.digest('SHA-256',inputBytes);
      rows.push({region:input.region,detail:input.detail,url:input.url,vertices:n,triangles:tris,cuts,forcedCuts,
        layout:Object.fromEntries(Object.entries(geometry.attributes).map(([key,a])=>[key,
          {type:a.array.constructor.name,size:a.itemSize,normalized:a.normalized,
            stride:a.data?.stride,offset:a.offset,count:a.count}])),indexType:geometry.index?.array.constructor.name,
        versions:{input:{index:original.indexVersion,position:original.positionVersion},
          expected:{index:actual.index?.version??0,position:actual.getAttribute('position').version??actual.getAttribute('position').data?.version}},
        ecefHash:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),
        matrix:matrix.elements,ecef:before,input:original,expected:arrays(actual)});
      await frame();
    }
    for(let repeat=0;repeat<4;repeat++)for(const mode of repeat%2===0?['old','new']:['new','old']){
      const measurements=[];
      for(let i=0;i<inputs.length;i++){
        await frame();
        const input=inputs[i],geometry=input.geometry.clone(),start=performance.now();
        if(mode==='old')oldCut.call(input.host,geometry,input.ecef);
        else input.cutter.cut(geometry,input.ecef,input.matrix);
        const ms=performance.now()-start;
        compare(rows[i].expected,arrays(geometry));geometry.dispose();
        measurements.push({region:input.region,detail:input.detail,vertices:input.ecef.length/3,ms});
      }
      samples.push({repeat,mode,measurements});
    }
    const changed=G.getFrame()!==stableFrame||__game!==G;
    if(changed)throw new Error('game/frame changed during comparison');
    window.__qaFootprintInputs=rows;
    const metadata=rows.map(r=>({region:r.region,detail:r.detail,url:r.url,vertices:r.vertices,
      triangles:r.triangles,cuts:r.cuts,forcedCuts:r.forcedCuts,ecefHash:r.ecefHash,matrix:r.matrix,
      layout:r.layout,indexType:r.indexType,versions:r.versions}));
    return {areas,rows:metadata,samples,compared,render:G.renderInfo,graphics:GRAPHICS.settings,
      session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
      errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|building_worker_failed|building_shader_failed|log_schema_invalid/})};
  })()`);
  // CDP closes oversized responses; persist numerical inputs in small binary chunks after timing.
  report.result.data = [];
  for (let i = 0; i < report.result.rows.length; i++) {
    const columns = await browser.evaluate(`(()=>{
      const row=__qaFootprintInputs[${i}],columns=[{key:'ecef',length:row.ecef.length}];
      for(const role of ['input','expected']){
        columns.push({key:role+'.index',length:row[role].index.length});
        for(const [key,values] of Object.entries(row[role].attributes))
          columns.push({key:role+'.attributes.'+key,length:values.length});
      }
      return columns;
    })()`);
    for (const column of columns) {
      const bytes = Buffer.alloc(column.length * 8);
      for (let start = 0; start < column.length; start += 32768) {
        const encoded = await browser.evaluate(`(()=>{
          const values=${JSON.stringify(column.key)}.split('.').reduce((v,key)=>v[key],__qaFootprintInputs[${i}]);
          const data=new Uint8Array(Float64Array.from(values.slice(${start},${start + 32768})).buffer);
          let text='';for(const byte of data)text+=String.fromCharCode(byte);
          return btoa(text);
        })()`);
        Buffer.from(encoded, "base64").copy(bytes, start * 8);
      }
      const file = `${i}-${column.key}.f64`;
      writeFileSync(join(out, file), bytes);
      report.result.data.push({
        mesh: i,
        column: column.key,
        count: column.length,
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  report.logs = browser.logs;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(
    JSON.stringify({
      report: join(out, "report.json"),
      compared: report.result.compared,
      session: report.result.session,
      areas: report.result.areas.map((a) => ({ region: a.region, meshes: a.meshes })),
      samples: report.result.samples.map((s) => ({
        mode: s.mode,
        repeat: s.repeat,
        cpuMs: s.measurements.reduce((sum, m) => sum + m.ms, 0),
        maxMs: Math.max(...s.measurements.map((m) => m.ms)),
      })),
      errors: report.result.errors,
    }) + "\n",
  );
} finally {
  await browser.close();
}
