// The social-share card's picture: the game itself at 画質 最高, 東京駅 丸の内駅舎 on a rainy night
// seen from the driver's seat (the rain on the windscreen, the wipers, the dashboard), filmed by
// headless Chrome with the teaser's staging (page.mjs) on its virtual clock (clock.mjs).
// scripts/textures/og_image.py puts the title over it (the left of the frame is kept for that).
//
//   node scripts/teaser/og.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/og] [--port 9341]
//
// Writes one JPEG per framing (out/og/<name>.jpg, 2400×1260: twice the card, scaled down after) so
// the best can be chosen; --pick <name> names the one og_image.py reads (out/og/scene.jpg, by
// default seat-near-1: the second take, the wipers at the edges of the glass).
// Needs the dev server (just serve-dev) or a development build served with the dev hook.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../qa/browser.mjs";
import { installClock } from "./clock.mjs";
import { stage } from "./page.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/og");
const PORT = Number(args.port ?? 9341);
// The line shape of src/log.ts. Why not import it: plain node cannot load the .ts logger.
const traceId = crypto.randomUUID();
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, traceId, ...fields }));

// 画質 最高 (src/graphics.ts PRESETS.ultra), Japanese, the one-time tips already seen.
const ULTRA = {
  resolution: "2",
  shadows: "4096",
  motionBlur: "light",
  bloom: "high",
  lensFlare: "on",
  reflections: "high",
  windows: "rooms",
  wetRoads: "full",
  streetLights: "32",
  rainGlass: "on",
  viewDistance: "far",
  traffic: "many",
  antialias: "on",
  backend: "auto",
};
const STORAGE = {
  "tod.graphics": JSON.stringify(ULTRA),
  "tod.lang": "ja",
  "tod.charmTip": "1",
  "tod.tvNotice": "1",
  "tod.controls": JSON.stringify({ layout: "wasd", assist: "easy", charm: "both", seatModel: 2 }),
};
const PRELOAD = `(() => { const s = ${JSON.stringify(STORAGE)};
  try { for (const k in s) localStorage.setItem(k, s[k]); } catch {} })(); (${installClock})();`;

/**
 * 東京駅 丸の内駅舎: its middle, and the road before it (the teaser's opening drives there; the game
 * starts the car on that road, facing along it).
 */
const STATION = { lat: 35.6812, lon: 139.7669 };
const STATION_FRONT = { lat: 35.6806, lon: 139.7652 };
/**
 * The framings: the car on 行幸通り (its left lane, eastbound) `lon` along, facing the station; the
 * driver's eye turned `yaw` rad (left +) and `pitch` up, with `fov`. Each is taken `takes` times a
 * second apart, as the drops gather on the glass between the wipers' strokes.
 */
const LANE_LAT = 35.68124;
const SHOTS = [{ name: "seat-near", lon: 139.7652, yaw: -0.08, pitch: 0.06, fov: 62 }];
const TAKES = 3;

/** A point at `lat, lon` in the local frame, on the ground plus `h` m. */
const at = (lat, lon, h) =>
  `(() => { const G = window.__game; const f = G.getFrame(); const p = f.toLocal(${lat}, ${lon}, f.origin.h);
  p.y = (G.groundY(p.x, p.z) ?? 0) + ${h}; return p; })()`;

const b = await launch(`${BASE}?start=${STATION_FRONT.lat},${STATION_FRONT.lon}`, {
  width: 2400,
  height: 1260,
  port: PORT,
  preload: PRELOAD,
});
try {
  let state = null;
  for (let i = 0; i < 150 && state !== "ready"; i++) {
    await b.sleep(1000);
    state = await b.evaluate("window.__game?.getState()").catch(() => null);
  }
  if (state !== "ready") throw new Error(`the game did not load (${state})`);
  await b.evaluate("window.__clock.start()");
  await b.evaluate(`(${stage})()`);
  const pump = async (frames) => {
    for (let i = 0; i < frames; i++) await b.evaluate("window.__tz.frame(window.__tz.t, window.__tz.len)");
  };
  const sky = () =>
    b.evaluate(`document.querySelector('[data-time="night"]').click();
      document.querySelector('[data-weather="rain"]').click();
      window.__game.env.wetness = window.__game.env.overcast = 1`);
  await b.evaluate("window.__game.start()");
  await pump(5);
  await sky();
  await b.evaluate("window.__tz.hud('none')");
  // No light pillars over the spots and no route arrows on the road; the phone in the pocket.
  await b.evaluate(`(() => { const G = window.__game; G.field.beams.visible = false; G.field.gems.visible = false;
    G.ribbon.update = () => {}; G.ribbon.object.visible = false; })()`);
  await b.evaluate("window.__tz.key('KeyF')");
  // Long enough for the city's tiles, the far skyline and the wet road to come in.
  await pump(240);
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    // The car placed facing the station (the game's own cockpit camera rides with it).
    const placed =
      await b.evaluate(`(() => { const G = window.__game; const p = ${at(LANE_LAT, shot.lon, 0.9)};
      const st = ${at(STATION.lat, STATION.lon, 0)}; G.vehicle.teleport(p, Math.atan2(st.x - p.x, st.z - p.z));
      return G.vehicle.position().distanceTo(p); })()`);
    await b.evaluate("window.__tz.camera(null)");
    // The car settled on its wheels and the tiles the new view needs in.
    await pump(60);
    await b.evaluate(`window.__tz.seat(${shot.yaw}, ${shot.pitch}, ${shot.fov})`);
    await pump(30);
    for (let take = 0; take < TAKES; take++) {
      await b.screenshot(join(OUT, `${shot.name}-${take}.jpg`), 95);
      await pump(30);
    }
    log("og_shot", { name: shot.name, placedOffM: Math.round(placed * 10) / 10 });
  }
  const pick = args.pick ?? "seat-near-1";
  copyFileSync(join(OUT, `${pick}.jpg`), join(OUT, "scene.jpg"));
  log("og_pick", { name: pick });
} finally {
  await b.close();
}
