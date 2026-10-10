# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json* ./

# Install all dependencies for build
RUN npm ci || npm install --legacy-peer-deps

# Copy source code and config
COPY . .

# Build frontend assets
RUN npm run build

# ---------------------------------------------
# Production runner image (minimal footprint)
# ---------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests and install only production dependencies
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev || npm install --omit=dev --legacy-peer-deps) && npm install -g tsx

# Copy built frontend assets and backend source
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Use non-root node user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["tsx", "server.ts"]
