// Structured one-line JSON logs carrying a per-session trace id so console output can be
// grepped / jq'd when diagnosing a player's report.
const traceId = crypto.randomUUID?.() ?? String(performance.now());

export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), traceId, event, ...fields }));
}

export function warn(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), traceId, level: "warn", event, ...fields }));
}
