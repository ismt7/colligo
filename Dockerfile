# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
#   Installs ALL dependencies, generates the Prisma client, and compiles
#   TypeScript so the output in /app/dist is ready to run.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Ensure Prisma detects OpenSSL 3 on Alpine during client generation.
RUN apk add --no-cache openssl

# Copy manifests first to exploit layer caching on dependency installs.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy the Prisma schema and generate the client.
COPY prisma ./prisma
RUN npx prisma generate

# Copy the remaining source and compile.
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime
#   Slim image that only contains what is needed to run the compiled app.
#   Both the API and the worker use this same image; the service command
#   (node dist/api/index.js vs node dist/worker/index.js) is specified in
#   docker-compose.yml.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Prisma CLI/engines require OpenSSL on Alpine.
RUN apk add --no-cache openssl

# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy the generated Prisma client and migration files.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY prisma ./prisma

# Copy the compiled JavaScript.
COPY --from=builder /app/dist ./dist

# Run as a non-root user for security.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

# The default command starts the API server.
# Override with `node dist/worker/index.js` for the worker service.
CMD ["node", "dist/api/index.js"]
