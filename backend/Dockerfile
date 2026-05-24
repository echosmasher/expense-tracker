FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY backend/package.json ./backend/
# Create stubs for workspaces not present so npm lockfile stays consistent
RUN mkdir -p web mobile && echo '{"name":"@expense-tracker/web","version":"1.0.0","private":true,"dependencies":{"react":"^18.3.0","react-dom":"^18.3.0"}}' > web/package.json && echo '{"name":"@expense-tracker/mobile","version":"1.0.0","private":true}' > mobile/package.json
# Drop the host lockfile: it pins react@18.2.0 at root (forced by the mobile
# workspace's expo/react-native pins on the host), which conflicts with
# react-dom@18.3.1's peer requirement once mobile is stubbed out here.
RUN rm -f package-lock.json && npm install --legacy-peer-deps
# Build shared package so backend can resolve @expense-tracker/shared
WORKDIR /app/shared
RUN ../node_modules/.bin/tsc
WORKDIR /app

FROM base AS development
COPY backend/ ./backend/
WORKDIR /app/backend
EXPOSE 3001
CMD ["npm", "run", "dev"]

FROM base AS build
COPY backend/ ./backend/
WORKDIR /app/backend
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY backend/package.json ./backend/
RUN mkdir -p web mobile && echo '{"name":"@expense-tracker/web","version":"1.0.0","private":true,"dependencies":{"react":"^18.3.0","react-dom":"^18.3.0"}}' > web/package.json && echo '{"name":"@expense-tracker/mobile","version":"1.0.0","private":true}' > mobile/package.json
RUN npm install --omit=dev --legacy-peer-deps
WORKDIR /app/shared
RUN ../node_modules/.bin/tsc
WORKDIR /app
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/index.js"]
