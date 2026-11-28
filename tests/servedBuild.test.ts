import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { servedBuild, servedRecord } from "../scripts/qa/servedBuild";

// The served tree's label, as the QA reports keep it: read from the server's own __log/build, and
// null (not a guess) when the server is not there or answers something else.
let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});
const serve = (status: number, body: string) =>
  new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      const isBuild = req.url === "/tokyo-od-game/__log/build";
      res.writeHead(isBuild ? status : 404, { "content-type": "application/json" });
      res.end(isBuild ? body : "{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/tokyo-od-game/`);
    });
  });

describe("the served tree's build label (scripts/qa/servedBuild.ts)", () => {
  it("reads the label the server answers at <base>__log/build", async () => {
    const base = await serve(200, JSON.stringify({ build: "d467391+1a2b3c@0.1.0" }));
    expect(await servedBuild(base)).toBe("d467391+1a2b3c@0.1.0");
  });

  it("gives null for a refusal, a body without a label, and no server", async () => {
    expect(await servedBuild(await serve(403, JSON.stringify({ error: "cross-origin" })))).toBeNull();
    server?.close();
    expect(await servedBuild(await serve(200, JSON.stringify({ other: 1 })))).toBeNull();
    server?.close();
    server = null;
    expect(await servedBuild("http://127.0.0.1:9/tokyo-od-game/")).toBeNull();
  });

  it("calls a run the same tree only when both ends answered the same label", () => {
    expect(servedRecord("a@1", "a@1").isSame).toBe(true);
    expect(servedRecord("a@1", "a+f@1").isSame).toBe(false);
    expect(servedRecord("a@1", null).isSame).toBe(false);
    expect(servedRecord(null, null).isSame).toBe(false);
  });
});
