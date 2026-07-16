import React, { useRef, useState } from "react";

// 2026-07-16(2차): 로그인 페이지의 온보딩 카드 5개(Overview/Incidents/ATT&CK/
// Infrastructure/Admin)를 LoginScreen.jsx 안에 전부 몰아넣었던 걸 "각 페이지마다
// 각 컴포넌트로" 분리해달라는 요청 - 페이지별 온보딩 영상 제작(교체/추가)을
// 나중에 페이지 단위로 독립적으로 진행할 수 있게 하기 위함. 이 파일은 실제
// 카드 UI(영상/이미지/플레이스홀더 + 재생 버튼)를 그리는 공용 렌더러이고,
// 이 폴더 안의 OverviewOnboardingCard.jsx 등 5개 파일이 각자 자기 page 데이터
// (label/desc/video/image)만 들고 이 컴포넌트를 감싼다.
//
// video/image는 아직 실제 파일이 없어서 지금은 항상 플레이스홀더가 뜬다 -
// dashboard/public/onboarding/ 아래에 같은 파일명으로 넣으면(예: overview.mp4)
// 바로 그 자리에 재생된다. Vite는 public/ 밑을 그대로 빌드 결과물 루트로
// 복사하므로 코드에서는 "/onboarding/xxx.mp4"처럼 절대경로로 참조하면 된다
// (로컬 개발 서버·Vercel 배포 둘 다 동일하게 동작).
//
// 미디어 로드 실패는 카드별로 독립 추적(각 카드가 자기 state를 들고 있음) -
// 영상이 없거나 깨졌으면 이미지로, 이미지도 없으면 플레이스홀더 블록으로 조용히
// 대체한다(로고와 같은 onError 폴백 패턴). 이미지가 object-contain인 이유는
// 대시보드 스크린샷은 폭이 넓은 경우가 많아서 object-cover로 자르면 양옆이
// 잘려나가 "화면이 깨진 것처럼" 보인다는 피드백 때문 - 검정 레터박스를 감수하고
// 원본 비율 그대로 다 보이게 했다.
export default function OnboardingCard({ page }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // 2026-07-16: 자동재생 영상을 사용자가 멈출 수 있어야 한다는 피드백 - video
  // 엘리먼트를 ref로 직접 잡고 play()/pause()를 토글한다. isPlaying은 autoPlay
  // 기본값(true)에서 시작해서 버튼을 누를 때만 바뀐다.
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);

  const showVideo = page.video && !videoFailed;
  const showImage = !showVideo && page.image && !imageFailed;
  const showPlaceholder = !showVideo && !showImage;

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }

  return (
    <div>
      {/* 2026-07-16: 설명 문구가 영상 "아래"에 있던 걸 "위"로 옮겨달라는 요청 -
          텍스트 블록을 미디어 박스보다 먼저 렌더링한다. */}
      <div className="pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white/60 shrink-0" />
          <p className="text-white text-sm font-semibold">{page.label}</p>
        </div>
        <p className="text-white/55 text-xs leading-relaxed">{page.desc}</p>
      </div>

      {/* 2026-07-16: 페이지 전체 폭을 1240px 스케일로 넓히면서 미디어 박스도
          고정 h-96 대신 aspect-video(16:9)로 바꿔 넓어진 폭에 맞춰 자연스럽게
          커지도록 했다(넓은 화면에서는 커지고, 좁은 화면에서는 알아서 줄어듦). */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black/50 border border-white/10">
        {showVideo && (
          <video
            ref={videoRef}
            src={page.video}
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        {showImage && (
          <img
            src={page.image}
            alt={page.label}
            className="w-full h-full object-contain bg-black"
            onError={() => setImageFailed(true)}
          />
        )}
        {showPlaceholder && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <span className="text-white/35 text-xs">{page.label} 화면 준비 중</span>
          </div>
        )}

        {showVideo && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "영상 멈추기" : "영상 재생"}
            className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
          >
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="4" height="12" rx="1" />
                <rect x="9" y="2" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2.5v11l10-5.5-10-5.5Z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
