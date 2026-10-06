import { computeBuildingFacade } from "./buildingFacadeData";
import type { BuildingFacadeReply, BuildingFacadeRequest } from "./buildingFacadeCompute";

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener("message", (event: MessageEvent<BuildingFacadeRequest>) => {
  const { id, input } = event.data;
  try {
    const start = performance.now();
    const data = computeBuildingFacade(input);
    const reply: BuildingFacadeReply = { id, data, computeMs: performance.now() - start };
    // Dedicated workers take a transfer list here, rather than a Window target origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    scope.postMessage(reply, [data.ecef.buffer, data.facade.buffer]);
  } catch (error) {
    const reply: BuildingFacadeReply = { id, error: String(error) };
    // DedicatedWorker responses use the same channel without a Window origin parameter.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    scope.postMessage(reply);
  }
});
