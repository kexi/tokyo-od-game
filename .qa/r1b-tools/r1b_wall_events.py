# R1-1b 追記 1 A4 の 6: in the page logs of a served worktree (.qa/logs/<day>/*.jsonl), per session,
# each expressway_end_wall_built of one chunk (time, end, loweredM, boxes) and when the chunks named
# as "over" were built (expressway chunk builds by id, where logged), to see whether the wall came out
# the same whatever was read first.
#   python3 -I r1b_wall_events.py <logs dir> <chunk> [<over chunk> ...]
import glob
import json
import sys

logs, chunk, *overs = sys.argv[1:]
for path in sorted(glob.glob(f"{logs}/*/*.jsonl")):
    walls = []
    builds = {}
    first = None
    for line in open(path):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        first = first or e.get("ts")
        isWall = e.get("event") == "expressway_end_wall_built" and e.get("chunk") == chunk
        if isWall:
            walls.append((e["ts"], e["end"], e["loweredM"], e["boxes"], e.get("yieldedM")))
        for o in overs:
            isOver = e.get("chunk") == o and o not in builds
            if isOver:
                builds[o] = (e["ts"], e.get("event"))
    if walls:
        print(path.split("/")[-1], "from", first, "build", "walls", walls, "first lines of", builds)
