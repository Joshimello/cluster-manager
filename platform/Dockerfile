# syntax=docker/dockerfile:1

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
EXPOSE 5173
CMD ["sh", "-c", "npm run db:migrate:runtime && if [ \"$NODE_DEV_SEED_WORKSTATIONS\" = \"true\" ]; then npm run dev:seed-workstations; fi && npm run dev -- --host 0.0.0.0"]

FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate:runtime && node build"]
