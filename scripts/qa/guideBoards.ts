// The 案内標識 at five fixed places, as the running game plans and draws them (knowledge/sign-system.md
// 「案内標識のレイアウタ（G5）」): every plan's placement (number, where the pole stands, its facing,
// the mount, the distance to the junction, the board's content) and every board's drawn face, as a
// lossless PNG and a SHA-256 of its pixels. With --against, compares with an earlier label: rows that
// moved and boards whose pixels differ (count of differing pixels and the largest channel step).
//
//   pnpm exec tsx scripts/qa/guideBoards.ts --label before [--base URL]
//   pnpm exec tsx scripts/qa/guideBoards.ts --label after --against before
//
// Output: .qa/guide-boards/<label>/<place>.json and <place>/<n>.png; compare.json with --against.
// Exit 1 when the comparison finds a change in the 108 series (105・106 are new and listed apart).
//
// Besides the five places, `fixed` draws FIXED_BOARDS: 108 contents none of the five places plans
// (an expressway's name in its green box, 10 and 15 cm letters, a 108の4 with a distance), so the
// drawing paths the places leave out are compared too (`--only fixed` draws just them). The mount
// (路側式 or 片持式) is not part of a face: it does not change a pixel.
//
// How the face is drawn: the game's own `GuideSigns.debugBoards()` when it has one (G5 on), else the
// module the dev server serves (src/world/guideArt.ts, before G5), so one script reads both.
// Why not the review runner (views.ts): it shoots the screen; the board's own pixels are what must
// not change, and the screen also moves with the light, the mips and the camera.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log, warn } from "../../src/log";
import { launch, type Browser } from "./browser.mjs";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
/** The five places of the 108 series' first survey (knowledge/road-markings-and-signs.md「結果」). */
const PLACES = [
  { id: "marunouchi", start: [35.68075, 139.76345] },
  { id: "hibiya", start: [35.6745, 139.7598] },
  { id: "ginza4", start: [35.67165, 139.76506] },
  { id: "kasumigaseki", start: [35.67345, 139.75045] },
  { id: "kudanshita", start: [35.6955, 139.7514] },
] as const;

const boardName = (ja: string, en: string, expressway = false) => ({ ja, en, expressway });
/** An expressway's name: a generic one (no operator's or route's real name is needed for the box). */
const EXPRESSWAY = boardName("都市高速", "Expressway", true);
const national = (number: string) => ({ kind: "national", number });
const prefectural = (number: string) => ({ kind: "prefectural", number });
/**
 * 108 contents the five places do not plan (knowledge/sign-system.md「不変の確かめ方」): each names
 * an expressway, and the letters run over 10, 15, 20 and 30 cm. Plain JSON in the shape of
 * BoardSpec before G5 and of JunctionContent after it (the two are the same).
 */
