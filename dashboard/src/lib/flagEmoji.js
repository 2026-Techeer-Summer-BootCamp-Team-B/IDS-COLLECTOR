// ISO 3166-1 alpha-2 국가 코드(예: "KR", "US")를 국기 이모지로 변환.
// 유니코드 Regional Indicator Symbol(🇦~🇿, U+1F1E6~U+1F1FF)은 A~Z를 그대로
// 코드포인트 오프셋만큼 밀어서 만들 수 있어 별도 매핑 테이블 없이 계산 가능.
// (2026-07-18: GeoIP 지도 툴팁에 국가 이모지도 같이 보여달라는 요청으로 추가 -
// 지도 위 빨간 점 hover 시 "나라 · 도시 · 건수" 텍스트 앞에 국기를 붙인다.)
const REGIONAL_INDICATOR_OFFSET = 127397; // 0x1F1E6 - 'A'.charCodeAt(0)(65)

export function countryCodeToFlagEmoji(code) {
  if (!code || typeof code !== "string") return "";
  const cc = code.trim().toUpperCase();
  // 2글자 알파벳 ISO 코드가 아니면(드문 지역코드/미상 등) 국기를 표시하지 않는다 -
  // 잘못된 이모지(빈 사각형 등)를 보여주는 것보다 낫다.
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(
    ...[...cc].map((ch) => ch.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET)
  );
}
