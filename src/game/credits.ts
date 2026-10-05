import type { Source } from "../data/schema";
import { getLocale, interpolate, t, type MessageKey, type Params } from "../i18n";
import { ja } from "../i18n/ja";
import type { RegulationMeta } from "../world/regulations";

export const REPO_URL = "https://github.com/kexi/tokyo-od-game";
const CC_BY_DEED = "https://creativecommons.org/licenses/by/4.0/deed.ja";
const OFL_URL = "https://openfontlicense.org/";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

// Only http(s) links are rendered as anchors so a malformed source URL cannot inject script.
const link = (url: string, text: string) =>
  /^https?:\/\//.test(url)
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`
    : esc(text);

/** Picks a key's text: the language in force (t) or Japanese (for the wording a provider requires). */
type Words = (key: MessageKey) => string;
const inJa: Words = (key) => ja[key];
/** A dictionary entry as HTML: its text escaped, its slots filled with ready HTML (links, code). */
const html = (words: Words, key: MessageKey, params?: Params) => interpolate(esc(words(key)), params);

/**
 * A credit in the wording its provider asks for: the Japanese as the terms prescribe it, and in
 * English or Chinese its translation after it. `params` gets the same picker, so link texts inside
 * the credit follow (the original's in Japanese, the translation's translated).
 *
 * Why not translate it alone: the terms (東京都オープンデータ利用規約, PLATEAU, 地理院, JARTIC,
 * ODPT, 気象庁, e-Stat, the つくよみちゃん corpus) give their wording in Japanese.
 */
function required(key: MessageKey, params: (words: Words) => Params = () => ({})): string {
  const original = html(inJa, key, params(inJa));
  if (getLocale() === "ja") return original;
  // Each on a line of its own, so the text that follows starts on the next.
  return `<span lang="ja">${original}</span><br><span class="sub">${html(t, key, params(t))}</span><br>`;
}

/** Translated text, as HTML. */
const text = (key: MessageKey, params?: Params) => html(t, key, params);
/** A required credit followed by translated text: run together in Japanese, a space between otherwise. */
const then = (credit: string, rest: string) =>
  getLocale() === "ja" ? `${credit}${rest}` : `${credit} ${rest}`;

/** Bureaus of the metropolitan government are credited as 東京都・<bureau> (利用規約 2(1)イ). */
function holder(publisher: string): string {
  return publisher.startsWith("東京都") && publisher !== "東京都"
    ? `東京都・${publisher.slice(3)}`
    : publisher;
}

/**
 * Attribution in the wording each licensor asks for (terms checked on 2026-10-04):
 * 東京都オープンデータ利用規約 2(1)イ, ODPT FAQ (CC BY credit), PLATEAU site policy / PDL1.0,
 * 地理院タイル利用規約, 気象庁ホームページ利用規約 + 留意事項. Kept in code next to the endpoints
 * so that adding a data source without credit is visible in review.
 */
const ttsUrl = (file: string) => new URL(`${import.meta.env.BASE_URL}tts/${file}`, location.href).href;

/**
 * sanoTTS-jp model licence §3.1 (A), reproduced verbatim. The JSUT lines are omitted because
 * the bundled weights are v4 (`saanotts-jp-v4-int8.bin`), which the licence says do not use JSUT.
 */
const TTS_ATTRIBUTION = `This model was distilled from a piper-plus teacher model.
sanoTTS-jp — https://github.com/ayutaz/sanoTTS-jp

つくよみちゃんコーパス
  本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」
  （© 夢前黎）が無料公開している音声データを使用しています。
  https://tyc.rei-yumesaki.net/material/corpus/

