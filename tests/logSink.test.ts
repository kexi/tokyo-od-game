import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformWithOxc } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkSinkRequest,
  LogFiles,
  logSinkMiddleware,
  mapFrames,
  parseBatch,
  SINK_LIMITS,
  type SinkRequest,
} from "../scripts/logSink";
import { decodeSegment, originalPosition } from "../scripts/sourceMap";

const TRACE = "0f8a2c1e-aaaa-bbbb-cccc-000000000001";
const line = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    ts: "2026-10-05T04:00:00.000Z",
    level: "info",
    event: "game_started",
    traceId: TRACE,
    build: "d727db1@0.1.0",
    ...fields,
  });

const local = (over: Partial<SinkRequest> = {}, headers: SinkRequest["headers"] = {}): SinkRequest => ({
  method: "POST",
  remoteAddress: "127.0.0.1",
  ...over,
  headers: { host: "localhost:5173", "content-type": "text/plain;charset=UTF-8", ...headers },
});

describe("which requests the dev log sink takes (scripts/logSink.ts)", () => {
  it("takes the page's own batches from this machine", () => {
    expect(
      checkSinkRequest(
        local({}, { origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }),
        "post",
      ),
    ).toEqual({
      ok: true,
    });
    expect(checkSinkRequest(local({ remoteAddress: "::1" }, { host: "[::1]:5173" }), "post").ok).toBe(true);
    expect(checkSinkRequest(local({ method: "GET" }), "get").ok).toBe(true);
  });

  it("refuses other machines, other host names, other origins and sites", () => {
    expect(checkSinkRequest(local({ remoteAddress: "192.168.1.20" }), "post")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkSinkRequest(local({ remoteAddress: undefined }), "post")).toMatchObject({
      ok: false,
      status: 403,
    });
    // DNS rebinding: a name that resolves to 127.0.0.1 is still not localhost.
    expect(checkSinkRequest(local({}, { host: "evil.example:5173" }), "post")).toMatchObject({ status: 403 });
    expect(checkSinkRequest(local({}, { origin: "http://evil.example" }), "post")).toMatchObject({
      status: 403,
    });
    expect(checkSinkRequest(local({}, { "sec-fetch-site": "cross-site" }), "post")).toMatchObject({
      status: 403,
    });
  });

  it("takes only POSTed text within the size bound", () => {
    expect(checkSinkRequest(local({ method: "PUT" }), "post")).toMatchObject({ status: 405 });
    expect(checkSinkRequest(local({}, { "content-type": "multipart/form-data" }), "post")).toMatchObject({
      status: 415,
    });
    const big = String(SINK_LIMITS.bodyBytes + 1);
    expect(checkSinkRequest(local({}, { "content-length": big }), "post")).toMatchObject({ status: 413 });
  });

  it("writes only log lines with an id for a traceId, at most the bound per batch", () => {
    const body = [
      line(),
      "not json",
      JSON.stringify({ hello: "world" }),
      line({ traceId: "../../etc/passwd" }),
      line({ level: "fatal" }),
      "",
      line({ event: "accident", kind: "car", speedKmh: 30 }),
    ].join("\n");
    const { entries, rejected } = parseBatch(body);
    expect(entries.map((e) => e.entry.event)).toEqual(["game_started", "accident"]);
    expect(rejected).toBe(4);
    const many = Array.from({ length: 5 }, () => line()).join("\n");
    expect(parseBatch(many, { ...SINK_LIMITS, lines: 3 })).toMatchObject({ rejected: 2 });
    expect(parseBatch(line({ pad: "x".repeat(200) }), { ...SINK_LIMITS, lineBytes: 100 })).toMatchObject({
      rejected: 1,
    });
  });
});

describe("the session files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tod-logs-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends each session to <day>/<traceId>.jsonl and points latest.jsonl at the newest session", () => {
    const files = new LogFiles(dir);
    files.write(parseBatch([line(), line({ event: "title_reload" })].join("\n")).entries);
    const other = "0f8a2c1e-aaaa-bbbb-cccc-000000000002";
    files.write(parseBatch(line({ traceId: other })).entries);
    files.write(parseBatch(line()).entries);
    const first = join(dir, "2026-10-05", `${TRACE}.jsonl`);
    expect(readFileSync(first, "utf8").trim().split("\n")).toHaveLength(3);
    // The second session started last: latest stays on it when the first writes again.
    expect(readlinkSync(files.latest)).toBe(join("2026-10-05", `${other}.jsonl`));
  });

  it("stops a session's file at its size bound and says how many lines it dropped", () => {
    const files = new LogFiles(dir, { ...SINK_LIMITS, fileBytes: line().length * 2 + 2 });
    const result = files.write(parseBatch([line(), line(), line()].join("\n")).entries);
    expect(result).toEqual({ written: 2, dropped: 1 });
  });
});

describe("the middleware over HTTP", () => {
  let dir: string;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "tod-logs-"));
    const handle = logSinkMiddleware({ root: dir, dir, build: () => "abc1234+00ff00@0.1.0" });
    server = createServer((req, res) =>
      handle(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
    );
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tokyo-od-game/`;
  });
  afterEach(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a batch and answers what it kept, and gives the build label", async () => {
    const res = await fetch(`${base}__log`, {
      method: "POST",
      body: [line(), "junk"].join("\n"),
      headers: { "content-type": "text/plain" },
    });
    expect(await res.json()).toEqual({ written: 1, dropped: 0, rejected: 1 });
    expect(existsSync(join(dir, "2026-10-05", `${TRACE}.jsonl`))).toBe(true);
    const build = await fetch(`${base}__log/build`);
    expect(await build.json()).toEqual({ build: "abc1234+00ff00@0.1.0" });
    const other = await fetch(`${base}index.html`);
    expect(other.status).toBe(404);
  });

  it("refuses a body over the bound even without a content-length", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(SINK_LIMITS.bodyBytes + 10)));
        c.close();
      },
    });
    const res = await fetch(`${base}__log`, {
      method: "POST",
      body,
      headers: { "content-type": "text/plain" },
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });
});

describe("source-mapped frames (scripts/sourceMap.ts)", () => {
  it("decodes base64 VLQ segments", () => {
    expect(decodeSegment("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeSegment("AAgBC")).toEqual([0, 0, 16, 1]);
    expect(decodeSegment("D")).toEqual([-1]);
  });

  it("finds the TypeScript line of a line in the code the dev server serves", async () => {
    const source = [
      "type Shape = { kind: string };",
      "",
      "export function area(s: Shape): number {",
      "  const w: number = 2;",
      '  throw new Error("boom " + s.kind + w);',
      "}",
    ].join("\n");
    const out = await transformWithOxc(source, "/project/src/area.ts", { sourcemap: true });
    const code = out.code.split("\n");
    const at = code.findIndex((l) => l.includes("throw new Error"));
    const map = out.map as unknown as { mappings: string; sources: string[] };
    const col = code[at].indexOf("throw");
    expect(originalPosition(map, at, col)).toMatchObject({ line: 4, column: 2 });
    const entry = {
      event: "uncaught_error",
      frames: [{ file: "/tokyo-od-game/src/area.ts", line: at + 1, column: col + 1 }],
    };
    const isMapped = await mapFrames(entry, async () => ({ map, file: "/project/src/area.ts" }), "/project");
    expect(isMapped).toBe(true);
    expect(entry.frames[0]).toMatchObject({ original: "src/area.ts:5:3" });
  });
});