const FIXED_BOARDS = [
  {
    kind: "108-A",
    arms: [
      {
        angle: 0,
        names: [EXPRESSWAY, boardName("新宿", "Shinjuku")],
        shields: [national("20")],
        street: null,
      },
      { angle: 90, names: [boardName("上野", "Ueno")], shields: [], street: null },
      { angle: -90, names: [boardName("品川", "Shinagawa")], shields: [prefectural("316")], street: null },
    ],
    distance: 300,
    letter: 30,
  },
  {
    kind: "108の2-A",
    arms: [
      { angle: 0, names: [boardName("池袋", "Ikebukuro")], shields: [], street: null },
      { angle: 90, names: [EXPRESSWAY], shields: [], street: null },
      {
        angle: -90,
        names: [boardName("渋谷", "Shibuya"), boardName("目黒", "Meguro")],
        shields: [],
        street: null,
      },
    ],
    distance: null,
    letter: 10,
  },
  {
    kind: "108の3",
    arms: [
      { angle: 0, names: [EXPRESSWAY], shields: [national("1")], street: "外堀通り" },
      { angle: 90, names: [boardName("神田", "Kanda")], shields: [], street: "靖国通り" },
      { angle: -90, names: [boardName("赤坂", "Akasaka")], shields: [], street: null },
    ],
    distance: null,
    letter: 15,
  },
  {
    kind: "108の4",
    arms: [
      { angle: 0, names: [boardName("日本橋", "Nihombashi")], shields: [], street: "中央通り" },
      { angle: 45, names: [EXPRESSWAY, boardName("浅草", "Asakusa")], shields: [], street: null },
      { angle: -90, names: [boardName("銀座", "Ginza")], shields: [prefectural("405")], street: "晴海通り" },
    ],
    distance: 150,
    letter: 20,
  },
  {
    kind: "108-A",
    arms: [
      { angle: 0, names: [boardName("大手町", "Otemachi")], shields: [], street: null },
      {
        angle: -90,
        names: [EXPRESSWAY, boardName("有明", "Ariake")],
        shields: [national("357")],
        street: null,
      },
    ],
    distance: 300,
    letter: 15,
  },
];
/** The pseudo place of FIXED_BOARDS. */
const FIXED = "fixed";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label");
if (!label) throw new Error("usage: guideBoards.ts --label NAME [--against NAME] [--base URL] [--only ids]");
const against = flag("against");
const only = flag("only")?.split(",") ?? null;
const base = flag("base") || process.env.QA_URL || "http://localhost:5173/tokyo-od-game/";
const outDir = join(ROOT, ".qa", "guide-boards", label);
mkdirSync(outDir, { recursive: true });

const keepAlive = setInterval(() => {}, 1000);

async function until<T>(b: Browser, expression: string, seconds: number, every = 500): Promise<T | null> {
  const deadline = performance.now() + seconds * 1000;
  while (performance.now() < deadline) {
    const v = await b.evaluate<T>(expression).catch(() => null);
    if (v) return v;
    await b.sleep(every);
  }
  return null;
}

type Row = Record<string, unknown> & { key: string; kind: string };
type Face = { key: string; kind: string; png: string; sha: string; width: number; height: number };
/** The BoardFacePool's budget as the game used it while the place settled (G5 on; null before). */
type PoolDump = { usage: Record<string, number>; stats: Record<string, number | number[]> } | null;
type PlaceDump = { place: string; rows: Row[]; faces: Face[]; pool?: PoolDump };

/** Page-side: a drawn canvas as a Face (SHA-256 of its pixels and a PNG data URL). */
// Everything is read off the canvas before the first await: drawBoard may reuse one canvas, which
// the game's own drawing could take over while the digest runs.
const FACE_OF = `async (key, kind, c) => {
  const { width, height } = c;
  const data = c.getContext('2d').getImageData(0, 0, width, height).data;
  const png = c.toDataURL('image/png');
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { key, kind, png, sha, width, height };
}`;

/**
 * Page-side: FIXED_BOARDS laid out and drawn at 512 px by the module the dev server serves —
 * layoutGuideBoard after G5, layoutBoard (BoardSpec) before it.
 */
const DUMP_FIXED = (baseUrl: string) => `(async () => {
  const faceOf = ${FACE_OF};
  const m = await import(${JSON.stringify(baseUrl)} + 'src/world/guideArt.ts');
  await m.loadGuideFonts();
  await document.fonts.ready;
  const layout = m.layoutGuideBoard ?? m.layoutBoard;
  const boards = ${JSON.stringify(FIXED_BOARDS)};
  const rows = boards.map((board, i) => ({ key: String(i), kind: board.kind, board }));
  const faces = [];
  for (const [i, board] of boards.entries())
    faces.push(await faceOf(String(i), board.kind, m.drawBoard(layout(board), 512)));
  return { rows, faces, pool: null };
})()`;

