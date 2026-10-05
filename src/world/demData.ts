const SIZE = 256;

/** GSI elevation text tile: 256 rows of 256 comma-separated metres, "e" where there is no value. */
export function parseDemText(text: string): Float32Array {
  const steps = parseDemTextSteps(text);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

export function* parseDemTextSteps(text: string): Generator<void, Float32Array> {
  const out = new Float32Array(SIZE * SIZE).fill(Number.NaN);
  const rows = text.trim().split("\n");
  for (let j = 0; j < Math.min(SIZE, rows.length); j++) {
    yield;
    const cells = rows[j].split(",");
    for (let i = 0; i < Math.min(SIZE, cells.length); i++) {
      const v = cells[i].trim();
      if (v !== "e") out[j * SIZE + i] = Number(v);
    }
  }
  return out;
}

/**
 * DEM5A in the city is laser ground points with buildings removed; where few ground points
 * survive (beside buildings, under elevated roads) the interpolation leaves 1–1.5 m lumps and
 * pits that read as a bumpy pavement in the game. A 5×5 median (~20 m at z15) removes those
 * while keeping real steps such as moat walls and embankments sharp; a 3×3 binomial pass then
 * softens the median's terraces. Why not a plain Gaussian: it would smear the lumps into wider
 * swells and round off the steps.
 */
export function smoothGround(src: Float32Array): Float32Array {
  const steps = smoothGroundSteps(src);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}

/** The fallback performs the identical filter while letting rendering run between rows. */
export function* smoothGroundSteps(src: Float32Array): Generator<void, Float32Array> {
  const median = new Float32Array(SIZE * SIZE);
  const window = new Float32Array(25);
  for (let y = 0; y < SIZE; y++) {
    yield;
    for (let x = 0; x < SIZE; x++) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.min(SIZE - 1, Math.max(0, y + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const xx = Math.min(SIZE - 1, Math.max(0, x + dx));
          window[n++] = src[yy * SIZE + xx];
        }
      }
      window.sort();
      median[y * SIZE + x] = window[12];
    }
  }
  const out = new Float32Array(SIZE * SIZE);
  const kernel = [1, 2, 1];
  for (let y = 0; y < SIZE; y++) {
    yield;
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(SIZE - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(SIZE - 1, Math.max(0, x + dx));
          sum += median[yy * SIZE + xx] * kernel[dx + 1] * kernel[dy + 1];
        }
      }
      out[y * SIZE + x] = sum / 16;
    }
  }
  return out;
}
