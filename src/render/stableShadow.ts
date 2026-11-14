import { type DirectionalLight, type LightShadow, type Material, VSMShadowMap } from "three";
import { type NodeMaterial, type Renderer, ShadowNode } from "three/webgpu";
import { nodeObject } from "three/tsl";

type ShadowDraw = ReturnType<ShadowNode["getShadowRenderObjectFunction"]>;
type ShadowEntry = {
  material: NodeMaterial;
  version: number;
  dispose: () => void;
};

export class StableShadowNode extends ShadowNode {
  private readonly materials = new Map<Material, ShadowEntry>();
  private readonly draws = new WeakMap<ShadowDraw, ShadowDraw>();

  constructor(private readonly sourceLight: DirectionalLight) {
    super(sourceLight, sourceLight.shadow);
  }

  override getShadowRenderObjectFunction(
    renderer: Renderer,
    shadow: LightShadow = this.sourceLight.shadow,
  ): ShadowDraw {
    const draw = super.getShadowRenderObjectFunction(renderer, shadow);
    const cached = this.draws.get(draw);
    if (cached) return cached;

    const shadowType = renderer.shadowMap.type;
    const stableDraw: ShadowDraw = (...args) => {
      const [object, scene, , , source] = args;
      const isShadowCaster = object.castShadow || (object.receiveShadow && shadowType === VSMShadowMap);
      const usesOverride = isShadowCaster && source.allowOverride;
      if (!usesOverride) return draw(...args);

      const previous = scene.overrideMaterial;
      scene.overrideMaterial = this.materialFor(source);
      try {
        draw(...args);
      } finally {
        scene.overrideMaterial = previous;
      }
    };
    this.draws.set(draw, stableDraw);
    return stableDraw;
  }

  override disposeShadowMaterial(): void {
    for (const [source, entry] of this.materials) {
      source.removeEventListener("dispose", entry.dispose);
      entry.material.dispose();
    }
    this.materials.clear();
    super.disposeShadowMaterial();
  }

  private materialFor(source: Material): NodeMaterial {
    const existing = this.materials.get(source);
    if (existing) {
      const isSourceChanged = existing.version !== source.version;
      if (isSourceChanged) {
        existing.material.needsUpdate = true;
        existing.version = source.version;
      }
      return existing.material;
    }

    // Sharing one override makes alpha-tested and opaque draws toggle its version every frame.
    // Per-source overrides keep Three's shadow nodes, side and displacement handling intact.
    const material = super.getShadowMaterial().clone();
    (material as NodeMaterial & { isShadowPassMaterial: boolean }).isShadowPassMaterial = true;
    const dispose = () => {
      source.removeEventListener("dispose", dispose);
      this.materials.delete(source);
      // Three also releases render objects on source disposal. Disposing the override during
      // that event would invoke the same release twice from its copied listener list.
      queueMicrotask(() => material.dispose());
    };
    this.materials.set(source, { material, version: source.version, dispose });
    source.addEventListener("dispose", dispose);
    return material;
  }
}

export function useStableShadows(light: DirectionalLight): void {
  light.shadow.shadowNode = nodeObject(new StableShadowNode(light));
}
