import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const reference = "f50795d3c3b2881db6303e5aae6fa531660d95c8";
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-signal-network");
mkdirSync(out, { recursive: true });
const source = execFileSync("git", ["show", `${reference}:src/world/trafficControl.ts`], {
  encoding: "utf8",
});
const current = readFileSync("src/world/trafficControl.ts", "utf8");
writeFileSync(
  join(out, "trafficControl-before.ts"),
  source.replaceAll('from "../', 'from "../../../src/').replaceAll('from "./', 'from "../../../src/world/'),
);
writeFileSync(join(out, "trafficControl-current.txt"), current);
const hash = (text) => createHash("sha256").update(text).digest("hex");
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
  sources: { before: hash(source), current: hash(current) },
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model },
  url: url.href,
  regions: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9381 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  await browser.evaluate("__game.start();window.__qaGame=__game");
  await browser.sleep(30000);
  report.session = await browser.evaluate("__game.debug.logs.query({limit:1}).at(-1)?.traceId");
  for (const region of ["Tokyo", "Azuma"]) {
    const isAzuma = region === "Azuma";
    if (isAzuma) {
      await browser.evaluate(`(async()=>{
        const G=__game,before=G.getRoadGraph();
        G.debug.roads.warp({name:'QA signal Azuma',kind:'QA',lat:35.7101,lon:139.8015});
        for(let i=0;i<360;i++){
          const origin=G.getFrame().origin;
          const done=G.getRoadGraph()!==before&&!G.debug.roads.input().loading&&
            Math.abs(origin.lat-35.7101)<.00001&&Math.abs(origin.lon-139.8015)<.00001;
          if(done)return;
          await new Promise(r=>setTimeout(r,250));
        }
        throw new Error('Azuma graph did not arrive');
      })()`);
      await browser.sleep(10000);
    }
    const measured = await browser.evaluate(`(async()=>{
      const G=__game,graph=G.getRoadGraph(),regs=G.getApplied();
      const playing=G===__qaGame&&G.getState()==='playing'&&graph?.segments.length>100&&
        regs&&!G.debug.roads.input().loading;
      if(!playing)throw new Error('gameplay/graph missing or changed by HMR');
      const {TrafficControl}=await import(new URL('src/world/trafficControl.ts',location.href).href);
      const {TrafficControl:OldControl}=await import(new URL(${JSON.stringify(out + "/trafficControl-before.ts")},location.href).href);
      const Scene=G.scene.constructor;
      // The returned model generator is not advanced: these isolated controls create no GPU/physics resources.
      const controls={old:new OldControl(new Scene(),()=>0,{}),current:new TrafficControl(new Scene(),()=>0,{})};
      const run=name=>{
        const control=controls[name],start=performance.now();
        control.setNetwork(graph,regs);
        return performance.now()-start;
      };
      const output=control=>({
        approaches:control.approaches.map(ap=>({id:ap.id,seg:ap.seg.id,dir:ap.dir,at:ap.at,
          kind:ap.kind,axis:ap.axis,a:ap.a.toArray(),b:ap.b.toArray(),travel:ap.travel.toArray(),
          controller:ap.controller?{...ap.controller,nodes:[...ap.controller.nodes]}:null})),
        bySegment:[...control.bySegment].map(([id,aps])=>[id,aps.map(ap=>ap.id)]),
        signalCount:control.signalCount(),
        sharedControllers:control.approaches.map((ap,i,all)=>all.findIndex(x=>x.controller===ap.controller)),
        states:[0,19,20,22,23,24,25,39,40,42,43,44,45].map(seconds=>{
          control.update(seconds);
          return control.approaches.map(ap=>control.state(ap));
        }),
        nextStops:control.approaches.map(ap=>[-20,.6].map(delta=>{
          const next=control.nextStop(ap.seg,ap.dir,ap.at+delta);
          return next?{id:next.approach.id,dist:next.dist}:null;
        })),
      });
      let values=0;
      const same=(a,b)=>{
        if(typeof a==='number')values++;
        if(Object.is(a,b))return true;
        const objects=a!==null&&b!==null&&typeof a==='object'&&typeof b==='object';
        if(!objects||a.constructor!==b.constructor)return false;
        const keys=Object.keys(a);
        return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
      };
      const first={old:run('old'),current:run('current')};
      if(!same(output(controls.old),output(controls.current)))throw new Error('first signal output differs');
      for(let i=0;i<8;i++){
        run('old');run('current');await new Promise(r=>requestAnimationFrame(r));
      }
      const rows=[];
      for(let i=0;i<30;i++){
        const times={};
        for(const name of i%2?['current','old']:['old','current'])times[name]=run(name);
        const matched=same(output(controls.old),output(controls.current));
        rows.push({...times,matched});
        if(!matched)break;
        await new Promise(r=>requestAnimationFrame(r));
      }
      const summary=Object.fromEntries(['old','current'].map(name=>{
        const ms=rows.map(r=>r[name]).toSorted((a,b)=>a-b);
        return [name,{count:ms.length,total:ms.reduce((a,b)=>a+b,0),min:ms[0],median:ms[15],p95:ms[28],max:ms.at(-1)}];
      }));
      return {segments:graph.segments.length,signals:regs.signals.length,
        junctions:[...graph.nodes.values()].filter(ids=>ids.length>=3).length,
        first,rows,summary,values,output:output(controls.current),snapshot:graph.snapshot(),
        input:JSON.parse(JSON.stringify(regs,(k,v)=>k==='seg'||k==='approach'?v?.id:v)),
        valid:rows.length===30&&rows.every(r=>r.matched)&&G===__qaGame&&G.getRoadGraph()===graph&&G.getApplied()===regs,
        session:G.debug.logs.query({limit:1}).at(-1)?.traceId};
    })()`);
    report.regions.push({ region, ...measured });
    save();
    const valid = measured.valid && measured.session === report.session;
    if (!valid) throw new Error(`signal comparison failed: ${join(out, "report.json")}`);
    process.stdout.write(
      JSON.stringify({
        region,
        segments: measured.segments,
        signals: measured.signals,
        junctions: measured.junctions,
        first: measured.first,
        summary: measured.summary,
        values: measured.values,
      }) + "\n",
    );
  }
  const errors = browser.logs.filter((line) => line.startsWith("[error]") || line.startsWith("[exception]"));
  if (errors.length) throw new Error(JSON.stringify(errors));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
} finally {
  report.logs = browser.logs;
  save();
  await browser.close();
}
