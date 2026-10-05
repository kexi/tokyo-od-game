// Photos of the game for sharing: 東京駅 丸の内駅舎, 東京スカイツリー and 東京タワー on a rainy night
// from the driver's seat (the rain on the windscreen, the wipers, the dashboard), at 画質 最高 with
// the game in `--lang` (English by default), filmed by headless Chrome (stills.mjs).
//
//   node scripts/teaser/photos.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/photos]
//                                  [--lang en] [--only skytree,tower] [--port 9343]
//
// Writes out/photos/<name>-<take>.png (2560×1440, lossless), three takes a second apart as the drops
// gather between the wipers' strokes, and <name>.png: the take --pick-<name> names (by default the
// one of each where the wipers were off the middle of the glass when last filmed).
// Needs the dev server (just serve-dev) or a development build served with the dev hook.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { log, openGame, parseArgs } from "./stills.mjs";

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
 * road in the graph is the street across the station's front, not the boulevard). `pitch` and
 * `fov` override the look up worked out from the landmark's height.
 */
const PHOTOS = [
  {
    name: "tokyo-station",
    landmark: { lat: 35.6813763, lon: 139.7660621, height: 46.1 },
    from: { lat: 35.68124, lon: 139.7652 },
    fixed: true,
    // Close (≈ 80 m) and low: the share card's framing, level enough to keep the gauges in.
    turn: -0.08,
    pitch: 0.06,
    fov: 62,
    pick: 1,
  },
  {
    name: "tokyo-skytree",
    landmark: { lat: 35.7100392, lon: 139.810708, height: 634 },
    from: { lat: 35.7104, lon: 139.7935 },
    minWidth: 12,
    turn: 0,
    pick: 0,
  },
  {
    name: "tokyo-tower",
    landmark: { lat: 35.658592, lon: 139.74545, height: 333 },
    from: { lat: 35.6617, lon: 139.7345 },
    minWidth: 10,
    turn: 0,
    pick: 0,
  },
];

/**
 * Page side: the car placed for `photo`; returns the driver's turn towards the landmark (rad, left
 * +) and how far up its top is (rad), with where it stood.
 */
const placeFor = (photo) => `(() => {
  const G = window.__game; const V = G.camera.position.constructor; const f = G.getFrame();
  const lm = f.toLocal(${photo.landmark.lat}, ${photo.landmark.lon}, f.origin.h);
  const from = f.toLocal(${photo.from.lat}, ${photo.from.lon}, f.origin.h);
  let p = from.clone(); let heading = new V(lm.x - from.x, 0, lm.z - from.z).normalize(); let road = null;
  if (!${Boolean(photo.fixed)}) {
    const graph = G.getRoadGraph();
    // Only a road running towards the landmark (within ≈ 25°): the nearest wide road alone was a
    // cross street, the landmark off to the side behind the pillars.
    const toward = new V(lm.x - from.x, 0, lm.z - from.z).normalize();
    // Not an expressway: its deck is not in the road graph's heights, and a car put on the ground
    // under it stood among the buildings. A one-way street only the way it may be driven.
    const isToward = (seg) => {
      if (seg.line.kind === 'highway') return false;
      const a = seg.pts[0]; const z = seg.pts[seg.pts.length - 1];
      const run = new V(z.x - a.x, 0, z.z - a.z);
      if (run.lengthSq() <= 1) return false;
      const along = run.normalize().dot(toward);
      const isAllowed = seg.line.oneway === 0 || Math.sign(along) === seg.line.oneway;
      return isAllowed && Math.abs(along) > 0.9;
    };
    const hit = graph && graph.nearest(from, 250, (seg) => seg.line.width >= ${photo.minWidth ?? 6} && isToward(seg));
    if (!hit) return { error: 'no road near the viewpoint' };
    const s = graph.sample(hit.seg, hit.s);
    const d = s.dir.clone().setY(0).normalize();
    const toLm = new V(lm.x - s.pos.x, 0, lm.z - s.pos.z);
    if (d.dot(toLm) < 0) d.negate();
    // Keep left: the lane a quarter of the road's width left of its middle (at most 4 m).
    const left = new V(d.z, 0, -d.x);
    p = s.pos.clone().addScaledVector(left, Math.min(hit.seg.line.width * 0.25, 4));
    heading = d;
    road = { width: hit.seg.line.width, kind: hit.seg.line.kind, offM: Math.round(hit.lateral) };
  }
  p.y = (G.groundY(p.x, p.z) ?? 0) + 0.9;
  const yaw = Math.atan2(heading.x, heading.z);
  G.vehicle.teleport(p, yaw);
  const bearing = Math.atan2(lm.x - p.x, lm.z - p.z);
  const turn = Math.atan2(Math.sin(bearing - yaw), Math.cos(bearing - yaw));
  const dist = Math.hypot(lm.x - p.x, lm.z - p.z);
  return { turn, dist: Math.round(dist), top: Math.atan2(${photo.landmark.height} - 1.2, dist), road };
})()`;

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
    if (placed?.error) throw new Error(`${photo.name}: ${placed.error}`);
    await game.ev("window.__tz.camera(null)");
    // The car settled on its wheels and the tiles the new view needs in.
    await game.pump(90);
    // Turned towards the landmark (as far as the windscreen allows) and looking up so its top sits
    // about two thirds of the way up the picture.
    const yaw = Math.max(-0.6, Math.min(0.6, placed.turn + photo.turn));
    const pitch = photo.pitch ?? Math.max(0.03, Math.min(0.2, placed.top - 0.3));
    await game.ev(`window.__tz.seat(${yaw}, ${pitch}, ${photo.fov ?? 60})`);
    await game.pump(30);
    for (let take = 0; take < TAKES; take++) {
      await game.b.screenshot(join(OUT, `${photo.name}-${take}.png`));
      await game.pump(30);
    }
    // A pedestrian under the car where it was put books an accident (its stamp is on the picture).
    const hasAccident = Boolean(await game.ev("window.__game.emergency.active"));
    const pick = args[`pick-${photo.name}`] ?? String(photo.pick);
    copyFileSync(join(OUT, `${photo.name}-${pick}.png`), join(OUT, `${photo.name}.png`));
    log("photo_shot", { name: photo.name, ...placed, yaw, pitch, pick, hasAccident });
  } finally {
    await game.close();
  }
}
