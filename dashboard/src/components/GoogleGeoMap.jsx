import React, { useEffect, useRef, useState } from "react";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import WorldMap from "./WorldMap";
import { renderHoverPanelHTML } from "./HoverPanel";
import { resolveFlagCode } from "../lib/flagEmoji";

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
    // language=en: 안 넣으면 Maps JS SDK가 브라우저 로케일(이 프로젝트 사용자 대부분
    // ko-KR)을 따라가서 지도 위 나라/지명 라벨이 한글로 뜬다(마커 툴팁 쪽 국가명은
    // countryGeo.js에 이미 영문으로 박혀있어 문제 없었음 - 문제는 Google이 타일
    // 자체에 그려주는 라벨) - 2026-07-17, "나라 이름 영어로" 피드백으로 고정.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&callback=${callbackName}&loading=async&language=en`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps 스크립트 로드 실패"));
    document.head.appendChild(script);
  });
  return mapsLoaderPromise;
}

// 앱 다크/라이트 테마와 톤을 맞춘 지도 스타일 - 기본 Google 지도의 파랑/초록
// POI 색상을 지우고, 무채색+민트 포인트 컬러로 대시보드 전체 톤에 맞춘다.
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#111827" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#BAC6D8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#09111E" }, { weight: 2 }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#62748D" }, { weight: 1.2 }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#2B3A52" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A1424" }] },
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

function hitPadForZoom(zoom) {
  return Math.max(0.3, Math.min(1.2, zoom * 0.105));
}

const CLICK_ZOOM = 6.3;
// 참고 화면처럼 터키·이집트 사이를 중심으로 유럽·아프리카·아시아가 한 번에
// 들어오도록 한다. 이 줌에서는 Google 타일의 세계 반복도 의도적으로 보인다.
const DEFAULT_CENTER = { lat: 32, lng: 30 };
const DEFAULT_ZOOM = 2.15;

function toMercator({ lat, lng }) {
  const safeLat = Math.max(-85, Math.min(85, lat));
  const sinLat = Math.sin((safeLat * Math.PI) / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI) };
}

function fromMercator({ x, y }) {
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI, lng: x * 360 - 180 };
}

function smoothCameraTo(map, targetCenter, targetZoom, motionRef, duration = 900, onComplete) {
  const motionId = ++motionRef.current;
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  const startPoint = toMercator({ lat: startCenter.lat(), lng: startCenter.lng() });
  const targetPoint = toMercator(targetCenter);
  const startedAt = performance.now();
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const step = (now) => {
    if (motionId !== motionRef.current) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(progress);
    map.moveCamera({
      center: fromMercator({ x: startPoint.x + (targetPoint.x - startPoint.x) * eased, y: startPoint.y + (targetPoint.y - startPoint.y) * eased }),
      zoom: startZoom + (targetZoom - startZoom) * eased,
    });
    if (progress < 1) window.requestAnimationFrame(step);
    else onComplete?.();
  };
  window.requestAnimationFrame(step);
}

function smoothFocusMarker(map, markerPosition, targetZoom, motionRef, duration = 900, onComplete) {
  const motionId = ++motionRef.current;
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  const markerPoint = toMercator(markerPosition);
  const centerPoint = toMercator({ lat: startCenter.lat(), lng: startCenter.lng() });
  const startScale = 256 * 2 ** startZoom;
  const offset = { x: (markerPoint.x - centerPoint.x) * startScale, y: (markerPoint.y - centerPoint.y) * startScale };
  const startedAt = performance.now();
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const step = (now) => {
    if (motionId !== motionRef.current) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(progress);
    const zoom = startZoom + (targetZoom - startZoom) * eased;
    const scale = 256 * 2 ** zoom;
    map.moveCamera({
      center: fromMercator({ x: markerPoint.x - (offset.x * (1 - eased)) / scale, y: markerPoint.y - (offset.y * (1 - eased)) / scale }),
      zoom,
    });
    if (progress < 1) window.requestAnimationFrame(step);
    else onComplete?.();
  };
  window.requestAnimationFrame(step);
}

