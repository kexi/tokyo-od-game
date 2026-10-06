import Pbf from "pbf";

type Feature = { type: number; properties: Record<string, string | number>; rings: number[][] };
type Layer = { name: string; extent: number; features: Feature[] };

/** Encode actual MVT bytes so the tests exercise properties and geometry, not parser stubs. */
export function vectorTileFixture(layers: Layer[]): ArrayBuffer {
  const tile = new Pbf();
  for (const inputLayer of layers) {
    tile.writeMessage(
      3,
      (layer, pbf) => {
        pbf.writeVarintField(15, 2);
        pbf.writeStringField(1, layer.name);
        pbf.writeVarintField(5, layer.extent);
        const keys = [...new Set(layer.features.flatMap((f) => Object.keys(f.properties)))];
        const values: Array<string | number> = [];
        for (const feature of layer.features) {
          const tags: number[] = [];
          for (const [key, value] of Object.entries(feature.properties)) {
            tags.push(keys.indexOf(key), values.length);
            values.push(value);
          }
          pbf.writeMessage(
            2,
            (_unused, featurePbf) => {
              featurePbf.writePackedVarint(2, tags);
              featurePbf.writeVarintField(3, feature.type);
              const geometry: number[] = [];
              let x = 0,
                y = 0;
              const delta = (nx: number, ny: number) => {
                const dx = nx - x,
                  dy = ny - y;
                geometry.push((dx << 1) ^ (dx >> 31), (dy << 1) ^ (dy >> 31));
                x = nx;
                y = ny;
              };
              for (const ring of feature.rings) {
                geometry.push(9);
                delta(ring[0], ring[1]);
                const hasLines = ring.length > 2;
                if (hasLines) {
                  geometry.push(((ring.length / 2 - 1) << 3) | 2);
                  for (let i = 2; i < ring.length; i += 2) delta(ring[i], ring[i + 1]);
                }
                const isPolygon = feature.type === 3;
                if (isPolygon) geometry.push(15);
              }
              featurePbf.writePackedVarint(4, geometry);
            },
            null,
          );
        }
        for (const key of keys) pbf.writeStringField(3, key);
        for (const entry of values)
          pbf.writeMessage(
            4,
            (value, valuePbf) => {
              const isString = typeof value === "string";
              if (isString) valuePbf.writeStringField(1, value);
              else valuePbf.writeDoubleField(3, value);
            },
            entry,
          );
      },
      inputLayer,
    );
  }
  const result = tile.finish();
  return result.slice().buffer as ArrayBuffer;
}

export const square = [0, 0, 4096, 0, 4096, 4096, 0, 4096];
export const hole = [1024, 1024, 1024, 2048, 2048, 2048, 2048, 1024];
export const inputFixture = () =>
  vectorTileFixture([
    {
      name: "road",
      extent: 4096,
      features: [
        {
          type: 2,
          properties: { ftCode: 2703, rdCtg: 0, Width: 8 },
          rings: [
            [0, 0, 2048, 4096],
            [4096, 0, 4096, 4096],
          ],
        },
        {
          type: 2,
          properties: { ftCode: 2701, rdCtg: 1, Width: 0, rnkWidth: 2 },
          rings: [[0, 0, 4096, 4096]],
        },
        {
          type: 2,
          properties: { ftCode: 2701, rdCtg: 2, motorway: 1, rnkWidth: 99 },
          rings: [[0, 0, 4096, 4096]],
        },
        { type: 2, properties: { ftCode: 2701, rdCtg: 2, rnkWidth: 0 }, rings: [[0, 0, 4096, 4096]] },
        { type: 2, properties: { ftCode: 2701, lvOrder: 1 }, rings: [[0, 0, 4096, 4096]] },
        { type: 2, properties: { ftCode: 2801 }, rings: [[0, 0, 4096, 4096]] },
        { type: 1, properties: { ftCode: 2701 }, rings: [[0, 0]] },
      ],
    },
    {
      name: "waterarea",
      extent: 4096,
      features: [
        { type: 3, properties: {}, rings: [square, hole] },
        { type: 2, properties: {}, rings: [[0, 0, 4096, 4096]] },
      ],
    },
    {
      name: "TrafficArea",
      extent: 4096,
      features: [
        { type: 3, properties: { tran_function: "歩道部" }, rings: [square, hole] },
        { type: 3, properties: { tran_function: "車道部" }, rings: [square] },
      ],
    },
    {
      name: "AuxiliaryTrafficArea",
      extent: 4096,
      features: [{ type: 3, properties: { tran_function: "島" }, rings: [square] }],
    },
  ]);
