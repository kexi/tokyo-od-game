/// <reference lib="webworker" />
import { computeRoadNetwork, type RoadNetworkReply, type RoadNetworkRequest } from "./roadNetworkData";

self.addEventListener("message", (event: MessageEvent<RoadNetworkRequest>) => {
  const { id, input } = event.data;
  try {
    postMessage({ id, data: computeRoadNetwork(input) } satisfies RoadNetworkReply);
  } catch (error) {
    postMessage({ id, error: String(error) } satisfies RoadNetworkReply);
  }
});
