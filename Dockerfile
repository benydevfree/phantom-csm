# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user (security best-practice)
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER app

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Default: API — override with `command: node dist/worker.js` for the worker
CMD ["node", "dist/index.js"]
