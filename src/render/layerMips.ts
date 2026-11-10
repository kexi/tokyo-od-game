/**
 * Mipmaps for one layer of an array texture, on WebGPU: each level is drawn from the one above with
 * a linear sampler (a 2×2 box at exactly half the size), into views of that layer alone. With an
 * sRGB format the views decode and encode, so the averaging is done in linear light, as three's own
 * mipmapper does.
 *
 * Why not three's mipmapper (WebGPUTexturePassUtils.generateMipmaps): it redraws every level of
 * every layer. For the sign faces' 112 layers that is 896 render passes and measured 54 ms of GPU
 * time per update in the PoC (knowledge/sign-system.md「SignFaceMaterial（G3）」), against ~1 ms
 * for one layer here.
 */

const SHADER = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  // One triangle over the target: (0,0), (2,0), (0,2) in uv.
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Out;
  o.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}
@fragment fn fs(i: Out) -> @location(0) vec4f { return textureSampleLevel(src, smp, i.uv, 0.0); }
`;

export class LayerMipmapper {
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly sampler: GPUSampler;
  private readonly module: GPUShaderModule;

  constructor(private readonly device: GPUDevice) {
    this.sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
    this.module = device.createShaderModule({ label: "layer-mips", code: SHADER });
  }

  private pipeline(format: GPUTextureFormat): GPURenderPipeline {
    const known = this.pipelines.get(format);
    if (known) return known;
    const made = this.device.createRenderPipeline({
      label: `layer-mips-${format}`,
      layout: "auto",
      vertex: { module: this.module, entryPoint: "vs" },
      fragment: { module: this.module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.pipelines.set(format, made);
    return made;
  }

  /** Levels 1… of `layer` from its level 0, in one submit. */
  generate(texture: GPUTexture, layer: number): void {
    const pipeline = this.pipeline(texture.format);
    const encoder = this.device.createCommandEncoder({ label: "layer-mips" });
    const view = (level: number) =>
      texture.createView({
        dimension: "2d",
        baseMipLevel: level,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const group = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: view(level - 1) },
          { binding: 1, resource: this.sampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: view(level), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
}
