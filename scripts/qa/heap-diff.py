# /// script
# requires-python = ">=3.11"
# ///
"""What two V8 heap snapshots of one page differ by (M1): the objects in the later one that the
earlier one did not have, by constructor (count and self size, top 20), the largest array buffers,
and for the top 5 constructors the first three steps of what retains a few of them.

Not yet checked on a real snapshot: the game's heap snapshots (465 MB of heap) did not arrive in
20 minutes (knowledge/memory-growth.md), so this has only been run on nothing larger than a test.

How: a node id stays the same for one object across snapshots of one page, so "new" is "id not in
the first". Why self size and not retained size: retained size needs the dominator tree of a
multi-GB graph; the self sizes of the new objects add up to the growth, and the retainer steps say
who owns them.

    python3 scripts/qa/heap-diff.py A.heapsnapshot B.heapsnapshot [--json OUT]
"""

import json
import sys
from collections import defaultdict


def load(path):
    with open(path) as f:
        snap = json.load(f)
    meta = snap["snapshot"]["meta"]
    return {
        "nf": meta["node_fields"],
        "nt": meta["node_types"][0],
        "ef": meta["edge_fields"],
        "et": meta["edge_types"][0],
        "nodes": snap["nodes"],
        "edges": snap["edges"],
        "strings": snap["strings"],
    }


def ids_of(s):
    n = len(s["nf"])
    i = s["nf"].index("id")
    return {s["nodes"][k + i] for k in range(0, len(s["nodes"]), n)}


def main():
    args = sys.argv[1:]
    out_json = None
    if "--json" in args:
        k = args.index("--json")
        out_json = args[k + 1]
        del args[k : k + 2]
    a_path, b_path = args
    before = ids_of(load(a_path))
    s = load(b_path)
    nf, ef = s["nf"], s["ef"]
    nn, en = len(nf), len(ef)
    f_type, f_name, f_id, f_size, f_edges = (nf.index(x) for x in ("type", "name", "id", "self_size", "edge_count"))
    e_type, e_name, e_to = (ef.index(x) for x in ("type", "name_or_index", "to_node"))
    nodes, edges, strings, ntypes, etypes = s["nodes"], s["edges"], s["strings"], s["nt"], s["et"]
    count = len(nodes) // nn

    def label(i):
        base = i * nn
        return f"{ntypes[nodes[base + f_type]]}:{strings[nodes[base + f_name]][:80]}"

    groups = defaultdict(lambda: [0, 0, []])
    buffers = []
    for i in range(count):
        base = i * nn
        is_new = nodes[base + f_id] not in before
        if not is_new:
            continue
        g = groups[label(i)]
        g[0] += 1
        g[1] += nodes[base + f_size]
        if len(g[2]) < 50:
            g[2].append(i)
        name = strings[nodes[base + f_name]]
        is_buffer = "ArrayBuffer" in name or name == "system / JSArrayBufferData"
        if is_buffer:
            buffers.append((nodes[base + f_size], i))

    # Reverse edges of the later snapshot: for each node, who points at it (and by which edge).
    retainers = defaultdict(list)
    e = 0
    for i in range(count):
        for _ in range(nodes[i * nn + f_edges]):
            to = edges[e + e_to] // nn
            kind = etypes[edges[e + e_type]]
            is_kept = kind not in ("weak", "shortcut")
            if is_kept:
                ref = edges[e + e_name]
                name = strings[ref] if kind not in ("element", "hidden") else f"[{ref}]"
                retainers[to].append((i, f"{kind}:{name}"[:60]))
            e += en

    def path(i, depth=3):
        steps = []
        for _ in range(depth):
            rs = [r for r in retainers.get(i, []) if not label(r[0]).startswith("synthetic")]
            if not rs:
                break
            parent, edge = rs[0]
            steps.append(f"{edge} <- {label(parent)}")
            i = parent
        return steps

    top = sorted(groups.items(), key=lambda kv: -kv[1][1])[:20]
    total = sum(g[1] for g in groups.values())
    result = {
        "newMB": round(total / 1e6, 1),
        "top": [{"what": k, "count": g[0], "MB": round(g[1] / 1e6, 2)} for k, g in top],
        "retainers": {
            k: [path(i) for i in sorted(g[2], key=lambda i: -nodes[i * nn + f_size])[:3]] for k, g in top[:5]
        },
        "buffers": [{"MB": round(sz / 1e6, 2), "retainers": path(i)} for sz, i in sorted(buffers, reverse=True)[:10]],
    }
    print(json.dumps(result, ensure_ascii=False, indent=1))
    if out_json:
        with open(out_json, "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
