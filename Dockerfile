FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# --- Runtime ---
FROM oven/bun:1-alpine

# Install dig (bind-tools) and whois for domain lookups
RUN apk add --no-cache bind-tools whois

WORKDIR /app

# Copy built static files and API server
COPY --from=builder /app/build ./build
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["bun", "scripts/api-server.ts"]
