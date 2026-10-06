import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ColliderCompute, type ColliderRequest } from "../src/physics/colliderCompute";
import { installCollider, snapshotCollider, type ColliderMesh } from "../src/physics/colliderSnapshot";

beforeAll(async () => {
  await RAPIER.init();
});

function mesh(flags?: RAPIER.TriMeshFlags): ColliderMesh {
  return {
    vertices: new Float32Array([-2, 1, -2, 2, 1, -2, -2, 1, 2, 2, 1, 2]),
    indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
    flags,
  };
}

class WorkerStub extends EventTarget {
  requests: ColliderRequest[] = [];
  detached: number[][] = [];
  terminate = vi.fn();
  postMessage(request: ColliderRequest, transfer: Transferable[]): void {
    this.requests.push(structuredClone(request, { transfer }));
    this.detached.push([request.mesh.vertices.byteLength, request.mesh.indices.byteLength]);
  }
  reply(index: number): void {
    const request = this.requests[index];
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          id: request.id,
          snapshot: snapshotCollider(request.mesh),
          computeMs: 1,
        },
      }),
    );
  }
}

describe("prepared collider ownership and queries", () => {
  it("keeps dynamic contact and movement identical while crossing an internal terrain edge", () => {
    const input = mesh(RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
    const snapshot = snapshotCollider(input);
    const worlds = [new RAPIER.World({ x: 0, y: -9.81, z: 0 }), new RAPIER.World({ x: 0, y: -9.81, z: 0 })];
    try {
      const traces = worlds.map((world, index) => {
        const prepared = { mesh: input, snapshot: index === 0 ? null : snapshot };
        const ground = installCollider(world, prepared, 1);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, 3, 0));
        const car = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.2), body);
        const states = [];
        let contacts = 0;
        for (let step = 0; step < 180; step++) {
          body.setLinvel({ x: 0.5, y: body.linvel().y, z: 0 }, true);
          world.step();
          world.contactPair(ground, car, () => {
            contacts++;
          });
          states.push({
            position: body.translation(),
            rotation: body.rotation(),
            velocity: body.linvel(),
            angular: body.angvel(),
          });
        }
        expect(contacts).toBeGreaterThan(0);
        expect(body.translation().x).toBeGreaterThan(0);
        expect(body.translation().y).toBeGreaterThan(1);
        expect(body.translation().y).toBeLessThan(1.3);
        return { states, contacts };
      });
      expect(traces[1]).toEqual(traces[0]);
    } finally {
      for (const world of worlds) world.free();
    }
  });

  it.each([undefined, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES])(
    "keeps native vertices, triangles, ray results and shape queries after releasing scratch worlds (%s)",
    (flags) => {
      const input = mesh(flags),
        snapshot = snapshotCollider(input);
      const reference = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const target = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      try {
        const expected = reference.createCollider(
          RAPIER.ColliderDesc.trimesh(input.vertices, input.indices, flags).setFriction(0.6),
        );
        const actual = installCollider(target, { mesh: input, snapshot }, 0.6);
        reference.step();
        target.step();
        expect(actual.vertices()).toEqual(expected.vertices());
        expect(actual.indices()).toEqual(expected.indices());
        expect(actual.friction()).toBe(expected.friction());
        for (const x of [-1.5, 0, 1.5]) {
          const ray = new RAPIER.Ray({ x, y: 8, z: 0 }, { x: 0, y: -1, z: 0 });
          expect(target.castRayAndGetNormal(ray, 20, true)).toMatchObject({
            timeOfImpact: reference.castRayAndGetNormal(ray, 20, true)!.timeOfImpact,
            normal: reference.castRayAndGetNormal(ray, 20, true)!.normal,
          });
          expect(actual.shape.castRay(ray, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 20, true)).toBe(
            7,
          );
        }
      } finally {
        reference.free();
        target.free();
      }
    },
  );

  it("preserves the live world's bodies, joints, clock and unrelated collider handles", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      world.timestep = 0.01;
      const timestep = world.timestep;
      const a = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(20, 5, 0));
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(20, 6, 0));
      const joint = world.createImpulseJoint(
        RAPIER.JointData.spherical({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }),
        a,
        b,
        true,
      );
      const ball = world.createCollider(RAPIER.ColliderDesc.ball(0.5), a);
      const before = a.translation();
      const input = mesh(),
        actual = installCollider(world, { mesh: input, snapshot: snapshotCollider(input) }, 1);
      expect(world.bodies.len()).toBe(2);
      expect(world.impulseJoints.get(joint.handle)).toBe(joint);
      expect(world.getCollider(ball.handle)).toBe(ball);
      expect(a.translation()).toEqual(before);
      expect(world.gravity.y).toBe(-9.81);
      expect(world.timestep).toBe(timestep);
      world.step();
      expect(actual.castRay(new RAPIER.Ray({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }), 20, true)).toBe(9);
    } finally {
      world.free();
    }
  });

  it("releases a restored world when target registration throws, and leaves the prepared shape reusable", () => {
    const input = mesh(),
      snapshot = snapshotCollider(input);
    const scratch = RAPIER.World.restoreSnapshot(snapshot.bytes),
      release = vi.spyOn(scratch, "free");
    const restore = vi.spyOn(RAPIER.World, "restoreSnapshot").mockReturnValueOnce(scratch);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const create = vi.spyOn(world, "createCollider").mockImplementationOnce(() => {
      throw new Error("QA install failure");
    });
    try {
      expect(() => installCollider(world, { mesh: input, snapshot }, 1)).toThrow("QA install failure");
      expect(release).toHaveBeenCalledOnce();
      const actual = installCollider(world, { mesh: input, snapshot }, 1);
      expect(
        actual.shape.castRay(
          new RAPIER.Ray({ x: 0, y: 8, z: 0 }, { x: 0, y: -1, z: 0 }),
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
          20,
          true,
        ),
      ).toBe(7);
    } finally {
      create.mockRestore();
      restore.mockRestore();
      world.free();
    }
  });
});

