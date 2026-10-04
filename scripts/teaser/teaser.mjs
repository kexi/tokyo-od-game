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
  // No camera script: the game's own camera (the player's view).
  if (!camera.trim()) await b.evaluate("window.__game.setDebugCamera(null)");
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

/** テロップ: a lower-third caption over the next shots (null removes it). */
async function telop(b, main, sub = "") {
  await b.evaluate(`(() => { document.getElementById('telop')?.remove(); const m = ${JSON.stringify(main)}; if (!m) return;
    const d = document.createElement('div'); d.id = 'telop';
    d.style.cssText = 'position:fixed;left:64px;bottom:72px;z-index:98;color:#fff;font-family:"Noto Sans JP",system-ui,sans-serif;animation:telop-in .35s ease-out both';
    const band = 'background:linear-gradient(90deg,rgba(8,12,20,.86),rgba(8,12,20,.55) 80%,rgba(8,12,20,0));padding:10px 64px 10px 22px;border-left:6px solid #ffd23c';
    d.innerHTML = '<div style="' + band + ';font-size:46px;font-weight:800;letter-spacing:.02em">' + m + '</div>' + (${JSON.stringify(sub)} ? '<div style="margin-top:6px;' + band + ';font-size:24px;opacity:.92;border-left-color:#4dd2ff">' + ${JSON.stringify(sub)} + '</div>' : '');
    if (!document.getElementById('telop-style')) document.head.insertAdjacentHTML('beforeend', '<style id="telop-style">@keyframes telop-in{from{transform:translateX(-40px);opacity:0}to{transform:none;opacity:1}}</style>');
    document.body.append(d); })()`);
}

const orbit = (lat, lon, radius, height, lookHeight, speed, rise = 0) => `
  const f = G.getFrame(); const c = f.toLocal(${lat}, ${lon}, f.origin.h);
  const a = t * ${speed} + 0.6;
  cam.position.set(c.x + Math.cos(a) * ${radius}, c.y + ${height} + t * ${rise}, c.z + Math.sin(a) * ${radius});
  cam.lookAt(c.x, c.y + ${lookHeight}, c.z); cam.fov = 50;`;

// ---- Marunouchi by day: the city, guidance, the driver's seat ----
let b = await session(null, "day", async (g) => {
  await key(g, "KeyB");
  await key(g, "KeyA"); // 自動運転
  await key(g, "KeyM"); // route arrows off for the cinematic shots
  await g.evaluate("window.__game.advance(4)");
});
await card(
  b,
  '<div><div style="font-size:30px;letter-spacing:.3em;opacity:.8">TOKYO OPEN DATA</div><div style="font-size:64px;font-weight:800;margin-top:12px">東京を、法令どおりに走れ。</div></div>',
  2.5,
);
await telop(
  b,
  "東京 23 区を、オープンデータで",
  "PLATEAU 3D 都市モデル・地理院地図・JARTIC 交通規制・OpenStreetMap",
);
await shot(
  b,
  "crane",
  4,
  `
  const r = 14 + t * 5; const h = 1.2 + t * 9;
  cam.position.set(car.x - fwd.x * r + left.x * 4, car.y + h, car.z - fwd.z * r + left.z * 4);
  cam.lookAt(car.x + fwd.x * 6, car.y + 1, car.z + fwd.z * 6); cam.fov = 55;`,
);
await telop(b, "実在の交差点・信号・標識", "道路標識令 別表第一の全番号を描いて配置");
await shot(
  b,
  "roadside",
  2.2,
  `
  if (!window.__spot) { window.__spot = { x: car.x + fwd.x * 34 + left.x * 6.5, z: car.z + fwd.z * 34 + left.z * 6.5 }; }
  cam.position.set(window.__spot.x, car.y + 1.1, window.__spot.z); cam.lookAt(car.x, car.y + 0.8, car.z);
  cam.fov = Math.max(24, 60 - Math.hypot(car.x - window.__spot.x, car.z - window.__spot.z));`,
  { hud: true },
);
await b.evaluate("window.__spot = null");
await telop(b, "自動運転も、法令どおり", "信号・一時停止・車線・合図を守って走る");
await shot(
  b,
  "wheel",
  1.6,
  `
  cam.position.set(car.x + left.x * 2.1 - fwd.x * 3, car.y - 0.45, car.z + left.z * 2.1 - fwd.z * 3);
  cam.lookAt(car.x + fwd.x * 8, car.y, car.z + fwd.z * 8); cam.fov = 72;`,
  { hud: true },
);
await key(b, "KeyM"); // route arrows on
await telop(b, "レーン案内つきカーナビ", "右折専用レーンも、交差点名も");
await shot(b, "guidance", 3, "", { hud: true });
// Buses, trucks and motorbikes in traffic: track one alongside.
await key(b, "KeyM");
const hasBig =
  await b.evaluate(`(() => { const c = (window.__game.traffic.cars ?? []).find((x) => x.vehicle && x.vehicle.kind !== 'motorbike') ?? (window.__game.traffic.cars ?? []).find((x) => x.vehicle);
  if (!c) return false; window.__big = c; return true; })()`);
