import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /stats/k8s-targets (analytics_api.py, ClickHouse) — namespace/리소스별
// 탐지 건수. data/attackEvents.js의 byK8sTarget(ATTACK_EVENTS) mock 대체.
// mock 버전은 이벤트 목록을 직접 훑어 topAttackType(namespace/pod당 가장 흔한
// 공격 유형)까지 계산했지만, 실제 이벤트엔 "공격 유형" 분류 자체가 없어서
// (event.module/event.action만 있음) 그 필드는 낼 수 없다 — InfrastructureView
// 쪽 툴팁에서 topAttackType 표시를 뺐다.
export function useK8sTargets({ limit = 20 } = {}) {
  const [targets, setTargets] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    apiGet(`/stats/k8s-targets?limit=${limit}`)
      .then((res) => {
        if (cancelled) return;
        setTargets((res ?? []).map((row) => ({ namespace: row.namespace, pod: row.resource_name, count: row.count })));
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setTargets([]);
        setError(e instanceof ApiError ? e.message : "K8s 타깃 통계를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { targets, status, error };
}
