// Teaser movie: headless Chrome films scripted shots of the game frame by frame (30 fps, 1080p)
// with its dev hook (setDebugCamera, advance), then ffmpeg cuts them together with title cards
// and a synthesized soundtrack (no third-party music).
//
//   node scripts/teaser/teaser.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/teaser.mp4]
//
// Needs the dev server (just dev) or a development build served with the dev hook.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../qa/browser.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/teaser.mp4");
const FPS = 30;
const WORK = resolve("out/teaser-frames");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
let frameNo = 0;
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

/** Open the game at a place and time of day, ready to film. */
async function session(start, time, extra = async () => {}) {
  const b = await launch(`${BASE}${start ? `?start=${start}` : ""}`, {
    width: 1920,
    height: 1080,
    port: 9340,
  });
  for (let i = 0; i < 90; i++) {
    await b.sleep(1500);
    if ((await b.evaluate("window.__game?.getState()").catch(() => null)) === "ready") break;
  }
  await b.evaluate("window.__game.start()");
  const label = { day: "昼", night: "夜", evening: "夕方", morning: "朝" }[time];
  await b.evaluate(
    `[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${label}')?.click()`,
  );
  await b.evaluate("window.__game.advance(6)");
  await b.evaluate(
    `document.head.insertAdjacentHTML('beforeend', '<style id="cine">#hud, .toast, #toasts { display: none !important; }</style>')`,
  );
  await extra(b);
  return b;
}
const key = (b, code) =>
  b.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}' }))`,
  );

/**
 * Film one shot: `camera` is page-side JS (a function body) that places `cam` for shot time `t`
 * (seconds) with `G` = window.__game, `car` = the car position, `yaw` = its heading.
 */
async function shot(b, name, seconds, camera, { hud = false } = {}) {
  await b.evaluate(`document.getElementById('cine').disabled = ${hud}`);
  await b.evaluate(`window.__shotT = 0; window.__game.setDebugCamera((cam) => {
    const G = window.__game; const t = window.__shotT; const car = G.vehicle.object.position; const yaw = G.vehicle.yaw();
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) }; const left = { x: fwd.z, z: -fwd.x };
    ${camera}
    cam.updateProjectionMatrix();
  })`);
  if (hud) await b.evaluate("window.__game.setDebugCamera(null)");
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    await b.evaluate(`window.__shotT = ${i / FPS}; window.__game.advance(${1 / FPS})`);
    await b.screenshot(join(WORK, `f${String(frameNo++).padStart(5, "0")}.jpg`), 92);
  }
  log("shot", { name, frames });
}

/** A full-frame card (title, captions) drawn in the page, filmed like any shot. */
async function card(b, html, seconds) {
  await b.evaluate(`(() => { const d = document.createElement('div'); d.id = 'card';
    d.style.cssText = 'position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:#05070b;color:#f4f6fa;font-family:"Noto Sans JP",system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .4s';
    d.innerHTML = ${JSON.stringify(html)}; document.body.append(d); requestAnimationFrame(() => (d.style.opacity = '1')); })()`);
  await shot(b, "card", seconds, "cam.position.set(car.x, car.y + 3, car.z);");
  await b.evaluate("document.getElementById('card')?.remove()");
}

const orbit = (lat, lon, radius, height, lookHeight, speed, rise = 0) => `
  const f = G.getFrame(); const c = f.toLocal(${lat}, ${lon}, f.origin.h);
  const a = t * ${speed} + 0.6;
  cam.position.set(c.x + Math.cos(a) * ${radius}, c.y + ${height} + t * ${rise}, c.z + Math.sin(a) * ${radius});
  cam.lookAt(c.x, c.y + ${lookHeight}, c.z); cam.fov = 50;`;

// ---- Marunouchi by day: departure, cuts, rain, guidance ----
let b = await session(null, "day", async (g) => {
  await key(g, "KeyB");
  await key(g, "KeyA"); // 自動運転
  await g.evaluate("window.__game.advance(4)");
});
await card(
  b,
  '<div><div style="font-size:30px;letter-spacing:.3em;opacity:.8">TOKYO OPEN DATA</div><div style="font-size:64px;font-weight:800;margin-top:12px">東京を、法令どおりに走れ。</div></div>',
  2.4,
);
await shot(
  b,
  "crane",
  4.5,
  `
  const r = 14 + t * 5; const h = 1.2 + t * 9;
  cam.position.set(car.x - fwd.x * r + left.x * 4, car.y + h, car.z - fwd.z * r + left.z * 4);
  cam.lookAt(car.x + fwd.x * 6, car.y + 1, car.z + fwd.z * 6); cam.fov = 55;`,
);
await shot(
  b,
  "roadside",
  2.2,
  `
  if (!window.__spot) { window.__spot = { x: car.x + fwd.x * 34 + left.x * 6.5, z: car.z + fwd.z * 34 + left.z * 6.5 }; }
  cam.position.set(window.__spot.x, car.y + 1.1, window.__spot.z); cam.lookAt(car.x, car.y + 0.8, car.z);
  cam.fov = Math.max(24, 60 - Math.hypot(car.x - window.__spot.x, car.z - window.__spot.z));`,
);
await b.evaluate("window.__spot = null");
await shot(
  b,
  "wheel",
  1.6,
  `
  cam.position.set(car.x + left.x * 2.1 - fwd.x * 3, car.y - 0.45, car.z + left.z * 2.1 - fwd.z * 3);
  cam.lookAt(car.x + fwd.x * 8, car.y, car.z + fwd.z * 8); cam.fov = 72;`,
);
await shot(
  b,
  "front",
  1.6,
  `
  cam.position.set(car.x + fwd.x * 7, car.y + 0.2, car.z + fwd.z * 7);
  cam.lookAt(car.x, car.y, car.z); cam.fov = 45;`,
);
await shot(
  b,
  "drone",
  3.2,
  `
  const a = t * 0.35; cam.position.set(car.x + Math.cos(a) * 60, car.y + 55 - t * 6, car.z + Math.sin(a) * 60);
  cam.lookAt(car.x, car.y, car.z); cam.fov = 45;`,
);
// Rain in the driver's seat: the cockpit camera (C), wipers on HI.
await key(b, "KeyY");
await key(b, "KeyY");
await key(b, "KeyC");
await key(b, "Tab");
await key(b, "Tab");
await key(b, "Tab");
await b.evaluate("window.__game.setDebugCamera(null); window.__game.advance(3)");
await b.evaluate("document.getElementById('cine').disabled = false");
for (let i = 0; i < Math.round(4 * FPS); i++) {
  await b.evaluate(`window.__game.advance(${1 / FPS})`);
  await b.screenshot(join(WORK, `f${String(frameNo++).padStart(5, "0")}.jpg`), 92);
}
log("shot", { name: "cockpit-rain" });
await key(b, "KeyY");
await key(b, "KeyC");
await key(b, "KeyC");
await key(b, "KeyC"); // back to chase
await shot(b, "guidance", 3.5, "", { hud: true });
await b.close();