describe("collider Worker lifetime and fallback", () => {
  it("transfers only copies and accepts an actual native snapshot", async () => {
    const worker = new WorkerStub(),
      compute = new ColliderCompute(() => worker as unknown as Worker);
    const input = mesh(RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
      expected = structuredClone(input);
    try {
      const pending = compute.prepare(input, "test-ground");
      expect(worker.detached).toEqual([[0, 0]]);
      expect(input).toEqual(expected);
      worker.reply(0);
      const prepared = await pending;
      expect(prepared.mesh).toBe(input);
      expect(prepared.snapshot!.bytes.byteLength).toBeGreaterThan(0);
    } finally {
      compute.dispose();
    }
  });

  it("rejects cancellation, ignores its late reply, and allows a later request", async () => {
    const worker = new WorkerStub(),
      compute = new ColliderCompute(() => worker as unknown as Worker);
    const controller = new AbortController();
    try {
      const cancelled = compute.prepare(mesh(), "old-ground", controller.signal);
      const rejected = expect(cancelled).rejects.toThrow("cancelled");
      controller.abort();
      await rejected;
      worker.reply(0);
      const next = compute.prepare(mesh(), "current-ground");
      worker.reply(1);
      expect((await next).snapshot).not.toBeNull();
    } finally {
      compute.dispose();
    }
  });

  it("uses the original geometry and flags when a Worker is unavailable", async () => {
    const compute = new ColliderCompute(() => {
      throw new Error("QA unavailable worker");
    });
    const input = mesh(RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      const prepared = await compute.prepare(input, "fallback");
      expect(prepared).toEqual({ mesh: input, snapshot: null });
      expect(installCollider(world, prepared, 1).shape).toMatchObject(input);
      expect((await compute.prepare(input, "next-fallback")).snapshot).toBeNull();
    } finally {
      compute.dispose();
      world.free();
    }
  });

  it("falls back for pending jobs when a reply cannot be decoded", async () => {
    const worker = new WorkerStub(),
      compute = new ColliderCompute(() => worker as unknown as Worker);
    try {
      const first = compute.prepare(mesh(), "first"),
        second = compute.prepare(mesh(), "second");
      worker.dispatchEvent(new MessageEvent("messageerror"));
      expect((await first).snapshot).toBeNull();
      expect((await second).snapshot).toBeNull();
      expect(worker.terminate).toHaveBeenCalledOnce();
      worker.reply(0);
      expect((await compute.prepare(mesh(), "third")).snapshot).toBeNull();
    } finally {
      compute.dispose();
    }
  });

  it("rejects all pending work on disposal without accepting a later reply", async () => {
    const worker = new WorkerStub(),
      compute = new ColliderCompute(() => worker as unknown as Worker);
    const pending = compute.prepare(mesh(), "disposable");
    const rejected = expect(pending).rejects.toThrow("cancelled");
    compute.dispose();
    await rejected;
    worker.reply(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(compute.prepare(mesh(), "after-dispose")).rejects.toThrow("cancelled");
  });
});
