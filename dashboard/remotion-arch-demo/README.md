# remotion-arch-demo

SENTINEL-OPS 아키텍처 트리 데모 영상 - 외부 접속이 WAF/Ingress를 거쳐 WAS 3대로 분기되고,
그중 하나(WAS:3)에서 Falco가 컨테이너 내부 쉘 실행을 잡아내는 과정을 스크린샷 없이
CSS 도형(원/사각형)·테두리·box-shadow·텍스트만으로 시각화한 15초짜리 모션그래픽입니다.
스크린샷을 이어붙이는 방식이던 `remotion-onboarding`/`remotion-intro`와 달리, 이 프로젝트는
프레임 단위로 완전히 코드로 그려지는 영상입니다.

## 스펙

- 해상도: 1920x1080 (16:9)
- FPS: 30
- 길이: 15초 (450프레임)
- 컬러: 배경 `#111222`, 정상 `#00ffcc`, 위험 `#ff3366`, 연결선 `#334466`

## 타임라인

| 구간 (프레임) | 시간 | 내용 |
| --- | --- | --- |
| 0~90 | 0~3s | 배경 페이드인 + EXTERNAL ACCESS / WAF·INGRESS 노드 등장 |
| 90~210 | 3~7s | Ingress에서 WAS:1/2/3로 선이 순차적으로 그려지고, 작은 빛이 트래픽처럼 라인을 왕복 |
| 210~330 | 7~11s | WAS:3 아래 Falco 컨테이너 노드(사각형)가 추가되고 색이 청록 → 네온 레드로 전이 + 펄스 |
| 330~450 | 11~15s | "FALCO ALERT: Unauthorized Shell Access" 타이핑 효과로 출력, 영상 종료 |

## 로컬에서 확인/렌더링

```bash
cd dashboard/remotion-arch-demo
npm install
npm run preview   # Remotion Studio로 미리보기 (프레임 단위로 스크럽 가능)
npm run render    # out/arch-tree-demo.mp4 로 렌더링
```

## 구조

- `src/index.js` — `registerRoot` 진입점
- `src/Root.jsx` — `<Composition>` 등록 (id: `ArchTreeDemo`)
- `src/MainVideo.jsx` — 실제 컴포넌트. `Node`(원/사각형 노드), `Edge`(SVG stroke-dashoffset으로
  그려지는 연결선), `TravelingDot`(라인을 순환하는 트래픽 표시광), `AlertPanel`(타이핑 효과 경보
  텍스트)로 구성. 노드 등장은 `spring()`, 색상 전이는 `interpolateColors()`, 그 외 진행도는
  전부 `interpolate()` + `extrapolateLeft/Right: "clamp"`로 처리해 구간을 벗어나도 값이
  튀지 않게 했습니다.
