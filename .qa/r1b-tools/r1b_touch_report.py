# ruff: noqa: E501 (Japanese prose and one-line report formats)
import json
import sys

# The probe's walls: road/underside touches (counted), lowered/none widths, and the other touches by kind.
names = sys.argv[1:]
for n in names:
    d = json.load(open(f".qa/expressway/end-walls-{n}.json"))
    print("==", n, d["summary"]["walls"], "walls, poking", d["summary"]["poking"], "lowered", d["summary"]["lowered"])
    for w in d["walls"]:
        counted = [t for t in w["touches"] if t["kind"] in ("road", "underside")]
        listed = [t for t in w["touches"] if t["kind"] not in ("road", "underside")]
        if not (counted or listed or w["loweredM"] or w["noneM"]):
            continue
        print(
            f"  {w['chunk']} {w['end']} poke {w['pokeM']} lowered {w['loweredM']} none {w['noneM']} boxes {w['boxes']}"
        )
        for t in counted:
            print(
                f"    COUNT {t['run']} {t['kind']} u {t['uFrom']}..{t['uTo']} dy {t['dyMin']}..{t['dyMax']} n {t['points']}"
            )
        for t in listed:
            print(
                f"    list  {t['run']} {t['kind']} u {t['uFrom']}..{t['uTo']} dy {t['dyMin']}..{t['dyMax']} n {t['points']}"
            )
