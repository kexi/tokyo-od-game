// The teaser's soundtrack with the game's own sounds: each section's scene (sounds.mjs) rendered
// by the game's audio code in headless Chrome (sfxPage.mjs), laid on the cut, mixed under and over
// the music (mix.py), brought to −16 LUFS with the true peak under −1 dBTP (a gain from ffmpeg's
// EBU R128 reading, then a limiter at 4 × the sample rate, read again after the AAC encode and set
// once more), and muxed with the video stream as it is (no re-encode).
//
//   node scripts/teaser/sound.mjs --lang en --video out/teaser.en.mp4 [--out <the video, or for ja
//                                 out/teaser.sfx.mp4: the Japanese teaser's file is kept as it was>]
//                                 [--work out/teaser-frames-en] [--base http://localhost:5173/tokyo-od-game/]
//                                 [--port 9340] [--sfx-db 4] [--music-db -2]
//
// The cut's frames need not be there, only WORK/done.json (when each section starts) and
// WORK/music.wav (else the music is rendered again from the cut's cues). Needs the dev server or a
// development build (window.__game). teaser.mjs runs it at the end for a cut with `sfx`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "../qa/browser.mjs";
import { CUTS } from "./cuts.mjs";
import { renderSection } from "./sfxPage.mjs";
import { timeline } from "./sounds.mjs";

const SR = 44100;
/**
 * Where the loudness ends: −16 LUFS integrated; the limiter's ceiling −2.5 dBFS at 176.4 kHz (an
 * estimate of the true peak), so the AAC's overshoot stays under −1 dBTP.
 */
const LOUDNESS = { I: -16, ceilingDb: -2.5 };
// The line shape of src/log.ts. Why not import it: plain node cannot load the .ts logger.
const traceId = crypto.randomUUID();
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, traceId, ...fields }));

/** The game's page, light to load (画質 低): only its audio classes are used. */
const PRELOAD = `(() => { try {
  localStorage.setItem('tod.graphics', JSON.stringify({ resolution: '0.75', shadows: 'off', motionBlur: 'off', bloom: 'off',
    lensFlare: 'off', reflections: 'off', windows: 'flat', wetRoads: 'simple', streetLights: '0', rainGlass: 'off',
    viewDistance: 'near', traffic: 'few', antialias: 'off', backend: 'auto' }));
  localStorage.setItem('tod.charmTip', '1'); localStorage.setItem('tod.tvNotice', '1'); } catch {} })();`;

/** The game's sounds for every section of the cut, laid on it: interleaved stereo float32. */
async function renderSfx({ sections, seconds, base, port }) {
  const PAD = 0.02;
  const out = new Float32Array(Math.round(seconds * SR) * 2);
  const b = await launch(base, { width: 640, height: 360, port, preload: PRELOAD });
  try {
    let state = null;
    for (let i = 0; i < 180 && state !== "ready"; i++) {
      await b.sleep(1000);
      state = await b.evaluate("window.__game?.getState()").catch(() => null);
    }
    if (state !== "ready") throw new Error(`the game did not load (${state})`);
    for (const s of sections) {
      const t0 = performance.now();
      const b64 = await b.evaluate(
        `(${renderSection})(${JSON.stringify({ scene: s.scene, seconds: s.seconds, pad: PAD })})`,
      );
      const buf = Buffer.from(b64, "base64");
      const data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      // Laid from `pad` before the cut to `pad` after it, faded over 2 × pad at both ends: the
      // sections overlap there and cross.
      const first = Math.round((s.start - PAD) * SR);
      const n = data.length / 2;
      const fade = Math.round(2 * PAD * SR);
      const gain = 10 ** (s.gain / 20);
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const at = first + i;
        if (at < 0 || at * 2 + 1 >= out.length) continue;
        const k = Math.min(1, (i + 0.5) / fade, (n - i - 0.5) / fade);
        for (let ch = 0; ch < 2; ch++) {
          const v = data[i * 2 + ch] * gain;
          peak = Math.max(peak, Math.abs(v));
          out[at * 2 + ch] += v * k;
        }
      }
      log("sfx_section", {
        id: s.id,
        seconds: Math.round(s.seconds * 100) / 100,
        peakDb: peak > 0 ? Math.round(20 * Math.log10(peak) * 10) / 10 : null,
        durationMs: Math.round(performance.now() - t0),
      });
    }
  } finally {
    await b.close();
  }
  return out;
}

