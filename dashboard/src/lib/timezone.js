// 대시보드 전체가 시간을 표시할 때 쓰는 타임존 - 하드코딩해서 여기저기 흩어두지
// 않고 이 한 곳에서만 정의한다. 브라우저의 로컬 타임존에 의존하면 대시보드를 보는
// 컴퓨터마다 표시가 달라지므로(실측 확인, 팀원 컴퓨터가 UTC라 시간이 다르게 보임)
// 항상 이 값으로 고정해서 렌더한다.
//
// 배포 시 서버 타임존과 맞추려면 코드를 고칠 필요 없이 VITE_DISPLAY_TIMEZONE
// 환경변수만 설정하면 된다(.env.example 참고) - IANA 타임존 이름(예: "UTC",
// "Asia/Seoul") 아무거나 가능, Intl.DateTimeFormat이 그대로 받아들인다.
export const DISPLAY_TIMEZONE = import.meta.env.VITE_DISPLAY_TIMEZONE ?? "Asia/Seoul";
