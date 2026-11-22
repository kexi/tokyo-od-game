# PR W, 追記 7 N5: the keys in the G′-only list (121) whose first returned record is strict (the 103 / 121 gap).
import glob
import json

ret = {}
loose = set()
for p in sorted(glob.glob(".qa/w/wide-[0-3].json")):
    d = json.load(open(p))
    for k, v in d["returned"].items():
        ret.setdefault(k, v["loose"])
    for row in d["looseList"]:
        loose.add(row["seg"])
print(",".join(k for k in sorted(loose) if not ret[k]))
