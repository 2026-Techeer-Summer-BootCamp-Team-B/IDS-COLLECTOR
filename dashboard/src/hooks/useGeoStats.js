import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { getCountryGeo } from "../data/countryGeo";

// GET /stats/geo (servers/platform-api/app/analytics_api.py, ClickHouse
// security_events_analytics 집계) — 국가별 탐지 건수. data/attackEvents.js의
// byCountry(ATTACK_EVENTS) mock 대체. 응답은 {country_iso_code, count}뿐이라
// WorldMap/Globe3D가 필요로 하는 lat/lon/국가명은 data/countryGeo.js(오프라인
// 생성 테이블)로 붙인다 — 코드가 테이블에 없으면(희귀 지역코드 등) 그 항목은
// 그린다.
//
// 주의: enrichment.py의 GeoIP lookup이 아직 모든 IP를 "KR/Seoul"로 고정
// 반환하는 더미라, MaxMind DB가 붙기 전까지는 실제로 연결해도 지도에 한반도
// 쪽 점 하나만 두드러지게 보일 수 있다 — 백엔드 GeoIP가 실측으로 바뀌면
// 자동으로 정상화된다.
export function useGeoStats({ limit = 10 } = {}) {
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
          .map((row) => {
            const geo = getCountryGeo(row.country_iso_code);
            if (!geo) return null;
            return { country: geo.name, countryCode: row.country_iso_code, lat: geo.lat, lon: geo.lon, count: row.count };
          })
          .filter(Boolean);
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
