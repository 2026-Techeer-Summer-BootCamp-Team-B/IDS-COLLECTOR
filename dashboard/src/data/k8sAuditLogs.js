// Mock data for the K8s API 상세 view — kube-apiserver audit log style
// events (verb/resource/user/allowed), distinct from the WAS/Falco layers.
// This is the one layer that didn't have its own mock dataset yet (only
// showed up as text inside Incidents' storyline entries).

import { MOCK_NOW } from "./mockLogs";
import { POD_CONTEXTS } from "./clusterTopology";

const VERBS = [
  { verb: "get", weight: 30 },
  { verb: "list", weight: 25 },
  { verb: "watch", weight: 20 },
  { verb: "create", weight: 8 },
  { verb: "update", weight: 6 },
  { verb: "patch", weight: 5 },
  { verb: "delete", weight: 4 },
  { verb: "exec", weight: 2 },
];

const RESOURCES = [
  { resource: "pods", weight: 22 },
  { resource: "configmaps", weight: 14 },
  { resource: "services", weight: 12 },
  { resource: "deployments", weight: 10 },
  { resource: "events", weight: 10 },
  { resource: "secrets", weight: 8 },
  { resource: "endpoints", weight: 8 },
  { resource: "serviceaccounts", weight: 6 },
  { resource: "roles", weight: 4 },
  { resource: "rolebindings", weight: 3 },
  { resource: "persistentvolumeclaims", weight: 3 },
];

// Mostly service accounts doing routine reconciliation (controllers,
// operators) + a couple of human users — realistic mix for a platform
// namespace-heavy cluster.
const USERS = [
  { user: "system:serviceaccount:kube-system:coredns", weight: 20 },
  { user: "system:serviceaccount:argo-cd:argocd-application-controller", weight: 14 },
  { user: "system:serviceaccount:cert-manager:cert-manager", weight: 10 },
  { user: "system:serviceaccount:metallb:speaker", weight: 8 },
  { user: "system:serviceaccount:longhorn-system:longhorn-manager", weight: 8 },
  { user: "system:node:worker-1", weight: 10 },
  { user: "system:node:worker-2", weight: 8 },
  { user: "admin@sentinel-ops.io", weight: 6 },
  { user: "dev-oncall@sentinel-ops.io", weight: 6 },
  { user: "system:serviceaccount:payment:dev-sa", weight: 5 },
  { user: "system:anonymous", weight: 5 },
];

function weightedPick(pool, key) {
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let x = Math.random() * total;
  for (const r of pool) {
    if (x < r.weight) return r[key];
    x -= r.weight;
  }
  return pool[0][key];
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomIp() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

// A handful of combinations are treated as sensitive — verb+resource pairs
// that, coming from an unexpected user, are worth flagging as denied
// (mirrors the PRIV_ESC/CRED_ACCESS attack types the correlation engine
// already watches K8s Audit for).
const SENSITIVE_COMBOS = new Set(["create:pods", "delete:secrets", "create:rolebindings", "exec:pods", "create:roles"]);

function generateAuditEvents(count, lookbackMs) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const verb = weightedPick(VERBS, "verb");
    const resource = weightedPick(RESOURCES, "resource");
    const user = weightedPick(USERS, "user");
    const target = randomFrom(POD_CONTEXTS);
    const timestamp = new Date(MOCK_NOW.getTime() - Math.random() * lookbackMs);

    const isSensitive = SENSITIVE_COMBOS.has(`${verb}:${resource}`);
    const isSuspiciousUser = user === "system:anonymous" || user === "system:serviceaccount:payment:dev-sa";
    // Denied mostly when a sensitive action comes from an unexpected/anonymous
    // caller — everything else (routine controller traffic) is allowed.
    const denyChance = isSensitive && isSuspiciousUser ? 0.7 : isSensitive ? 0.08 : 0.01;
    const allowed = Math.random() >= denyChance;

    // pods 리소스를 대상으로 한 요청(특히 exec)만 구체적인 파드/컨테이너까지
    // 특정 — 다른 리소스(configmaps, services 등)는 네임스페이스 단위까지만
    // 의미가 있어서 pod/container/image/node는 비워둔다(감사 로그의 실제 특성과 일치).
    const targetsPod = resource === "pods" || verb === "exec";

    events.push({
      id: i + 1,
      timestamp,
      verb,
      resource,
      namespace: target.namespace,
      workload: targetsPod ? target.workload : undefined,
      pod: targetsPod ? target.pod : undefined,
      container: targetsPod ? target.container : undefined,
      image: targetsPod ? target.image : undefined,
      node: target.node,
      user,
      sourceIp: randomIp(),
      allowed,
    });
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}

// 24h of history — kube-apiserver audit is high-volume like Falco.
export const K8S_AUDIT_EVENTS = generateAuditEvents(3200, 24 * 60 * 60 * 1000);

export function byVerb(events) {
  const counts = events.reduce((acc, e) => ((acc[e.verb] = (acc[e.verb] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([verb, count]) => ({ verb, count }))
    .sort((a, b) => b.count - a.count);
}

export function byResource(events) {
  const counts = events.reduce((acc, e) => ((acc[e.resource] = (acc[e.resource] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([resource, count]) => ({ resource, count }))
    .sort((a, b) => b.count - a.count);
}

export function byUser(events) {
  const counts = events.reduce((acc, e) => ((acc[e.user] = (acc[e.user] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count);
}
