// ============================================================================
// TODO: 실제 OAuth 구현 시 이 파일의 connectSlack()/connectDiscord()를 교체 필요
//
// Slack/Discord 앱 등록이 아직 안 끝나서(2026-07-18) 실제 인증 없이 더미 토큰으로
// 즉시 "연결됨" 상태를 만든다. 실제 흐름으로 바꿀 때는 각 함수를 아래처럼 교체할 것:
//
//   connectSlack():
//     1. https://slack.com/oauth/v2/authorize?client_id=...&scope=chat:write
//        로 브라우저를 리다이렉트
//     2. 콜백에서 받은 code를 백엔드로 넘겨 oauth.v2.access로 토큰 교환
//        (교환 자체는 서버에서 하고 access_token은 브라우저에 절대 노출하지 않을 것 -
//        지금 목업처럼 프론트가 access_token을 들고 있다가 그대로 POST하는 방식은
//        실제 연동에서는 쓰면 안 됨)
//     3. 교환된 값(access_token/workspace_name/channel_id)만 저장 API로 전달
//
//   connectDiscord(): 동일한 패턴, https://discord.com/api/oauth2/authorize +
//     콜백에서 code -> token 교환
//
// 아래 두 함수는 그 전체 리다이렉트/콜백 왕복을 건너뛰고 반환값만 흉내낸다 - 호출하는
// 쪽(useReportIntegrations.js)은 실제 OAuth로 바뀌어도 이 함수들의 반환 shape
// ({access_token, workspace_or_server_name, channel_id})만 유지되면 코드를 바꿀
// 필요가 없다.
// ============================================================================

// 목업: 실제 인증 없이 더미 토큰으로 즉시 "연결됨" 처리
export async function connectSlack() {
  return {
    access_token: "mock-slack-token-xxxx",
    workspace_or_server_name: "테스트 워크스페이스",
    channel_id: "mock-slack-channel-id",
  };
}

// 목업: 실제 인증 없이 더미 토큰으로 즉시 "연결됨" 처리
export async function connectDiscord() {
  return {
    access_token: "mock-discord-token-xxxx",
    workspace_or_server_name: "테스트 서버",
    channel_id: "mock-discord-channel-id",
  };
}
