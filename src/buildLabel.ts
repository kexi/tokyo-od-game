/**
 * The build identity every log line carries (`build`): the git commit, a hash of the uncommitted
 * changes when there are any, and the app version, as `d727db1@0.1.0` or `d727db1+3f2a9c@0.1.0`.
 * A line then says which code wrote it, and two runs of the same dirty tree have the same label.
 *
 * Pure: the git calls and the hash come in, so vite.config.ts (Node), the logger under tsx (Node
 * builtins reached at run time) and the tests share it without the browser bundle importing Node.
 */
export type Run = (command: string, args: readonly string[]) => string;

export function gitBuildLabel(run: Run, hash: (text: string) => string, version: string): string {
  const sha = tryRun(run, ["rev-parse", "--short", "HEAD"]).trim() || "nogit";
  const status = tryRun(run, ["status", "--porcelain", "--untracked-files=normal"]);
  if (status.trim() === "") return `${sha}@${version}`;
  // The diff and the list of changed and new files: the same edits give the same tag.
  // Why not the diff's size or the time: neither tells two different edits apart reliably.
  const diff = tryRun(run, ["diff", "HEAD", "--no-ext-diff"]);
  return `${sha}+${hash(`${status}\n${diff}`).slice(0, 6)}@${version}`;
}

function tryRun(run: Run, args: readonly string[]): string {
  try {
    return run("git", args);
  } catch {
    return "";
  }
}
