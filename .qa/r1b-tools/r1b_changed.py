# The walls whose chunk's vertices changed against ea62e55 (r1b_hash6.sh) and the walls that gave
# way (R1-1b 追記 4 D3), per folder: width, lowered, yielded and to whom, the height between the roads.
#   python3 -I r1b_changed.py <worktree>/.qa
import json
import sys

q = sys.argv[1]
for n in ["expressway", "r1b-g3", "r1b-g4", "r1b-g5", "r1b-g1-pruned", "r1b-g2-all"]:
    a = json.load(open(f"{q}/r1b/hash-ea62-{n}.json"))
    b = json.load(open(f"{q}/r1b/hash-now-{n}.json"))
    p = json.load(open(f"{q}/expressway/end-walls-{n}.json"))
    diff = [k for k in b if (a[k]["collider"], a[k]["drawn"]) != (b[k]["collider"], b[k]["drawn"])]
    print(n, "changed", len(diff))
    for k in diff:
        ws = [w for w in p["walls"] if w["chunk"] == k]
        rows = [
            (w["end"], w["widthM"], w["loweredM"], w["yieldedM"], w["yieldTo"], w["yieldDzM"], w["boxes"]) for w in ws
        ]
        print("   ", k, "tri", a[k]["triangles"], "->", b[k]["triangles"], rows)
    walls_a = {k: v["endWalls"] for k, v in a.items()}
    for w in p["walls"]:
        before = [x for x in walls_a.get(w["chunk"], []) if x["end"] == w["end"]]
        if w["yieldedM"] > 0:
            print(
                "    yielded", w["chunk"], w["end"], "width", before[0]["widthM"] if before else None, "->", w["widthM"]
            )
