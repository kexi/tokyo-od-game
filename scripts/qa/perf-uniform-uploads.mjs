import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-uniform-cpu");
mkdirSync(out, { recursive: true });
const sources = {};
for (const file of [
  "scripts/qa/uniformUploads.ts",
  "src/render/renderer.ts",
  "src/render/frame.ts",
  "src/game/cockpit.ts",
  "src/render/stableShadow.ts",
  "scripts/qa/perf-uniform-uploads.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  sources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const report = {
  sources,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  scope:
    "Frozen simulation, actual cockpit/world rendering; only uniform upload coalescing changes. No per-binding/queue instrumentation.",
  scenarios: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const preload = `{
  window.__qaFreeze=false;window.__qaSkipped=0;
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>raf(t=>{
    if(__qaFreeze&&callback.name==='tick'){__qaSkipped++;return;}
    callback(t);
  });
}`;
for (const [time, weather] of [
  ["night", "rain"],
  ["day", "clear"],
]) {
  const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time,
    weather,
  }))
    url.searchParams.set(key, value);
  const browser = await launch(url.href, { port: 9377, preload });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await browser.evaluate("window.__game?.getState()==='ready'");
      if (ready) break;
      await browser.sleep(1000);
    }
    const unavailable = !ready;
    if (unavailable) throw new Error("game not ready");
    await browser.evaluate(`(async()=>{
      const path=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/src/game/cockpit.ts'))?.name;
      if(!path)throw new Error('actual cockpit module missing');
      const {Cockpit}=await import(path),render=Cockpit.prototype.render;
      Cockpit.prototype.render=function(...args){window.__qaCockpit=this;return render.apply(this,args);};
      __game.start();window.__qaGame=__game;
    })()`);
    await browser.sleep(30000);
    await browser.evaluate("__game.phone.close();window.__qaFreeze=true");
    await browser.sleep(3000);
    const context = await browser.evaluate(`(async()=>{
      const G=__game,cockpit=__qaCockpit;
      if(!__qaSkipped||!cockpit?.active)throw new Error('game loop not frozen');
      const {coalesceUniformUploads}=await import(new URL('scripts/qa/uniformUploads.ts',location.href).href);
      const control=coalesceUniformUploads(G.renderer);if(!control)throw new Error('WebGPU control missing');
      const {frameStats}=await import(new URL('src/game/perf.ts',location.href).href);
      const {GRAPHICS}=await import(new URL('src/device.ts',location.href).href);
      const fingerprint=()=>{let hash=2166136261,count=0;G.scene.traverse(o=>{
        const text=JSON.stringify([o.uuid,o.visible,...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray()]);
        for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);count++;
      });return{objects:count,hash:hash>>>0};};
      const summary=values=>{const sorted=values.toSorted((a,b)=>a-b);return{mean:values.reduce((n,v)=>n+v,0)/values.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)};};
      window.__qaSample=async mode=>{
        control.enabled=mode==='coalesced';cockpit.mirrorUpdates.reset();
        const before=fingerprint(),stamps=[],cpu=[];let start=null,lastUpload=-Infinity;
        const at=performance.now();
        await new Promise(resolve=>{const draw=t=>{
          const measuring=t-at>=2000;
          if(measuring&&start===null)start=t;
          const begin=performance.now();
          if(t-lastUpload>=120){cockpit.displayTexture.needsUpdate=true;lastUpload=t;}
          cockpit.render(G.composer,G.renderer,G.scene,G.camera);G.composer.present();
          if(measuring){stamps.push(t);cpu.push(performance.now()-begin);}
          if(start!==null&&t-start>=6000)resolve();else requestAnimationFrame(draw);
        };requestAnimationFrame(draw);});
        const after=fingerprint();if(JSON.stringify(before)!==JSON.stringify(after)||G!==__qaGame)throw new Error('scene changed during sample');
        return{mode,frames:frameStats(stamps),cpu:summary(cpu),renders:cpu.length,before,after,enabled:control.enabled};
      };
      return{render:G.renderInfo,graphics:GRAPHICS.settings,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},scene:fingerprint(),session:G.debug.logs.query({limit:1}).at(-1)?.traceId};
    })()`);
    const scenario = { time, weather, context, samples: [] };
    report.scenarios.push(scenario);
    for (const mode of [
      "legacy",
      "coalesced",
      "coalesced",
      "legacy",
      "coalesced",
      "legacy",
      "legacy",
      "coalesced",
    ]) {
      const sample = await browser.evaluate(`__qaSample(${JSON.stringify(mode)})`);
      const sameScene = JSON.stringify(sample.before) === JSON.stringify(context.scene);
      if (!sameScene) throw new Error("scene changed between samples");
      scenario.samples.push(sample);
      save();
      process.stdout.write(JSON.stringify({ time, weather, ...sample }) + "\n");
    }
    scenario.errors = await browser.evaluate(
      "__game.debug.logs.query({event:/uncaught_error|gpu_device_lost|log_schema_invalid/})",
    );
    const failed = scenario.errors.length > 0;
    if (failed) throw new Error("runtime errors during uniform CPU measurement");
    await browser.screenshot(join(out, time + "-" + weather + ".png"));
    save();
  } catch (error) {
    report.failure = String(error);
    save();
    throw error;
  } finally {
    await browser.close();
  }
}
report.sourcesUnchanged = Object.fromEntries(
  Object.entries(sources).map(([file, hash]) => [
    file,
    createHash("sha256").update(readFileSync(file)).digest("hex") === hash,
  ]),
);
save();
const sourcesChanged = Object.values(report.sourcesUnchanged).some((same) => !same);
if (sourcesChanged) throw new Error("measurement sources changed during uniform CPU comparison");
process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
