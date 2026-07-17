# 온보딩 데모 영상 (Remotion)

로그인 페이지에 띄울 온보딩 영상을 컴포넌트로 구성한 Remotion 프로젝트.
`public/`에 저장된 8개 스크린샷(4개 화면 × 다크/화이트)을 순서대로 이어서 만든다.

## 구성 순서

Overview(다크→화이트) → Incidents(다크→화이트) → ATT&CK(다크→화이트) → Infrastructure(다크→화이트)

Admin 페이지는 스크린샷이 없어서 제외했다. 장면당 2.5초, 총 8장면 = 20초.

## 로컬에서 실행하기

```bash
cd dashboard/remotion-onboarding
npm install
npm run preview   # npx remotion studio - 브라우저에서 실시간 미리보기/편집
```

미리보기에서 마음에 들면 렌더링:

```bash
npm run render    # out/onboarding-demo.mp4로 저장됨
```

## 커스터마이징

- `src/OnboardingDemo.jsx`의 `SCENES` 배열 - 순서/라벨/파일명 수정
- `SCENE_DURATION_SEC` - 장면당 길이(초) 조절, 전체 길이도 같이 바뀜
- `Scene` 컴포넌트 안 `scale`(켄번즈 줌 정도), `fadeIn`/`fadeOut` 프레임 수 - 애니메이션 느낌 조절
- 렌더링된 mp4를 `dashboard/public/onboarding/`에 넣고 `LoginScreen.jsx` 쪽에서 사용하면 됨
