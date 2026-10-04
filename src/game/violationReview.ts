import type { ViolationRecord } from "./traffic";

/**
 * 違反の振り返り: every booked violation with the screen at that moment, when and where it
 * happened, the speed against the limit, what went wrong, and the article, points and fine — so
 * the player can see what the law asked of them, not just the total.
 */
export function renderReview(list: HTMLElement, log: readonly ViolationRecord[]): void {
  if (log.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sub";
    empty.textContent = "違反の記録はありません。法令を守った運転ができています。";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...log.map((v, i) => {
      const item = document.createElement("article");
      item.className = "violation";
      const shot = document.createElement("div");
      shot.className = "violation-shot";
      if (v.context?.snapshot) {
        const img = document.createElement("img");
        img.src = v.context.snapshot;
        img.alt = `${v.label}の瞬間の画面`;
        shot.append(img);
      } else shot.textContent = "画面なし";
      const body = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${i + 1}. ${v.label}`;
      const article = document.createElement("div");
      article.className = "sub";
      const fine = v.fine === null ? "罰金（刑事手続）" : `反則金 ${v.fine.toLocaleString()} 円`;
      article.textContent = `${v.article}・違反点数 ${v.points} 点・${fine}`;
      const facts = document.createElement("dl");
      const c = v.context;
      const rows: Array<[string, string]> = c
        ? [
            ["日時", c.clock],
            ["場所", c.place],
            [
              "速度",
              `${Math.round(c.kmh)} km/h` +
                (c.limit !== null
                  ? `（${c.limitKind === "sign" ? "規制速度" : "法定速度"} ${c.limit} km/h）`
                  : ""),
            ],
            ...(c.detail ? ([["内容", c.detail]] as Array<[string, string]>) : []),
          ]
        : [];
      for (const [k, val] of rows) {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = val;
        facts.append(dt, dd);
      }
      body.append(title, article, facts);
      item.append(shot, body);
      return item;
    }),
  );
}
