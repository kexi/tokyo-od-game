import { facesOf, type Registry } from "./registry";
import type { LawTable, SignGroup } from "./schema";

/**
 * How far the sign definitions get: which 別表第一 numbers have a definition, which are drawn, and
 * which drawn ones the game places (`game.kind`, or a 補助標識 it hangs under its plates: registry
 * `aux`). `just show-sign-coverage` prints it; the
 * not-placed list is meant to shrink as placement rules are added, so nothing fails on it.
 */
export type SignCoverage = {
  total: number;
  drawn: number;
  placed: number;
  /** No art (案内, and anything else without a texture), with the reason given. */
  undrawn: Array<{ id: string; group: SignGroup; reason: string }>;
  /** Drawn, but no game sign type uses it yet. */
  unplaced: Array<{ id: string; group: SignGroup; name: string }>;
  /** 別表第一 numbers with no definition, and definitions that are not in 別表第一 (法定外 aside). */
  missingFromDefs: string[];
  notInLaw: string[];
};

export function signCoverage(reg: Registry, law: LawTable): SignCoverage {
  const lawIds = new Set(law.signs.map((r) => r.id));
  const defIds = new Set(reg.signs.map((s) => s.id));
  const undrawn: SignCoverage["undrawn"] = [];
  const unplaced: SignCoverage["unplaced"] = [];
  const hung = new Set(reg.aux.map((a) => a.sign));
  let drawn = 0;
  let placed = 0;
  for (const s of reg.signs) {
    const isDrawn = facesOf(reg, s.id).length > 0;
    if (!isDrawn) {
      const reason = s.art?.by === "none" ? s.art.reason : "図柄が無い";
      undrawn.push({ id: s.id, group: s.group, reason });
      continue;
    }
    drawn += 1;
    const isPlaced = s.game !== undefined || hung.has(s.id);
    if (!isPlaced) {
      unplaced.push({ id: s.id, group: s.group, name: s.name });
      continue;
    }
    placed += 1;
  }
  return {
    total: reg.signs.length,
    drawn,
    placed,
    undrawn,
    unplaced,
    missingFromDefs: law.signs.map((r) => r.id).filter((id) => !defIds.has(id)),
    notInLaw: reg.signs.filter((s) => s.group !== "法定外" && !lawIds.has(s.id)).map((s) => s.id),
  };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const list = out.get(key(item)) ?? [];
    list.push(item);
    out.set(key(item), list);
  }
  return out;
}

/** The report as text: totals, then the lists by group (undrawn ones with one line per reason). */
export function formatCoverage(c: SignCoverage): string {
  const lines = [
    `定義 ${c.total} 件（図柄あり ${c.drawn}、ゲームが配置 ${c.placed}、図柄あり・未配置 ${c.unplaced.length}、未描画 ${c.undrawn.length}）`,
  ];
  lines.push("", `図柄あり・未配置 ${c.unplaced.length}`);
  for (const [g, items] of groupBy(c.unplaced, (u) => u.group))
    lines.push(`  ${g} ${items.length}: ${items.map((i) => `${i.id} ${i.name}`).join("、")}`);
  lines.push("", `未描画 ${c.undrawn.length}`);
  for (const [reason, items] of groupBy(c.undrawn, (u) => u.reason))
    lines.push(`  ${items.length} 件: ${reason}`, `    ${items.map((u) => u.id).join(" ")}`);
  const hasGaps = c.missingFromDefs.length + c.notInLaw.length > 0;
  if (hasGaps)
    lines.push(
      "",
      `別表第一にあって定義が無い: ${c.missingFromDefs.join(" ") || "なし"}`,
      `定義にあって別表第一に無い: ${c.notInLaw.join(" ") || "なし"}`,
    );
  return `${lines.join("\n")}\n`;
}
