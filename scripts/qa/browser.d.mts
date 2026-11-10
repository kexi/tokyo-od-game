// Types of browser.mjs for the .ts QA scripts (views.ts, contactSheet.ts) — browser.mjs stays plain
// JS because drive.mjs and the perf scripts run it under plain node.

export type Browser = {
  /** Runtime.evaluate (awaits promises, returns by value); throws on an exception in the page. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** A .png file is written losslessly, anything else as JPEG of `quality`. */
  screenshot(file: string, quality?: number): Promise<string>;
  sleep(ms: number): Promise<void>;
  /** Console lines and exceptions of the page. */
  logs: string[];
  close(): Promise<void>;
  /** A raw DevTools Protocol call. */
  send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ result: Record<string, unknown> & { data?: string } }>;
};

export function launch(
  url: string,
  options?: { port?: number; width?: number; height?: number; preload?: string | null },
): Promise<Browser>;
