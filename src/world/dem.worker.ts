/// <reference lib="webworker" />
import type { DemReply, DemRequest } from "./demCompute";
import { parseDemText, smoothGround } from "./demData";

self.addEventListener("message", (event: MessageEvent<DemRequest>) => {
  const request = event.data;
  try {
    const isSmooth = request.kind === "smooth";
    const data = isSmooth ? smoothGround(request.data) : parseDemText(request.text);
    postMessage({ id: request.id, data } satisfies DemReply, [data.buffer]);
  } catch (error) {
    postMessage({ id: request.id, error: String(error) } satisfies DemReply);
  }
});
