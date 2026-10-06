import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-road-reply-slices");
mkdirSync(out, { recursive: true });
const reference = "19af0de1d593f4d0b37860a4c2e1a42cef521b72";
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
const refDir = ".qa/reference/road-reply-slices";
mkdirSync(refDir, { recursive: true });
const legacyFiles = [
  "roadNetwork.worker.ts",
  "roadNetworkData.ts",
  "roads.ts",
  "roadNetworkPacket.ts",
  "roadNetworkBuilder.ts",
];
const frozen = {};
for (const name of legacyFiles) {
  const file = "src/world/" + name;
  const source = execFileSync("git", ["show", reference + ":" + file], { encoding: "utf8" });
  frozen[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, name + "-legacy.txt"), source);
  const logged =
    name === "roadNetworkBuilder.ts"
      ? source.replace(
          "          packMs,",
          "          packMs,\n          maxSliceMs: unpackMs + restoreMs,\n          yields: 0,",
        )
      : source;
  const module = logged.replace(/from (["'])(\.[^"']+)\1/g, (_match, _quote, specifier) => {
    const isFrozen = legacyFiles.includes(specifier.slice(2) + ".ts");
    const path = isFrozen ? refDir + "/" + specifier.slice(2) + ".ts" : "src/world/" + specifier + ".ts";
    return `from "${new URL(path, url).href}"`;
  });
  writeFileSync(join(refDir, name), module);
}
const sources = {};
for (const file of [
  "src/world/roadNetworkBuilder.ts",
  "src/world/roadNetworkData.ts",
  "src/world/roadNetwork.worker.ts",
  "src/world/roadNetworkPacket.ts",
  "src/world/roads.ts",
  "src/logEvents.ts",
  "src/game/frameWork.ts",
  "scripts/qa/perf-road-reply-slices.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const report = {
  reference,
  frozen,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  sources,
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
  regions: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const preload = `{
  const descriptor=Object.getOwnPropertyDescriptor(MessageEvent.prototype,'data');
  const events=new WeakSet(),targets=new WeakMap();let serial=0;
  window.__qaReplyReads=[];
  window.__qaReplyTargetId=target=>{if(!targets.has(target))targets.set(target,++serial);return targets.get(target);};
  Object.defineProperty(MessageEvent.prototype,'data',{...descriptor,get(){
    const at=performance.now(),data=descriptor.get.call(this),ms=performance.now()-at;
    const isRoad=data&&typeof data==='object'&&data.data?.graph?.segments;
    if(isRoad){
      const first=!events.has(this);events.add(this);
      __qaReplyReads.push({at,ms,first,id:data.id,targetId:__qaReplyTargetId(this.target),segments:data.data.graph.segments.length});
    }
    return data;
  }});
}`;
const browser = await launch(url.href, { port: 9373, preload });
try {
  report.browser = (await browser.send("Browser.getVersion")).result;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  const isUnavailable = !ready;
  if (isUnavailable) throw new Error("game not ready");
  await browser.evaluate("__game.start();window.__qaGame=__game");
  await browser.sleep(30000);
  report.session = await browser.evaluate("__game.debug.logs.query({limit:1}).at(-1)?.traceId");
  for (const region of ["Tokyo", "Azuma"]) {
    const isAzuma = region === "Azuma";
    if (isAzuma) {
      await browser.evaluate(`(async()=>{
        __game.debug.roads.warp({name:'QA reply Azuma',kind:'QA',lat:35.7101,lon:139.8015});
        for(let i=0;i<240;i++){
          const landed=__game.debug.logs.query({event:'warp_landed'}).at(-1);
          const done=landed?.to==='QA reply Azuma'&&!__game.debug.roads.input().loading;
          if(done)return;await new Promise(r=>setTimeout(r,250));
        }throw new Error('Azuma warp not finished');
      })()`);
      await browser.sleep(10000);
    }
    const result = await browser.evaluate(`(async()=>{
      const G=__game,input=G.debug.roads.input(),frame=G.getFrame(),live=G.getRoadGraph();
      const missing=G!==__qaGame||!input.regs||input.lines.length<100||input.loading;
      if(missing)throw new Error('actual road input unavailable');
      const {RoadNetworkBuilder}=await import(new URL('src/world/roadNetworkBuilder.ts',location.href).href);
      const {restoreRoadNetwork}=await import(new URL('src/world/roadNetworkData.ts',location.href).href);
      const {computeRoadNetwork}=await import(new URL('.qa/reference/road-reply-slices/roadNetworkData.ts',location.href).href);
      const {frameStats,longFramesDuring}=await import(new URL('src/game/perf.ts',location.href).href);
      const raw=computeRoadNetwork({lines:input.lines,regs:input.regs,origin:frame.origin});
      const expected=restoreRoadNetwork(structuredClone(raw),frame);
      const structure={segments:raw.graph.segments.length,points:raw.graph.segments.reduce((n,s)=>n+s.pts.length,0),
        nodes:raw.graph.nodes.size,pieceCells:raw.graph.pieces?.size??0,
        piecePairs:[...(raw.graph.pieces?.values()??[])].reduce((n,p)=>n+p.length,0),signs:raw.applied?.signs.length??0};
      const {RoadNetworkBuilder:LegacyBuilder}=await import(new URL('.qa/reference/road-reply-slices/roadNetworkBuilder.ts',location.href).href);
      const builders={legacy:new LegacyBuilder(),sliced:new RoadNetworkBuilder()};
      Object.values(builders).forEach(b=>b.warm());
      // Reference computation must finish presenting before the first measured rAF timestamp.
      await new Promise(r=>setTimeout(r,250));
      let finished=false;const rows=[],outputs=[],captures=[];
      try{
        for(let round=0;round<4;round++){
          const order=round%2?['sliced','legacy']:['legacy','sliced'];
          for(const mode of order){
            const builder=builders[mode],stamps=[];finished=false;
            const frames=new Promise(resolve=>{const loop=t=>{stamps.push(t);if(finished)resolve(stamps);else requestAnimationFrame(loop);};requestAnimationFrame(loop);});
            const watch=longFramesDuring(performance.now(),frames);
            await new Promise(r=>setTimeout(r,200));
            for(let sample=0;sample<6;sample++){
              const start=performance.now(),pending=builder.build(input.lines,input.regs,frame),span=builder.active.span.spanId,id=builder.active.id;
              const callMs=performance.now()-start,targetId=__qaReplyTargetId(builder.worker);
              const output=await pending;
              const prepared=G.debug.logs.query({event:'road_network_prepared'}).findLast(e=>e.spanId===span);
              const reads=__qaReplyReads.filter(e=>e.targetId===targetId&&e.id===id);
              const first=reads.filter(e=>e.first),backend=prepared?.backend;
              const invalid=first.length!==1||backend!=='worker';
              if(invalid)throw new Error('own Native Worker reply/metrics missing');
              rows.push({round,mode,sample,...prepared,callMs,latencyMs:performance.now()-start,firstReadMs:first[0].ms,
                repeatedReadMs:reads.filter(e=>!e.first).reduce((n,r)=>n+r.ms,0),readCalls:reads.length,
                receiveMs:prepared.readMs+prepared.unpackMs+prepared.restoreMs,maxReceiveSliceMs:mode==='legacy'?prepared.readMs+prepared.unpackMs+prepared.restoreMs:Math.max(prepared.readMs,prepared.maxSliceMs)});
              outputs.push({mode,output});await new Promise(requestAnimationFrame);
            }
            await new Promise(r=>setTimeout(r,500));finished=true;
            const {result,long}=await watch;captures.push({round,mode,frames:frameStats(result),long});
            await new Promise(r=>setTimeout(r,250));
          }
        }
        let values=0;const valuesByMode={legacy:0,sliced:0};
        const same=(a,b)=>{
          const isNumber=typeof a==='number';if(isNumber)values++;
          if(Object.is(a,b))return true;
          const areObjects=a!==null&&b!==null&&typeof a==='object'&&typeof b==='object';
          if(!areObjects||a.constructor.name!==b.constructor.name)return false;
          const areMaps=a instanceof Map;
          if(areMaps){const aa=[...a],bb=[...b];return aa.length===bb.length&&aa.every((v,i)=>same(v,bb[i]));}
          const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
        };
        for(const {mode,output} of outputs){const before=values,differs=!same(output,expected);if(differs)throw new Error('Native Worker result differs');valuesByMode[mode]+=values-before;}
        const liveChanged=G.getRoadGraph()!==live; if(liveChanged)throw new Error('probe replaced live graph');
        return{structure,rows,captures,values,valuesByMode,matched:true,
          input:{lines:input.lines,regs:input.regs,origin:frame.origin},session:G.debug.logs.query({limit:1}).at(-1)?.traceId,
          gameReads:__qaReplyReads.filter(e=>!Object.values(builders).some(b=>e.targetId===__qaReplyTargetId(b.worker))&&e.first)};
      }finally{finished=true;Object.values(builders).forEach(b=>b.dispose());}
    })()`);
    report.regions.push({ region, ...result });
    save();
    process.stdout.write(
      JSON.stringify({
        region,
        structure: result.structure,
        matched: result.matched,
        values: result.values,
        captures: result.captures,
        rows: result.rows.map(
          ({
            round,
            mode,
            firstReadMs,
            unpackMs,
            restoreMs,
            receiveMs,
            sendMs,
            maxReceiveSliceMs,
            yields,
            latencyMs,
          }) => ({
            round,
            mode,
            firstReadMs,
            unpackMs,
            restoreMs,
            receiveMs,
            sendMs,
            maxReceiveSliceMs,
            yields,
            latencyMs,
          }),
        ),
      }) + "\n",
    );
  }
  report.errors = await browser.evaluate(
    "__game.debug.logs.query({event:/uncaught_error|road_network_failed|road_worker_failed|log_schema_invalid/})",
  );
  save();
  await browser.screenshot(join(out, "night-rain.png"));
  process.stdout.write(JSON.stringify({ report: join(out, "report.json"), errors: report.errors }) + "\n");
} catch (error) {
  report.failure = String(error);
  save();
  throw error;
} finally {
  await browser.close();
}
