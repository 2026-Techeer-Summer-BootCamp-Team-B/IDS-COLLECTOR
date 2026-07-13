// Shared Kubernetes object topology — namespace/workload/pod/container/image/node
// all in one place so WAS, Falco, and K8s Audit mock data reference the SAME
// cluster objects instead of each layer inventing its own pod names. This is
// what makes "these 3 logs are about the same pod" a coherent story instead
// of a coincidence, and fills the K8s-metadata gap (container/node/image were
// missing from WAS entirely, and from all 3 layers before this file existed).

// App workloads (what the correlation engine watches for attacks) + a
// handful of platform/infra workloads (what Falco/K8s Audit see constantly
// as routine cluster traffic, same as the reference Falco dashboard's
// "cert-manager / argo-cd / metallb / ..." pod list).
export const WORKLOADS = [
  {
    namespace: "juice-shop",
    workload: "juice-shop",
    container: "juice-shop",
    image: "bkimminich/juice-shop:15.1.0",
    pods: [
      { pod: "juice-shop-7d9f", node: "worker-1" },
      { pod: "juice-shop-a231", node: "worker-2" },
    ],
  },
  {
    namespace: "payment",
    workload: "payment-service",
    container: "payment-service",
    image: "sentinel-ops/payment-service:2.4.1",
    pods: [{ pod: "payment-service-5c1a", node: "worker-2" }],
  },
  {
    namespace: "auth",
    workload: "auth-service",
    container: "auth-service",
    image: "sentinel-ops/auth-service:1.9.0",
    pods: [{ pod: "auth-service-88bd", node: "worker-1" }],
  },
  {
    namespace: "juice-shop",
    workload: "web-app",
    container: "web-app",
    image: "sentinel-ops/web-app:3.1.0",
    pods: [{ pod: "web-app-6f2c", node: "worker-1" }],
  },
  {
    namespace: "platform",
    workload: "api-gateway",
    container: "api-gateway",
    image: "sentinel-ops/api-gateway:4.0.2",
    pods: [{ pod: "api-gateway-2m9x", node: "worker-1" }],
  },
  {
    namespace: "platform",
    workload: "worker-queue",
    container: "worker-queue",
    image: "sentinel-ops/worker-queue:1.2.0",
    pods: [{ pod: "worker-queue-9k1p", node: "worker-3" }],
  },
  {
    namespace: "platform",
    workload: "db-proxy",
    container: "db-proxy",
    image: "sentinel-ops/db-proxy:1.0.4",
    pods: [{ pod: "db-proxy-4h7w", node: "worker-3" }],
  },
  // 플랫폼/인프라 워크로드 — 앱 트래픽과 무관하게 Falco/K8s Audit이 항상 관찰하는
  // 대상. 실제 Falco 레퍼런스 대시보드의 Top Pods 목록과 동일한 네임스페이스 사용.
  {
    namespace: "cert-manager",
    workload: "cert-manager-webhook",
    container: "cert-manager-webhook",
    image: "quay.io/jetstack/cert-manager-webhook:v1.14.4",
    pods: [{ pod: "cert-manager-webhook-778c765c87-t642t", node: "worker-1" }],
  },
  {
    namespace: "cloudnative-pg",
    workload: "cnpg-cloudnative-pg",
    container: "postgres",
    image: "ghcr.io/cloudnative-pg/postgresql:16.2",
    pods: [{ pod: "cnpg-cloudnative-pg-687c867554-t542v", node: "worker-2" }],
  },
  {
    namespace: "sealed-secrets",
    workload: "sealed-secrets",
    container: "sealed-secrets-controller",
    image: "bitnami/sealed-secrets-controller:0.26.0",
    pods: [{ pod: "sealed-secrets-ccdcd67f-q2ft6", node: "worker-1" }],
  },
  {
    namespace: "keycloak",
    workload: "keycloak-postgresql",
    container: "postgresql",
    image: "bitnami/postgresql:16.2.0",
    pods: [{ pod: "keycloak-postgresql-cluster-1", node: "worker-3" }],
  },
  {
    namespace: "argo-cd",
    workload: "argocd-notifications-controller",
    container: "notifications-controller",
    image: "quay.io/argoproj/argocd:v2.10.6",
    pods: [{ pod: "argocd-notifications-controller-7f9k2", node: "worker-2" }],
  },
  {
    namespace: "monitoring",
    workload: "falco",
    container: "falco",
    image: "falcosecurity/falco:0.38.0",
    pods: [{ pod: "falco-k8s-metacollector-5d678f9c47-k2tfr", node: "worker-1" }],
  },
  {
    namespace: "metallb",
    workload: "metallb-speaker",
    container: "speaker",
    image: "quay.io/metallb/speaker:v0.14.5",
    pods: [{ pod: "metallb-speaker-sdgwz", node: "worker-3" }],
  },
  {
    namespace: "longhorn-system",
    workload: "longhorn-manager",
    container: "longhorn-manager",
    image: "longhornio/longhorn-manager:v1.6.1",
    pods: [{ pod: "instance-manager-457722d1bb409060a", node: "worker-2" }],
  },
  {
    namespace: "kube-system",
    workload: "kube-proxy",
    container: "kube-proxy",
    image: "registry.k8s.io/kube-proxy:v1.29.3",
    pods: [{ pod: "kube-proxy-11ff", node: "worker-1" }],
  },
  {
    namespace: "ingress",
    workload: "nginx-ingress",
    container: "controller",
    image: "registry.k8s.io/ingress-nginx/controller:v1.10.0",
    pods: [{ pod: "nginx-ingress-77aa", node: "worker-3" }],
  },
];

// Flat [{ namespace, workload, container, image, pod, node }] — one row per
// pod, easiest shape for mock generators to pick a random target from.
export const POD_CONTEXTS = WORKLOADS.flatMap((w) =>
  w.pods.map((p) => ({
    namespace: w.namespace,
    workload: w.workload,
    container: w.container,
    image: w.image,
    pod: p.pod,
    node: p.node,
  }))
);

// App-only subset (excludes platform/infra pods) — for WAS traffic, which by
// definition only comes from the juice-shop app tier, not cert-manager etc.
export const APP_POD_CONTEXTS = POD_CONTEXTS.filter((p) =>
  ["juice-shop", "payment", "auth", "platform"].includes(p.namespace)
);

export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