/** ffmpeg's EBU R128 reading of a file: integrated loudness (LUFS), range (LU), true peak (dBTP). */
function readR128(file) {
  const r = execFileSync(
    "sh",
    [
      "-c",
      `ffmpeg -hide_banner -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | tail -16`,
      "sh",
      file,
    ],
    { encoding: "utf8" },
  );
  const num = (re) => Number(r.match(re)?.[1]);
  return {
    lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDbtp: num(/Peak:\s+(-?[\d.]+) dBFS/),
  };
}

/**
 * The cut's soundtrack with the game's sounds, muxed with `video`'s picture into `out` (which may
 * be `video` itself: written beside it, then moved over).
 */
export async function addSound({
  lang,
  video,
  out,
  work,
  base = "http://localhost:5173/tokyo-od-game/",
  port = 9340,
  sfxDb = 4,
  musicDb = -2,
}) {
  const cut = CUTS[lang];
  if (!cut) throw new Error(`no cut for --lang ${lang}`);
  const done = JSON.parse(readFileSync(join(work, "done.json"), "utf8"));
  const sections = timeline(done, cut.edit, lang);
  const music = join(work, "music.wav");
  if (!existsSync(music)) {
    const cues = cut.music.map((id) => done.starts[id].toFixed(2)).join(",");
    execFileSync("uv", ["run", join(import.meta.dirname, "music.py"), music, String(done.seconds), cues], {
      stdio: "inherit",
    });
  }
  const sfx = await renderSfx({ sections, seconds: done.seconds, base, port });
  const sfxFile = join(work, "sfx.f32");
  writeFileSync(sfxFile, Buffer.from(sfx.buffer));
  const duckFile = join(work, "duck.json");
  writeFileSync(duckFile, JSON.stringify(sections.flatMap((s) => s.duck)));
  const mix = join(work, "mix.wav");
  execFileSync(
    "uv",
    [
      "run",
      join(import.meta.dirname, "mix.py"),
      music,
      sfxFile,
      duckFile,
      mix,
      "--sfx-db",
      String(sfxDb),
      "--music-db",
      String(musicDb),
    ],
    { stdio: "inherit" },
  );
  log("layers", { music: readR128(`${mix}.music.wav`), sfx: readR128(`${mix}.sfx.wav`) });
  // Why not ffmpeg's loudnorm: to reach −16 LUFS with these peaks it leaves its linear mode for its
  // dynamic one, which reshapes the mix (the ducks and the seal's slam flattened, LRA 5.6), and the
  // AAC then went over its −1.5 dBTP to −0.9.
  const tmp = resolve(out).replace(/\.mp4$/, ".sound-tmp.mp4");
  const encode = (gainDb) =>
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        video,
        "-i",
        mix,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-af",
        `volume=${gainDb.toFixed(2)}dB,aresample=${SR * 4},` +
          `alimiter=limit=${(10 ** (LOUDNESS.ceilingDb / 20)).toFixed(4)}:attack=2:release=60:level=0,aresample=${SR}`,
        "-ar",
        String(SR),
        "-ac",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        tmp,
      ],
      { stdio: "ignore" },
    );
  const before = readR128(mix);
  let gainDb = LOUDNESS.I - before.lufs;
  encode(gainDb);
  let result = readR128(tmp);
  // The limiter takes a little of the loudness: once more with the difference.
  if (Math.abs(result.lufs - LOUDNESS.I) > 0.2) {
    gainDb += LOUDNESS.I - result.lufs;
    encode(gainDb);
    result = readR128(tmp);
  }
  renameSync(tmp, out);
  log("sound_done", { out, mixLufs: before.lufs, gainDb: Math.round(gainDb * 100) / 100, ...result });
  return result;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
  );
  const lang = args.lang ?? "en";
  const isJa = lang === "ja";
  const video = resolve(args.video ?? (isJa ? "out/teaser.mp4" : `out/teaser.${lang}.mp4`));
  await addSound({
    lang,
    video,
    out: resolve(args.out ?? (isJa ? "out/teaser.sfx.mp4" : video)),
    work: resolve(args.work ?? (isJa ? "out/teaser-frames" : `out/teaser-frames-${lang}`)),
    base: args.base,
    port: args.port ? Number(args.port) : undefined,
    sfxDb: args["sfx-db"] === undefined ? undefined : Number(args["sfx-db"]),
    musicDb: args["music-db"] === undefined ? undefined : Number(args["music-db"]),
  });
}
