FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY web/package.json ./web/
# Create stubs for workspaces not present so npm lockfile stays consistent
RUN mkdir -p backend mobile && echo '{"name":"@expense-tracker/backend","version":"1.0.0","private":true}' > backend/package.json && echo '{"name":"@expense-tracker/mobile","version":"1.0.0","private":true}' > mobile/package.json
RUN npm install --legacy-peer-deps
# Build shared package so web can resolve @expense-tracker/shared
WORKDIR /app/shared
RUN ../node_modules/.bin/tsc
WORKDIR /app

FROM base AS development
COPY web/ ./web/
WORKDIR /app/web
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host"]

FROM base AS build
COPY web/ ./web/
WORKDIR /app/web
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
