/**
 * The build label (src/buildLabel.ts: commit, hash of the uncommitted changes, version) of the tree
 * the dev or preview server at `base` serves, from its `GET <base>__log/build` (scripts/logSink.ts),
 * or null when it does not answer in 10 s. The QA tools keep it in their reports at the start and
 * the end of a run, so a report says which tree it measured.
 * Why not the git commit and status of the tree the tool runs in (what the reports kept before): the
 * tool and the page's server can be different trees. A run of 2026-11-28 (p0-attr-3) wrote main's
 * commit while it had measured another worktree's server that held the port.
 */
export async function servedBuild(base: string): Promise<string | null> {
  try {
    const res = await fetch(new URL("__log/build", base), { signal: AbortSignal.timeout(10_000) });
    const isOk = res.ok;
    if (!isOk) return null;
    const body = (await res.json()) as { build?: unknown };
    const isLabel = typeof body.build === "string";
    return isLabel ? (body.build as string) : null;
  } catch {
    return null;
  }
}

/** The served labels at a run's start and end, and whether they differ (the tree changed, or the server went). */
export function servedRecord(atStart: string | null, atEnd: string | null) {
  const isSame = atStart !== null && atStart === atEnd;
  return { atStart, atEnd, isSame };
}
