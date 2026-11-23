# The walls the end-wall probe counts (R1-1b 追記 3): per wall with a road point by (b) or (c), the
# runs met, same or not, the kinds, u and d spans, heights over this road, and how the reads part.
#   python3 -I r1b_poke_list.py <end-walls-*.json> [...]
import json
import sys

for path in sys.argv[1:]:
    d = json.load(open(path))
    print("##", path)
    for w in d["walls"]:
        b = w["pokeM"] is not None and w["pokeM"] > 1e-3
        c = w["levelM"] is not None and w["levelM"] > 1e-3
        if not (b or c):
            continue
        print(
            f"{w['chunk']}:{w['end']} {w['structure']} same={w['same']} poke(b)={w['pokeM']}"
            f" offEndWall={w['offWallM']} level(c)={w['levelM']} lowered={w['loweredM']} boxes={w['boxes']}"
        )
        groups = {}
        for t in w["points"]:
            key = (t["run"], t["kind"], t["same"], t["onReach"], t["level"], t["inEndWall"])
            g = groups.setdefault(key, {"u": [], "d": set(), "dy": [], "over": [], "onroad": []})
            g["u"].append(t["u"])
            g["d"].add(t["d"])
            g["dy"].append(t["dyM"])
            g["over"].append(t["overM"])
            if t["overRoadM"] is not None:
                g["onroad"].append(t["overRoadM"])
        for (run, kind, same, onr, lev, ew), g in sorted(groups.items()):
            print(
                f"    {run} {kind:9} same={same!s:5} b={onr!s:5} c={lev!s:5} endwall={ew!s:5} n={len(g['u'])}"
                f" u {min(g['u'])}..{max(g['u'])} d {sorted(g['d'])} dy {min(g['dy'])}..{max(g['dy'])}"
                f" over {max(g['over'])}" + (f" overRoad {min(g['onroad'])}..{max(g['onroad'])}" if g["onroad"] else "")
            )
