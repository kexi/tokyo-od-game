import {
  BufferAttribute,
  Float16BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Vector3,
  type TypedArray,
} from "three";
import { facadeAttributeSteps } from "./facadeData";

export type BuildingAttribute = {
  array: TypedArray;
  itemSize: number;
  normalized: boolean;
  count: number;
  stride: number;
  offset: number;
  interleaved: boolean;
  halfFloat: boolean;
};
export type BuildingFacadeInput = {
  position: BuildingAttribute;
  ids: BuildingAttribute | null;
  matrix: number[];
};
export type BuildingFacadeData = { ecef: Float32Array; facade: Float32Array };

function attribute(input: BuildingAttribute): BufferAttribute | InterleavedBufferAttribute {
  const { array, itemSize, normalized, stride, offset } = input;
  if (input.interleaved)
    return new InterleavedBufferAttribute(new InterleavedBuffer(array, stride), itemSize, offset, normalized);
  if (input.halfFloat) return new Float16BufferAttribute(array, itemSize, normalized);
  return new BufferAttribute(array, itemSize, normalized);
}

/** Reads normalized and interleaved attributes through the same Three getters as the original. */
export function* buildingFacadeSteps(input: BuildingFacadeInput): Generator<void, BuildingFacadeData> {
  const position = attribute(input.position);
  const ids = input.ids ? attribute(input.ids) : null;
  const matrix = new Matrix4().fromArray(input.matrix);
  const vertex = new Vector3();
  const ecef = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const isChunkStart = i % 4096 === 0;
    if (isChunkStart) yield;
    vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
    ecef.set([vertex.x, vertex.y, vertex.z], i * 3);
  }
  const facade = yield* facadeAttributeSteps(position.count, ecef, ids ? (i) => ids.getX(i) : null);
  return { ecef, facade };
}

export function computeBuildingFacade(input: BuildingFacadeInput): BuildingFacadeData {
  const steps = buildingFacadeSteps(input);
  for (;;) {
    const result = steps.next();
    if (result.done) return result.value;
  }
}
