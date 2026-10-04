import type { Source } from "../data/schema";
import type { RegulationMeta } from "../world/regulations";

export const REPO_URL = "https://github.com/kexi/tokyo-od-game";
const CC_BY_DEED = "https://creativecommons.org/licenses/by/4.0/deed.ja";

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

export function renderCredits(sources: Source[], regs: RegulationMeta | null = null): string {
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
  const jarticUrl = regs?.url ?? "https://www.jartic.or.jp/service/opendata/";
  const jarticUse = regs ? `（${jstDate(regs.fetchedAt)}に利用）` : "";
  const jarticEdition = regs ? `${regs.targetMonth}時点のデータ（${regs.releaseDay}公開）` : "";

  return `
  <p>本ゲームは以下のオープンデータ等を利用して開発者が個人で作成した非公式の作品です。東京都・各区・国土交通省・国土地理院・気象庁・日本道路交通情報センター・警察・公共交通事業者が作成・公認したものではありません。</p>

  <h3>スポット・施設情報（東京都オープンデータ）</h3>
  <p>このゲームは、以下の著作物を改変（緯度経度・名称の抽出および形式変換）して利用しています。</p>
  <ul>${opendata || "<li>（データ未生成）</li>"}</ul>

  <h3>3D 都市モデル</h3>
  <p>出典：国土交通省 ${link("https://www.mlit.go.jp/plateau/", "PLATEAUウェブサイト")}「3D都市モデル（Project PLATEAU）東京都」（建築物 LOD1）を加工して作成（外観の窓・色はゲーム側で描画）。
  著作権者：東京都ほか各地方公共団体。利用条件：${link("https://www.mlit.go.jp/plateau/site-policy/", "PLATEAU サイトポリシー")}（公共データ利用規約 第1.0版／CC BY 4.0 互換）。
  データ取得：${link("https://docs.plateauview.mlit.go.jp/", "PLATEAU 配信サービス（試験運用）")}。地面の「PLATEAU オルソ画像 2023」も同サービスから取得しています。</p>

  <h3>地図・空中写真・標高（国土地理院）</h3>
  <p>出典：${link("https://maps.gsi.go.jp/development/ichiran.html", "国土地理院「地理院タイル」")}（全国最新写真（シームレス）、標高タイル）。
  地理院タイル（標高タイル（基盤地図情報数値標高モデル））を加工して地形を作成。
  道路の中心線・幅員：出典 ${link("https://github.com/gsi-cyberjapan/gsimaps-vector-experiment", "国土地理院ベクトルタイル提供実験")}（道路の路面・白線・横断歩道の描画、AI 車両の走行、交通違反の判定に加工して使用）。
  タイルはプレイ中にリアルタイムで読み込んでおり、本ゲームに同梱・再配布していません。</p>

  <h3>交通規制（一方通行・規制速度・横断歩道・停止線・一時停止）</h3>
  <p>出典：「交通規制情報」（公益財団法人日本道路交通情報センター）（${link(jarticUrl, jarticUrl)}）${esc(jarticUse)}を加工して作成。
  ${esc(jarticEdition)}の東京都（警視庁）分から 23 区周辺の一方通行・最高速度（区間・区域）・横断歩道・停止線・一時停止を抽出し、国土地理院の道路中心線に対応付けています。
  期間・曜日指定の規制、首都高速道路（自動車道）の規制、可変速度規制は省略しています。対応付けはゲーム側の推定を含み、実際の規制と異なる場合があります。
  <strong>実際の運転では現地の標識・標示に従ってください。</strong>
  利用条件：${link("https://www.jartic.or.jp/d/opendata/riyou_kiyaku.pdf", "交通規制情報 利用規約")}（CC BY 4.0 互換）。</p>

  <h3>信号機の位置</h3>
  <p>© ${link("https://www.openstreetmap.org/copyright", "OpenStreetMap contributors")}。
  OpenStreetMap の <code>highway=traffic_signals</code> を ${link("https://download.bbbike.org/osm/bbbike/Tokyo/", "BBBike の東京抽出")} から取り出し、交差点に対応付けて表示しています。
  抽出したデータベースは ${link("https://opendatacommons.org/licenses/odbl/1-0/", "Open Database License (ODbL) 1.0")} で提供します（${link(odblUrl, "LICENSE.txt")}）。
  信号の表示サイクル（青・黄・赤の時間と交差点ごとのずれ）はゲーム側の設定で、実際の信号とは異なります。</p>

  <h3>車のモデル</h3>
  <p>本ゲーム用に ${link(`${REPO_URL}/blob/main/scripts/blender/car.py`, "Blender のスクリプト")}で作成しました。ナンバープレート・行灯・灯火などのテクスチャも手続き的に生成しています（${link(`${REPO_URL}/tree/main/assets/car/textures`, "生成方法")}）。文字は Noto Sans JP（${link("https://openfontlicense.org/", "SIL Open Font License 1.1")}）で描画。実在の車種・事業者・登録番号とは関係ありません。</p>

  <h3>町丁・区の境界と人口</h3>
  <p>出典：${link("https://www.e-stat.go.jp/", "政府統計の総合窓口（e-Stat）")}「国勢調査 令和2年 小地域（町丁・字等別）境界データ 東京都」を加工して作成（${link("https://www.e-stat.go.jp/terms-of-use", "利用規約")}：政府標準利用規約 第2.0版準拠）。現在地の区・町丁名の表示、スポットの座標検証、歩行者の人数（人口密度）に使用。</p>

  <h3>ジオイド高</h3>
  <p>EGM2008（U.S. National Geospatial-Intelligence Agency、パブリックドメイン）。${link("https://github.com/OSGeo/PROJ-data", "PROJ-data")} の us_nga_egm08_25.tif から東京付近を抽出し、標高→楕円体高の変換に使用。</p>

  <h3>公共交通（都営バス・都営交通）</h3>
  <p>このゲームは、以下の著作物を改変して利用しています。
  東京都交通局・公共交通オープンデータ協議会、「${link("https://ckan.odpt.org/dataset/b_bus_location-toei", "東京都交通局 バスロケーション情報")}」「${link("https://ckan.odpt.org/dataset/b_busstop-toei", "東京都交通局 バス停情報")}」${odpt}、
  クリエイティブ・コモンズ・ライセンス 表示4.0国際（${link(CC_BY_DEED, CC_BY_DEED)}）。<br>
  本ゲームが利用する公共交通データは、公共交通オープンデータセンターにおいて提供されるものです。
  公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。
  本ゲームの表示内容について、公共交通事業者への直接の問合せは行わないでください。
  本ゲームに関するお問い合わせ：${link(`${REPO_URL}/issues`, "GitHub Issues")}</p>

  <h3>気象</h3>
  <p>出典：${link("https://www.jma.go.jp/bosai/amedas/", "気象庁ホームページ")}のアメダス観測データ（東京）を加工して作成。編集・加工の責任は本ゲーム作者にあります。
  本ゲームの天候表現は気象庁の予報・警報ではありません。</p>

  <h3>交通ルール</h3>
  <p>違反点数・反則金は道路交通法・同施行令と警視庁の公表資料（普通車、2026-10-04 確認）に基づくゲーム内の参考値です。制限速度は JARTIC の規制速度（区間・区域）が対応付いた道路ではその値を、それ以外の道路では施行令第11条（2026-09-01 改正：中央線等のある道路 60km/h、それ以外 30km/h）を道路幅員から推定した値を使います。救急・警察への通報はゲーム内のシミュレーションで、実際の 119・110 にはつながりません。</p>

  <h3>音声合成（sanoTTS-jp）</h3>
  <p>歩行者の声は ${link("https://github.com/ayutaz/sanoTTS-jp", "sanoTTS-jp")}（コード: MIT、モデル: LicenseRef-sanoTTS-jp-Model-1.0）をブラウザ内で動かして合成しています。
  ${link(ttsUrl("LICENSE-MODEL.md"), "モデルライセンス")}・${link(ttsUrl("NOTICE.txt"), "NOTICE")}・${link(ttsUrl("NOTICE-dictionary.txt"), "辞書 NOTICE")}・${link(ttsUrl("NOTICE-openjtalk.txt"), "Open JTalk NOTICE")}・${link(ttsUrl("LICENSE-APACHE-2.0.txt"), "Apache License 2.0 全文")}</p>
  <pre class="notice">${esc(TTS_ATTRIBUTION)}</pre>

  <h3>会話 AI（任意）</h3>
  <p>有効にした場合のみ、Google ${link("https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm", "Gemma 4 E2B")}（Apache License 2.0）を各端末が Hugging Face から直接ダウンロードし、${link("https://github.com/google-ai-edge/LiteRT-LM", "LiteRT-LM")}（Apache License 2.0）で端末内実行します。会話内容は外部に送信されません。AI の発言は不正確な場合があります。</p>

  <h3>利用規約（合成音声の禁止事項）</h3>
  <p>本ゲームが合成した音声を、次の目的で使用することを禁止します（つくよみちゃんコーパスの条件に基づく。${link("https://tyc.rei-yumesaki.net/material/corpus/", "一次ソース")}）。本ゲームには音声を保存・書き出しする機能はありません。</p>
  <ul>
    <li>人を批判・攻撃すること。（「批判・攻撃」の定義は、つくよみちゃんキャラクターライセンスに準じます）</li>
    <li>特定の政治的立場・宗教・思想への賛同または反対を呼びかけること。</li>
    <li>刺激の強い表現をゾーニングなしで公開すること。</li>
    <li>他者に対して二次利用（素材としての利用）を許可する形で公開すること。</li>
  </ul>

  <h3>ソフトウェア</h3>
  <p>three.js (MIT) / 3DTilesRendererJS (Apache License 2.0, Copyright 2020 California Institute of Technology) /
  Rapier (Apache License 2.0, Copyright 2020 Dimforge EURL) / Zod (MIT) / Draco (Apache License 2.0, Google) /
  LiteRT-LM (Apache License 2.0, Google) / sanoTTS-jp (MIT) ほか。
  全文は ${link(licensesUrl, "THIRD_PARTY_LICENSES.txt")} を参照。</p>

  <h3>通信について</h3>
  <p class="sub">プレイ中、ブラウザから国土地理院・PLATEAU 配信サービス・気象庁・公共交通オープンデータセンターへ直接通信します（IP アドレス等が各サービスに送信されます）。進捗はこのブラウザの localStorage にのみ保存します。</p>`;
}
