import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { getCountryGeo } from "../data/countryGeo";

// GET /stats/geo (servers/platform-api/app/analytics_api.py, ClickHouse
// security_events_analytics 집계) - 도시 단위 탐지 건수. 위경도는 GeoLite2-City가
// 실측한 값을 API가 그대로 내려주므로(2026-07-16, geoip2fast country-only 배포판에서
// 교체), data/countryGeo.js는 더 이상 좌표 조회용이 아니라 국가 표시 이름(한글/영문
// 국가명) 조회용으로만 쓴다 - country_iso_code가 그 테이블에 없는 희귀 지역코드면
// 코드 자체를 이름으로 표시한다.
export function useGeoStats({ limit = 50 } = {}) {
  const [countries, setCountries] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    apiGet(`/stats/geo?limit=${limit}`)
      .then((res) => {
        if (cancelled) return;
        const mapped = (res ?? [])
          .filter((row) => row.lat != null && row.lon != null)
          .map((row) => ({
            country: getCountryGeo(row.country_iso_code)?.name ?? row.country_iso_code,
            countryCode: row.country_iso_code,
            city: row.city_name ?? null,
            lat: row.lat,
            lon: row.lon,
            count: row.count,
          }));
        setCountries(mapped);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setCountries([]);
        setError(e instanceof ApiError ? e.message : "GeoIP 통계를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { countries, status, error };
}
