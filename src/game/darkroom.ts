import { warn } from "../log";
import type { DarkroomReply, DarkroomRequest } from "./darkroom.worker";
import { developRows, finishPhoto, PHOTO_QUALITY, type Look } from "./photoDevelop";

/**
 * Pictures made off the main thread: a bystander's photo developed from the pixels read back
 * (witnessShot.ts) and the screen grabbed at a violation (main's takeShots), each a JPEG made in a
 * module worker on an OffscreenCanvas. The pixels are transferred, not copied; the screen is an
 * ImageBitmap taken in the frame's own task (the canvas still holds the frame then), so the readback
 * and the encoding wait in the worker instead of in a frame.
 *
 * `inline` (or no Worker / OffscreenCanvas / createImageBitmap) does it all on the main thread
 * at once, as the game did before: the fallback, and the "before" of window.__game.debug.perf.
 */
export class Darkroom {
  inline = false;
  // createImageBitmap refused the canvas once: screens are grabbed the old way from then on.
  private grabsHere = false;
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: DarkroomReply) => void; reject: (e: Error) => void }
  >();
  private readonly canWork =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined";

  /**
   * The photo developed from `pixels` (rw×rh RGBA rows bottom-up) into a w×h JPEG, as a URL for an
   * <img> (a blob: URL from the worker; a data URL inline); null if it failed. `pixels` is handed
   * over (unusable afterwards). Why a blob: URL: nothing keeps a post's photo past the page, and
   * it spares the base64 copy (the screen grab, kept in IndexedDB, stays a data URL).
   */
  async develop(
    pixels: Uint8Array,
    rw: number,
    rh: number,
    w: number,
    h: number,
    look: Look,
  ): Promise<string | null> {
    const worker = this.ready();
    if (!worker) return developHere(pixels, rw, rh, w, h, look);
    // A view of part of a buffer would send all of it: copy out just these bytes then.
    const isWhole = pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength;
    const buffer = (isWhole ? pixels : pixels.slice()).buffer as ArrayBuffer;
    const reply = await this.ask({ id: 0, kind: "develop", pixels: buffer, rw, rh, w, h, look }, [buffer]);
    return reply.blob ? URL.createObjectURL(reply.blob) : null;
  }

  /**
   * The canvas as it is now, w×h, as a JPEG data URL (later). Call it in the task that drew the
   * frame: createImageBitmap takes its copy at once, before the frame is shown.
   */
  async grab(canvas: HTMLCanvasElement, w: number, h: number, quality: number): Promise<string | null> {
    const worker = this.grabsHere ? null : this.ready();
    if (!worker) return grabHere(canvas, w, h, quality);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
    } catch (error) {
      // This browser does not give the canvas so: this screen is lost, the next ones are grabbed here.
      warn("darkroom_grab_failed", { error: String(error) });
      this.grabsHere = true;
      return null;
    }
    const reply = await this.ask({ id: 0, kind: "encode", bitmap, quality }, [bitmap]);
    return reply.url ?? null;
  }

  /** Starts the worker now (before play), so the first violation does not load its module. */
  warm(): void {
    this.ready();
  }

  private ready(): Worker | null {
    if (this.inline || !this.canWork) return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL("./darkroom.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (e: MessageEvent<DarkroomReply>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data);
      });
      worker.addEventListener("error", (e) => {
        warn("darkroom_failed", { error: e.message });
        // Nothing more comes from it: what is asked from now on is done here.
        this.inline = true;
        for (const p of this.pending.values()) p.reject(new Error(e.message));
        this.pending.clear();
      });
      this.worker = worker;
      return worker;
    } catch (error) {
      warn("darkroom_failed", { error: String(error) });
      this.inline = true;
      return null;
    }
  }

  private ask(req: DarkroomRequest, transfer: Transferable[]): Promise<DarkroomReply> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("no darkroom worker"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id }, transfer);
    });
  }
}

/** The fallback and the old way: developed and encoded on the main thread, at once. */
function developHere(
  pixels: Uint8Array,
  rw: number,
  rh: number,
  w: number,
  h: number,
  look: Look,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const picture = ctx.createImageData(w, h);
  developRows(pixels, rw, rh, w, h, look, picture.data);
  ctx.putImageData(picture, 0, 0);
  finishPhoto(ctx, canvas, look, (sw, sh) => {
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    return c;
  });
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

/** The fallback and the old way: drawn and encoded in this task (stalls until the GPU is done). */
function grabHere(source: HTMLCanvasElement, w: number, h: number, quality: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}