function smoothReturnFromMarker(map, savedView, motionRef, duration = 900, onComplete) {
  const motionId = ++motionRef.current;
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  const markerPoint = toMercator(savedView.markerPosition);
  const startCenterPoint = toMercator({ lat: startCenter.lat(), lng: startCenter.lng() });
  const targetCenterPoint = toMercator(savedView.center);
  const startScale = 256 * 2 ** startZoom;
  const targetScale = 256 * 2 ** savedView.zoom;
  const startOffset = { x: (markerPoint.x - startCenterPoint.x) * startScale, y: (markerPoint.y - startCenterPoint.y) * startScale };
  const targetOffset = { x: (markerPoint.x - targetCenterPoint.x) * targetScale, y: (markerPoint.y - targetCenterPoint.y) * targetScale };
  const startedAt = performance.now();
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const step = (now) => {
    if (motionId !== motionRef.current) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(progress);
    const zoom = startZoom + (savedView.zoom - startZoom) * eased;
    const scale = 256 * 2 ** zoom;
    const offset = {
      x: startOffset.x + (targetOffset.x - startOffset.x) * eased,
      y: startOffset.y + (targetOffset.y - startOffset.y) * eased,
    };
    map.moveCamera({ center: fromMercator({ x: markerPoint.x - offset.x / scale, y: markerPoint.y - offset.y / scale }), zoom });
    if (progress < 1) window.requestAnimationFrame(step);
    else onComplete?.();
  };
  window.requestAnimationFrame(step);
}