if (hasBig) {
  await telop(b, "バス・トラック・バイクも走る", "Blender でモデリングした大型車と二輪");
  await shot(
    b,
    "traffic",
    2.6,
    `
    const o = window.__big.object; const y = o.rotation.y; const f = { x: Math.sin(y), z: Math.cos(y) }; const l = { x: f.z, z: -f.x };
    cam.position.set(o.position.x + l.x * 9 + f.x * (6 - t * 4), o.position.y + 2.2, o.position.z + l.z * 9 + f.z * (6 - t * 4));
    cam.lookAt(o.position.x, o.position.y + 1.6, o.position.z); cam.fov = 52;`,
    { hud: true },
  );
}
await key(b, "KeyM");
// Rain in the driver's seat: the cockpit camera (C), wipers on HI.
await key(b, "KeyY");
await key(b, "KeyY");
await key(b, "KeyC");
for (const _ of [1, 2, 3]) await key(b, "Tab");
await b.evaluate("window.__game.setDebugCamera(null); window.__game.advance(4)");
await telop(b, "運転席から。雨の日はワイパーで", "速度計・回転計・ミラー・方向指示器");
await shot(b, "cockpit-rain", 3.5, "", { hud: true });
await key(b, "KeyY");
for (const _ of [1, 2, 3]) await key(b, "KeyC"); // back to the chase view
await key(b, "KeyA"); // autopilot off: the player drives (badly)
await b.close();

// ---- Violations: 未検挙, the patrol car, the ticket, the orbis, the internet, the post ----
b = await session(null, "day", async (g) => {
  await key(g, "KeyM");
  await g.evaluate("window.__game.advance(3)");
  for (let i = 0; i < 12 && !(await g.evaluate("!!window.__game.getPolice()")); i++)
    await g.evaluate("window.__game.advance(6)");
});
await telop(b, "違反は、見つかって初めて数える", "誰にも見られていなければ「未検挙」");
await b.evaluate("document.getElementById('cine').disabled = true");
await b.evaluate("window.__game.setDebugCamera(null)");
for (let i = 0; i < Math.round(3 * FPS); i++) {
  await b.evaluate(`window.__game.advance(${1 / FPS}, ['ArrowUp'])`);
  await b.screenshot(join(WORK, `f${String(frameNo++).padStart(5, "0")}.jpg`), 92);
}
// A patrol car right behind, lights on.
await b.evaluate(`(() => { const G = window.__game; const p = G.getPolice(); if (!p) return; const y = G.vehicle.yaw();
  const at = G.vehicle.position().clone().add({ x: -Math.sin(y) * 14, y: 0, z: -Math.cos(y) * 14 }); p.car.setCoasting(true); p.car.teleport(at, y);
  p.state = 'pursuing'; G.debug.startPursuit(); })()`);
await telop(b, "パトカーに現認されたら", "赤色灯とサイレン「前の車、左に寄って止まってください」");
await shot(
  b,
  "pursuit",
  3.5,
  `
  const p = G.getPolice()?.position ?? car; const mid = { x: (p.x + car.x) / 2, z: (p.z + car.z) / 2 };
  cam.position.set(mid.x + left.x * 8 - fwd.x * 2, car.y + 1.3, mid.z + left.z * 8 - fwd.z * 2);
  cam.lookAt(mid.x, car.y + 0.8, mid.z); cam.fov = 58;`,
  { hud: true },
);
// The ticket for what the officer saw.
await b.evaluate(`(() => { const G = window.__game; const p = G.getPolice(); if (!p) return;
  const r = G.law.state.log.find((x) => x.status === 'uncaught') ?? G.law.commit({ kind: 'speed', label: '速度超過（25km/h超過）', article: '道路交通法 第22条', points: 3, fine: 18000 }, 0, 0);
  if (r && !p.seen.includes(r)) p.seen.push(r); G.debug.openTicket(); })()`);
await telop(b, "その場で青切符", "反則金と違反点数。今日はそのまま運転して帰れる");
await shot(b, "ticket", 2.6, "", { hud: true });
await b.evaluate("document.querySelector('#ticket-accept')?.click()");
// The orbis.
await telop(b, "オービスは、後日郵便で", "赤い閃光。出頭通知書は帰宅後のポストへ");
await b.evaluate("window.__game.debug.flashScreen()");
await shot(
  b,
  "orbis",
  1.8,
  `
  cam.position.set(car.x + fwd.x * 12 + left.x * 3, car.y + 4.5, car.z + fwd.z * 12 + left.z * 3);
  cam.lookAt(car.x, car.y + 0.8, car.z); cam.fov = 50;`,
  { hud: true },
);
// The internet: a dashcam clip spreads.
await b.evaluate(`(() => { const G = window.__game; const now = G.debug.gameNow();
  const rec = G.law.state.log[0] ?? G.law.commit({ kind: 'signal', label: '信号無視（赤色等）', article: '道路交通法 第7条', points: 2, fine: 9000 }, 0, 0);
  rec.kind = 'signal'; rec.label = '信号無視（赤色等）';
  for (let i = 0; i < 6 && G.social.posts.length < 2; i++) G.social.maybePost(rec, 12, now - 50 * 60000);
  G.social.update(now);
  document.querySelector('#phone-button').click(); document.querySelector('#social-open').click();
  document.querySelector('#social-feed .social-post')?.click(); })()`);
