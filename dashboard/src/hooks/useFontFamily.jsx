// 2026-07-17: 글씨체 선택 기능 제거됨 - 대시보드 전역 글씨체는 Noto Sans KR로
// 고정 (index.css의 body font-family 참고). 이 파일은 더 이상 어디에서도
// import되지 않는 죽은 코드라 삭제해도 안전합니다 - 이 세션의 샌드박스에서는
// 마운트된 폴더에 대한 삭제 권한이 없어서 파일 자체를 지우지 못하고 내용만
// 비웠습니다. `git rm dashboard/src/hooks/useFontFamily.jsx`로 직접 지워주세요.
export {};
