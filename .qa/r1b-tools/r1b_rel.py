import json
import sys

# For each (wall chunk, other run) pair the probe counted, the wall chunk's `decks` relation to that run.
d = sys.argv[1]
pairs = [p.split("/") for p in sys.argv[2:]]
meta = json.load(open(f"{d}/meta.json"))
ch = {}
for t in meta["tiles"]:
    for c in json.load(open(f"{d}/{t}.json"))["chunks"]:
        ch[c["id"]] = c
for cid, run in pairs:
    c = ch[cid]
    rel = [x for x in c["decks"] if x["with"] == run]
    print(cid, run, c["structure"], "lanes", c["lanes"], rel)
