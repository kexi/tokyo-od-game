/**
 * The 23 special wards' English names, as the wards write themselves and the guide signs print
 * them ("Chiyoda City": 区 is "City" in English, guidePlan.ts signEnglish). For speech in English:
 * an English voice cannot read the kanji of the e-Stat names, which the screen keeps as they are.
 * Town names (丸の内二丁目) have no such data and are not spoken in English.
 */
const WARD_EN: Readonly<Record<string, string>> = {
  千代田区: "Chiyoda",
  中央区: "Chuo",
  港区: "Minato",
  新宿区: "Shinjuku",
  文京区: "Bunkyo",
  台東区: "Taito",
  墨田区: "Sumida",
  江東区: "Koto",
  品川区: "Shinagawa",
  目黒区: "Meguro",
  大田区: "Ota",
  世田谷区: "Setagaya",
  渋谷区: "Shibuya",
  中野区: "Nakano",
  杉並区: "Suginami",
  豊島区: "Toshima",
  北区: "Kita",
  荒川区: "Arakawa",
  板橋区: "Itabashi",
  練馬区: "Nerima",
  足立区: "Adachi",
  葛飾区: "Katsushika",
  江戸川区: "Edogawa",
};

/** 千代田区 → "Chiyoda City"; null outside the 23 wards (or for an unknown name). */
export function wardInEnglish(ward: string): string | null {
  const name = WARD_EN[ward.trim()];
  return name ? `${name} City` : null;
}
