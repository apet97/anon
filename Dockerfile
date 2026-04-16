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

# tini as PID 1 for clean signal handling; su-exec to drop to the node user
# at runtime after fixing volume-mount ownership.
RUN apk add --no-cache tini su-exec

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package.json ./package.json
# pumble-sdk reads manifest.json from CWD at startup to learn the app shape
# (name, scopes, slash commands, event subscriptions). Ship it into the
# runtime image explicitly — it's not code so it doesn't go through dist/.
COPY --chown=node:node manifest.json ./manifest.json

# The data directory is the mount point for the platform-managed persistent
# volume (Railway / fly.io / K8s). Don't declare `VOLUME` here — Railway
# rejects that directive. We also can't declare `USER node` because Railway
# mounts the volume as root, so our entrypoint starts as root, chowns
# /app/data to node:node, then `exec su-exec` drops privileges for the main
# process. The node user runs node dist/main.js as PID 1 (under tini).
RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 3000

# nosemgrep: dockerfile.security.missing-user.missing-user
# nosemgrep: yaml.dockerfile.security.missing-user.missing-user
# Intentional: no trailing USER directive. Railway mounts the persistent
# volume as root, so the container MUST start as root, then
# `chown -R node:node /app/data`, then `exec su-exec node ...` drops
# privileges before the main process runs. The effective runtime user
# is `node`. See the comment above the `mkdir /app/data` line.
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health || exit 1
# H-2: chmod 700 /app/data after chown so only the `node` user can read the
# SQLite DB + WAL sidecars containing plaintext Pumble tokens. Matches the
# "Tokens at rest" section in SECURITY.md.
# nosemgrep: dockerfile.security.missing-user.missing-user
# nosemgrep: yaml.dockerfile.security.missing-user.missing-user
CMD ["sh", "-c", "chown -R node:node /app/data && chmod 700 /app/data && exec su-exec node node dist/main.js"]
