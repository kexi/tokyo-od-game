// Minimal RFC 4180 CSV parser + Japanese open-data decoding helpers (no dependency needed).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Tokyo datasets mix UTF-8 (with/without BOM), Shift_JIS (CP932) and UTF-16. */
export function decodeJapanese(bytes: Uint8Array): string {
  const isUtf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (isUtf16le) return new TextDecoder("utf-16le").decode(bytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const hasBom = text.charCodeAt(0) === 0xfeff;
    return hasBom ? text.slice(1) : text;
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

export const WARD_NAMES = [
  "千代田区",
  "中央区",
  "港区",
  "新宿区",
  "文京区",
  "台東区",
  "墨田区",
  "江東区",
  "品川区",
  "目黒区",
  "大田区",
  "世田谷区",
  "渋谷区",
  "中野区",
  "杉並区",
  "豊島区",
  "北区",
  "荒川区",
  "板橋区",
  "練馬区",
  "足立区",
  "葛飾区",
  "江戸川区",
] as const;

/** Ward from a local-government code (e.g. 131041 / 13104) or null. */
export function wardFromCode(code: string): string | null {
  const m = code.trim().match(/^131(\d{2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 23 ? WARD_NAMES[n - 1] : null;
}

/**
 * Ward named in an address. "北区" is a suffix of other names (e.g. none in 23-ku today, but
 * "東京都北区" must not match "台東区北上野"), so require the ward to follow 東京都 or start the string.
 */
export function wardFromAddress(address: string): string | null {
  const a = address.replace(/\s/g, "").replace(/^東京都/, "");
  const sorted = [...WARD_NAMES].sort((x, y) => y.length - x.length);
  return sorted.find((w) => a.startsWith(w)) ?? null;
}

/** Index of the first header matching any candidate (exact, then substring). */
export function findColumn(header: string[], candidates: string[]): number {
  const clean = header.map((h) => h.replace(/\s/g, ""));
  for (const c of candidates) {
    const i = clean.indexOf(c);
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = clean.findIndex((h) => h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

export function toNumber(s: string | undefined): number {
  if (s === undefined) return Number.NaN;
  const half = s.replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  return half === "" ? Number.NaN : Number(half);
}
