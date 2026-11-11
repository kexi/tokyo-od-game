/**
 * The OSM extract the expressway data is built from, pinned (P2.7-1). Geofabrik's kanto-latest
 * moves every day, and a new extract moves the decks (other ways, other nodes): a scorecard of one
 * build compared with another's would mix the compiler's change with OSM's. So the build reads its
 * own copy, named by its replication timestamp (.cache/osm/kanto-<timestamp>.osm.pbf), which
 * `just fetch-regs` never touches (it re-downloads kanto-latest.osm.pbf in place once it is a week
 * old). The copy is made once from kanto-latest when that is still this extract, and the build
 * stops on any other extract unless `--accept-extract` is given (and the change is measured as its
 * own step).
 *
 * Why the timestamp and not the SHA-256 names the pin: the timestamp is the OSM state itself (what
 * the data is "as of", written to meta.json and LICENSE.txt), and readable from the file's header;
 * the same state downloaded again may come with other block compression and another hash. The
 * hash is still checked when the copy is made, so a damaged or different file of the same
 * timestamp is not taken in silently.
 */

/** The replication timestamp of the extract public/data/expressway is built from. */
export const EXPECTED_EXTRACT_TIMESTAMP = "2026-10-03T20:20:50Z";

/** SHA-256 of that extract as downloaded (checked when the pinned copy is made). */
export const EXPECTED_EXTRACT_SHA256 = "777236f6b77647b3ba034176981cc5cb0d3b1ce8677ddfd8de211602ad578ec3";

/** The pinned copy's file name: kanto-20261003T202050Z.osm.pbf for the expected timestamp. */
export function pinnedExtractName(timestamp = EXPECTED_EXTRACT_TIMESTAMP): string {
  return `kanto-${timestamp.replace(/[-:]/g, "")}.osm.pbf`;
}

export type ExtractCheck = { ok: true } | { ok: false; reason: string };

/** How to get the pinned extract back, for the error. */
const RECOVERY =
  "restore .cache/osm/" +
  pinnedExtractName() +
  " (or a kanto-latest.osm.pbf of that timestamp and SHA-256, which the build copies), or pass --accept-extract (just make-expressway-data <range> --accept-extract) to build from this one and measure the change as its own step";

/** Whether a build may go on with the extract of this timestamp (and hash, when known). */
export function checkExtract(
  timestamp: string | null,
  accept: boolean,
  sha256: string | null = null,
  expected = { timestamp: EXPECTED_EXTRACT_TIMESTAMP, sha256: EXPECTED_EXTRACT_SHA256 },
): ExtractCheck {
  const isPinnedTime = timestamp === expected.timestamp;
  const isPinnedHash = sha256 === null || sha256 === expected.sha256;
  const isPinned = isPinnedTime && isPinnedHash;
  if (isPinned || accept) return { ok: true };
  const what = isPinnedTime
    ? `SHA-256 ${sha256} is not the pinned ${expected.sha256}`
    : `replication ${timestamp ?? "unknown"} is not the pinned ${expected.timestamp}`;
  return { ok: false, reason: `OSM extract ${what} (src/expressway/extract.ts): ${RECOVERY}` };
}
