// Minimal PNG decoder for build scripts: 8-bit truecolour (RGB / RGBA) or palette, not interlaced,
// which is what GSI's elevation tiles are. Returns RGBA bytes like ImageData, without the colour
// management a browser canvas would apply (none here, as createImageBitmap is told in dem.ts).
// Why not a package: one format, ~60 lines, and the install policy keeps dependencies few.
import { inflateSync } from "node:zlib";

export type Rgba = { width: number; height: number; data: Uint8Array };

export function decodePng(buf: Uint8Array): Rgba {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const body = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === "IHDR") {
      width = view.getUint32(body.byteOffset - buf.byteOffset);
      height = view.getUint32(body.byteOffset - buf.byteOffset + 4);
      const bitDepth = body[8];
      colorType = body[9];
      const isSupported = bitDepth === 8 && body[12] === 0 && [2, 3, 6].includes(colorType);
      if (!isSupported)
        throw new Error(`unsupported PNG (depth ${bitDepth}, colour ${colorType}, interlace ${body[12]})`);
    } else if (type === "PLTE") palette = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = width * channels;
  const pix = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pix.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pix.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = up[i];
      const c = i >= channels ? up[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const isPalette = channels === 1;
    if (isPalette) {
      const k = pix[i] * 3;
      data.set([palette![k], palette![k + 1], palette![k + 2], 255], i * 4);
      continue;
    }
    data[i * 4] = pix[i * channels];
    data[i * 4 + 1] = pix[i * channels + 1];
    data[i * 4 + 2] = pix[i * channels + 2];
    data[i * 4 + 3] = channels === 4 ? pix[i * channels + 3] : 255;
  }
  return { width, height, data };
}
