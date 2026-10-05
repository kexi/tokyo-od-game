import { t, type MessageKey } from "../i18n";
import { formatNumber } from "../i18n/format";
import { lawRef, pointsText, recordClock, recordPlace, violationDetail, violationName } from "../i18n/law";
import { keysWithPrefix, retranslate } from "../i18n/reverse";
import type { Detector, ViolationRecord } from "./traffic";

/** Who caught it, as the status line names them. */
const CAUGHT_BY: Record<Detector, MessageKey> = {
  patrol: "review.by.patrol",
  officer: "review.by.officer",
  orbis: "review.by.orbis",
  orbisPortable: "review.by.orbisPortable",
  accident: "review.by.accident",
  parking: "review.by.parking",
  sns: "review.by.sns",
};

/** The speed against the limit in force: 規制速度 (posted) or 法定速度 (statutory), when known. */
function speedText(kmh: number, limit: number | null, limitKind: string | null): string {
  const speed = Math.round(kmh);
  if (limit === null) return t("review.kmh", { kmh: speed });
  const key: MessageKey = limitKind === "sign" ? "review.kmhSign" : "review.kmhStatutory";
  return t(key, { kmh: speed, limit });
}

function statusText(v: ViolationRecord): string {
  if (v.status === "caught") return t("review.caught", { by: t(CAUGHT_BY[v.by ?? "accident"]) });
  if (v.status === "notice") return t("review.notice");
  return t("review.uncaught");
}

/**
 * 違反の振り返り: every booked violation with the screen at that moment, when and where it
 * happened, the speed against the limit, what went wrong, and the article, points and fine — so
 * the player can see what the law asked of them, not just the total. The records stay Japanese;
 * each line is translated as it is drawn.
 */
export function renderReview(
  list: HTMLElement,
  log: readonly ViolationRecord[],
  onReplay?: (r: ViolationRecord) => boolean,
): void {
  if (log.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sub";
    empty.textContent = t("review.empty");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...log.map((v, i) => {
      const name = violationName(v.label);
      const item = document.createElement("article");
      item.className = "violation";
      const shot = document.createElement("div");
      shot.className = "violation-shot";
      if (v.context?.snapshot) {
        const img = document.createElement("img");
        img.src = v.context.snapshot;
        img.alt = t("review.shotAlt", { label: name });
        shot.append(img);
      } else shot.textContent = t("review.noShot");
      const body = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${i + 1}. ${name}`;
      const article = document.createElement("div");
      article.className = "sub";
      article.textContent = t("review.articleLine", {
        article: lawRef(v.article),
        points: pointsText(v.points),
        // 「反則金 0 円」 as the list always said for a points-only violation (not 「反則金なし」).
        fine: v.fine === null ? t("fine.criminal") : t("fine.amount", { n: formatNumber(v.fine) }),
      });
      const facts = document.createElement("dl");
      const c = v.context;
      const rows: Array<[string, string]> = c
        ? [
            [t("review.when"), recordClock(c.clock)],
            [t("review.where"), recordPlace(c.place)],
            [t("review.speed"), speedText(c.kmh, c.limit, c.limitKind)],
            ...(c.detail ? ([[t("review.what"), violationDetail(c.detail)]] as Array<[string, string]>) : []),
          ]
        : [];
      // Why it left the 反則金 procedure (fled, no licence) or whose points it is counted in.
      if (v.procedure)
        rows.push([t("review.procedure"), retranslate(v.procedure, keysWithPrefix("procedure."))]);
      for (const [k, val] of rows) {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = val;
        facts.append(dt, dd);
      }
      body.append(title, article, facts);
      const status = document.createElement("p");
      status.className = "sub";
      status.textContent = statusText(v);
      body.append(status);
      if (onReplay) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = t("review.replay");
        b.addEventListener("click", () => {
          if (!onReplay(v)) b.textContent = t("review.replayGone");
        });
        body.append(b);
      }
      item.append(shot, body);
      return item;
    }),
  );
}
