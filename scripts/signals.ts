// Writes assets/signals/heads.json, the signal-head registry scripts/blender/signals.py models
// from (src/signals/heads.ts is the one definition; knowledge/signal-system.md).
// Run: just make-signal-layout   (this script, then oxfmt over the file: the repo's JSON style)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../src/log.ts";
import { SIGNAL_REGISTRY_PATH, signalRegistry } from "../src/signals/registry.ts";

const file = join(import.meta.dirname, "..", SIGNAL_REGISTRY_PATH);
const registry = signalRegistry();
await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`);
log("signal_heads_written", { file: SIGNAL_REGISTRY_PATH, heads: registry.heads.length });
