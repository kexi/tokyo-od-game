import glob
import json

for f in sorted(glob.glob(".qa/r1b/drives-default-w0/*.json")):
    d = json.load(open(f))
    s = d.get("summary") or {}
    w = s.get("wall") or {}
    print(d["route"], d["invalid"], d["failures"], w.get("maxPastEndM"), w.get("maxKmh"), w.get("lastDyM"))
