import { expect, it, vi } from "vitest";
import { coalesceUniformUploads } from "../scripts/qa/uniformUploads";

type Binding = {
  isUniformsGroup?: boolean;
  buffer: Float32Array;
  updateRanges: Array<{ start: number; count: number }>;
};
function setup() {
  const gpu = new Uint8Array(8192);
  const writeBuffer = vi.fn(
    (_buffer: unknown, offset: number, data: Float32Array, start = 0, count = data.length - start) => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset + start * 4, count * 4);
      gpu.set(bytes, offset);
    },
  );
  const original = vi.fn(function (this: unknown, binding: Binding) {
    const { buffer, updateRanges } = binding;
    const all = updateRanges.length === 0;
    if (all) {
      writeBuffer(gpu, 0, buffer);
      return;
    }
    for (const { start, count } of updateRanges) writeBuffer(gpu, start * 4, buffer, start, count);
  });
  const backend = {
    isWebGPUBackend: true,
    bindingUtils: { updateBinding: original as (binding: Binding) => void },
    device: { queue: { writeBuffer } },
    get: () => ({ buffer: gpu }),
  };
  return { renderer: { backend }, backend, gpu, writeBuffer, original };
}

it("uploads separated uniform ranges in one call without changing bytes or the layout metadata", () => {
  const { renderer, backend, gpu, writeBuffer, original } = setup();
  const control = coalesceUniformUploads(renderer)!;
  const binding: Binding = {
    isUniformsGroup: true,
    buffer: Float32Array.from({ length: 64 }, (_, i) => i + 0.25),
    updateRanges: [],
  };
  backend.bindingUtils.updateBinding(binding);
  binding.buffer[4] = 19;
  binding.buffer[20] = -0;
  binding.buffer[33] = 21;
  binding.updateRanges = [
    { start: 4, count: 1 },
    { start: 20, count: 1 },
    { start: 33, count: 1 },
  ];
  const ranges = structuredClone(binding.updateRanges);
  writeBuffer.mockClear();
  original.mockClear();
  backend.bindingUtils.updateBinding(binding);
  expect(writeBuffer).toHaveBeenCalledOnce();
  expect(writeBuffer).toHaveBeenCalledWith(gpu, 16, binding.buffer, 4, 30);
  expect(original).not.toHaveBeenCalled();
  expect(gpu.slice(0, 256)).toEqual(new Uint8Array(binding.buffer.buffer));
  expect(binding.updateRanges).toEqual(ranges);
  control.restore();
});

it("preserves integer bit patterns and uses offsets relative to a typed-array subview", () => {
  const { renderer, backend, gpu } = setup();
  const control = coalesceUniformUploads(renderer)!;
  const raw = new Uint32Array(64);
  raw[8] = 0x7fc00001;
  raw[25] = 0xffffffff;
  raw[40] = 0x80000000;
  const buffer = new Float32Array(raw.buffer, 16, 48);
  const binding: Binding = { isUniformsGroup: true, buffer, updateRanges: [] };
  backend.bindingUtils.updateBinding(binding);
  raw[8] = 0x7f800001;
  raw[25] = 0xdeadbeef;
  binding.updateRanges = [
    { start: 4, count: 1 },
    { start: 21, count: 1 },
  ];
  backend.bindingUtils.updateBinding(binding);
  expect(gpu.slice(0, buffer.byteLength)).toEqual(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );
  control.restore();
});

it("keeps original full, single-range, non-uniform and large-buffer updates with their receiver", () => {
  const { renderer, backend, original } = setup();
  const control = coalesceUniformUploads(renderer)!;
  for (const binding of [
    { isUniformsGroup: true, buffer: new Float32Array(8), updateRanges: [] },
    { isUniformsGroup: true, buffer: new Float32Array(8), updateRanges: [{ start: 1, count: 1 }] },
    {
      isUniformsGroup: false,
      buffer: new Float32Array(8),
      updateRanges: [
        { start: 1, count: 1 },
        { start: 3, count: 1 },
      ],
    },
    {
      isUniformsGroup: true,
      buffer: new Float32Array(2048),
      updateRanges: [
        { start: 1, count: 1 },
        { start: 2047, count: 1 },
      ],
    },
  ]) {
    backend.bindingUtils.updateBinding(binding);
    expect(original).toHaveBeenLastCalledWith(binding);
    expect(original.mock.contexts.at(-1)).toBe(backend.bindingUtils);
  }
  control.restore();
});

it("is renderer-local, idempotent, can be disabled for comparison and restores the original method", () => {
  const a = setup(),
    b = setup();
  const control = coalesceUniformUploads(a.renderer)!;
  expect(coalesceUniformUploads(a.renderer)).toBe(control);
  expect(b.backend.bindingUtils.updateBinding).toBe(b.original);
  control.enabled = false;
  const binding = {
    isUniformsGroup: true,
    buffer: new Float32Array(8),
    updateRanges: [
      { start: 1, count: 1 },
      { start: 3, count: 1 },
    ],
  };
  a.backend.bindingUtils.updateBinding(binding);
  expect(a.original).toHaveBeenCalledOnce();
  control.enabled = true;
  a.original.mockClear();
  a.writeBuffer.mockClear();
  a.backend.bindingUtils.updateBinding(binding);
  expect(a.original).not.toHaveBeenCalled();
  expect(a.writeBuffer).toHaveBeenCalledOnce();
  control.restore();
  control.restore();
  expect(a.backend.bindingUtils.updateBinding).toBe(a.original);
  expect(coalesceUniformUploads(a.renderer)).not.toBe(control);
});

it("leaves the WebGL backend untouched and declines an incomplete WebGPU backend", () => {
  const renderer = { backend: { isWebGPUBackend: false } };
  expect(coalesceUniformUploads(renderer)).toBeNull();
  expect(renderer.backend).toEqual({ isWebGPUBackend: false });
  expect(coalesceUniformUploads({ backend: { isWebGPUBackend: true } })).toBeNull();
});
