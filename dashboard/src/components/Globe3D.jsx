import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CHART_COLORS } from "../data/theme";
import { WORLD_COUNTRIES } from "../data/worldCountries";
import { HoverPanel } from "./HoverPanel";
import { resolveFlagCode } from "../lib/flagEmoji";

/**
 * 3D rotating globe for Overview's GeoIP summary (Infrastructure tab keeps
 * the flat WorldMap — this is Overview's more "화려한" hero visual).
 *
 * No new map/geo runtime dependency beyond three.js itself: the same
 * pre-projected equirectangular country outlines used by WorldMap.jsx
 * (data/worldCountries.js, 1000x460 canvas space) are rasterized onto an
 * offscreen 2D canvas and used as a sphere texture, instead of pulling in a
 * texture image or a dedicated globe library.
 *
 * lat/lon -> 3D placement for the GeoIP marker sprites is derived to match
 * THREE.SphereGeometry's actual default UV layout (verified empirically
 * against the geometry's own uv attribute, not guessed from a tutorial):
 *   x = r * sin(phi) * cos(lon)
 *   y = r * cos(phi)
 *   z = -r * sin(phi) * sin(lon)
 *   where phi = radians(90 - lat), lon in radians (unshifted).
 */

const RADIUS = 1;
const TEX_W = 1000;
const TEX_H = 460;

// 다크 테마에서는 화이트 지구본이 잘 어울려서 카드 배경(C.surface/surfaceAlt)
// 대신 반전된 톤을 쓴다. 라이트 테마는 반전판이 별로라 원래대로(테마와 같은
// 톤, 곧 C.surface/surfaceAlt) 되돌림 — dark만 override, light는 null이면
// buildEarthTexture에서 C를 그대로 쓰게 되어있음.
const GLOBE_INVERTED_COLORS = {
  dark: { ocean: "#F5F7FF", land: "#C7CCE0" },
  light: null,
};

