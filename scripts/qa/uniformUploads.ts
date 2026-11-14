type UniformBinding = {
  isUniformsGroup?: boolean;
  buffer: Float32Array;
  updateRanges: Array<{ start: number; count: number }>;
};
type UploadUtils = { updateBinding(binding: UniformBinding): void };
type UploadBackend = {
  isWebGPUBackend?: boolean;
  bindingUtils?: UploadUtils;
  device?: { queue: Pick<GPUQueue, "writeBuffer"> };
  get?(binding: UniformBinding): { buffer: GPUBuffer };
};
export type UniformUploadControl = { enabled: boolean; restore(): void };
const controls = new WeakMap<object, UniformUploadControl>();
// The measured fragmented spans were at most 672 bytes. Keep large/storage buffers on Three's path.
const MAX_SPAN_BYTES = 4096;

/**
 * QA-only experiment: fewer queue calls did not meaningfully improve the measured game's CPU time.
 * Three's uniform groups keep the complete Float32 buffer, including unchanged values and padding.
 * Upload its changed span once instead of making a queue call for every separated range. Why not
 * upload the whole buffer: a late uniform change must not copy a potentially large unchanged prefix.
 * This is local to a WebGPU renderer; WebGL and other buffer bindings keep their original updates.
 */
export function coalesceUniformUploads(renderer: { backend: unknown }): UniformUploadControl | null {
  const existing = controls.get(renderer);
  if (existing) return existing;
  const backend = renderer.backend as UploadBackend;
  const utils = backend.bindingUtils;
  const supported =
    backend.isWebGPUBackend === true &&
    utils !== undefined &&
    typeof utils.updateBinding === "function" &&
    typeof backend.get === "function" &&
    typeof backend.device?.queue.writeBuffer === "function";
  if (!supported) return null;
  const original = utils.updateBinding;
  const control: UniformUploadControl = {
    enabled: true,
    restore() {
      const isOwnWrapper = utils.updateBinding === update;
      if (!isOwnWrapper) return;
      utils.updateBinding = original;
      controls.delete(renderer);
    },
  };
  function update(this: UploadUtils, binding: UniformBinding): void {
    const ranges = binding.updateRanges;
    const grouped = control.enabled && binding.isUniformsGroup === true && ranges.length > 1;
    if (!grouped) return original.call(this, binding);
    // UniformsGroup emits ranges in layout order, as WebGPUBindingUtils requires.
    const start = ranges[0].start;
    const last = ranges[ranges.length - 1];
    const count = last.start + last.count - start;
    const bytes = count * Float32Array.BYTES_PER_ELEMENT;
    const small = bytes > 0 && bytes <= MAX_SPAN_BYTES && binding.buffer instanceof Float32Array;
    if (!small) return original.call(this, binding);
    const queue = backend.device!.queue;
    queue.writeBuffer(backend.get!(binding).buffer, start * 4, binding.buffer, start, count);
  }
  utils.updateBinding = update;
  controls.set(renderer, control);
  return control;
}
