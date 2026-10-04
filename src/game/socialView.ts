import { formatCount, type SocialFeed, type SocialPost } from "./social";

/**
 * つぶやき on the phone: the feed of posts about the player's driving, newest first, each with
 * its still, counts (返信・リポスト・引用・いいね・表示) and the replies under it.
 */
export function renderFeed(el: HTMLElement, feed: SocialFeed, onOpen: (p: SocialPost) => void): void {
  if (feed.posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sub";
    empty.textContent = "あなたの運転についての投稿はまだありません。";
    el.replaceChildren(empty);
    return;
  }
  el.replaceChildren(
    ...feed.posts.map((p) => {
      const card = postCard(p, false);
      card.addEventListener("click", () => onOpen(p));
      return card;
    }),
  );
}

export function renderPost(el: HTMLElement, p: SocialPost): void {
  const replies = document.createElement("div");
  replies.className = "social-replies";
  const section = (title: string, items: SocialPost["replies"]) => {
    if (!items.length) return [];
    const h = document.createElement("h4");
    h.textContent = title;
    return [h, ...items.map((r) => line(r.author, r.handle, r.text, `${r.atMinute}分`))];
  };
  replies.append(...section("引用", p.quotePosts), ...section("返信", p.replies));
  el.replaceChildren(postCard(p, true), replies);
}

function postCard(p: SocialPost, isOpen: boolean): HTMLElement {
  const card = document.createElement("article");
  card.className = `social-post${isOpen ? " open" : ""}`;
  card.append(line(p.author, p.handle, `${p.text} ${p.tags.join(" ")}`, ""));
  if (p.image) {
    const img = document.createElement("img");
    img.src = p.image;
    img.alt = "投稿された動画の一場面";
    card.append(img);
  }
  const counts = document.createElement("div");
  counts.className = "social-counts";
  for (const [label, n] of [
    ["返信", p.replies.length + Math.round(p.reposts * 0.2)],
    ["リポスト", p.reposts],
    ["引用", p.quotes],
    ["いいね", p.likes],
    ["表示", p.views],
  ] as const) {
    const s = document.createElement("span");
    s.textContent = `${label} ${formatCount(n)}`;
    counts.append(s);
  }
  card.append(counts);
  if (p.isReported) {
    const note = document.createElement("p");
    note.className = "social-reported";
    note.textContent = "この動画は警察にも情報提供されました";
    card.append(note);
  }
  return card;
}

function line(author: string, handle: string, text: string, when: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "social-line";
  const who = document.createElement("div");
  who.className = "social-who";
  who.textContent = `${author} @${handle}${when ? ` · ${when}` : ""}`;
  const body = document.createElement("p");
  body.textContent = text;
  row.append(who, body);
  return row;
}
