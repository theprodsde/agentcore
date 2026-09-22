FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend + server bundles.
# agentcore-mcp.cjs is built without --packages=external so it is
# fully self-contained and needs no node_modules at runtime.
RUN npm run build

# ── Main server image ────────────────────────────────────────────────────────

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

RUN npm ci --omit=dev

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/server.cjs"]

# ── MCP server image (used by Glama and Claude Desktop / Claude Code) ────────
# Self-contained: agentcore-mcp.cjs bundles all dependencies.
# Requires AGENTCORE_URL pointing to a running AgentCore server.

FROM node:24-alpine AS mcp

WORKDIR /app

COPY --from=builder /app/dist/tools/agentcore-mcp.cjs ./dist/tools/agentcore-mcp.cjs

CMD ["node", "dist/tools/agentcore-mcp.cjs"]