/** Page-side: the plans as rows and each board drawn at 512 px (the layer's width). */
const DUMP = (baseUrl: string) => `(async () => {
  const faceOf = ${FACE_OF};
  const G = window.__game;
  const guide = G.guideSigns;
  const r2 = (v) => Math.round(v * 100) / 100;
  const hook = typeof guide.debugBoards === 'function' ? guide.debugBoards() : null;
  let draw;
  if (hook) { draw = hook.draw; }
  else {
    const m = await import(${JSON.stringify(baseUrl)} + 'src/world/guideArt.ts');
    await m.loadGuideFonts();
    draw = (i) => m.drawBoard(m.layoutBoard(guide.plans[i].board), 512);
  }
  await document.fonts.ready;
  const plans = guide.plans;
  const rows = plans.map((p, i) => ({
    key: String(i),
    kind: p.board.kind,
    pos: [r2(p.pos.x), r2(p.pos.z)],
    travel: [r2(p.travel.x), r2(p.travel.z)],
    mount: p.mount,
    before: r2(p.before),
    board: p.board,
  }));
  const faces = [];
  for (let i = 0; i < plans.length; i++) faces.push(await faceOf(String(i), plans[i].board.kind, draw(i)));
  const pool = hook ? { usage: hook.usage, stats: hook.stats } : null;
  return { rows, faces, pool };
})()`;

/** Page-side: differing pixels between two PNGs (data URLs) and the largest channel step. */
const DIFF = (a: string, b: string) => `(async () => {
  const load = async (u) => { const r = await fetch(u); return createImageBitmap(await r.blob()); };
  const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  if (x.width !== y.width || x.height !== y.height) return { sizeA: [x.width, x.height], sizeB: [y.width, y.height] };
  const read = (im) => { const c = new OffscreenCanvas(im.width, im.height); const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
  const p = read(x); const q = read(y);
  let pixels = 0; let max = 0;
  for (let i = 0; i < p.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(p[i + k] - q[i + k]));
    if (d > 0) pixels++;
    max = Math.max(max, d);
  }
  return { pixels, max, of: p.length / 4 };
})()`;

/** FIXED_BOARDS on a page of the dev server that does not start the game (assets.html). */
async function dumpFixed(): Promise<PlaceDump> {
  const page = new URL("assets.html", base).href;
  const b = await launch(page, { port: await freePort(), width: 640, height: 480 });
  try {
    const dump = await b.evaluate<{ rows: Row[]; faces: Face[]; pool: PoolDump }>(DUMP_FIXED(base));
    return { place: FIXED, ...dump };
  } finally {
    await b.close();
  }
}

async function dumpPlace(place: (typeof PLACES)[number]): Promise<PlaceDump> {
  const url = new URL(base);
  url.searchParams.set("start", `${place.start[0]},${place.start[1]}`);
  url.searchParams.set("time", "day");
  url.searchParams.set("weather", "clear");
  url.searchParams.set("seed", "20261110");
  const b = await launch(url.href, { port: await freePort(), width: 960, height: 540 });
  try {
    const isReady = await until<boolean>(b, "window.__game?.getState() === 'ready'", 180, 1000);
    if (!isReady) throw new Error(`page not ready: ${url.href}`);
    await b.evaluate("window.__game.start()");
    // The plans are made once the route tiles are in after the roads (guideSigns.rebuild); the
    // same count twice 3 s apart, after the world settled, is taken as done.
    await until<boolean>(b, "__game.debug.settled().isSettled", 180, 1000);
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const n = await b.evaluate<number>("__game.guideSigns.plans.length");
      if (n > 0 && n === last) break;
      last = n;
      await b.sleep(3000);
    }
    const dump = await b.evaluate<{ rows: Row[]; faces: Face[]; pool: PoolDump }>(DUMP(base));
    return { place: place.id, ...dump };
  } finally {
    await b.close();
  }
}

const ms = (v: number) => Math.round(v * 10) / 10;
/**
 * Drawing steps counted as the warm-up. Two, not one: in the G5 review's measurement the first
 * step cost 6–9 ms like the steady ones and the second 12.6–58.9 ms (knowledge/sign-system.md
 * 「BoardFacePool」).
 */
const WARMUP_STEPS = 2;
/**
 * The pool's drawing steps (BoardFacePool stats.stepMs, a whole `start(1)` each): the warm-up
 * steps apart, the rest's median and longest. Empty before G5.
 */
