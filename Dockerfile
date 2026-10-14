# ==============================================================================
# Multi-stage Dockerfile for Team Access Control API (Node.js 22 Slim)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Dependencies
# ------------------------------------------------------------------------------
FROM node:22-slim AS builder

# Install OpenSSL required by Prisma CLI & schema generation
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies for build
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and TypeScript configuration
COPY tsconfig.json ./
COPY src ./src/

# Compile TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep production image footprint minimal
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-slim AS runner

# Install OpenSSL for Prisma engine and curl for healthcheck
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy application files and runtime dependencies with non-root ownership
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

# Run as non-root user for security
USER node

EXPOSE 3000

# Periodic health check against the public health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

# Production start command
CMD ["npm", "run", "start:prod"]
