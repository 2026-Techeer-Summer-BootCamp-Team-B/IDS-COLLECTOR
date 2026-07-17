import React, { useEffect, useRef, useState } from "react";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import WorldMap from "./WorldMap";

// 2026-07-17(5차): "city가 null이 아니라 여러 지역이 나오는데, 지도를
// 스크롤/확대하면 지역이 자세히 보이게 해달라"는 요청 - 기존 WorldMap은
// 고정 크기 SVG라 확대/스크롤이 안 됐다. 발급받은 Google Maps API 키로
// 실제 인터랙티브 지도(확대/축소/드래그가 기본 제공됨)로 바꾼다.
//
// API 키는 dashboard/.env(.production)의 VITE_GOOGLE_MAPS_API_KEY로 설정 -
// 키가 없으면(로컬에서 아직 설정 전이거나 값을 안 채운 경우) 에러 화면 대신
// 기존 평면 WorldMap으로 조용히 대체한다(둘 다 같은 points prop을 받는 동일
// 인터페이스라 자연스럽게 바뀐다).

let mapsLoaderPromise = null;

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoaderPromise) return mapsLoaderPromise;

  mapsLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = "__sentinelOpsGoogleMapsInit";
    window[callbackName] = () => {
      resolve(window.google.maps);
      delete window[callbackName];
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&callback=${callbackName}&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps 스크립트 로드 실패"));
    document.head.appendChild(script);
  });
  return mapsLoaderPromise;
}

// 앱 다크/라이트 테마와 톤을 맞춘 지도 스타일 - 기본 Google 지도의 파랑/초록
// POI 색상을 지우고, 무채색+민트 포인트 컬러로 대시보드 전체 톤에 맞춘다.
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0d0f16" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d0f16" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#2a2f3f" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#16161b" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#08080a" }] },
];
const LIGHT_MAP_STYLE = [
  { elementType: "labels.text.fill", stylers: [{ color: "#8a8fa3" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#F4F5FA" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#c9cce0" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#E6E8F5" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#D5D9EE" }] },
];

export default function GoogleGeoMap({ points, compact = false }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const [status, setStatus] = useState(apiKey ? "loading" : "no-key"); // loading | ready | error | no-key

  // 지도 최초 1회 생성
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: 20, lng: 10 },
          zoom: compact ? 1 : 2,
          minZoom: 1,
          styles: theme === "light" ? LIGHT_MAP_STYLE : DARK_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy", // 스크롤만으로 바로 확대/축소 (Ctrl 안 눌러도 됨)
          backgroundColor: C.bg,
        });
        infoWindowRef.current = new maps.InfoWindow();
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // 테마 바뀌면 스타일만 갱신
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setOptions({ styles: theme === "light" ? LIGHT_MAP_STYLE : DARK_MAP_STYLE });
    }
  }, [theme]);

  // points 바뀌면 마커 다시 그리기
  useEffect(() => {
    if (status !== "ready" || !window.google?.maps || !mapRef.current) return;
    const maps = window.google.maps;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    if (points.length === 0) return;

    const maxCount = Math.max(...points.map((p) => p.count), 1);
    const bounds = new maps.LatLngBounds();

    points.forEach((p) => {
      const r = 4 + Math.sqrt(p.count / maxCount) * (compact ? 10 : 16);
      const position = { lat: p.lat, lng: p.lon };
      const marker = new maps.Marker({
        position,
        map: mapRef.current,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: r,
          fillColor: C.critical,
          fillOpacity: 0.28,
          strokeColor: C.critical,
          strokeWeight: 0,
        },
        zIndex: Math.round(p.count),
      });
      const coreDot = new maps.Marker({
        position,
        map: mapRef.current,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: Math.max(2.5, r * 0.4),
          fillColor: C.critical,
          fillOpacity: 1,
          strokeWeight: 0,
        },
        zIndex: Math.round(p.count) + 1000,
      });

      const content = `<div style="font: 500 12px sans-serif; padding: 2px 4px; color: #111;">
        ${p.country}${p.city ? ` · ${p.city}` : ""} · ${p.count}건
      </div>`;
      marker.addListener("mouseover", () => {
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
      });
      marker.addListener("mouseout", () => infoWindowRef.current.close());

      markersRef.current.push(marker, coreDot);
      bounds.extend(position);
    });

    // 점이 몇 개 안 되면 전체 화면에 맞춰 자동으로 프레이밍 - 흩어진 지역들이
    // 한눈에 들어오게 하고, 그 상태에서 사용자가 직접 스크롤/드래그로 더
    // 확대해서 자세히 볼 수 있다.
    if (points.length > 1) {
      mapRef.current.fitBounds(bounds, 40);
    } else if (points.length === 1) {
      mapRef.current.setCenter({ lat: points[0].lat, lng: points[0].lon });
      mapRef.current.setZoom(4);
    }
  }, [points, status, compact, C.critical]);

  if (status === "no-key" || status === "error") {
    // 키가 없거나 로드 실패 시 기존 평면 지도로 조용히 대체 - 화면이 깨지는 것보다 낫다.
    return <WorldMap points={points} compact={compact} />;
  }

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-dash-surface">
          <span className="w-5 h-5 border-2 border-dash-muted/30 border-t-dash-muted rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
