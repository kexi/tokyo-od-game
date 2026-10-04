// Minimal OpenStreetMap PBF reader: tagged nodes (dense and plain) and ways that match a tag
// filter, plus coordinates for chosen node ids. Enough to pull traffic signals and footbridges
// out of a regional extract without osmium or a GIS stack.
// Format: https://wiki.openstreetmap.org/wiki/PBF_Format
import { inflateSync } from "node:zlib";
import Pbf from "pbf";

export type OsmNode = { id: number; lat: number; lon: number; tags: Record<string, string> };
export type OsmWay = { id: number; refs: number[]; tags: Record<string, string> };

type Block = {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
  groups: Pbf[];
};

const decoder = new TextDecoder();

function readBlob(buf: Uint8Array): Uint8Array {
  let raw: Uint8Array | null = null;
  let zlib: Uint8Array | null = null;
  new Pbf(buf).readFields((tag, _r, pbf) => {
    if (tag === 1) raw = pbf.readBytes();
    else if (tag === 3) zlib = pbf.readBytes();
  }, null);
  if (raw) return raw;
  if (zlib) return new Uint8Array(inflateSync(zlib));
  throw new Error("unsupported blob compression (only raw and zlib)");
}

function readBlock(buf: Uint8Array): Block {
  const block: Block = { strings: [], granularity: 100, latOffset: 0, lonOffset: 0, groups: [] };
  new Pbf(buf).readFields((tag, b, pbf) => {
    if (tag === 1) {
      const end = pbf.readVarint() + pbf.pos;
      while (pbf.pos < end) {
        const key = pbf.readVarint();
        if (key >> 3 === 1) b.strings.push(decoder.decode(pbf.readBytes()));
        else pbf.skip(key);
      }
    } else if (tag === 2) b.groups.push(new Pbf(pbf.readBytes()));
    else if (tag === 17) b.granularity = pbf.readVarint();
    else if (tag === 19) b.latOffset = pbf.readVarint64 ? pbf.readVarint64() : pbf.readVarint();
    else if (tag === 20) b.lonOffset = pbf.readVarint64 ? pbf.readVarint64() : pbf.readVarint();
  }, block);
  return block;
}

function denseNodes(
  block: Block,
  pbf: Pbf,
  match: (tags: Record<string, string>) => boolean,
  out: OsmNode[],
  only?: Set<number>,
): void {
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let kv: number[] = [];
  pbf.readFields((tag, _r, p) => {
    if (tag === 1) ids = p.readPackedSVarint();
    else if (tag === 8) lats = p.readPackedSVarint();
    else if (tag === 9) lons = p.readPackedSVarint();
    else if (tag === 10) kv = p.readPackedVarint();
  }, null);
  let id = 0;
  let lat = 0;
  let lon = 0;
  let k = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];
    const tags: Record<string, string> = {};
    while (k < kv.length && kv[k] !== 0) {
      tags[block.strings[kv[k]]] = block.strings[kv[k + 1]];
      k += 2;
    }
    k++; // the 0 delimiter ending this node's tags
    if (only && !only.has(id)) continue;
    if (!match(tags)) continue;
    out.push({
      id,
      lat: 1e-9 * (block.latOffset + block.granularity * lat),
      lon: 1e-9 * (block.lonOffset + block.granularity * lon),
      tags,
    });
  }
}

/** Calls `fn` for every primitive group of every data block, in file order. */
function forEachGroup(file: Uint8Array, fn: (block: Block, group: Pbf) => void): void {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let p = 0;
  while (p + 4 <= file.length) {
    const headerLen = view.getUint32(p);
    p += 4;
    let type = "";
    let dataSize = 0;
    new Pbf(file.subarray(p, p + headerLen)).readFields((tag, _r, pbf) => {
      if (tag === 1) type = pbf.readString();
      else if (tag === 3) dataSize = pbf.readVarint();
    }, null);
    p += headerLen;
    const blob = file.subarray(p, p + dataSize);
    p += dataSize;
    if (type !== "OSMData") continue;
    const block = readBlock(readBlob(blob));
    for (const group of block.groups) fn(block, group);
  }
}

/** Plain (non-dense) node: id=1, keys=2, vals=3, lat=8, lon=9. */
function plainNode(block: Block, pbf: Pbf): OsmNode {
  let id = 0;
  let lat = 0;
  let lon = 0;
  let keys: number[] = [];
  let vals: number[] = [];
  pbf.readFields((t, _x, q) => {
    if (t === 1) id = q.readSVarint();
    else if (t === 2) keys = q.readPackedVarint();
    else if (t === 3) vals = q.readPackedVarint();
    else if (t === 8) lat = q.readSVarint();
    else if (t === 9) lon = q.readSVarint();
  }, null);
  return {
    id,
    lat: 1e-9 * (block.latOffset + block.granularity * lat),
    lon: 1e-9 * (block.lonOffset + block.granularity * lon),
    tags: Object.fromEntries(keys.map((key, i) => [block.strings[key], block.strings[vals[i]]])),
  };
}

/** All nodes in the file whose tags satisfy `match`. */
export function readTaggedNodes(
  file: Uint8Array,
  match: (tags: Record<string, string>) => boolean,
): OsmNode[] {
  const out: OsmNode[] = [];
  forEachGroup(file, (block, group) => {
    group.readFields((tag, _r, pbf) => {
      if (tag === 2) denseNodes(block, new Pbf(pbf.readBytes()), match, out);
      else if (tag === 1) {
        const node = plainNode(block, new Pbf(pbf.readBytes()));
        if (match(node.tags)) out.push(node);
      }
    }, null);
  });
  return out;
}

/** All ways whose tags satisfy `match`: id=1, keys=2, vals=3, refs=8 (delta-coded). */
export function readWays(file: Uint8Array, match: (tags: Record<string, string>) => boolean): OsmWay[] {
  const out: OsmWay[] = [];
  forEachGroup(file, (block, group) => {
    group.readFields((tag, _r, pbf) => {
      if (tag !== 3) return;
      const way = new Pbf(pbf.readBytes());
      let id = 0;
      let keys: number[] = [];
      let vals: number[] = [];
      let deltas: number[] = [];
      way.readFields((t, _x, q) => {
        if (t === 1) id = q.readVarint();
        else if (t === 2) keys = q.readPackedVarint();
        else if (t === 3) vals = q.readPackedVarint();
        else if (t === 8) deltas = q.readPackedSVarint();
      }, null);
      const tags = Object.fromEntries(keys.map((key, i) => [block.strings[key], block.strings[vals[i]]]));
      if (!match(tags)) return;
      const refs: number[] = [];
      let ref = 0;
      for (const d of deltas) refs.push((ref += d));
      out.push({ id, refs, tags });
    }, null);
  });
  return out;
}

/** Coordinates [lon, lat] of the given node ids (tagged or not). */
export function readNodeCoords(file: Uint8Array, ids: Set<number>): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const all: OsmNode[] = [];
  forEachGroup(file, (block, group) => {
    group.readFields((tag, _r, pbf) => {
      if (tag === 2) {
        all.length = 0;
        denseNodes(block, new Pbf(pbf.readBytes()), () => true, all, ids);
        for (const n of all) out.set(n.id, [n.lon, n.lat]);
      } else if (tag === 1) {
        const node = plainNode(block, new Pbf(pbf.readBytes()));
        if (ids.has(node.id)) out.set(node.id, [node.lon, node.lat]);
      }
    }, null);
  });
  return out;
}
