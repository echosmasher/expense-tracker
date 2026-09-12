FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY backend/package.json ./backend/
# Create a stub for the workspace not present so npm lockfile stays consistent
RUN mkdir -p web && echo '{"name":"@expense-tracker/web","version":"1.0.0","private":true,"dependencies":{"react":"^18.3.0","react-dom":"^18.3.0"}}' > web/package.json
RUN npm install --legacy-peer-deps
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
# tsc only compiles .ts files - the raw .sql migrations never land in dist/,
# but migrate.ts resolves MIGRATIONS_DIR relative to its own compiled location.
RUN cp -r src/db/migrations dist/db/migrations

FROM node:20-alpine AS production
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY backend/package.json ./backend/
RUN mkdir -p web && echo '{"name":"@expense-tracker/web","version":"1.0.0","private":true,"dependencies":{"react":"^18.3.0","react-dom":"^18.3.0"}}' > web/package.json
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/index.js"]
