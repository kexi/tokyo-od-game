import { z } from "zod";
import { warn } from "../log";

// The places the navi's 目的地 chooser searches (public/data/destinations.json, written by
// scripts/destinations.ts from OpenStreetMap): every railway station in the 23 wards and the
// notable places people drive to, some marked featured for the chooser's first view.

/** [kind, lat, lon, name, name_en, ward, featured, note] — tuples keep ~4,000 places small. */
export const DestinationRowSchema = z.tuple([
  z.string(),
  z.number(),
  z.number(),
  z.string(),
  z.string().nullable(),
  z.string().nullable(),
  z.union([z.literal(0), z.literal(1)]),
  z.string().nullable(),
]);

export const DestinationFileSchema = z.object({
  source: z.string(),
  /** The OSM extract's replication time (the data's "as of"), not when the script ran. */
  generatedAt: z.string(),
  /** Kind id → Japanese label (station → 駅, temple → 寺院 …), in the file's order. */
  kinds: z.record(z.string(), z.string()),
  items: z.array(DestinationRowSchema),
});
export type DestinationFile = z.infer<typeof DestinationFileSchema>;

export type Destination = {
  /** Index in the file (stable for one generated file only). */
  id: number;
  kind: string;
  lat: number;
  lon: number;
  /** Japanese name as people say it (stations end in 駅: 東京駅). */
  name: string;
  /** English name from OSM (stations end in "Station"), null when OSM has none. */
  nameEn: string | null;
  ward: string | null;
  /** A well-known landmark for the list shown before anything is typed. */
  featured: boolean;
  /** Stations: the operators (JR東日本・東京メトロ). Places: other names it goes by (official name,
   * 東京国際空港 for 羽田空港). Null when there is none. */
  note: string | null;
};

export function expandDestinations(file: DestinationFile): Destination[] {
  return file.items.map(([kind, lat, lon, name, nameEn, ward, featured, note], id) => ({
    id,
    kind,
    lat,
    lon,
    name,
    nameEn,
    ward,
    featured: featured === 1,
    note,
  }));
}

/** The destinations and the kind labels, or null when the file is missing or malformed. */
export async function loadDestinations(): Promise<{
  items: Destination[];
  kinds: Record<string, string>;
  source: string;
  generatedAt: string;
} | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/destinations.json`);
    if (!res.ok) return null;
    const file = DestinationFileSchema.parse(await res.json());
    return {
      items: expandDestinations(file),
      kinds: file.kinds,
      source: file.source,
      generatedAt: file.generatedAt,
    };
  } catch (error) {
    warn("data_load_failed", { name: "destinations.json", error: String(error) });
    return null;
  }
}
