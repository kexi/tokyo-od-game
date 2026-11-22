# ruff: noqa: E501 (Japanese prose and one-line report formats)
import sys

root = sys.argv[1]
p = root + "/knowledge/expressway-generation.md"
s = open(p).read()
draft = open(sys.argv[2]).read()
body, foot = draft.split("\n[^r1-1b]:", 1)
foot = "[^r1-1b]:" + foot


def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)


# The section before S7-1.
rep("\n# S7-1 地下のスコアカード", "\n" + body.rstrip() + "\n\n# S7-1 地下のスコアカード")
# Its footnote after R1-1a's.
i = s.index("[^r1-1a]:")
j = s.index("\n", i)
s = s[: j + 1] + foot.rstrip() + "\n" + s[j + 1 :]
# The correction in R1-1a's ends and mouths, kept as written.
rep(
    """- 既定範囲の今の端（45554540 の始まりなど）は、ship の `scope` の端に当たる（S7 まで出ない地下の先）。
""",
    """- 既定範囲の今の端（45554540 の始まりなど）は、ship の `scope` の端に当たる（S7 まで出ない地下の先）。
- **訂正（R1-1b、スコアカード版 9）**: 上の数は N1 の前の数え方（ランプの端を数えず、本線の端の節点に付く子も口に数えた）。版 9 では、R1（G3、pruned・cut・central）が本線の端 51（`scope` 45・`operator` 4・`ref` 2、うち `ground` 6）・ランプの端 8・口 19（`district` 16・`closed` 3）で、壁の立つ端は 52。口の 26 → 19 は、本線の端の節点に付く子を端の行の `beyond` へ移した分（46876435:end・46913090:start・5204787:start・5204789:end など）。ship/all・cut 全部（G5）は本線の端 39・ランプの端 15・口 25 で壁 39。ship/pruned・cut 全部は版 9 で作り直していない。
""",
)
# The frontmatter's trust signals.
rep(
    "verified:\n",
    """verified:
  - { by: process:check-expressway-end-walls-r1-1b, at: 2026-11-18T03:00:00Z }
  - { by: process:check-expressway-ends-r1-1b, at: 2026-11-18T03:10:00Z }
  - { by: process:check-deck-drive-r1-1b, at: DRIVE_AT }
  - { by: process:vitest-r1-1b, at: 2026-11-18T03:20:00Z }
""",
)
open(p, "w").write(s)
