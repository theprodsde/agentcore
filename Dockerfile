FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend + server bundles
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# Versioned migration files, applied at startup via drizzle-orm's migrator
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

RUN npm ci --omit=dev

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Run migrations (safe, idempotent) then start the server.
# Uses drizzle-orm's bundled migrator — no drizzle-kit needed in the prod image.
CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/server.cjs"]
