/**
 * The build label (src/buildLabel.ts: commit, hash of the uncommitted changes, version) of the tree
 * the dev or preview server at `base` serves, from its `GET <base>__log/build` (scripts/logSink.ts),
 * or null when it does not answer in `timeoutMs` (10 s by default). The QA tools keep it in their reports at the start and
 * the end of a run, so a report says which tree it measured.
 * Why not the git commit and status of the tree the tool runs in (what the reports kept before): the
 * tool and the page's server can be different trees. A run of 2026-11-28 (p0-attr-3) wrote main's
 * commit while it had measured another worktree's server that held the port.
 */
export async function servedBuild(base: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const res = await fetch(new URL("__log/build", base), { signal: AbortSignal.timeout(timeoutMs) });
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

/**
 * One JSON line on stderr when a finished run's served labels differ or are missing: the report
 * stays, but it is not one tree's measurement. Why stderr and not src/log.ts: the QA tools run in
 * Node, outside the game's logger, and write their own JSON lines (stdout is the result).
 */
export function warnIfNotSame(record: ReturnType<typeof servedRecord>, report: string): void {
  const isSame = record.isSame;
  if (isSame) return;
  process.stderr.write(`${JSON.stringify({ warning: "served_build_not_same", ...record, report })}\n`);
}
