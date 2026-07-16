# 제품 소개 데모 영상 (Remotion)

로그인부터 조치 완료까지 이어지는 스토리로 구성한 소개 영상.

## 구성 순서 (8장면 · 장면당 2.5초 · 총 20초)

1. 로그인 — `1. login.png` (풀블리드, 프레임 없이 전체 화면)
2. 검색창으로 바로 로그 검색 — `search.png`
3. 들어오는 공격 확인 — `att&ck .png` (ATT&CK 매트릭스 전체)
4. 조치하러 바로 이동 — `att&zoom.png` ("조치하러 가기" 버튼 클로즈업, 더 강한 줌)
5. 공격 스토리라인 확인 — `incident.png` (인시던트 상세/타임라인)
6. 조사 시작 — `incident2.png` (버튼 클로즈업, 더 강한 줌)
7. 조치 완료 — `incident3.png` (버튼 클로즈업, 더 강한 줌)
8. 공격 발원지 확인 — `geoip.png` (GeoIP 지도)

8개 스크린샷 모두 스토리에 쓰여서 버린 이미지는 없습니다.

## 로컬에서 실행하기

```bash
cd dashboard/remotion-intro
npm install
npm run preview   # npx remotion studio - 브라우저에서 실시간 미리보기/편집
npm run render    # out/intro-demo.mp4로 렌더링
```

## 커스터마이징

- `src/IntroDemo.jsx`의 `SCENES` 배열 - 순서/자막/파일명 수정
- `SCENE_DURATION_SEC` - 장면당 길이(초), 전체 길이도 같이 바뀜
- `emphasize: true` - 클로즈업 컷에서 줌을 더 세게(1.08배) 주는 플래그, 필요하면 다른 장면에도 붙이면 됨
- `fullBleed: true` - 카드 프레임 없이 화면 전체를 채우는 플래그 (로그인처럼 이미 완성된 화면일 때)