function buildEarthTexture(C, theme) {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  const globeColors = GLOBE_INVERTED_COLORS[theme] || { ocean: C.surface, land: C.surfaceAlt };

  ctx.fillStyle = globeColors.ocean;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.fillStyle = globeColors.land;
  ctx.strokeStyle = C.mint;
  ctx.lineWidth = 0.7;
  WORLD_COUNTRIES.forEach((c) => {
    const path = new Path2D(c.d);
    ctx.fill(path);
    ctx.globalAlpha = 0.4;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildGlowSprite(hexColor) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `${hexColor}FF`);
  grd.addColorStop(0.35, `${hexColor}AA`);
  grd.addColorStop(1, `${hexColor}00`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function latLonToVec3(lat, lon, radius) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    -radius * Math.sin(phi) * Math.sin(theta)
  );
}

export default function Globe3D({ points = [], theme = "dark" }) {
  const containerRef = useRef(null);
  const [hover, setHover] = useState(null); // { point, x, y }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const C = CHART_COLORS[theme];

    const scene = new THREE.Scene();
    // 2026-07-19 버그 수정 - "카드를 키웠는데 지구본 위/아래가 그대로 잘린다":
    // FOV(42°)와 카메라 거리(2.7)의 조합 자체가 원래부터 지구본(대기광 셸까지
    // 포함한 반지름 1.06)보다 좁았다 - asin(1.06/2.7)≈23.1°는 세로 FOV의 절반
    // (21°)보다 큼, 즉 카드/컨테이너 크기와 무관하게 항상 각도상으로 살짝
    // 잘리는 구조였다(카드를 키우면 잘리는 절대 픽셀 수만 커져서 더 눈에 띔).
    // 컨테이너를 더 키운다고 고쳐지는 게 아니라 카메라를 더 물러세워야 한다 -
    // asin(1.06/distance)가 세로 FOV 절반의 90%(여유 10%) 안에 들어오도록
    // distance를 2.7 -> 3.3으로 늘렸다(대기광 셸까지 포함해 프레임 안에 다
    // 들어옴). FOV를 넓히는 대신 거리를 늘린 이유: FOV를 바꾸면 구체가
    // 어안렌즈처럼 왜곡되는데, 거리만 늘리면 원근감은 그대로 유지된다.
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 3.3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.cursor = "grab";

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Earth sphere
    const earthTexture = buildEarthTexture(C, theme);
    const earthMat = new THREE.MeshPhongMaterial({ map: earthTexture, shininess: 6 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 64, 64), earthMat);
    globeGroup.add(earth);

    // Faint lat/lon graticule shell for a "tech" overlay feel
    const graticule = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.003, 24, 16),
      new THREE.MeshBasicMaterial({ color: C.mint, wireframe: true, transparent: true, opacity: 0.06 })
    );
    globeGroup.add(graticule);

    // Outer atmosphere glow (backside-lit translucent shell)
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.06, 48, 48),
      new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0.06, side: THREE.BackSide })
    );
    globeGroup.add(atmosphere);

    // GeoIP markers
    const maxCount = Math.max(...points.map((p) => p.count), 1);
    const markerColor = C.critical;
    const glowTex = buildGlowSprite(markerColor);
    const markerSprites = points.map((p) => {
      const pos = latLonToVec3(p.lat, p.lon, RADIUS * 1.015);
      const scale = 0.05 + (p.count / maxCount) * 0.09;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false })
      );
      sprite.position.copy(pos);
      sprite.scale.set(scale, scale, 1);
      sprite.userData = { baseScale: scale, phase: Math.random() * Math.PI * 2, point: p };
      globeGroup.add(sprite);
      return sprite;
    });

    const ambient = new THREE.AmbientLight(0x8890b5, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 2, 4);
    scene.add(ambient, dir);

    // Resize handling
    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Auto-rotate + drag-to-rotate
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let idleUntil = 0;

    function onPointerDown(e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.style.cursor = "grabbing";
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      globeGroup.rotation.y += dx * 0.005;
      globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x + dy * 0.005, -1.1, 1.1);
    }
    function onPointerUp() {
      dragging = false;
      idleUntil = performance.now() + 1500;
      renderer.domElement.style.cursor = "grab";
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    // 마커 hover 툴팁 ("국가 · 도시 · N건") - 드래그 중에는 레이캐스트를 생략해서
    // 회전 중 깜빡이는 걸 막는다.
    const raycaster = new THREE.Raycaster();
    // 마커 자체 크기(스프라이트 scale)는 그대로 두고 감지 반경만 넓힌다 -
    // 기본 0.02는 작은 마커 위에서 커서를 거의 정확히 맞춰야만 hover가 잡혀서
    // 너무 빡빡했다(2026-07-17 요청, 2026-07-18 추가 확대: 0.08 -> 0.14).
    raycaster.params.Sprite = { threshold: 0.14 };
    const pointerNdc = new THREE.Vector2();

    // hover 중인 마커가 있으면 자동 회전을 멈추고, hover가 끝나도 곧바로
    // 재개하지 않고 0.5초 뒤에 재개한다(2026-07-17 요청, 1초→0.5초로 단축) -
    // 0.5초 안에 다른 마커로 다시 hover하면 타이머를 취소해서 계속 멈춰있게 한다.
    let hoverPaused = false;
    let hoverResumeTimer = null;

    function onHoverMove(e) {
      if (dragging) {
        setHover(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      // Sprite raycast는 깊이 버퍼를 보지 않아 지구 반대편 마커까지 맞을 수 있다.
      // 같은 광선이 지구 표면을 먼저 만난 뒤에 있는 마커는 뒤편이므로 제외한다.
      const earthHit = raycaster.intersectObject(earth)[0];
      const hit = raycaster
        .intersectObjects(markerSprites)
        .find((markerHit) => !earthHit || markerHit.distance <= earthHit.distance + 0.03);
      if (hit) {
        clearTimeout(hoverResumeTimer);
        hoverPaused = true;
        setHover({ point: hit.object.userData.point, x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setHover(null);
        if (hoverPaused) {
          clearTimeout(hoverResumeTimer);
          hoverResumeTimer = setTimeout(() => {
            hoverPaused = false;
          }, 500);
        }
      }
    }
    function onHoverLeave() {
      setHover(null);
      if (hoverPaused) {
        clearTimeout(hoverResumeTimer);
        hoverResumeTimer = setTimeout(() => {
          hoverPaused = false;
        }, 500);
      }
    }
    renderer.domElement.addEventListener("pointermove", onHoverMove);
    renderer.domElement.addEventListener("pointerleave", onHoverLeave);

    let raf;
    function animate(t) {
      raf = requestAnimationFrame(animate);
      if (!dragging && !hoverPaused && t > idleUntil) {
        globeGroup.rotation.y += 0.0016;
      }
      markerSprites.forEach((s) => {
        const pulse = 1 + Math.sin(t * 0.003 + s.userData.phase) * 0.18;
        s.scale.set(s.userData.baseScale * pulse, s.userData.baseScale * pulse, 1);
      });
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hoverResumeTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onHoverMove);
      renderer.domElement.removeEventListener("pointerleave", onHoverLeave);
      setHover(null);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [points, theme]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {hover && (
        <div className="pointer-events-none absolute z-10" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <HoverPanel
            title={hover.point.country}
            titleFlag={resolveFlagCode(hover.point.countryCode, hover.point.country)}
            subtitle={hover.point.city || undefined}
            rows={[{ color: CHART_COLORS[theme].critical, value: `${hover.point.count}건`, label: "탐지" }]}
            theme={theme}
          />
        </div>
      )}
    </div>
  );
}
