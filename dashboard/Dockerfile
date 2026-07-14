# 대시보드(Vite/React) 프로덕션 이미지 - 멀티스테이지 빌드.
#
# 1단계(build): Node로 `vite build`를 돌려 정적 파일(dist/)을 만든다.
# 2단계(serve): 그 정적 파일만 nginx 이미지에 담아 서빙한다 - 최종 이미지에
# node_modules/소스가 전혀 들어가지 않아 훨씬 가볍다.
#
# VITE_API_BASE_URL은 따로 안 넘긴다 - 기본값(빈 문자열 -> "/api")이 그대로
# 맞다. 이 이미지는 servers/docker-compose.yml에서 Traefik 뒤에 platform-api와
# 같은 origin(:80)으로 붙어서 뜨도록 배포하기 때문에(README "프론트엔드 연동
# API" 절 참고), 상대경로 "/api"가 곧 Traefik이 platform-api로 프록시하는
# 경로와 일치한다.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
