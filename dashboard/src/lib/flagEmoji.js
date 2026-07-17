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

// A(65)~Z(90) -> Regional Indicator Symbol Letter A~Z(1F1E6~1F1FF), 대문자
// 알파벳 코드포인트 차이만큼 그대로 옮기면 된다.
function alpha2ToFlagEmoji(code) {
  const upper = code.toUpperCase();
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}

// countryCode(ISO alpha-2)를 우선 쓰고, 없으면 국가명 매핑 테이블로 폴백.
// 그래도 못 찾으면 빈 문자열(호출부에서 그냥 국기 없이 표시).
export function countryToFlagEmoji(countryCode, countryName) {
  if (isAlpha2(countryCode)) return alpha2ToFlagEmoji(countryCode);
  const mapped = countryName && COUNTRY_NAME_TO_CODE[countryName];
  if (isAlpha2(mapped)) return alpha2ToFlagEmoji(mapped);
  return "";
}
