/// <reference lib="webworker" />
import type { WaterMaskReply, WaterMaskRequest } from "./waterCompute";
import { waterMaskSteps } from "./waterMasks";

self.addEventListener("message", (event: MessageEvent<WaterMaskRequest>) => {
  const { id, polygons, x, y, size } = event.data;
  try {
    const start = performance.now();
    const steps = waterMaskSteps(polygons, x, y, size);
    for (;;) {
      const result = steps.next();
      if (!result.done) continue;
      const masks = result.value;
      postMessage({ id, masks, computeMs: performance.now() - start } satisfies WaterMaskReply, [
        masks.raster.buffer,
        masks.cut.buffer,
      ]);
      return;
    }
  } catch (error) {
    postMessage({ id, error: String(error) } satisfies WaterMaskReply);
  }
});
