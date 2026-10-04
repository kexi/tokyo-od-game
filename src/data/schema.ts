import { z } from "zod";

// Shapes of the static JSON files produced by scripts/fetch-data.ts and served from public/data.

export const GeoidGridSchema = z.object({
  lat0: z.number(),
  lon0: z.number(),
  dLat: z.number(),
  dLon: z.number(),
  nLat: z.number().int(),
  nLon: z.number().int(),
  values: z.array(z.number()),
  source: z.string().optional(),
});
export type GeoidGrid = z.infer<typeof GeoidGridSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.string(),
  license: z.string(),
  /** Attribution wording the publisher asks for in the dataset description, verbatim. */
  note: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  points: z.number().int(),
});
export type Category = z.infer<typeof CategorySchema>;

/** [category, lat, lon, name, ward, sourceIndex] — tuples keep a ~10k-POI file small. */
export const PoiTupleSchema = z.tuple([
  z.string(),
  z.number(),
  z.number(),
  z.string(),
  z.string(),
  z.number().int(),
]);

export const PoiFileSchema = z.object({
  generatedAt: z.string(),
  sources: z.array(SourceSchema),
  categories: z.array(CategorySchema),
  items: z.array(PoiTupleSchema),
});
export type PoiFile = z.infer<typeof PoiFileSchema>;

export type Poi = {
  id: number;
  category: string;
  lat: number;
  lon: number;
  name: string;
  ward: string;
  source: number;
};

export const BusStopFileSchema = z.object({
  generatedAt: z.string(),
  stops: z.record(z.string(), z.tuple([z.number(), z.number()])),
});
export type BusStopFile = z.infer<typeof BusStopFileSchema>;

export function expandPois(file: PoiFile): Poi[] {
  return file.items.map(([category, lat, lon, name, ward, source], id) => ({
    id,
    category,
    lat,
    lon,
    name,
    ward,
    source,
  }));
}