教師 base の学習に使用した音声コーパス
（⚠️ 改変あり: いずれも音声合成モデルの学習に使用しています）:
  - LibriTTS-R (en) — Koizumi et al., 2023 — CC BY 4.0
      素材:       https://www.openslr.org/141/
      ライセンス: https://creativecommons.org/licenses/by/4.0/
  - CML-TTS (es / fr / pt) — freds0 et al. — CC BY 4.0
      素材:       https://github.com/freds0/CML-TTS-Dataset
      ライセンス: https://creativecommons.org/licenses/by/4.0/
  - AISHELL-3 (zh) — Shi et al., 2020 — Apache-2.0
      素材:       https://www.aishelltech.com/aishell_3
      ライセンス: https://www.apache.org/licenses/LICENSE-2.0
  上記 3 素材は現状のまま (AS IS) 提供され、明示・黙示を問わず保証はありません。`;

/** 「2026-10-04T05:16:30Z」 → 「2026年10月4日」 (JST), the 利用日 JARTIC's terms ask for. */
function jstDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/**
 * A Japanese date of the data (「2026年10月4日」, 「2026年08月」) as the language in force writes it:
 * "October 4, 2026" / "2026年10月4日"; as it is when it is not one.
 */
function localDate(jaDate: string): string {
  if (getLocale() === "ja") return jaDate;
  const m = /^(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?$/.exec(jaDate.trim());
  if (!m) return jaDate;
  const [year, month, day] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  const options: Intl.DateTimeFormatOptions =
    day === null
      ? { year: "numeric", month: "long", timeZone: "UTC" }
      : { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
  const tag = getLocale() === "zh" ? "zh-Hans" : "en";
  return new Intl.DateTimeFormat(tag, options).format(Date.UTC(year, month - 1, day ?? 1));
}

/** The database extracted from OpenStreetMap, offered under the ODbL (its LICENSE.txt beside it). */
const odbl = (file: string) =>
  text("credits.odbl", {
    odbl: link(ODBL_URL, "Open Database License (ODbL) 1.0"),
    file: link(file, "LICENSE.txt"),
  });
const osm = () => text("credits.osm", { osm: link(OSM_COPYRIGHT, "OpenStreetMap contributors") });

export function renderCredits(sources: Source[], regs: RegulationMeta | null = null): string {
  // The dataset's title, holder and licence in the form the Tokyo terms ask for, in every language.
  const opendata = sources
    .filter((s) => !s.id.startsWith("odpt"))
    .map(
      (s) =>
        `<li>${link(s.url, s.title)}、${esc(holder(s.publisher))}、${esc(s.license)}（${link(CC_BY_DEED, CC_BY_DEED)}）` +
        (s.note ? `<br><span class="sub">${esc(s.note)}</span>` : "") +
        `</li>`,
    )
    .join("");
  const odpt = sources
    .filter((s) => s.id.startsWith("odpt"))
    .map((s) => `「${link(s.url, s.title)}」`)
    .join("");
  const licensesUrl = new URL(`${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt`, location.href).href;
  const odblUrl = new URL(`${import.meta.env.BASE_URL}data/signals/LICENSE.txt`, location.href).href;
  const routesOdblUrl = new URL(`${import.meta.env.BASE_URL}data/routes/LICENSE.txt`, location.href).href;
  const destOdblUrl = new URL(`${import.meta.env.BASE_URL}data/destinations.LICENSE.txt`, location.href).href;
  const jarticUrl = regs?.url ?? "https://www.jartic.or.jp/service/opendata/";
  const jarticSource = regs
    ? required("credits.jartic.source", (w) => ({
        url: link(jarticUrl, jarticUrl),
        used: esc(w === inJa ? jstDate(regs.fetchedAt) : localDate(jstDate(regs.fetchedAt))),
      }))
    : required("credits.jartic.sourceUndated", () => ({ url: link(jarticUrl, jarticUrl) }));
  const jarticEdition = regs
    ? text("credits.jartic.edition", {
        month: esc(localDate(regs.targetMonth)),
        day: esc(localDate(regs.releaseDay)),
      })
    : text("credits.jartic.editionUnknown");
  const software =
    "three.js (MIT) / 3DTilesRendererJS (Apache License 2.0, Copyright 2020 California Institute of Technology) /\n" +
    "  Rapier (Apache License 2.0, Copyright 2020 Dimforge EURL) / Zod (MIT) / Draco (Apache License 2.0, Google) /\n" +
    "  LiteRT-LM (Apache License 2.0, Google) / sanoTTS-jp (MIT) / sanoTTS Web (GPL-3.0-or-later)";
  const isJapanese = getLocale() === "ja";
  // The licence asks for its notice as written; in English and Chinese, say why it stays Japanese.
  const ttsVerbatim = isJapanese ? "" : `<p class="sub">${text("credits.tts.verbatim")}</p>`;

  return `
  <p>${text("credits.intro")}</p>

  <h3>${text("credits.h.opendata")}</h3>
  <p>${required("credits.opendata.notice")}</p>
  <ul>${opendata || `<li>${text("credits.opendata.none")}</li>`}</ul>

  <h3>${text("credits.h.plateau")}</h3>
  <p>${then(
    required("credits.plateau.source", (w) => ({
      site: link("https://www.mlit.go.jp/plateau/", w("credits.link.plateauSite")),
    })),
    text("credits.plateau.drawn"),
  )}
  ${text("credits.plateau.terms", {
    policy: link("https://www.mlit.go.jp/plateau/site-policy/", t("credits.link.plateauPolicy")),
  })}
  ${text("credits.plateau.fetch", {
    service: link("https://docs.plateauview.mlit.go.jp/", t("credits.link.plateauService")),
  })}</p>

  <h3>${text("credits.h.gsi")}</h3>
  <p>${required("credits.gsi.source", (w) => ({
    tiles: link("https://maps.gsi.go.jp/development/ichiran.html", w("credits.link.gsiTiles")),
  }))}
  ${required("credits.gsi.terrain")}
  ${required("credits.gsi.vector", (w) => ({
    vector: link("https://github.com/gsi-cyberjapan/gsimaps-vector-experiment", w("credits.link.gsiVector")),
  }))}
  ${text("credits.gsi.live")}</p>

  <h3>${text("credits.h.jartic")}</h3>
  <p>${jarticSource}
  ${text("credits.jartic.extract", { edition: jarticEdition })}
  ${text("credits.jartic.omitted")}
  <strong>${text("credits.jartic.real")}</strong>
  ${text("credits.jartic.terms", {
    terms: link("https://www.jartic.or.jp/d/opendata/riyou_kiyaku.pdf", t("credits.link.jarticTerms")),
  })}</p>

  <h3>${text("credits.h.signals")}</h3>
  <p>${osm()}
  ${text("credits.signals.extract", {
    tag: "<code>highway=traffic_signals</code>",
    bbbike: link("https://download.bbbike.org/osm/bbbike/Tokyo/", t("credits.link.bbbike")),
  })}
  ${odbl(odblUrl)}
  ${text("credits.signals.cycle")}</p>

  <h3>${text("credits.h.guide")}</h3>
  <p>${osm()}
  ${text("credits.guide.extract", {
    tag: "<code>destination</code>",
    geofabrik: link("https://download.geofabrik.de/asia/japan/kanto.html", t("credits.link.geofabrik")),
  })}
  ${odbl(routesOdblUrl)}
  ${required("credits.guide.places", (w) => ({
    list: link("https://www.mlit.go.jp/road/sign/sign/annai/6-hyou-timei.htm", w("credits.link.mlitPlaces")),
  }))}
  ${text("credits.guide.style")}
  ${text("credits.guide.estimate")}
  ${text("credits.guide.fonts", { ofl: link(OFL_URL, "SIL Open Font License 1.1") })}</p>

  <h3>${text("credits.h.destinations")}</h3>
  <p>${osm()}
  ${text("credits.destinations.extract", {
    geofabrik: link("https://download.geofabrik.de/asia/japan/kanto.html", t("credits.link.geofabrik")),
  })}
  ${odbl(destOdblUrl)}</p>

  <h3>${text("credits.h.models")}</h3>
  <p>${text("credits.models", {
    blender: link(`${REPO_URL}/tree/main/scripts/blender`, t("credits.link.blender")),
    how: link(`${REPO_URL}/tree/main/assets`, t("credits.link.howMade")),
    ofl: link(OFL_URL, "SIL Open Font License 1.1"),
  })}</p>

  <h3>${text("credits.h.estat")}</h3>
  <p>${then(
    required("credits.estat.source", (w) => ({
      estat: link("https://www.e-stat.go.jp/", w("credits.link.estat")),
      terms: link("https://www.e-stat.go.jp/terms-of-use", w("credits.link.terms")),
    })),
    text("credits.estat.use"),
  )}</p>

  <h3>${text("credits.h.geoid")}</h3>
  <p>${text("credits.geoid", { proj: link("https://github.com/OSGeo/PROJ-data", "PROJ-data") })}</p>

  <h3>${text("credits.h.odpt")}</h3>
  <p>${required("credits.odpt.credit", () => ({
    location: link("https://ckan.odpt.org/dataset/b_bus_location-toei", "東京都交通局 バスロケーション情報"),
    stops: link("https://ckan.odpt.org/dataset/b_busstop-toei", "東京都交通局 バス停情報"),
    more: odpt,
    deed: link(CC_BY_DEED, CC_BY_DEED),
  }))}<br>
  ${required("credits.odpt.disclaimer", () => ({ issues: link(`${REPO_URL}/issues`, "GitHub Issues") }))}</p>

  <h3>${text("credits.h.water")}</h3>
  <p>${then(
    required("credits.water.source", (w) => ({
      system: link("https://www.kasen-suibo.metro.tokyo.lg.jp/", w("credits.link.waterSystem")),
    })),
    text("credits.water.use"),
  )}
  ${then(
    required("credits.tide.source", (w) => ({
      tide: link("https://www.data.jma.go.jp/kaiyou/db/tide/suisan/", w("credits.link.jmaTide")),
    })),
    text("credits.tide.use"),
  )}${isJapanese ? "" : " "}${required("credits.jma.responsibility")}</p>

  <h3>${text("credits.h.weather")}</h3>
  <p>${required("credits.weather.source", (w) => ({
    jma: link("https://www.jma.go.jp/bosai/amedas/", w("credits.link.jma")),
  }))}${isJapanese ? "" : " "}${required("credits.jma.responsibility")}
  ${text("credits.weather.notForecast")}</p>

  <h3>${text("credits.h.rules")}</h3>
  <p>${text("credits.rules")}</p>

  <h3>${text("credits.h.tts")}</h3>
  <p>${text("credits.tts.intro", { sano: link("https://github.com/ayutaz/sanoTTS-jp", "sanoTTS-jp"), sanoOther: link("https://github.com/Ampixa/sanoTTS", "sanoTTS") })}
  ${text("credits.tts.files", {
    model: link(ttsUrl("LICENSE-MODEL.md"), t("credits.link.modelLicense")),
    notice: link(ttsUrl("NOTICE.txt"), "NOTICE"),
    dict: link(ttsUrl("NOTICE-dictionary.txt"), t("credits.link.dictNotice")),
    jtalk: link(ttsUrl("NOTICE-openjtalk.txt"), "Open JTalk NOTICE"),
    apache: link(ttsUrl("LICENSE-APACHE-2.0.txt"), t("credits.link.apacheFull")),
  })}</p>
  <p>${text("credits.tts.multilingualFiles", {
    license: link(
      new URL(`${import.meta.env.BASE_URL}sanotts/LICENSE-GPL-3.0.txt`, location.href).href,
      "GPL-3.0-or-later",
    ),
    source: link(new URL(`${import.meta.env.BASE_URL}sanotts/SOURCE.md`, location.href).href, "Source"),
    dict: link(new URL(`${import.meta.env.BASE_URL}sanotts/NOTICE-G2P.md`, location.href).href, "G2P NOTICE"),
  })}</p>
  ${ttsVerbatim}<pre class="notice">${esc(TTS_ATTRIBUTION)}</pre>

  <h3>${text("credits.h.ai")}</h3>
  <p>${text("credits.ai", {
    gemma: link("https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm", "Gemma 4 E2B"),
    litert: link("https://github.com/google-ai-edge/LiteRT-LM", "LiteRT-LM"),
  })}</p>

  <h3>${text("credits.h.tos")}</h3>
  <p>${text("credits.tos.intro", {
    source: link("https://tyc.rei-yumesaki.net/material/corpus/", t("credits.link.primary")),
  })}</p>
  <ul>
    <li>${required("credits.tos.attack")}</li>
    <li>${required("credits.tos.politics")}</li>
    <li>${required("credits.tos.zoning")}</li>
    <li>${required("credits.tos.reuse")}</li>
  </ul>

  <h3>${text("credits.h.software")}</h3>
  <p>${software} ${text("credits.software.more", { file: link(licensesUrl, "THIRD_PARTY_LICENSES.txt") })}</p>

  <h3>${text("credits.h.network")}</h3>
  <p class="sub">${text("credits.network")}</p>`;
}
