// Photos of the game for sharing: 東京駅 丸の内駅舎, 東京スカイツリー and 東京タワー on a rainy night
// from the driver's seat (the rain on the windscreen, the wipers, the dashboard), at 画質 最高 with
// the game in `--lang` (English by default), filmed by headless Chrome (stills.mjs).
//
//   node scripts/teaser/photos.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/photos]
//                                  [--lang en] [--only skytree,tower] [--port 9343]
//
// Writes out/photos/<name>-<take>.png (2560×1440, lossless), three takes a second apart as the drops
// gather between the wipers' strokes, and <name>-raw.png: the take --pick-<name> names (by default
// the one of each where the wipers were off the middle of the glass when last filmed).
// scripts/textures/photo_title.py then puts the game's title on it as <name>.png.
// Needs the dev server (just serve-dev) or a development build served with the dev hook.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { log, lookAtLandmark, openGame, parseArgs, placeFor } from "./stills.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/photos");
const PORT = Number(args.port ?? 9343);
const LANG = args.lang ?? "en";
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const TAKES = 3;

/**
 * Each photo: the landmark (public/data/landmarks.json: its foot and height), and the road the car
 * stands on — the one nearest `from` at least `minWidth` m wide, in its left lane, facing along it
 * the way towards the landmark. A road that runs straight at it: 行幸通り to the station,
 * 浅草通り east from 田原町 to the Skytree (≈ 1.5 km, its top ≈ 22° up), 外苑東通り from 六本木 to
 * the tower at the end of the road (≈ 1.1 km; from 芝大門 the street ended at a building before it). `fixed` places the car exactly at `from` (行幸通り: its nearest
 * road in the graph is the street across the station's front, not the boulevard). `toward` is the
 * way the car goes when that is not straight at the landmark (the station's front street); `pitch`
 * and `fov` override the look up worked out from the landmark's height.
 */
const STATION = { lat: 35.6813763, lon: 139.7660621, height: 46.1 };
const SKYTREE = { lat: 35.7100392, lon: 139.810708, height: 634 };
const TOWER = { lat: 35.658592, lon: 139.74545, height: 333 };
const PHOTOS = [
  {
    name: "tokyo-station",
    landmark: STATION,
    from: { lat: 35.68124, lon: 139.7652 },
    fixed: true,
    // Close (≈ 80 m) and low: the share card's framing, level enough to keep the gauges in.
    turn: -0.08,
    pitch: 0.06,
    fov: 62,
    pick: 0,
  },
  // Further back on 行幸通り (≈ 250 m), a narrower view: the station at the end of the boulevard
  // between the high-rises.
  {
    name: "tokyo-station-vista",
    landmark: STATION,
    from: { lat: 35.68124, lon: 139.7638 },
    fixed: true,
    turn: -0.03,
    pitch: 0.05,
    fov: 48,
    pick: 0,
  },
  {
    name: "tokyo-skytree",
    landmark: SKYTREE,
    from: { lat: 35.7104, lon: 139.7935 },
    minWidth: 12,
    turn: 0,
    pick: 0,
  },
  // Close-ups: as near as the top still shows through the glass (its upper edge is ≈ 27° above the
  // eye, so ≈ 1.3 km for the Skytree, ≈ 0.75 km for the tower; nearer, the roof hides the top), and
  // a narrower view (44°) to make them larger. 雷門 by 吾妻橋; 外苑東通り at 飯倉片町.
  {
    name: "tokyo-skytree-close",
    landmark: SKYTREE,
    from: { lat: 35.7104, lon: 139.7962 },
    minWidth: 10,
    turn: 0,
    fov: 44,
    pick: 0,
  },
  // 吾妻橋 eastbound over the Sumida (≈ 1.2 km): the river's lights under the tower.
  {
    name: "tokyo-skytree-bridge",
    landmark: SKYTREE,
    from: { lat: 35.7106, lon: 139.7978 },
    minWidth: 10,
    turn: 0,
    fov: 64,
    pick: 0,
  },
  {
    name: "tokyo-tower-close",
    landmark: TOWER,
    from: { lat: 35.6608, lon: 139.7377 },
    minWidth: 10,
    turn: 0,
    fov: 44,
    pick: 0,
  },
  // From the south (三田 side, ≈ 0.75 km): the tower at the end of the street over a crossing.
  {
    name: "tokyo-tower-south",
    landmark: TOWER,
    from: { lat: 35.652, lon: 139.743 },
    minWidth: 10,
    turn: 0,
    pick: 0,
  },
  // From the east (御成門 side, ≈ 0.5 km): the tower large over an open crossing.
  {
    name: "tokyo-tower-east",
    landmark: TOWER,
    from: { lat: 35.6595, lon: 139.752 },
    minWidth: 8,
    turn: 0,
    pick: 0,
  },
];

mkdirSync(OUT, { recursive: true });
for (const photo of PHOTOS) {
  if (ONLY && !ONLY.has(photo.name)) continue;
  const game = await openGame({
    base: BASE,
    start: `${photo.from.lat},${photo.from.lon}`,
    lang: LANG,
    width: 2560,
    height: 1440,
    port: PORT,
  });
  try {
    const placed = await game.ev(placeFor(photo));
    // One viewpoint without a fitting road skips that photo, not the rest.
    if (placed?.error) {
      log("photo_skipped", { name: photo.name, reason: placed.error });
      continue;
    }
    await game.ev("window.__tz.camera(null)");
    // The car settled on its wheels and the tiles the new view needs in.
    await game.pump(90);
    const { yaw, pitch } = await lookAtLandmark(game, photo, placed);
    await game.pump(30);
    for (let take = 0; take < TAKES; take++) {
      await game.b.screenshot(join(OUT, `${photo.name}-${take}.png`));
      await game.pump(30);
    }
    // A pedestrian under the car where it was put books an accident (its stamp is on the picture).
    const hasAccident = Boolean(await game.ev("window.__game.emergency.active"));
    const pick = args[`pick-${photo.name}`] ?? String(photo.pick);
    copyFileSync(join(OUT, `${photo.name}-${pick}.png`), join(OUT, `${photo.name}-raw.png`));
    log("photo_shot", { name: photo.name, ...placed, yaw, pitch, pick, hasAccident });
  } finally {
    await game.close();
  }
}
