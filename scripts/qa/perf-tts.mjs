import { launch } from "./browser.mjs";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-tts",
);
mkdirSync(out, { recursive: true });
const base = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
const browser = await launch(new URL("sanotts/SOURCE.md", base).href, { port: 9364 });
function wav(pcm, sampleRate) {
  const buffer = Buffer.alloc(44 + pcm.length);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcm.length, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcm.length, 40);
  pcm.copy(buffer, 44);
  return buffer;
}
try {
  await browser.sleep(1000);
  const report = await browser.evaluate(`(async()=>{
  const {Voice,speechChunks}=await import('${new URL("src/ai/tts.ts", base).href}');
  const voice=new Voice(()=>null); const rows=[];
  let stopped=false,last=performance.now(),frames=[];
  function tick(now){frames.push(now-last);last=now;if(!stopped)requestAnimationFrame(tick)}requestAnimationFrame(tick);
  for (const [locale,text] of [['ja','300m先を右に曲がってください。'],['en','Turn right in 300 meters.'],['zh','前方300米右转。']]) {
   const started=performance.now(),ok=await voice.enable(locale),initMs=performance.now()-started;
   if(!ok)throw Error(locale+' voice init failed');
   let sample=null;const times=[];
   for(let i=0;i<3;i++){
    const before=performance.now();sample=await voice.synth(speechChunks(text,locale)[0],locale);times.push(performance.now()-before);
    if(!sample)throw Error(locale+' synthesis failed');
   }
   const {pcm,sampleRate}=sample;let max=0,energy=0;for(const v of pcm){if(!Number.isFinite(v))throw Error('nonfinite pcm');max=Math.max(max,Math.abs(v));energy+=v*v;}
   if(pcm.length<1000||max<0.001)throw Error(locale+' empty/silent pcm');
   const bytes=new Uint8Array(pcm.buffer);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   rows.push({locale,text,initMs,synthMs:times,sampleRate,samples:pcm.length,seconds:pcm.length/sampleRate,peak:max,rms:Math.sqrt(energy/pcm.length),base64:btoa(binary)});
  }
  const longStarted=performance.now();
  const longText='前方右转然后继续直行。'.repeat(15);
  const longPcm=await voice.synth(longText,'zh');
  if(!longPcm)throw Error('long Mandarin synthesis failed');
  const longSeconds=longPcm.pcm.length/longPcm.sampleRate;
  if(longSeconds<=20)throw Error('capacity test did not exceed the single-call 20-second limit');
  const capacity={characters:[...longText].length,seconds:longSeconds,elapsedMs:performance.now()-longStarted};
  const context=new AudioContext();await context.resume();const spoken=new Voice(()=>context);await spoken.enable('en');spoken.speak('Turn right in 300 meters.',undefined,'en');
  const start=performance.now();while(!spoken.speaking&&performance.now()-start<5000)await new Promise(r=>setTimeout(r,10));
  const playing=spoken.speaking;spoken.stop();await context.close();voice.disable();stopped=true;
  return {userAgent:navigator.userAgent,coldHttpCache:true,scene:"static SOURCE.md; no game rendering",rows,capacity,playing,frames:{count:frames.length,max:Math.max(...frames),over50:frames.filter(t=>t>50).length}};
 })()`);
  for (const row of report.rows) {
    writeFileSync(out + "/" + row.locale + ".wav", wav(Buffer.from(row.base64, "base64"), row.sampleRate));
    delete row.base64;
  }
  report.browserLogs = browser.logs;
  writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  await browser.close();
}
