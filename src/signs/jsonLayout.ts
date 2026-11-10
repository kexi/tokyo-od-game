/**
 * JSON laid out the way the repository formatter (oxfmt, printWidth 110) leaves it — objects one key
 * per line, arrays of scalars on one line when they fit — so the generated files pass
 * `just check-format` untouched. A port of scripts/textures/signs/catalog.py `dumps`, which wrote
 * catalog.json until G1a: the two must agree byte for byte (tests/signRegistry.test.ts).
 *
 * Why not JSON.stringify(v, null, 2): it breaks every array onto one line per item, which oxfmt
 * folds back, so the file would never be in its formatted state.
 */

/**
 * A number Python wrote as a float (`1200.0`). catalog.json kept Python's int / float distinction,
 * which a JS number cannot carry; the catalogue wraps the values that were floats in it.
 */
export class PyFloat {
  constructor(readonly value: number) {}
}

/**
 * Python's float repr turns to exponent form at 1e16 and below 1e-4, JS's String at 1e21 and below
 * 1e-6: between those bounds the two disagree, so such a value is refused instead of written wrong.
 */
const printsLikePython = (v: number) => v === 0 || (Math.abs(v) >= 1e-4 && Math.abs(v) < 1e16);

type Scalar = string | number | boolean | null | PyFloat;
/** An object's undefined values are left out (an absent optional field), as JSON.stringify does. */
export type Json = Scalar | Json[] | { [key: string]: Json | undefined };

/** Python counts code points, JS strings count UTF-16 units: width checks use code points. */
const width = (s: string) => [...s].length;

function scalar(v: Scalar): string {
  const n = v instanceof PyFloat ? v.value : v;
  const isNonFinite = typeof n === "number" && !Number.isFinite(n);
  // Why not let JSON.stringify write null: a NaN or Infinity here is a bug upstream, not data.
  if (isNonFinite) throw new Error(`layoutJson: ${String(n)} is not a JSON number`);
  if (v instanceof PyFloat) {
    const isOutOfRange = !printsLikePython(v.value);
    if (isOutOfRange) throw new Error(`layoutJson: ${v.value} would not print as Python prints it`);
    const text = String(v.value);
    const isWhole = Number.isInteger(v.value);
    return isWhole ? `${text}.0` : text;
  }
  return JSON.stringify(v);
}

const isScalar = (v: Json): v is Scalar => v === null || typeof v !== "object" || v instanceof PyFloat;

function layout(v: Json | undefined, indent: number, prefix: number, maxWidth: number): string {
  // Why not write null as JSON.stringify does: an undefined array item is a hole in the data.
  const isHole = v === undefined;
  if (isHole) throw new Error("layoutJson: undefined inside an array");
  if (isScalar(v)) return scalar(v);
  const pad = "  ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const scalars = v.filter((x): x is Scalar => x !== undefined && isScalar(x));
    const isFlat = scalars.length === v.length;
    if (isFlat) {
      const one = `[${scalars.map(scalar).join(", ")}]`;
      const fits = prefix + width(one) + 1 <= maxWidth;
      if (fits) return one;
    }
    const items = v.map((x) => `${pad}  ${layout(x, indent + 1, pad.length + 2, maxWidth)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(v).filter((e): e is [string, Json] => e[1] !== undefined);
  if (entries.length === 0) return "{}";
  const items = entries.map(([k, x]) => {
    const key = JSON.stringify(k);
    return `${pad}  ${key}: ${layout(x, indent + 1, pad.length + 4 + width(key), maxWidth)}`;
  });
  return `{\n${items.join(",\n")}\n${pad}}`;
}

/** The file text: the laid-out value and a final newline. */
export function layoutJson(value: Json, maxWidth = 110): string {
  return `${layout(value, 0, 0, maxWidth)}\n`;
}
