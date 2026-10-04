// JARTIC 交通規制情報 (typeD, 拡張版 K 2.1) CSV helpers, shared by the build script and tests.

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Streaming RFC 4180 parser over Shift_JIS bytes: the Tokyo file is ~400 MB, so rows are handed
 * to `onRow` as they complete instead of materialising one huge string.
 */
export function streamCsv(bytes: Uint8Array, onRow: (row: string[]) => void, chunk = 8 * 1024 * 1024): void {
  const decoder = new TextDecoder("shift_jis");
  const CHUNK = chunk;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside quotes; next char decides escape vs close
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const text = decoder.decode(bytes.subarray(off, off + CHUNK), { stream: off + CHUNK < bytes.length });
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') {
          field += '"';
          continue;
        }
        inQuotes = false;
      }
      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        onRow(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    onRow(row);
  }
}

/** JARTIC 「経度 緯度;経度 緯度;…」 → [lon, lat, …], rounded to ~0.1 m. */
export function parseCoords(s: string): number[] {
  const out: number[] = [];
  for (const pair of s.split(";")) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push(round(lon), round(lat));
  }
  return out;
}