export default function GoogleGeoMap({ points, compact = false }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const hitMarkersRef = useRef([]); // [{ marker, baseRadius }]
  const zoomRef = useRef(compact ? 1 : 2);
  const infoWindowRef = useRef(null);
  const pinnedMarkerRef = useRef(null);
  const zoomMotionRef = useRef(0);
  const refreshHitMarkerRangesRef = useRef(null);
  const savedFocusRef = useRef(null);
  const isCameraMotionRef = useRef(false);
  const pendingResetTimerRef = useRef(null);
  const ignoreBackgroundPointerRef = useRef(false);
  const backgroundResetInProgressRef = useRef(false);
  const [status, setStatus] = useState(apiKey ? "loading" : "no-key"); // loading | ready | error | no-key

  // 지도 최초 1회 생성
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          minZoom: 1.5,
          isFractionalZoomEnabled: true,
          styles: theme === "light" ? LIGHT_MAP_STYLE : DARK_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy", // 스크롤만으로 바로 확대/축소 (Ctrl 안 눌러도 됨)
          backgroundColor: C.bg,
          // restriction: minZoom=1(줌 아웃 최대치)에서는 Google 지도가 세계지도를
          // 옆으로 이어붙여서(경도 wrap-around) 여러 개로 반복 표시한다 - "세계
          // 지도가 여러 개 중복해서 나온다"는 2026-07-17 피드백의 원인. 위경도를
          // 지구 전체(위도 ±85도, 경도 ±180도)로 한정하고 strictBounds로 그 밖으로
          // 못 나가게 고정하면 지도가 딱 한 벌만 렌더링된다(Google Maps 공식 문서의
          // "restrict panning" 패턴) - minZoom도 1→2로 살짝 올려서 반복이 다시
          // 보일 만큼 축소되는 걸 원천 차단.
          restriction: {
            latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
            strictBounds: true,
          },
        });
        // headerDisabled: true - hover로 뜨고 벗어나면 사라지는 패널이라 기본
        // 닫기(X) 버튼이 불필요함(2026-07-17 요청). 그래도 일부 구버전 API에선
        // 이 옵션이 없을 수 있어 domready 시점에 DOM에서도 한 번 더 숨긴다.
        infoWindowRef.current = new maps.InfoWindow({ headerDisabled: true });
        maps.event.addListener(infoWindowRef.current, "domready", () => {
          document.querySelectorAll(".gm-ui-hover-effect, .gm-style-iw-chr").forEach((el) => {
            el.style.display = "none";
          });
        });
        zoomRef.current = mapRef.current.getZoom();
        const refreshHitMarkerRanges = () => {
          const zoom = mapRef.current.getZoom();
          zoomRef.current = zoom;
          const padding = hitPadForZoom(zoom);
          hitMarkersRef.current.forEach(({ marker, baseRadius }) => {
            marker.setIcon({
              path: maps.SymbolPath.CIRCLE,
              scale: baseRadius + padding,
              fillOpacity: 0,
              strokeOpacity: 0,
            });
          });
        };
        refreshHitMarkerRangesRef.current = refreshHitMarkerRanges;
        maps.event.addListener(mapRef.current, "zoom_changed", () => {
          zoomRef.current = mapRef.current.getZoom();
          // moveCamera는 애니메이션 중 zoom_changed를 매 프레임 발생시킨다.
          // 이때 모든 투명 hit marker의 아이콘을 다시 만들면 복귀 모션이 끊긴다.
          // 움직임이 끝난 뒤 한 번만 갱신하고, 사용자의 일반 줌에서만 즉시 갱신한다.
          if (!isCameraMotionRef.current) refreshHitMarkerRanges();
          if (!isCameraMotionRef.current && pinnedMarkerRef.current) infoWindowRef.current.close();
        });
        maps.event.addListener(mapRef.current, "dragstart", () => {
          window.clearTimeout(pendingResetTimerRef.current);
          if (!isCameraMotionRef.current && pinnedMarkerRef.current) {
            infoWindowRef.current.close();
          }
        });
        const returnToSavedView = () => {
          if (backgroundResetInProgressRef.current) return;
          if (!pinnedMarkerRef.current && !savedFocusRef.current) return;
          backgroundResetInProgressRef.current = true;
          pinnedMarkerRef.current = null;
          infoWindowRef.current.close();
          isCameraMotionRef.current = true;
          savedFocusRef.current = null;
          smoothCameraTo(mapRef.current, DEFAULT_CENTER, DEFAULT_ZOOM, zoomMotionRef, 900, () => {
            isCameraMotionRef.current = false;
            refreshHitMarkerRangesRef.current?.();
            backgroundResetInProgressRef.current = false;
          });
        };
        maps.event.addListener(mapRef.current, "mousedown", () => {
          window.clearTimeout(pendingResetTimerRef.current);
          pendingResetTimerRef.current = window.setTimeout(() => {
            if (!ignoreBackgroundPointerRef.current) returnToSavedView();
          }, 80);
        });
        maps.event.addListener(mapRef.current, "click", () => {
          window.clearTimeout(pendingResetTimerRef.current);
          if (!ignoreBackgroundPointerRef.current) returnToSavedView();
          ignoreBackgroundPointerRef.current = false;
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(pendingResetTimerRef.current);
      refreshHitMarkerRangesRef.current = null;
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
    hitMarkersRef.current = [];

    if (points.length === 0) return;

    const maxCount = Math.max(...points.map((p) => p.count), 1);
    const showInfoWindow = async (point, marker, requirePinned = false) => {
      const content = await renderHoverPanelHTML({
        title: point.country,
        titleFlag: resolveFlagCode(point.countryCode, point.country),
        subtitle: point.city || undefined,
        rows: [{ color: C.critical, value: `${point.count}건`, label: "탐지" }],
        theme,
      });
      // 확대 완료 직후 패널을 열려는 사이에 사용자가 배경을 클릭하거나 다른
      // 마커를 선택했으면, 이전 선택의 비동기 패널이 다시 나타나지 않게 한다.
      if (requirePinned && pinnedMarkerRef.current !== marker) return;
      infoWindowRef.current.setContent(
        content
      );
      infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
    };
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
      // 마커 자체(marker/coreDot)는 시각 크기 그대로 두고, 투명한 더 큰
      // 심볼을 위에 얹어 hover 인식 범위만 넓힌다(2026-07-17 요청, 2026-07-18
      // 추가 확대: +10 -> +16) - 아이콘의 클릭/hover 판정은 opacity와 무관하게
      // scale(도형 크기) 기준이라 fillOpacity/strokeOpacity를 0으로 둬도 히트
      // 영역은 그대로 넓게 작동한다.
      const hitMarker = new maps.Marker({
        position,
        map: mapRef.current,
        icon: { path: maps.SymbolPath.CIRCLE, scale: r + hitPadForZoom(zoomRef.current), fillOpacity: 0, strokeOpacity: 0 },
        zIndex: Math.round(p.count) + 2000,
      });

      hitMarker.addListener("mouseover", async () => {
        if (!pinnedMarkerRef.current || pinnedMarkerRef.current === hitMarker) showInfoWindow(p, hitMarker);
      });
      hitMarker.addListener("mouseout", () => {
        if (pinnedMarkerRef.current !== hitMarker) infoWindowRef.current.close();
      });
      hitMarker.addListener("click", () => {
        // 지도 background mousedown 예약이 마커 클릭을 복귀로 오인하지 않게 한다.
        ignoreBackgroundPointerRef.current = true;
        window.setTimeout(() => {
          ignoreBackgroundPointerRef.current = false;
        }, 120);
        pinnedMarkerRef.current = hitMarker;
        // 이동 중에는 패널을 비워 두고, 목적지에 도착한 순간에만 표시한다.
        infoWindowRef.current.close();
        isCameraMotionRef.current = true;
        smoothFocusMarker(mapRef.current, position, CLICK_ZOOM, zoomMotionRef, 900, () => {
          isCameraMotionRef.current = false;
          refreshHitMarkerRangesRef.current?.();
          // InfoWindow 콘텐츠는 비동기로 만들어진다. 먼 위치에서 카메라를 크게
          // 이동하면 첫 open 요청이 지도 프레임 갱신과 경합해 사라질 수 있으므로,
          // 확대가 끝난 뒤에도 같은 마커가 선택되어 있을 때 한 번 더 확정한다.
          if (pinnedMarkerRef.current === hitMarker) showInfoWindow(p, hitMarker, true);
        });
      });

      markersRef.current.push(marker, coreDot, hitMarker);
      hitMarkersRef.current.push({ marker: hitMarker, baseRadius: r });
    });
  }, [points, status, compact, C.critical, theme]);

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
