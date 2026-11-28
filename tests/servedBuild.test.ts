import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logSinkMiddleware } from "../scripts/logSink";
import { servedBuild, servedRecord, warnIfNotSame } from "../scripts/qa/servedBuild";

// The served tree's label, as the QA reports keep it: read from the server's own __log/build, and
// null (not a guess) when the server refuses, answers something else, is too slow or is not there.
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  vi.restoreAllMocks();
});
const listen = (handler: RequestListener) =>
  new Promise<string>((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/tokyo-od-game/`);
    });
  });
/** A server whose __log/build answers `status` with `body`. */
const serve = (status: number, body: string) =>
  listen((req, res) => {
    const isBuild = req.url === "/tokyo-od-game/__log/build";
    res.writeHead(isBuild ? status : 404, { "content-type": "application/json" });
    res.end(isBuild ? body : "{}");
  });
const LABEL = JSON.stringify({ build: "d467391+1a2b3c@0.1.0" });

describe("the served tree's build label (scripts/qa/servedBuild.ts)", () => {
  it("reads the label the server answers at <base>__log/build", async () => {
    expect(await servedBuild(await serve(200, LABEL))).toBe("d467391+1a2b3c@0.1.0");
  });

  it("gives null for a refusal or an error even when the body carries a label", async () => {
    expect(await servedBuild(await serve(403, LABEL))).toBeNull();
    expect(await servedBuild(await serve(500, LABEL))).toBeNull();
  });

  it("gives null for a body without a label, and for no server", async () => {
    expect(await servedBuild(await serve(200, JSON.stringify({ other: 1 })))).toBeNull();
    expect(await servedBuild("http://127.0.0.1:9/tokyo-od-game/")).toBeNull();
  });

  it("gives up on a server that does not answer within the timeout", async () => {
    const base = await listen(() => undefined);
    const t0 = performance.now();
    expect(await servedBuild(base, 200)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("reads the label through the dev server's own sink (its rules on Host and Origin)", async () => {
    const sink = logSinkMiddleware({ root: process.cwd(), build: () => "abc1234@0.1.0" });
    const base = await listen((req, res) => sink(req, res, () => res.writeHead(404).end()));
    expect(await servedBuild(base)).toBe("abc1234@0.1.0");
    expect(await servedBuild(base.replace("127.0.0.1", "localhost"))).toBe("abc1234@0.1.0");
  });

  it("calls a run the same tree only when both ends answered the same label", () => {
    expect(servedRecord("a@1", "a@1").isSame).toBe(true);
    expect(servedRecord("a@1", "a+f@1").isSame).toBe(false);
    expect(servedRecord("a@1", null).isSame).toBe(false);
    expect(servedRecord(null, null).isSame).toBe(false);
  });

  it("warns on stderr only when the ends are not the same tree", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    warnIfNotSame(servedRecord("a@1", "a@1"), "r.json");
    expect(write).not.toHaveBeenCalled();
    warnIfNotSame(servedRecord("a@1", "b@1"), "r.json");
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      warning: "served_build_not_same",
      report: "r.json",
    });
  });
});
