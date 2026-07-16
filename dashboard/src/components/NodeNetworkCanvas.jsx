import { useEffect, useRef } from "react";

// LoginScreen 왼쪽 브랜드 패널의 배경 애니메이션. theme prop이 바뀌어도 애니메이션
// 루프/노드 위치를 리셋하지 않도록 themeRef로만 색을 넘기고 effect는 마운트 시
// 한 번만 돈다(빈 deps) - 로그인 폼 입력 중 리렌더가 나도 캔버스는 안 끊긴다.
const NODE_COLORS = {
  dark: { node: "rgba(93, 202, 165, 0.35)", line: "rgba(93, 202, 165, 0.1)" },
  light: { node: "rgba(255, 255, 255, 0.4)", line: "rgba(255, 255, 255, 0.12)" },
};

const CONNECT_DISTANCE = 140;
const NODE_RADIUS = 1.5;
const LINE_WIDTH = 0.6;
const MAX_SPEED = 0.22;

export default function NodeNetworkCanvas({ theme }) {
  const canvasRef = useRef(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let nodes = [];
    let width = 0;
    let height = 0;
    let frameId = null;

    function seedNodes() {
      const count = Math.max(10, Math.round(width / 60));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() * 2 - 1) * MAX_SPEED,
        vy: (Math.random() * 2 - 1) * MAX_SPEED,
      }));
    }

    function resize() {
      const parent = canvas.parentElement;
      width = parent.clientWidth;
      height = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedNodes();
    }

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement);

    function frame() {
      const colors = NODE_COLORS[themeRef.current] || NODE_COLORS.dark;
      ctx.clearRect(0, 0, width, height);

      if (!reduceMotion) {
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x <= 0 || n.x >= width) n.vx *= -1;
          if (n.y <= 0 || n.y >= height) n.vy *= -1;
          n.x = Math.min(Math.max(n.x, 0), width);
          n.y = Math.min(Math.max(n.y, 0), height);
        }
      }

      ctx.lineWidth = LINE_WIDTH;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < CONNECT_DISTANCE) {
            ctx.globalAlpha = 1 - d / CONNECT_DISTANCE;
            ctx.strokeStyle = colors.line;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = colors.node;
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduceMotion) {
        frameId = requestAnimationFrame(frame);
      }
    }

    frame();

    return () => {
      resizeObserver.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
