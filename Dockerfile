# syntax=docker/dockerfile:1.7
#
# Two-stage build for the Anon Pumble bot.
#
# Stage 1 installs every dependency (including dev) and compiles
# the TypeScript source plus copies the .sql migrations into dist/.
# Stage 2 is a slim runtime image with only production deps and the
# compiled output.
#
# The runtime image runs as the built-in `node` user (UID 1000) and
# listens on port 3000 by default. Configuration comes from env
# vars (see .env.example and SECURITY.md); the container never reads
# a .pumbleapprc file.

############################
# Stage 1 — build
############################
FROM node:24.14-alpine AS build
WORKDIR /app

# better-sqlite3 needs a C toolchain to build from source on alpine
RUN apk add --no-cache --virtual .build-deps python3 make g++ sqlite-dev

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# Prune dev dependencies to shrink the final image
RUN npm prune --omit=dev

############################
# Stage 2 — runtime
############################
FROM node:24.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/anon.db

# tini as PID 1 for clean signal handling
RUN apk add --no-cache tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# The data directory is a mount point for the persistent SQLite file.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