function stepSummary(pool: PoolDump | undefined) {
  const steps = pool?.stats.stepMs;
  if (!Array.isArray(steps) || steps.length === 0) return {};
  const sorted = steps.slice(WARMUP_STEPS).toSorted((a, b) => a - b);
  const summary = {
    steps: steps.length,
    warmupStepMs: steps.slice(0, WARMUP_STEPS).map(ms),
    maxSliceMs: ms(Number(pool?.stats.maxSliceMs)),
  };
  if (sorted.length === 0) return summary;
  return {
    ...summary,
    steadyMedianStepMs: ms(sorted[Math.floor(sorted.length / 2)]),
    steadyMaxStepMs: ms(sorted[sorted.length - 1]),
  };
}

const isNewKind = (kind: string) => kind.startsWith("105") || kind.startsWith("106");
const strip = (r: Row) => JSON.stringify({ ...r, key: undefined });

const report: Record<string, unknown> = {};
let changed = 0;
for (const place of [...PLACES, { id: FIXED }]) {
  if (only && !only.includes(place.id)) continue;
  const started = performance.now();
  const dump = "start" in place ? await dumpPlace(place) : await dumpFixed();
  const dir = join(outDir, place.id);
  mkdirSync(dir, { recursive: true });
  for (const f of dump.faces)
    writeFileSync(join(dir, `${f.key}.png`), Buffer.from(f.png.split(",")[1], "base64"));
  const kept = { ...dump, faces: dump.faces.map((f) => ({ ...f, png: `${place.id}/${f.key}.png` })) };
  writeFileSync(join(outDir, `${place.id}.json`), `${JSON.stringify(kept, null, 1)}\n`);
  log("guide_boards_dumped", {
    place: place.id,
    plans: dump.rows.length,
    durationMs: Math.round(performance.now() - started),
    ...stepSummary(dump.pool),
  });
  if (!against) continue;
  const prevFile = join(ROOT, ".qa", "guide-boards", against, `${place.id}.json`);
  if (!existsSync(prevFile)) {
    warn("guide_boards_no_baseline", { place: place.id, against });
    continue;
  }
  const prev = JSON.parse(readFileSync(prevFile, "utf8")) as PlaceDump;
  // 105・106 are planned after every 108 (guidePlan.ts), so the 108 rows keep their order.
  const oldRows = prev.rows.filter((r) => !isNewKind(r.kind));
  const newRows = dump.rows.filter((r) => !isNewKind(r.kind));
  const rowChanges = newRows
    .map((r, i) => ({ i, before: oldRows[i] ? strip(oldRows[i]) : null, after: strip(r) }))
    .filter((c) => c.before !== c.after);
  const missing = oldRows.length - newRows.length;
  const faceChanges: unknown[] = [];
  const b = await launch("about:blank", { port: await freePort(), width: 64, height: 64 });
  try {
    for (const [i, f] of dump.faces.entries()) {
      if (isNewKind(f.kind)) continue;
      const old = prev.faces.filter((x) => !isNewKind(x.kind))[newRows.indexOf(dump.rows[i])];
      if (!old || old.sha === f.sha) continue;
      const oldPng = readFileSync(join(ROOT, ".qa", "guide-boards", against, old.png)).toString("base64");
      const diff = await b.evaluate(DIFF(`data:image/png;base64,${oldPng}`, f.png));
      faceChanges.push({ key: f.key, kind: f.kind, diff });
    }
  } finally {
    await b.close();
  }
  const added = dump.rows.filter((r) => isNewKind(r.kind)).map((r) => ({ kind: r.kind, board: r.board }));
  changed += rowChanges.length + Math.abs(missing) + faceChanges.length;
  report[place.id] = {
    plans108: { before: oldRows.length, after: newRows.length },
    rowChanges,
    faceChanges,
    identicalFaces: newRows.length - faceChanges.length,
    added: { count: added.length, boards: added },
  };
}
if (against) {
  writeFileSync(join(outDir, "compare.json"), `${JSON.stringify(report, null, 1)}\n`);
  log("guide_boards_compared", { label, against, changed });
}
clearInterval(keepAlive);
process.exit(changed > 0 ? 1 : 0);