await telop(b, "ドラレコ動画が拡散。", "「こいつやべー」リポスト・引用・いいね。警察も動画から特定");
await shot(b, "sns", 3.6, "", { hud: true });
await b.evaluate(
  "document.querySelector('#social-back')?.click(); document.querySelector('#social-back')?.click()",
);
await telop(
  b,
  "スマホから 119・110、自動運転タクシー",
  "通報は AI のオペレーターが応答（ゲーム内のシミュレーション）",
);
await shot(b, "phone", 2.2, "", { hud: true });
await b.evaluate("document.querySelector('#taxi-open')?.click()");
await shot(b, "taxi-app", 1.6, "", { hud: true });
await b.evaluate(
  "document.querySelector('#taxi-back')?.click(); document.querySelector('#phone-close')?.click()",
);
// The record of violations, with the moment's screen.
await b.evaluate("document.querySelector('#review-open')?.click()");
await telop(b, "違反を振り返る", "その瞬間の画面・場所・速度・条文・点数・反則金");
await shot(b, "review", 2.4, "", { hud: true });
await b.evaluate("document.querySelector('#violations')?.close()");
// Replays with the automatic director.
await b.evaluate(
  "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F5' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'F5' }))",
);
await telop(b, "リプレイ", "沿道・ヘリ・車載…カメラは自動で切り替え");
await shot(b, "replay", 3, "", { hud: true });
await b.evaluate(
  "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F5' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'F5' }))",
);
// Home: the post.
await b.evaluate("window.__game.debug.endDay()");
await telop(b, "帰宅すると、ポストに封筒が…", "行政処分出頭通知書。期限までに出頭しないと…");
await shot(b, "post", 3.2, "", { hud: true });
await b.close();

// ---- Night: the city ----
b = await session(null, "night", async (g) => {
  await key(g, "KeyB");
  await key(g, "KeyA");
  await key(g, "KeyM");
  await g.evaluate("window.__game.advance(3)");
});
await telop(b, "夜の東京", "ライトアップも、時刻と曜日どおり");
await shot(
  b,
  "night-crane",
  3.2,
  `
  cam.position.set(car.x - fwd.x * (10 + t * 8), car.y + 2 + t * 14, car.z - fwd.z * (10 + t * 8));
  cam.lookAt(car.x + fwd.x * 30, car.y + 4, car.z + fwd.z * 30); cam.fov = 60;`,
  { hud: true },
);
await b.close();

// ---- Landmarks at night ----
b = await session("35.7065,139.8040", "night");
await telop(b, "東京スカイツリー", "点灯は公式カレンダーどおり（粋・雅・幟）");
await shot(b, "skytree", 4, orbit(35.7100392, 139.810708, 520, 60, 330, 0.09, 18));
await b.close();
b = await session("35.6560,139.7480", "night");
await telop(b, "東京タワー", "ライトアップは曜日と時刻どおり");
await shot(b, "tokyo-tower", 3.5, orbit(35.658592, 139.74545, 260, 30, 170, -0.12, 10));
await telop(b, null);
await card(
  b,
  `<div style="display:grid;grid-template-columns:repeat(3,auto);gap:18px 56px;font-size:30px;font-weight:700;text-align:left">${[
    "交通規制 30 種類・標識 155 種",
    "レーン案内つきカーナビ",
    "自動運転・自動運転タクシー",
    "運転席・雨・ワイパー",
    "City Car Driving のキー配置",
    "違反は見つかって初めて数える",
    "パトカー・オービス・駐車監視員",
    "行政処分と期限つきの出頭",
    "SNS で晒される",
    "リプレイと違反の振り返り",
    "スカイツリー・東京タワーのライトアップ",
    "時刻・曜日・天気はリアルにも",
  ]
    .map((x) => `<div>・${x}</div>`)
    .join("")}</div>`,
  3.6,
);
await card(
  b,
  '<div><div style="font-size:84px;font-weight:800;letter-spacing:.04em">法令厳守 TOKYO OPEN DRIVE</div><div style="font-size:26px;margin-top:22px;opacity:.85">東京都・国のオープンデータでつくった、法令どおりに走るドライブ</div><div style="font-size:22px;margin-top:34px;opacity:.7">kexi.github.io/tokyo-od-game</div></div>',
  4,
);
await b.close();

// ---- Edit: frames → H.264, with a synthesized soundtrack ----
const seconds = frameNo / FPS;
const music = join(WORK, "music.wav");
// The soundtrack is synthesized to the cut's length (scripts/teaser/music.py; no samples).
execFileSync("uv", ["run", join(import.meta.dirname, "music.py"), music, String(seconds)], {
  stdio: "inherit",
});
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
