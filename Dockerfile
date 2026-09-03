FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend + server bundles
RUN npm run build

# Generate versioned migration files from the schema.
# drizzle-kit generate reads only the schema — no DATABASE_URL needed here.
RUN npx drizzle-kit generate

FROM node:24-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# Migration files and config needed by drizzle-kit migrate at startup
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src/server/db ./src/server/db

RUN npm ci --omit=dev

EXPOSE 3000

# Run migrations (safe, idempotent) then start the server
CMD ["sh", "-c", "npx drizzle-kit migrate && node dist/server.cjs"]
