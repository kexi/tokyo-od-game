import type { RoadNetworkData, RoadNetworkRestorable } from "./roadNetworkData";
import type { RoadGraphSnapshot } from "./roads";

export type RoadNetworkPacket = Omit<RoadNetworkData, "graph"> & {
  graph: {
    segments: Array<Omit<RoadGraphSnapshot["segments"][number], "pts">>;
    nodes: RoadGraphSnapshot["nodes"];
  };
  points: Float64Array;
  pointOffsets: Uint32Array;
  pieces: { keys: string[]; offsets: Uint32Array; pairs: Float64Array } | null;
};

/** Flat buffers avoid deserializing a separate JS array for every vertex and indexed road piece. */
export function packRoadNetwork(data: RoadNetworkData): RoadNetworkPacket {
  const source = data.graph;
  const count = source.segments.reduce((n, segment) => n + segment.pts.length, 0);
  const points = new Float64Array(count * 3);
  const pointOffsets = new Uint32Array(source.segments.length + 1);
  const segments: RoadNetworkPacket["graph"]["segments"] = [];
  let vertex = 0;
  for (const segment of source.segments) {
    pointOffsets[segments.length] = vertex;
    const { pts, ...fields } = segment;
    segments.push(fields);
    for (const point of pts) {
      points.set(point, vertex * 3);
      vertex++;
    }
  }
  pointOffsets[segments.length] = vertex;
  let pieces: RoadNetworkPacket["pieces"] = null;
  const hasPieces = source.pieces !== null;
  if (hasPieces) {
    const index = source.pieces!;
    const keys: string[] = [];
    const offsets = new Uint32Array(index.size + 1);
    let countPairs = 0;
    for (const value of index.values()) countPairs += value.length;
    const pairs = new Float64Array(countPairs * 2);
    let piece = 0;
    for (const [key, values] of index) {
      offsets[keys.length] = piece;
      keys.push(key);
      for (const pair of values) {
        pairs.set(pair, piece * 2);
        piece++;
      }
    }
    offsets[keys.length] = piece;
    pieces = { keys, offsets, pairs };
  }
  return {
    graph: { segments, nodes: source.nodes },
    points,
    pointOffsets,
    pieces,
    applied: data.applied,
    diagnostics: data.diagnostics,
    computeMs: data.computeMs,
  };
}

export function roadNetworkTransfers(packet: RoadNetworkPacket): ArrayBuffer[] {
  const buffers = [packet.points.buffer, packet.pointOffsets.buffer];
  const hasPieces = packet.pieces !== null;
  if (hasPieces) buffers.push(packet.pieces!.offsets.buffer, packet.pieces!.pairs.buffer);
  return buffers as ArrayBuffer[];
}

/** Rebuild the existing snapshot contract, including Map iteration and per-cell piece order. */
export function unpackRoadNetwork(packet: RoadNetworkPacket): RoadNetworkRestorable {
  const steps = unpackRoadNetworkSteps(packet);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The same cell order, with checkpoints inside a large cell as well as between cells. */
export function* unpackRoadNetworkSteps(packet: RoadNetworkPacket): Generator<void, RoadNetworkRestorable> {
  let pieces: RoadGraphSnapshot["pieces"] = null;
  const hasPieces = packet.pieces !== null;
  if (hasPieces) {
    const index = packet.pieces!;
    pieces = new Map();
    for (let c = 0; c < index.keys.length; c++) {
      const pairs: Array<[number, number]> = [];
      for (let i = index.offsets[c]; i < index.offsets[c + 1]; i++) {
        pairs.push([index.pairs[i * 2], index.pairs[i * 2 + 1]]);
        const checkpoint = (i + 1) % 128 === 0;
        if (checkpoint) yield;
      }
      pieces.set(index.keys[c], pairs);
      const checkpoint = (c + 1) % 128 === 0;
      if (checkpoint) yield;
    }
  }
  return {
    graph: { ...packet.graph, pieces, points: packet.points, pointOffsets: packet.pointOffsets },
    applied: packet.applied,
    diagnostics: packet.diagnostics,
    computeMs: packet.computeMs,
  };
}
