import {
  decodeVectorTile,
  packVectorTile,
  vectorTileTransfers,
  type VectorTileInput,
  type VectorTilePacket,
} from "./vectorTileData";
export type VectorTileRequest = VectorTileInput & { id: number };
export type VectorTileReply =
  | { id: number; packet: VectorTilePacket; computeMs: number }
  | { id: number; error: string };
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.addEventListener("message", (event: MessageEvent<VectorTileRequest>) => {
  const input = event.data;
  try {
    const start = performance.now();
    const packet = packVectorTile(decodeVectorTile(input));
    const reply: VectorTileReply = { id: input.id, packet, computeMs: performance.now() - start };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    scope.postMessage(reply, vectorTileTransfers(packet));
  } catch (error) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    scope.postMessage({ id: input.id, error: String(error) } satisfies VectorTileReply);
  }
});
