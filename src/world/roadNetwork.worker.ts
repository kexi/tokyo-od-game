/// <reference lib="webworker" />
import { computeRoadNetwork, type RoadNetworkReply, type RoadNetworkRequest } from "./roadNetworkData";
import { packRoadNetwork, roadNetworkTransfers } from "./roadNetworkPacket";

self.addEventListener("message", (event: MessageEvent<RoadNetworkRequest>) => {
  const { id, input } = event.data;
  try {
    const network = computeRoadNetwork(input);
    const start = performance.now();
    const data = packRoadNetwork(network);
    const packMs = performance.now() - start;
    postMessage({ id, data, packMs } satisfies RoadNetworkReply, roadNetworkTransfers(data));
  } catch (error) {
    postMessage({ id, error: String(error) } satisfies RoadNetworkReply);
  }
});
