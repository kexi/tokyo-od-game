// The social-share card's picture: the game itself at 画質 最高, 東京駅 丸の内駅舎 on a rainy night
// seen from the driver's seat (the rain on the windscreen, the wipers, the dashboard), filmed by
// headless Chrome with the teaser's staging (stills.mjs). scripts/textures/og_image.py puts the
// title over it (the left of the frame is kept for that).
//
//   node scripts/teaser/og.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/og] [--port 9341]
//
// Writes one PNG per framing (out/og/<name>.png, 2400×1260, lossless: twice the card, scaled down after) so
// the best can be chosen; --pick <name> names the one og_image.py reads (out/og/scene.png, by
// default seat-near-1: the second take, the wipers at the edges of the glass).
// Needs the dev server (just serve-dev) or a development build served with the dev hook.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { at, log, openGame, parseArgs } from "./stills.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/og");
const PORT = Number(args.port ?? 9341);

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

const game = await openGame({
  base: BASE,
  start: `${STATION_FRONT.lat},${STATION_FRONT.lon}`,
  lang: "ja",
  width: 2400,
  height: 1260,
  port: PORT,
});
try {
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    // The car placed facing the station (the game's own cockpit camera rides with it).
    const placed = await game.ev(`(() => { const G = window.__game; const p = ${at(LANE_LAT, shot.lon, 0.9)};
      const st = ${at(STATION.lat, STATION.lon, 0)}; G.vehicle.teleport(p, Math.atan2(st.x - p.x, st.z - p.z));
      return G.vehicle.position().distanceTo(p); })()`);
    await game.ev("window.__tz.camera(null)");
    // The car settled on its wheels and the tiles the new view needs in.
    await game.pump(60);
    await game.ev(`window.__tz.seat(${shot.yaw}, ${shot.pitch}, ${shot.fov})`);
    await game.pump(30);
    for (let take = 0; take < TAKES; take++) {
      await game.b.screenshot(join(OUT, `${shot.name}-${take}.png`));
      await game.pump(30);
    }
    log("og_shot", { name: shot.name, placedOffM: Math.round(placed * 10) / 10 });
  }
  const pick = args.pick ?? "seat-near-1";
  copyFileSync(join(OUT, `${pick}.png`), join(OUT, "scene.png"));
  log("og_pick", { name: pick });
} finally {
  await game.close();
}
