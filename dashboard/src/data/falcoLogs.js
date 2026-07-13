// Mock data for the Falco 상세 view — a dedicated "runtime security layer"
// page, separate from Overview/Incidents (which only surface Falco events
// that were correlated into an attack). Real Falco deployments emit a LOT of
// low-priority noise (mostly NOTICE) alongside the rare real signal — this
// mirrors that shape instead of showing only confirmed-attack events.

import { MOCK_NOW } from "./mockLogs";
import { normalizeLevel } from "./logLevels";
import { POD_CONTEXTS } from "./clusterTopology";

// Rule pool loosely mirrors Falco's default ruleset — priority uses the same
// canonical 9-level scale as everything else in the app (logLevels.js) so
// colors/badges stay consistent across pages.
const RULES_POOL = [
  { rule: "Contact K8S API Server From Container", priority: "NOTICE", weight: 55 },
  { rule: "Packet socket created in container", priority: "WARNING", weight: 10 },
  { rule: "Redirect STDOUT/STDIN to Network Connection in Container", priority: "WARNING", weight: 6 },
  { rule: "DB program spawned process", priority: "NOTICE", weight: 9 },
  { rule: "Unexpected outbound connection destination", priority: "MAJOR", weight: 5 },
  { rule: "Run shell untrusted", priority: "MAJOR", weight: 5 },
  { rule: "Write below binary dir", priority: "MAJOR", weight: 2 },
  { rule: "Terminal shell in container", priority: "CRITICAL", weight: 4 },
  { rule: "Read sensitive file untrusted", priority: "CRITICAL", weight: 3 },
  { rule: "Privileged container started", priority: "CRITICAL", weight: 1 },
];

// Falco watches every container on every node, so it sees the full cluster
// topology (app pods AND platform/infra pods) — not just juice-shop traffic
// like the WAS/attack views. Shared with the other 2 layers (clusterTopology.js)
// so the same pod can show up consistently across WAS/Falco/K8s Audit.
const TARGETS_POOL = POD_CONTEXTS;

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(pool) {
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let x = Math.random() * total;
  for (const r of pool) {
    if (x < r.weight) return r;
    x -= r.weight;
  }
  return pool[0];
}

function randomIp() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

const OUTPUT_TEMPLATES = {
  "Contact K8S API Server From Container": (t) => `k8s.pod=${t.pod} connection to K8s API Server`,
  "Packet socket created in container": (t) => `container=${t.pod} proc=collector packet socket opened`,
  "Redirect STDOUT/STDIN to Network Connection in Container": (t) => `container=${t.pod} proc=sh fd redirected to socket`,
  "DB program spawned process": (t) => `container=${t.pod} proc=mysqld spawned process=sh`,
  "Unexpected outbound connection destination": (t) => `container=${t.pod} dst=${randomIp()}:443`,
  "Run shell untrusted": (t) => `container=${t.pod} proc=sh parent=node`,
  "Write below binary dir": (t) => `container=${t.pod} fd.name=/usr/bin/curl proc=sh`,
  "Terminal shell in container": (t) => `container=${t.pod} proc=sh ppid=node`,
  "Read sensitive file untrusted": (t) => `container=${t.pod} fd.name=/etc/shadow proc=sh`,
  "Privileged container started": (t) => `container=${t.pod} privileged=true user=root`,
};

function generateFalcoEvents(count, lookbackMs) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const { rule, priority } = weightedPick(RULES_POOL);
    const target = randomFrom(TARGETS_POOL);
    const timestamp = new Date(MOCK_NOW.getTime() - Math.random() * lookbackMs);
    events.push({
      id: i + 1,
      timestamp,
      priority: normalizeLevel(priority),
      rule,
      source: "syscall",
      namespace: target.namespace,
      workload: target.workload,
      pod: target.pod,
      container: target.container,
      image: target.image,
      node: target.node,
      output: OUTPUT_TEMPLATES[rule] ? OUTPUT_TEMPLATES[rule](target) : `container=${target.pod}`,
    });
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}

// 24h of history, high volume (Falco is chatty) — mirrors the "2675 events/day"
// scale from the reference dashboard.
export const FALCO_EVENTS = generateFalcoEvents(2600, 24 * 60 * 60 * 1000);

export function byRule(events) {
  const counts = events.reduce((acc, e) => ((acc[e.rule] = (acc[e.rule] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count);
}

export function byPod(events) {
  const counts = events.reduce((acc, e) => {
    const key = `${e.namespace}/${e.pod}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}
