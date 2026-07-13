import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { CHART_COLORS } from "../data/theme";
import { WORLD_COUNTRIES } from "../data/worldCountries";

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const C = CHART_COLORS[theme];

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 2.7);

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
      sprite.userData = { baseScale: scale, phase: Math.random() * Math.PI * 2 };
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

    let raf;
    function animate(t) {
      raf = requestAnimationFrame(animate);
      if (!dragging && t > idleUntil) {
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
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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

  return <div ref={containerRef} className="w-full h-full" />;
}
