import { describe, expect, it } from "vitest";
import { COUNT_PIPELINES, countKinds, pipelineKind } from "../scripts/qa/pipelineCount";

// A stand-in of window.__game with the groups and maps pipelineKind reads.
type Node = { parent?: Node | null; isInstancedMesh?: boolean };
const scene: Node = { parent: null };
const nearGroup: Node = { parent: scene };
const farGroup: Node = { parent: scene };
const facadeMesh: Node = { parent: { parent: nearGroup } };
const farMesh: Node = { parent: farGroup };
const terrainMesh: Node = { parent: scene };
const roadMesh: Node = { parent: scene };
const lamps: Node = { parent: scene, isInstancedMesh: true };
const car: Node = { parent: scene };
const game = {
  buildings: { tiles: { group: nearGroup }, far: { group: farGroup } },
  terrain: { chunks: new Map([["1/2", { mesh: terrainMesh }]]) },
  debug: { roads: { surface: { meshes: new Map([["k", roadMesh]]) } } },
};
const shadow = { isShadowPassMaterial: true };

describe("the render pipelines' kinds (scripts/qa/pipelineCount.ts)", () => {
  it("names a pipeline by the object it is drawn for", () => {
    expect(pipelineKind({ object: facadeMesh, material: {} }, game)).toBe("facade");
    expect(pipelineKind({ object: farMesh, material: {} }, game)).toBe("farFacade");
    expect(pipelineKind({ object: terrainMesh, material: {} }, game)).toBe("terrain");
    expect(pipelineKind({ object: roadMesh, material: {} }, game)).toBe("road");
    expect(pipelineKind({ object: lamps, material: {} }, game)).toBe("instanced");
    expect(pipelineKind({ object: car, material: {} }, game)).toBe("other");
  });

  it("puts the shadow pass in front, told by three's shadow override material", () => {
    expect(pipelineKind({ object: facadeMesh, material: shadow }, game)).toBe("shadow:facade");
    expect(pipelineKind({ object: car, material: shadow }, game)).toBe("shadow:other");
  });

  it("reads a game without a far skyline or terrain yet as other, not as an error", () => {
    expect(pipelineKind({ object: car }, { buildings: { tiles: { group: nearGroup }, far: null } })).toBe(
      "other",
    );
    expect(pipelineKind(undefined, undefined)).toBe("other");
  });

  it("counts the kinds inside a window only", () => {
    const at = [5, 10, 15, 30];
    const kinds = ["facade", "shadow:facade", "facade", "terrain"];
    expect(countKinds(at, kinds, 0, 20)).toEqual({ facade: 2, "shadow:facade": 1 });
    expect(countKinds(at, undefined, 20, 40)).toEqual({ "?": 1 });
    // The window's right end is open: a pipeline at its end belongs to the next window.
    expect(countKinds(at, kinds, 0, 15)).toEqual({ facade: 1, "shadow:facade": 1 });
  });

  it("puts pipelineKind in the page as plain JS (no TS types left in the counter's source)", () => {
    expect(COUNT_PIPELINES).toContain("function pipelineKind(");
    // Classified by the render object, three's first argument to createRenderPipeline.
    expect(COUNT_PIPELINES).toContain("__pipelineKind(args[0], window.__game)");
    expect(COUNT_PIPELINES).not.toMatch(/:\s*(Node|Game|string)\b/);
    // The page-side source evaluates and gives the same answer as the module's function.
    const kindOf = new Function(`return ${pipelineKind.toString()}`)() as typeof pipelineKind;
    expect(kindOf({ object: facadeMesh, material: shadow }, game)).toBe("shadow:facade");
  });
});
