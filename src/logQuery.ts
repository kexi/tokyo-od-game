// Reading log lines, shared by the page (recentLogs) and the terminal (scripts/logs.ts). No imports:
// the CLI loads it without the logger (whose start-up asks git for the build label).

/** The lines of `spanId` and of every span it led to (by parentId, transitively), in their order. */
export function spanChain<E extends { spanId?: string; parentId?: string }>(
  entries: readonly E[],
  spanId: string,
): E[] {
  const spans = new Set([spanId]);
  // Spans can be logged before their parent's later lines: repeat until no new child appears.
  let isGrowing = true;
  while (isGrowing) {
    isGrowing = false;
    for (const e of entries) {
      const isNewChild =
        e.spanId !== undefined && e.parentId !== undefined && spans.has(e.parentId) && !spans.has(e.spanId);
      if (!isNewChild) continue;
      spans.add(e.spanId as string);
      isGrowing = true;
    }
  }
  return entries.filter((e) => e.spanId !== undefined && spans.has(e.spanId));
}
