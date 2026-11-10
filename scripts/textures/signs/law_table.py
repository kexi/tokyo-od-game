"""別表第一 of 道路標識、区画線及び道路標示に関する命令, one row per 番号 (ranges such as
「３１１―Ａ～Ｆ」 expanded), with the 別表第二 figure of each.

Read from assets/signs/law-table.json, which scripts/sign-law-table.ts writes from the e-Gov 法令 API
v2 at a pinned revision (`just fetch-sign-law-table`). The rows used to be written out here; they
moved to the JSON so that the TypeScript sign definitions and this generator check against the
same list. Ruby readings (勾＜こう＞配, 牽＜けん＞引) are left out of the names.
"""

from __future__ import annotations

import json
from pathlib import Path

_TABLE = json.loads(
    (Path(__file__).resolve().parents[3] / "assets" / "signs" / "law-table.json").read_text(encoding="utf-8")
)

REVISION: str = _TABLE["law"]["revision"]
LAW_URL: str = _TABLE["law"]["url"]
FIGURE_URL: str = _TABLE["law"]["figureUrl"]

# (id, 種類, group, figure file)
SIGNS: list[tuple[str, str, str, str | None]] = [(r["id"], r["name"], r["group"], r["figure"]) for r in _TABLE["signs"]]
