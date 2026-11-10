import { createServer } from "node:net";

/**
 * A TCP port free on this machine now, for a headless Chrome's DevTools port. How: listen on port 0
 * and take what the OS gave. Why not fixed ports: shoots run side by side in several worktrees, and
 * a fixed port collides (browser.mjs refuses a port that answers).
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}
