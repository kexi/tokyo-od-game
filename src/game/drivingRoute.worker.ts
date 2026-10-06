/// <reference lib="webworker" />
import { setLogSink } from "../log";
import { computeDrivingRoute, type DrivingRouteInput, type DrivingRouteReply } from "./drivingRouteData";

const worker = self as unknown as DedicatedWorkerGlobalScope;
// The page re-emits diagnostics with its trace; worker console lines have a different trace.
setLogSink(() => {});
worker.addEventListener("message", (event: MessageEvent<{ id: number; input: DrivingRouteInput }>) => {
  const { id, input } = event.data;
  let reply: DrivingRouteReply;
  try {
    reply = { id, data: computeDrivingRoute(input) };
  } catch (error) {
    reply = { id, error: String(error) };
  }
  postMessage(reply);
});
