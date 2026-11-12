import { HIGH_DECK_ABOVE_M, HIGH_DECK_MIN_M } from "./allowlist";
import type { District } from "./districts";
import { ST, STATION_STRIDE, type XwChunk } from "./format";
import { forcingOf, isFreeAt, viaductOver } from "./report";

/**
 * The height budget's measures (P2.7-5 4.3), from the tiles alone as the scorecard's are: the
 * high-deck stretches of a run and the km of viaduct over 15 and 20 m per district. Pure.
 */

/** A run's high-deck stretch: where it starts and ends (run distance), its largest height over the ground, its length. */
export type HighDeckStretch = { s0: number; s1: number; heightM: number; spanM: number };

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * The stretches of one run (its chunks in k order) more than HIGH_DECK_ABOVE_M over the ground for
 * HIGH_DECK_MIN_M or more, station interval by interval: an interval counts when it lies on a viaduct
 * chunk off a structure's deck and both its stations are high and free (more than TRACK_FREE_M from
 * what forces the deck, report.ts forcingOf). Why both stations: a stretch then never takes in a
 * station that is not high, so its length is what stands over 20 m.
 */
export function highDeckStretches(list: readonly XwChunk[]): HighDeckStretch[] {
  const isEmpty = list.length === 0;
  if (isEmpty) return [];
  const forcing = forcingOf([...list]);
  const out: HighDeckStretch[] = [];
  let open: HighDeckStretch | null = null;
  const close = () => {
    const isLongEnough = open !== null && open.spanM >= HIGH_DECK_MIN_M;
    if (isLongEnough) out.push({ ...open!, heightM: round(open!.heightM, 2), spanM: round(open!.spanM, 1) });
    open = null;
  };
  for (const c of list) {
    const isPlainViaduct = c.structure === "viaduct" && c.over === null;
    for (let i = 0; i + STATION_STRIDE < c.st.length; i += STATION_STRIDE) {
      const s0 = c.st[i + ST.s];
      const s1 = c.st[i + STATION_STRIDE + ST.s];
      const h0 = c.st[i + ST.z] - c.st[i + ST.ground];
      const h1 = c.st[i + STATION_STRIDE + ST.z] - c.st[i + STATION_STRIDE + ST.ground];
      const isHigh = h0 > HIGH_DECK_ABOVE_M && h1 > HIGH_DECK_ABOVE_M;
      const isFree = isFreeAt(forcing, s0) && isFreeAt(forcing, s1);
      const counts = isPlainViaduct && isHigh && isFree;
      if (!counts) {
        close();
        continue;
      }
      if (open === null) open = { s0, s1, heightM: Math.max(h0, h1), spanM: 0 };
      open.s1 = s1;
      open.heightM = Math.max(open.heightM, h0, h1);
      open.spanM += s1 - s0;
    }
  }
  close();
  return out;
}

/** The km of viaduct over 15 and 20 m, per district (every written run, as report.ts height.over15Km). */
export type HeightKm = Partial<Record<District, { over15Km: number; over20Km: number }>>;

export function heightKmOf(
  byRun: ReadonlyMap<string, readonly XwChunk[]>,
  districtOf: (run: string) => District,
): HeightKm {
  const chunksOf = new Map<District, XwChunk[]>();
  for (const [run, list] of byRun) {
    const d = districtOf(run);
    chunksOf.set(d, [...(chunksOf.get(d) ?? []), ...list]);
  }
  const out: HeightKm = {};
  for (const d of [...chunksOf.keys()].sort()) {
    const chunks = chunksOf.get(d)!;
    out[d] = { over15Km: viaductOver(chunks, 15), over20Km: viaductOver(chunks, 20) };
  }
  return out;
}
