import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The repository's TypeScript sources with comments removed, for the tests that grep the code
 * (tests/log.test.ts: no console.*, tests/roadClass.test.ts: no GSI expressway kind outside
 * roadClass.ts).
 *
 * Comments are found by scanning, not by a regular expression: a pattern like
 * `/\/\*[\s\S]*?\*\//` also matches from a glob inside a string ("assets/**\/*.png") to the next
 * comment's end, and swallows the code in between (src/assetsPage.ts, src/world/signs.ts).
 * Strings and template literals are kept as they are; a `${…}` inside a template is scanned as
 * code. Regular-expression literals are not recognised, which is enough for this repository's
 * sources (none holds an unbalanced quote or a comment marker).
 */
export function stripComments(code: string): string {
  let out = "";
  let i = 0;
  // Brace depth of each open template's `${`: a `}` at that depth resumes the template.
  const templates: number[] = [];
  let depth = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    const isLineComment = c === "/" && next === "/";
    const isBlockComment = c === "/" && next === "*";
    if (isLineComment) {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (isBlockComment) {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      // Keep the line breaks so line numbers stay put.
      out += code.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    const isQuote = c === '"' || c === "'";
    if (isQuote) {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const isTemplateResume = c === "}" && templates.length > 0 && templates[templates.length - 1] === depth;
    if (c === "`" || isTemplateResume) {
      if (isTemplateResume) templates.pop();
      let j = i + 1;
      while (j < n && code[j] !== "`" && !(code[j] === "$" && code[j + 1] === "{"))
        j += code[j] === "\\" ? 2 : 1;
      const opensCode = code[j] === "$";
      if (opensCode) {
        templates.push(depth);
        out += code.slice(i, j + 2);
        i = j + 2;
        continue;
      }
      out += code.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") depth--;
    out += c;
    i++;
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Every .ts under the given top-level directories, as repository-relative path and stripped code. */
export function sourceFiles(...dirs: string[]): Array<{ path: string; code: string }> {
  const root = join(import.meta.dirname, "..");
  return dirs
    .flatMap((d) => sources(join(root, d)))
    .map((p) => ({ path: relative(root, p), code: stripComments(readFileSync(p, "utf8")) }));
}
