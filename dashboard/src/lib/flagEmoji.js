// ISO 3166-1 alpha-2 국가 코드 -> 유니코드 국기 이모지(Regional Indicator
// Symbol 2개 조합, 예: "KR" -> 🇰🇷). GeoIP 소스(useGeoStats.js)가 이미
// country_iso_code를 alpha-2로 내려주므로 대부분은 이 변환만으로 충분하다.
//
// 코드가 없거나(레거시 데이터) 2자리가 아닌 경우를 대비해, 자주 보이는
// 국가명 -> 코드 매핑을 최소한으로 같이 둔다(data/countryGeo.js의 표시용
// 이름과는 별개 - 여긴 국가명 "문자열"이 코드 없이 들어왔을 때의 fallback).
const COUNTRY_NAME_TO_CODE = {
  "대한민국": "KR",
  "한국": "KR",
  "South Korea": "KR",
  "Korea, Republic of": "KR",
  "United States": "US",
  "미국": "US",
  "China": "CN",
  "중국": "CN",
  "Japan": "JP",
  "일본": "JP",
  "Russia": "RU",
  "러시아": "RU",
  "Germany": "DE",
  "독일": "DE",
  "United Kingdom": "GB",
  "영국": "GB",
  "France": "FR",
  "프랑스": "FR",
  "Netherlands": "NL",
  "네덜란드": "NL",
  "Singapore": "SG",
  "싱가포르": "SG",
  "India": "IN",
  "인도": "IN",
  "Vietnam": "VN",
  "베트남": "VN",
  "Brazil": "BR",
  "브라질": "BR",
  "Canada": "CA",
  "캐나다": "CA",
};

function isAlpha2(code) {
  return typeof code === "string" && /^[A-Za-z]{2}$/.test(code);
}

// 2026-07-17: 유니코드 국기 이모지(Regional Indicator Symbol 조합)로 처음
// 구현했는데, 국기 이모지 폰트가 없는 OS/브라우저에서 이모지가 아니라 그
// 문자 그대로("KR", "CN" 등 알파벳 두 글자)가 보인다는 피드백 - OS/폰트에
// 의존하지 않는 flag-icons(CSS 스프라이트, main.jsx에서 전역 import)로
// 교체한다. flag-icons는 `fi fi-{소문자 alpha-2}` 클래스라 여기서는 코드
// 문자열만 돌려주고(항상 소문자), 실제 렌더링(className 조립)은
// HoverPanel이 한다.
//
// countryCode(ISO alpha-2)를 우선 쓰고, 없으면 국가명 매핑 테이블로 폴백.
// 그래도 못 찾으면 null(호출부에서 국기 없이 표시).
export function resolveFlagCode(countryCode, countryName) {
  if (isAlpha2(countryCode)) return countryCode.toLowerCase();
  const mapped = countryName && COUNTRY_NAME_TO_CODE[countryName];
  if (isAlpha2(mapped)) return mapped.toLowerCase();
  return null;
}
