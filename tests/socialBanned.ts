/**
 * Words Y must never write: real services, brands, operators and politics (the app is 「Y」 and
 * everything in it is generic). Shared by the tests of the Japanese texts (socialTexts.test.ts)
 * and of their translations (socialI18n.test.ts).
 */
export const BANNED: readonly RegExp[] = [
  /(^|[^A-Za-z])X([^A-Za-z]|$)/,
  /Twitter|ツイッター|ツイート|tweet|リツイート/i,
  /Instagram|インスタ|Facebook|TikTok|YouTube|ユーチューブ|(^|[^A-Za-z])LINE([^A-Za-z]|$)/,
  /セブン|ローソン|ファミマ|ファミリーマート|スタバ|スターバックス|マクドナルド|マック|ドトール|タリーズ|ユニクロ/,
  /トヨタ|ホンダ|日産|スバル|マツダ|レクサス|テスラ|Uber|ウーバー|出前館|アマゾン|Amazon|Google|グーグル|iPhone/,
  /NHK|JR|都営|都バス|東京メトロ|京急|東急|小田急|京王|西武|Suica|PASMO|ヤマト|佐川|ディズニー|ポケモン/,
  /選挙|政党|総理|首相|議員/,
];

/** The same, as English and Chinese write those names (for the translations). */
export const BANNED_ABROAD: readonly RegExp[] = [
  /Seven-Eleven|7-Eleven|Lawson|FamilyMart|Starbucks|McDonald|Doutor|Tully|Uniqlo/i,
  /Toyota|Honda|Nissan|Subaru|Mazda|Lexus|Tesla|Disney|Pok[eé]mon|Yamato|Sagawa|Tokyo Metro\b|Keikyu|Tokyu|Odakyu|Keio|Seibu/i,
  /election|political party|prime minister|lawmaker/i,
  /推特|微博|抖音|微信|脸书|丰田|本田|日产|斯巴鲁|马自达|雷克萨斯|特斯拉|优步|亚马逊|谷歌|苹果手机/,
  /星巴克|麦当劳|罗森|全家便利|7-11|优衣库|迪士尼|宝可梦|选举|政党|首相|总理|议员/,
];
