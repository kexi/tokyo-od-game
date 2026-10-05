// Map sampled CPU stacks to the page's actual longest rAF gaps; inclusive groups can overlap.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/qa/profile-frame-stalls.mjs path/to/report.json");
const report = JSON.parse(readFileSync(file, "utf8"));
const hasClock = Number.isFinite(report.clock?.navigationStart);
if (!hasClock) throw new Error("report has no validated CDP-to-page clock (use QA_PROFILE=1)");
const output = { report: file, clock: report.clock, samples: [] };
for (const sample of report.samples) {
  const profile = JSON.parse(readFileSync(join(dirname(file), `${sample.mode}.cpuprofile`), "utf8"));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map(profile.nodes.flatMap((n) => (n.children ?? []).map((id) => [id, n.id])));
  const chains = new Map();
  for (const node of profile.nodes) {
    const chain = [];
    let id = node.id;
    while (id) {
      chain.push(nodes.get(id).callFrame);
      id = parents.get(id);
    }
    chains.set(node.id, chain);
  }
  const peaks = [];
  for (const gap of sample.framePeaks.slice(0, 3)) {
    const start = report.clock.navigationStart * 1e6 + gap.start * 1000;
    const end = report.clock.navigationStart * 1e6 + gap.end * 1000;
    const self = new Map();
    const groups = { shaderBuild: 0, shadowRender: 0, waterMasks: 0, gc: 0 };
    let cursor = profile.startTime;
    let observed = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const next = cursor + profile.timeDeltas[i];
      const ms = Math.max(0, Math.min(end, next) - Math.max(start, cursor)) / 1000;
      cursor = next;
      if (ms === 0) continue;
      observed += ms;
      const chain = chains.get(profile.samples[i]);
      const frame = chain[0];
      const key = `${frame.functionName}:${frame.url}:${frame.lineNumber}`;
      const entry = self.get(key) ?? { frame, ms: 0, chain: chain.slice(0, 12) };
      entry.ms += ms;
      self.set(key, entry);
      const shaderBuild = chain.some(
        (f) =>
          /three/.test(f.url) &&
          /^(build|buildAsync|buildCode|buildFlow|setup|generate|generateNodeType)$/.test(f.functionName),
      );
      const shadowRender = chain.some(
        (f) => f.functionName === "renderShadow" || f.functionName === "updateShadow",
      );
      const waterMasks = chain.some(
        (f) => /waterGeometry|waterMasks/.test(f.url) && /^(coverage|dilate|rasterize)/.test(f.functionName),
      );
      const gc = frame.functionName === "(garbage collector)";
      if (shaderBuild) groups.shaderBuild += ms;
      if (shadowRender) groups.shadowRender += ms;
      if (waterMasks) groups.waterMasks += ms;
      if (gc) groups.gc += ms;
    }
    peaks.push({
      gap,
      observedMs: observed,
      groups,
      self: [...self.values()].toSorted((a, b) => b.ms - a.ms).slice(0, 20),
    });
  }
  output.samples.push({ mode: sample.mode, frames: sample.frames, peaks });
}
const destination = join(dirname(file), "frame-stacks.json");
writeFileSync(destination, JSON.stringify(output, null, 2));
process.stdout.write(
  JSON.stringify(
    {
      output: destination,
      samples: output.samples.map((s) => ({
        mode: s.mode,
        peaks: s.peaks.map((p) => ({
          ms: p.gap.ms,
          groups: p.groups,
          self: p.self
            .slice(0, 5)
            .map((e) => ({ name: e.frame.functionName, file: basename(e.frame.url), ms: e.ms })),
        })),
      })),
    },
    null,
    2,
  ) + "\n",
);
