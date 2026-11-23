# ruff: noqa: E501 (Japanese prose and one-line report formats)
# R1-1b's knowledge: the draft (r1b_knowledge_draft.md, commit 1〜4) with the addenda (r1b_knowledge_add.md,
# 追記 1〜5) put into knowledge/expressway-generation.md before "# S7-1", its footnote after R1-1a's, the
# correction of R1-1a's count, and the trust signals.
#   python3 -I r1b_kn_apply2.py <worktree>
import sys

root = sys.argv[1]
tools = root + "/.qa/r1b-tools"
p = root + "/knowledge/expressway-generation.md"
s = open(p).read()
draft = open(tools + "/r1b_knowledge_draft.md").read()
add = open(tools + "/r1b_knowledge_add.md").read()


def rep_in(text, old, new):
    assert text.count(old) == 1, old[:60]
    return text.replace(old, new)


# The draft's drive table and lines were the commit 4 version (ea62e55); say so, and point to the addenda.
draft = rep_in(
    draft,
    "## 走行（`just check-deck-drive`、この PR は既定のデータを :5320・G3 を :5321、main〔分岐元 5d0b7a2〕を :5322、鍵は 1 本ずつ、2026-11-22〜23）",
    "## 走行（commit 4 の版 ea62e55、`just check-deck-drive`、既定のデータを :5320・G3 を :5321、main〔分岐元 5d0b7a2〕を :5322、鍵は 1 本ずつ、2026-11-22〜23。追記 1〜5 の後の走行は下の節）",
)
draft = rep_in(
    draft, "（AFTER_SHIBA）", "原因は壁の天端が出口の路面を 0.457 m 貫いていたこと。追記 1 の後は 6/6 合格（下の節）。"
)
draft = rep_in(draft, "（AFTER_AUTO）", "追記 5 の後は、この PR・main とも 3/3 合格（下の節）。")
body, foot = draft.split("\n[^r1-1b]:", 1)
foot = "[^r1-1b]:" + foot
body = body.rstrip() + "\n\n" + add.rstrip()
s = rep_in(s, "\n# S7-1 地下のスコアカード", "\n" + body + "\n\n# S7-1 地下のスコアカード")
i = s.index("[^r1-1a]:")
j = s.index("\n", i)
s = s[: j + 1] + foot.rstrip() + "\n" + s[j + 1 :]
s = rep_in(
    s,
    """- 既定範囲の今の端（45554540 の始まりなど）は、ship の `scope` の端に当たる（S7 まで出ない地下の先）。
""",
    """- 既定範囲の今の端（45554540 の始まりなど）は、ship の `scope` の端に当たる（S7 まで出ない地下の先）。
- **訂正（R1-1b、スコアカード版 9）**: 上の数は N1 の前の数え方（ランプの端を数えず、本線の端の節点に付く子も口に数えた）。版 9 では、R1（G3、pruned・cut・central）が本線の端 51（`scope` 45・`operator` 4・`ref` 2、うち `ground` 6）・ランプの端 8・口 19（`district` 16・`closed` 3）で、壁の立つ端は 52。口の 26 → 19 は、本線の端の節点に付く子を端の行の `beyond` へ移した分（46876435:end・46913090:start・5204787:start・5204789:end など）。ship/all・cut 全部（G5）は本線の端 39・ランプの端 15・口 25 で壁 39。ship/pruned・cut 全部は版 9 で作り直していない。
""",
)
s = rep_in(
    s,
    "verified:\n",
    """verified:
  - { by: process:check-deck-drive-r1-1b-add5, at: 2026-11-23T03:25:00Z }
  - { by: process:check-expressway-end-walls-r1-1b-add5, at: 2026-11-23T02:40:00Z }
  - { by: process:vitest-r1-1b-add5, at: 2026-11-23T02:45:00Z }
  - { by: process:check-expressway-end-walls-r1-1b, at: 2026-11-18T03:00:00Z }
  - { by: process:check-expressway-ends-r1-1b, at: 2026-11-18T03:10:00Z }
  - { by: process:check-deck-drive-r1-1b, at: 2026-11-23T01:10:00Z }
  - { by: process:vitest-r1-1b, at: 2026-11-18T03:20:00Z }
""",
)
open(p, "w").write(s)
