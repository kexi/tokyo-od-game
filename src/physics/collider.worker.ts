import RAPIER from "@dimforge/rapier3d-compat";
import { snapshotCollider } from "./colliderSnapshot";
import type { ColliderReply, ColliderRequest } from "./colliderCompute";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const initialized = RAPIER.init();
scope.addEventListener("message", (event: MessageEvent<ColliderRequest>) => {
  const { id, mesh } = event.data;
  void initialized
    .then(() => {
      const start = performance.now();
      const snapshot = snapshotCollider(mesh);
      const reply: ColliderReply = { id, snapshot, computeMs: performance.now() - start };
      scope.postMessage(reply, [snapshot.bytes.buffer]);
    })
    .catch((error) => {
      const reply: ColliderReply = { id, error: String(error) };
      // DedicatedWorker replies do not have a Window targetOrigin argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      scope.postMessage(reply);
    });
});
