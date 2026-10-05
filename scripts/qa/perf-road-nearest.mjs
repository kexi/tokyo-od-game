import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-nearest");
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const browser = await launch(url.href, { port: 9369 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  const measured = await browser.evaluate(`(async () => {
    const G = __game, graph = G.getRoadGraph();
    const isPlaying = G.getState() === 'playing' && graph?.segments.length > 100 && !G.debug.roads.input().loading;
    if (!isPlaying) throw new Error('gameplay or road data missing');
    const session = G.debug.logs.query({event:'session_start'}).at(-1)?.traceId;
    const Vector3 = graph.segments[0].pts[0].constructor;
    const prepared = G.debug.logs.query({event:'road_network_prepared'}).at(-1);
    const indexReady = graph.pieces instanceof Map;
    if (prepared?.backend !== 'worker' || !indexReady) throw new Error('worker did not prepare the spatial index');
    // Frozen exhaustive projection from d9afba9, before candidate pruning.
    const exhaustive = (p, maxDist, accept) => {
      let best = null, bestD = maxDist;
      const ab = new Vector3(), ap = new Vector3();
      for (const seg of graph.segments) {
        if (!accept(seg)) continue;
        for (let i=1;i<seg.pts.length;i++) {
          const a = seg.pts[i-1];
          ab.copy(seg.pts[i]).sub(a);
          const len2 = ab.x*ab.x+ab.z*ab.z;
          if (len2<1e-6) continue;
          ap.set(p.x-a.x,0,p.z-a.z);
          const t = Math.min(1,Math.max(0,(ap.x*ab.x+ap.z*ab.z)/len2));
          const d = Math.hypot(a.x+ab.x*t-p.x,a.z+ab.z*t-p.z);
          if (d>=bestD) continue;
          bestD=d;
          const len=Math.sqrt(len2), dir=new Vector3(ab.x/len,0,ab.z/len);
          best={seg,s:seg.cum[i-1]+len*t,lateral:ap.x*dir.z-ap.z*dir.x,dir};
        }
      }
      return best;
    };
    const acceptAll = () => true, acceptSurface = seg => seg.line.kind !== 'highway';
    const queries = [];
    const step = Math.ceil(graph.segments.length/200);
    for (let i=0;i<graph.segments.length;i+=step) {
      const seg=graph.segments[i], {pos,dir}=graph.sample(seg,seg.length/2);
      for (const offset of [-12,0,12]) {
        const p=pos.clone().add(new Vector3(dir.z*offset,20,-dir.x*offset));
        for (const radius of [3,15,40,250]) for (const accept of [acceptAll,acceptSurface]) queries.push({p,radius,accept});
      }
    }
    const snapshot = graph.snapshot();
    const indexed = (p,r,a)=>graph.nearest(p,r,a);
    for (const q of queries.slice(0,100)) { exhaustive(q.p,q.radius,q.accept); indexed(q.p,q.radius,q.accept); }
    const timings={exhaustive:[],indexed:[]};
    let checked=0, checksum=0;
    const same=(a,b)=>a===null||b===null ? a===b : a.seg===b.seg && a.s===b.s && a.lateral===b.lateral && a.dir.equals(b.dir);
    for (let start=0;start<queries.length;start+=24) {
      const batch=queries.slice(start,start+24), results={};
      const methods=start%48===0 ? [['exhaustive',exhaustive],['indexed',indexed]] : [['indexed',indexed],['exhaustive',exhaustive]];
      for (const [name,method] of methods) {
        const before=performance.now();
        results[name]=batch.map(q=>method(q.p,q.radius,q.accept));
        timings[name].push(performance.now()-before);
      }
      for (let i=0;i<batch.length;i++) {
        if (!same(results.exhaustive[i],results.indexed[i])) throw new Error('nearest result changed at query '+(start+i));
        checksum+=results.indexed[i]?.seg.id??-1;
        checked++;
      }
      await new Promise(r=>requestAnimationFrame(r));
    }
    const stableSession = session === G.debug.logs.query({event:'session_start'}).at(-1)?.traceId && G.getState()==='playing' && G.getRoadGraph()===graph;
    if (!stableSession) throw new Error('session or graph changed during measurement');
    const summary=Object.fromEntries(Object.entries(timings).map(([name,values])=>{
      const sorted=values.toSorted((a,b)=>a-b), totalMs=values.reduce((a,b)=>a+b,0);
      return [name,{totalMs,meanQueryMs:totalMs/checked,maxBatchMs:sorted.at(-1),p95BatchMs:sorted[Math.floor(sorted.length*.95)]}];
    }));
    return {checked,checksum,summary,session,prepared,indexReady,indexCells:snapshot.pieces.size,segments:graph.segments.length,
      render:G.renderInfo,userAgent:navigator.userAgent,errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|log_schema_invalid/})};
  })()`);
  const hasErrors = measured.errors.length > 0;
  if (hasErrors) throw new Error(JSON.stringify(measured.errors));
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    url: url.href,
    host: { cpu: cpus()[0]?.model },
    ...measured,
  };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ...report, path: out }) + "\n");
} finally {
  await browser.close();
}