// ---- Night: the city, a patrol car in pursuit ----
b = await session(null, "night", async (g) => {
  await key(g, "KeyB");
  await key(g, "KeyA");
  await g.evaluate("window.__game.advance(3)");
  // A patrol car right behind, lights on.
  for (let i = 0; i < 12 && !(await g.evaluate("!!window.__game.getPolice()")); i++)
    await g.evaluate("window.__game.advance(6)");
  await g.evaluate(`(() => { const G = window.__game; const p = G.getPolice(); if (!p) return; const y = G.vehicle.yaw();
    const at = G.vehicle.position().clone().add({ x: -Math.sin(y) * 16, y: 0, z: -Math.cos(y) * 16 }); p.car.setCoasting(true); p.car.teleport(at, y); p.state = 'pursuing'; })()`);
  await g.evaluate("window.__game.advance(1)");
});
await shot(
  b,
  "pursuit",
  4.5,
  `
  const p = G.getPolice()?.position ?? car; const mid = { x: (p.x + car.x) / 2, z: (p.z + car.z) / 2 };
  cam.position.set(mid.x + left.x * 9 - fwd.x * 2, car.y + 1.4, mid.z + left.z * 9 - fwd.z * 2);
  cam.lookAt(mid.x, car.y + 0.8, mid.z); cam.fov = 58;`,
);
await shot(
  b,
  "night-crane",
  3.5,
  `
  cam.position.set(car.x - fwd.x * (10 + t * 8), car.y + 2 + t * 14, car.z - fwd.z * (10 + t * 8));
  cam.lookAt(car.x + fwd.x * 30, car.y + 4, car.z + fwd.z * 30); cam.fov = 60;`,
);
await b.close();

// ---- Landmarks at night ----
b = await session("35.7065,139.8040", "night");
await shot(b, "skytree", 5, orbit(35.7100392, 139.810708, 520, 60, 330, 0.09, 18));
await b.close();
b = await session("35.6560,139.7480", "night");
await shot(b, "tokyo-tower", 4.5, orbit(35.658592, 139.74545, 260, 30, 170, -0.12, 10));
await card(
  b,
  '<div><div style="font-size:84px;font-weight:800;letter-spacing:.04em">法令厳守 TOKYO OPEN DRIVE</div><div style="font-size:26px;margin-top:22px;opacity:.85">東京都・国のオープンデータでつくった、法令どおりに走るドライブ</div><div style="font-size:22px;margin-top:34px;opacity:.7">kexi.github.io/tokyo-od-game</div></div>',
  4,
);
await b.close();

// ---- Edit: frames → H.264, with a synthesized soundtrack ----
const seconds = frameNo / FPS;
const music = join(WORK, "music.wav");
// A low pulse at 112 bpm, a soft pad and a rising sweep: generated, no samples.
const expr = [
  "0.30*sin(2*PI*55*t)*exp(-9*mod(t,60/112))",
  "0.10*sin(2*PI*110*t+sin(2*PI*0.25*t))",
  "0.06*sin(2*PI*(220+40*sin(2*PI*0.05*t))*t)",
  "0.05*(random(0)-0.5)*exp(-40*mod(t+30/112,60/112))",
]
  .join("+")
  // Inside a filtergraph option the commas of the functions must be escaped.
  .replaceAll(",", "\\,");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expr}:s=44100:d=${seconds}`,
    "-af",
    `afade=t=in:d=1,afade=t=out:st=${Math.max(0, seconds - 2)}:d=2`,
    music,
  ],
  { stdio: "ignore" },
);
mkdirSync(resolve(OUT, ".."), { recursive: true });
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(WORK, "f%05d.jpg"),
    "-i",
    music,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-preset",
    "medium",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    OUT,
  ],
  { stdio: "ignore" },
);
writeFileSync(join(WORK, "done.json"), JSON.stringify({ frames: frameNo, seconds }));
log("done", { out: OUT, seconds: Math.round(seconds) });
