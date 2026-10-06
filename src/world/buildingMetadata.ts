import type { TilesRenderer } from "3d-tiles-renderer";
import type { Tile } from "3d-tiles-renderer/core";
import { log } from "../log";

/** Keep the feature table and embedded GLB; the game never reads building batch properties. */
export function omitBuildingBatchTable(buffer: ArrayBuffer): ArrayBuffer {
  const hasHeader = buffer.byteLength >= 28;
  if (!hasHeader) return buffer;
  const header = new DataView(buffer);
  const isB3dm = header.getUint32(0, true) === 0x6d643362;
  const isSupported = isB3dm && header.getUint32(4, true) === 1;
  const hasDeclaredLength = header.getUint32(8, true) === buffer.byteLength;
  const hasModernHeader = isSupported && hasDeclaredLength;
  if (!hasModernHeader) return buffer;

  const featureJsonBytes = header.getUint32(12, true);
  const featureBinaryBytes = header.getUint32(16, true);
  const batchJsonBytes = header.getUint32(20, true);
  const batchBinaryBytes = header.getUint32(24, true);
  const featureEnd = 28 + featureJsonBytes + featureBinaryBytes;
  const glbStart = featureEnd + batchJsonBytes + batchBinaryBytes;
  const canOmit = featureJsonBytes > 0 && batchJsonBytes > 0 && glbStart + 12 <= buffer.byteLength;
  if (!canOmit) return buffer;
  const hasGlb =
    header.getUint32(glbStart, true) === 0x46546c67 && header.getUint32(glbStart + 4, true) === 2;
  const glbBytes = header.getUint32(glbStart + 8, true);
  const hasGlbLength = glbBytes >= 12 && glbStart + glbBytes <= buffer.byteLength;
  const hasEmbeddedGlb = hasGlb && hasGlbLength;
  if (!hasEmbeddedGlb) return buffer;

  // Padding the JSON would move binary RTC_CENTER data. Append alignment bytes to the
  // feature binary instead: its data and relative offsets remain exactly the same.
  const alignedFeatureEnd = Math.ceil(featureEnd / 8) * 8;
  // Some published GLBs have no tail padding. GLTFLoader reads their declared GLB length.
  const compactBytes = Math.ceil((alignedFeatureEnd + buffer.byteLength - glbStart) / 8) * 8;
  const compact = new Uint8Array(compactBytes);
  compact.set(new Uint8Array(buffer, 0, featureEnd));
  compact.set(new Uint8Array(buffer, glbStart), alignedFeatureEnd);
  const rewritten = new DataView(compact.buffer);
  rewritten.setUint32(8, compact.byteLength, true);
  rewritten.setUint32(16, featureBinaryBytes + alignedFeatureEnd - featureEnd, true);
  rewritten.setUint32(20, 0, true);
  rewritten.setUint32(24, 0, true);
  return compact.buffer;
}

type ParseTileArgs = [
  buffer: ArrayBuffer,
  tile: Tile,
  extension: string,
  url: string,
  abortSignal: AbortSignal,
];
type TileParser = TilesRenderer & { parseTile(...args: ParseTileArgs): Promise<void> };

/** A parse plugin so downloads, cancellation and the standard geometry loader keep their flow. */
export class BuildingMetadataPlugin {
  readonly name = "BUILDING_METADATA_PLUGIN";
  private tiles!: TileParser;

  init(tiles: TilesRenderer): void {
    // parseTile is an overrideable public method in 0.5.3, absent from its declarations.
    this.tiles = tiles as TileParser;
  }

  parseTile(...[buffer, tile, extension, url, abortSignal]: ParseTileArgs): Promise<void> | null {
    const start = performance.now();
    const compact = omitBuildingBatchTable(buffer);
    const hasUnusedProperties = compact !== buffer;
    if (!hasUnusedProperties) return null;
    log("building_batch_table_skipped", {
      url,
      bytesBefore: buffer.byteLength,
      bytesAfter: compact.byteLength,
      cpuMs: performance.now() - start,
    });
    return this.tiles.parseTile(compact, tile, extension, url, abortSignal);
  }
}
