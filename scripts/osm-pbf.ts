// Minimal OpenStreetMap PBF reader: yields tagged nodes (dense and plain) that match a tag
// filter. Enough to pull traffic signals out of a city extract without osmium or a GIS stack.
// Format: https://wiki.openstreetmap.org/wiki/PBF_Format
import { inflateSync } from "node:zlib";
import Pbf from "pbf";

export type OsmNode = { id: number; lat: number; lon: number; tags: Record<string, string> };

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
    if (!match(tags)) continue;
    out.push({
      id,
      lat: 1e-9 * (block.latOffset + block.granularity * lat),
      lon: 1e-9 * (block.lonOffset + block.granularity * lon),
      tags,
    });
  }
}

/** All nodes in the file whose tags satisfy `match`. */
export function readTaggedNodes(
  file: Uint8Array,
  match: (tags: Record<string, string>) => boolean,
): OsmNode[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: OsmNode[] = [];
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
    for (const group of block.groups) {
      group.readFields((tag, _r, pbf) => {
        if (tag === 2) denseNodes(block, new Pbf(pbf.readBytes()), match, out);
        else if (tag === 1) {
          // Plain (non-dense) node: id=1, keys=2, vals=3, lat=8, lon=9.
          const node = new Pbf(pbf.readBytes());
          let nid = 0;
          let nlat = 0;
          let nlon = 0;
          let keys: number[] = [];
          let vals: number[] = [];
          node.readFields((t, _x, q) => {
            if (t === 1) nid = q.readSVarint();
            else if (t === 2) keys = q.readPackedVarint();
            else if (t === 3) vals = q.readPackedVarint();
            else if (t === 8) nlat = q.readSVarint();
            else if (t === 9) nlon = q.readSVarint();
          }, null);
          const tags = Object.fromEntries(keys.map((key, i) => [block.strings[key], block.strings[vals[i]]]));
          if (match(tags)) {
            out.push({
              id: nid,
              lat: 1e-9 * (block.latOffset + block.granularity * nlat),
              lon: 1e-9 * (block.lonOffset + block.granularity * nlon),
              tags,
            });
          }
        }
      }, null);
    }
  }
  return out;
}
