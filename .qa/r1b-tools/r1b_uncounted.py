# R1-1b 追記 4 D6 / D8: per folder, the walls standing on a road the line does not count (its run ends
# here: run, same, its dead end's distance from the face), and the faces met under − MERGE_MAX_DZ down
# to − SLAB (listed apart). python3 -I r1b_uncounted.py <worktree>/.qa
import json
import sys

q = sys.argv[1]
for n in ["expressway", "r1b-g3", "r1b-g4", "r1b-g5", "r1b-g1-pruned", "r1b-g2-all"]:
    d = json.load(open(f"{q}/expressway/end-walls-{n}.json"))
    print(
        "##",
        n,
        {
            k: d["summary"][k]
            for k in [
                "poking",
                "pokingRaw",
                "pokingLevel",
                "deepPoints",
                "uncountedFarthestEndM",
                "openM",
                "wallMisses",
            ]
        },
    )
    for w in d["walls"]:
        if w["uncounted"]:
            print("  uncounted", f"{w['chunk']}:{w['end']}", "rawM", w["rawM"], w["uncounted"])
    for w in d["walls"]:
        if not w["deep"]:
            continue
        by = {}
        for t in w["deep"]:
            g = by.setdefault((t["run"], t["onReach"], t["inEndWall"]), [])
            g.append(t)
        for (run, on, ew), g in by.items():
            dys = [t["dyM"] for t in g]
            print(
                "  deep",
                f"{w['chunk']}:{w['end']}",
                run,
                f"onReach={on} inEndWall={ew} n={len(g)} dy {min(dys)}..{max(dys)}",
                f"d {sorted({t['d'] for t in g})} u {min(t['u'] for t in g)}..{max(t['u'] for t in g)}",
            )
