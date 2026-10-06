import { computeTerrain } from "./terrainData";
import type { TerrainReply, TerrainRequest } from "./terrainCompute";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener("message", (event: MessageEvent<TerrainRequest>) => {
  const { id, input } = event.data;
  try {
    const start = performance.now();
    const data = computeTerrain(input);
    const reply: TerrainReply = { id, data, computeMs: performance.now() - start };
    scope.postMessage(reply, [
      data.positions.buffer,
      data.uvs.buffer,
      data.indices.buffer,
      data.normals.buffer,
    ]);
  } catch (error) {
    const reply: TerrainReply = { id, error: String(error) };
    // DedicatedWorker replies do not have a Window targetOrigin argument.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    scope.postMessage(reply);
  }
});
