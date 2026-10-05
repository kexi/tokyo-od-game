/// <reference lib="webworker" />
// The darkroom: pictures made off the main thread (darkroom.ts is its client). Developing a
// bystander's photo walks every pixel in JavaScript (5–15 ms for 640×360) and encoding a JPEG
// stalls on the GPU readback and the encoder; on the main thread either lands in a frame.

import { developRows, finishPhoto, PHOTO_QUALITY, type Look } from "./photoDevelop";

export type DarkroomRequest =
  | {
      id: number;
      kind: "develop";
      pixels: ArrayBuffer;
      rw: number;
      rh: number;
      w: number;
      h: number;
      look: Look;
    }
  | { id: number; kind: "encode"; bitmap: ImageBitmap; quality: number };

export type DarkroomReply = { id: number; blob?: Blob; url?: string; error?: string };

self.addEventListener("message", (e: MessageEvent<DarkroomRequest>) => {
  const req = e.data;
  void handle(req).then(
    (reply) => postMessage(reply),
    (error: unknown) => postMessage({ id: req.id, error: String(error) } satisfies DarkroomReply),
  );
});

async function handle(req: DarkroomRequest): Promise<DarkroomReply> {
  if (req.kind === "encode") return { id: req.id, url: await encode(req.bitmap, req.quality) };
  const { w, h, look } = req;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in the worker");
  const picture = new ImageData(w, h);
  developRows(new Uint8Array(req.pixels), req.rw, req.rh, w, h, look, picture.data);
  ctx.putImageData(picture, 0, 0);
  finishPhoto(ctx, canvas, look, (sw, sh) => new OffscreenCanvas(sw, sh));
  return { id: req.id, blob: await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_QUALITY }) };
}

/** The screen at a violation as a JPEG data URL (the violation record keeps it in IndexedDB). */
async function encode(bitmap: ImageBitmap, quality: number): Promise<string> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in the worker");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new FileReaderSync().readAsDataURL(blob);
}
