import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "b73309b1b446d9e4b7a8a26ca6031589a4ca0ce0";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-route-search");
mkdirSync(out, { recursive: true });
const sources = {};
const currentSources = {};
for (const name of ["navigation", "autoDriver"]) {
  const source = execFileSync("git", ["show", `${reference}:src/game/${name}.ts`], { encoding: "utf8" });
  sources[name] = createHash("sha256").update(source).digest("hex");
  let served = source
    .replaceAll('from "../', 'from "../../../src/')
    .replaceAll('from "./', 'from "../../../src/game/');
  const isDriver = name === "autoDriver";
  if (isDriver) served = served.replace('from "../../../src/game/navigation"', 'from "./navigation-before"');
  writeFileSync(join(out, `${name}-before.ts`), served);
  const current = readFileSync(`src/game/${name}.ts`, "utf8");
  currentSources[name] = createHash("sha256").update(current).digest("hex");
  writeFileSync(join(out, `${name}-current.txt`), current);
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
  reference,
  sources,
  currentSources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model },
  url: url.href,
  regions: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9379 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.session = await browser.evaluate("__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId");
  for (const region of ["Tokyo", "Azuma"]) {
    const isAzuma = region === "Azuma";
    if (isAzuma) {
      await browser.evaluate(`(async()=>{
        const G=__game, before=G.getRoadGraph();
        G.debug.roads.warp({name:'QA route Azuma',kind:'QA',lat:35.7101,lon:139.8015});
        for(let i=0;i<360;i++){
          const input=G.debug.roads.input(), origin=G.getFrame().origin;
          const done=G.getRoadGraph()!==before && !input.loading &&
            Math.abs(origin.lat-35.7101)<0.00001 && Math.abs(origin.lon-139.8015)<0.00001;
          if(done)return;
          await new Promise(r=>setTimeout(r,250));
        }
        throw new Error('Azuma road graph did not arrive');
      })()`);
      await browser.sleep(10000);
    }
    const measured = await browser.evaluate(`(async()=>{
      const G=__game, source=G.getRoadGraph(), frame=G.getFrame();
      const playing=G.getState()==='playing' && source?.segments.length>100 && !G.debug.roads.input().loading;
      if(!playing)throw new Error('gameplay or road data missing (check for HMR)');
      const {RoadGraph}=await import(new URL('src/world/roads.ts',location.href).href);
      const {gameClock}=await import(new URL('src/world/ruleTime.ts',location.href).href);
      const {planRoute}=await import(new URL('src/game/navigation.ts',location.href).href);
      const {AutoDriver}=await import(new URL('src/game/autoDriver.ts',location.href).href);
      const {planRoute:oldRoute}=await import(new URL(${JSON.stringify(out + "/navigation-before.ts")},location.href).href);
      const {AutoDriver:OldDriver}=await import(new URL(${JSON.stringify(out + "/autoDriver-before.ts")},location.href).href);
      const snapshot=source.snapshot(), graph=RoadGraph.restore(snapshot,frame), a=G.getApplied();
      const turns=(a?.turnRules??[]).map(r=>({...r,approach:graph.segments[r.approach.id]}));
      const lanes=(a?.laneUse??[]).map(r=>({...r,seg:graph.segments[r.seg.id]}));
      const streets=graph.segments.filter(s=>s.line.kind!=='highway' && s.line.width>=3);
      const queries=[];
      for(let i=0;i<32;i++){
        const seg=streets[(i*37)%streets.length], goal=streets[(i*83+Math.floor(streets.length/3))%streets.length];
        const target=graph.sample(goal,goal.length*.65).pos;
        for(const dir of [1,-1])for(const minutes of [600,1320])for(const mode of ['car','walk']){
          queries.push({kind:'route',seg:seg.id,s:seg.length*.35,dir,lane:i%seg.lanes,
            target:target.toArray(),minutes,mode});
        }
        const sample=graph.sample(seg,seg.length*.35), travel=sample.dir.multiplyScalar(seg.oneway||1);
        for(const placement of ['lane','reverse','offroad']){
          const pos=sample.pos.clone();
          const off=placement==='offroad'?20:Math.min(2,seg.line.width*.25);
          pos.x+=travel.z*off;pos.z-=travel.x*off;
          const yaw=Math.atan2(travel.x,travel.z)+(placement==='reverse'?Math.PI:0);
          queries.push({kind:'driver',placement,position:pos.toArray(),yaw,target:target.toArray(),minutes:1320});
        }
      }
      const Vector3=graph.segments[0].pts[0].constructor;
      let values=0;
      const same=(x,y)=>{
        const numeric=typeof x==='number';
        if(numeric)values++;
        if(Object.is(x,y))return true;
        const objects=x!==null && y!==null && typeof x==='object' && typeof y==='object';
        if(!objects || x.constructor!==y.constructor)return false;
        const keys=Object.keys(x);
        return keys.length===Object.keys(y).length && keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
      };
      const digest=async value=>{
        const json=JSON.stringify(value,(key,v)=>key==='seg'?v?.id:v);
        const bytes=new TextEncoder().encode(json);
        const hash=await crypto.subtle.digest('SHA-256',bytes);
        return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
      };
      const methods={old:{route:oldRoute,Driver:OldDriver},current:{route:planRoute,Driver:AutoDriver}};
      const run=(q,name,timed)=>{
        const method=methods[name], clock=gameClock(2026,10,1,q.minutes), target=new Vector3(...q.target);
        const isRoute=q.kind==='route';
        if(isRoute){
          const start={seg:graph.segments[q.seg],s:q.s,dir:q.dir,lane:q.lane};
          const before=performance.now(), route=method.route(graph,start,target,clock,turns,q.mode,lanes);
          const ms=performance.now()-before;
          return {output:route,ms:timed?ms:0};
        }
        const driver=new method.Driver();driver.place(new Vector3(...q.position),q.yaw);
        const world={graph,control:G.control,turnRules:turns,clock,obstacles:[],laneUse:lanes};
        const before=performance.now(), planned=driver.plan(world,target), ms=performance.now()-before;
        return {output:{planned,route:driver.route,lane:driver.lane,remaining:driver.remaining,
          signal:driver.signal,activity:driver.activity,gaveUp:driver.gaveUp},ms:timed?ms:0};
      };
      for(const q of queries.slice(0,12)){
        graph.setClock(gameClock(2026,10,1,q.minutes));
        run(q,'old',false);run(q,'current',false);
        await new Promise(r=>requestAnimationFrame(r));
      }
      const rows=[];
      for(let i=0;i<queries.length;i++){
        const q=queries[i], results={};
        graph.setClock(gameClock(2026,10,1,q.minutes));
        for(const name of i%2===0?['old','current']:['current','old'])results[name]=run(q,name,true);
        const matched=same(results.old.output,results.current.output);
        const hashes=await Promise.all([digest(results.old.output),digest(results.current.output)]);
        rows.push({query:q,oldMs:results.old.ms,currentMs:results.current.ms,matched,hashes});
        if(!matched)return {valid:false,rows,old:results.old.output,current:results.current.output};
        await new Promise(r=>requestAnimationFrame(r));
      }
      const stable=window.__game===G && G.getState()==='playing' && G.getRoadGraph()===source && G.getFrame()===frame;
      if(!stable)throw new Error('session or source graph changed during comparison');
      const summary={};
      for(const kind of ['route','driver']){
        const group=rows.filter(r=>r.query.kind===kind);summary[kind]={count:group.length};
        for(const [name,key] of [['old','oldMs'],['current','currentMs']]){
          const times=group.map(r=>r[key]).toSorted((a,b)=>a-b);
          summary[kind][name]={totalMs:times.reduce((a,b)=>a+b,0),maxMs:times.at(-1),p95Ms:times[Math.floor(times.length*.95)]};
        }
      }
      return {valid:true,rows,summary,values,render:G.renderInfo,userAgent:navigator.userAgent,
        segments:graph.segments.length,origin:frame.origin,turnRules:turns.map(r=>({...r,approach:r.approach.id})),
        laneUse:lanes.map(r=>({...r,seg:r.seg.id})),snapshot:{...snapshot,nodes:[...snapshot.nodes],pieces:[...snapshot.pieces]},
        session:G.debug.logs.query({event:'session_start'}).at(-1)?.traceId,
        errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|log_schema_invalid/})};
    })()`);
    report.regions.push({ region, ...measured });
    save();
    const valid = measured.valid && measured.errors.length === 0;
    if (!valid) throw new Error(`route comparison failed: ${join(out, "report.json")}`);
    process.stdout.write(
      JSON.stringify({
        region,
        segments: measured.segments,
        summary: measured.summary,
        values: measured.values,
      }) + "\n",
    );
  }
  const errors = browser.logs.filter((line) => line.startsWith("[error]") || line.startsWith("[exception]"));
  const hasErrors = errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(errors));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
} finally {
  report.logs = browser.logs;
  save();
  await browser.close();
}
