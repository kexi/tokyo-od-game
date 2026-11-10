// Contact sheets: one JPEG with many frames in a grid, each with a caption, a red border on the
// flagged ones. A round's shots (the aim point off the middle, or the target taking almost none of
// the screen, is flagged), for a reviewer to take in a whole round at a glance before opening single
// frames; signSheet.ts puts the sign review renders on the same kind of sheet.
//
//   pnpm exec tsx scripts/qa/contactSheet.ts <round dir>   (views.ts calls it after shooting)
//
// How: an HTML page of <img> next to the images, opened in headless Chrome (file://) and captured
// beyond the viewport. Why not Pillow or sharp: no new dependency, and Chrome has the Japanese
// fonts for the captions; it is already what shoots.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";

const COLUMNS = 4;
const THUMB_W = 400;

export const escape = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export type SheetItem = { image: string; captionHtml: string; isFlagged: boolean };

/** The frame records (views.ts) of a round dir, by their JSON next to each JPEG. */
type ShotRecord = {
  image: string;
  shot: string;
  view: { camera: string };
  target: { id: string } | null;
  projection: { isCentred: boolean; offCentre: number; screenShare: number } | null;
};
export function shotsIn(dir: string): ShotRecord[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !["run.json", "review-template.json"].includes(f))
    .toSorted()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ShotRecord)
    .filter((s) => typeof s.image === "string");
}

/** A sheet of `items` written as <name>.html and <name>.jpg in `dir`. Returns the JPEG's path. */
export async function writeSheet(
  dir: string,
  items: SheetItem[],
  opts: { port?: number; title?: string; name?: string; columns?: number; thumbW?: number } = {},
): Promise<string> {
  const { title = "", name = "contact-sheet", columns = COLUMNS, thumbW = THUMB_W } = opts;
  const cells = items
    .map(
      (it) =>
        `<figure class="${it.isFlagged ? "off" : ""}"><img src="${escape(it.image)}"><figcaption>${it.captionHtml}</figcaption></figure>`,
    )
    .join("\n");
  const width = columns * (thumbW + 12) + 12;
  const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; padding: 12px; background: #1b1d22; color: #e8e8e8; font: 13px/1.3 -apple-system, "Hiragino Sans", sans-serif; width: ${width}px; }
h1 { font-size: 16px; margin: 0 0 8px; }
main { display: grid; grid-template-columns: repeat(${columns}, ${thumbW}px); gap: 12px; }
figure { margin: 0; border: 3px solid #3a3f48; }
figure.off { border-color: #e5484d; }
img { display: block; width: 100%; }
figcaption { padding: 4px 6px; overflow-wrap: anywhere; }
</style><h1>${escape(title)} — ${items.length}</h1><main>${cells}</main>`;
  const page = join(dir, `${name}.html`);
  writeFileSync(page, html);
  // A short viewport: the capture below takes the document's own height.
  const port = opts.port ?? (await freePort());
  const b = await launch(pathToFileURL(resolve(page)).href, { port, width: width + 12, height: 240 });
  try {
    for (let i = 0; i < 100; i++) {
      const isLoaded = await b
        .evaluate<boolean>(
          "document.readyState === 'complete' && [...document.images].every((i) => i.complete)",
        )
        .catch(() => false);
      if (isLoaded) break;
      await b.sleep(200);
    }
    const size = await b.evaluate<{ w: number; h: number }>(
      "({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })",
    );
    const res = await b.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 },
    });
    const file = join(dir, `${name}.jpg`);
    writeFileSync(file, Buffer.from(res.result.data ?? "", "base64"));
    return file;
  } finally {
    await b.close();
  }
}

/** Flagged on a sheet: the aim point off the middle, or the thing under 0.05 % of the screen. */
export const isShotFlagged = (p: ShotRecord["projection"]) =>
  p !== null && (!p.isCentred || p.screenShare < 0.0005);

/** The contact sheet of a round dir (views.ts output). */
export function writeContactSheet(
  dir: string,
  opts: { port?: number; title?: string } = {},
): Promise<string> {
  const items = shotsIn(dir).map((s) => ({
    image: s.image,
    isFlagged: isShotFlagged(s.projection),
    captionHtml: `<b>${escape(s.shot)}</b> ${escape(s.view.camera)} · ${escape(s.target?.id ?? "")} · off ${s.projection?.offCentre ?? "–"} · screen ${s.projection?.screenShare ?? "–"}`,
  }));
  return writeSheet(dir, items, opts);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: contactSheet.ts <round dir>");
  process.stdout.write(`${await writeContactSheet(dir, { title: dir })}\n`);
}
