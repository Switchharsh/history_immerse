# Cloud Run image for the Parley engine.
#
# Built from the repo root, not from engine/, because the engine reads cards/ and
# scenarios/ off disk:
#   docker build -f engine/Dockerfile -t parley-engine .
FROM node:24-slim AS deps
WORKDIR /app
COPY engine/package.json engine/package-lock.json* ./engine/
# Firestore and firebase-admin are optionalDependencies; omit them unless the deployment
# actually uses PARLEY_STORE=firestore, and the image stays much smaller.
RUN cd engine && npm ci --omit=dev --no-audit --no-fund

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=deps /app/engine/node_modules ./engine/node_modules
COPY engine/package.json ./engine/
COPY engine/src ./engine/src
COPY engine/scripts ./engine/scripts
# Content is baked into the image so a cold start needs no network to serve /api/characters.
COPY cards ./cards
COPY scenarios ./scenarios
COPY schemas ./schemas

# Cloud Run terminates as this user; nothing here needs root.
USER node
EXPOSE 8080
CMD ["node", "engine/src/index.js"]
