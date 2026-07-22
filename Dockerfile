# Use Node.js 18 LTS Alpine image for smaller size
FROM node:18-alpine AS base

# Install security updates and necessary packages
RUN apk update && apk upgrade && \
    apk add --no-cache dumb-init curl && \
    rm -rf /var/cache/apk/*

# Create app directory with proper permissions
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Dependencies stage
FROM base AS dependencies

# Copy package files explicitly (package-lock.json is optional with *)
COPY package.json package-lock.json* ./

# Install production dependencies only
# Use --omit=dev instead of deprecated --only=production
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev && npm cache clean --force; \
    else \
      npm install --omit=dev && npm cache clean --force; \
    fi

# Build stage
FROM base AS build

# Copy package files explicitly (package-lock.json is optional with *)
COPY package.json package-lock.json* ./

# Install all dependencies (including dev dependencies)
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy source code
COPY . .

# Remove dev dependencies for production
RUN npm prune --production

# Production stage
FROM base AS production

# Accept build arguments
ARG NODE_ENV=production
ARG PORT=4004
ARG LOG_LEVEL=info
ARG RATE_LIMIT_WINDOW_MS=900000
ARG RATE_LIMIT_MAX_REQUESTS=100
ARG CORS_ORIGIN
ARG MONGODB_URI
ARG SERVICE_AUTH_TOKEN
ARG VERIFICATION_PROVIDER=cashfree
ARG CASHFREE_ENV=sandbox
ARG CASHFREE_CLIENT_ID
ARG CASHFREE_CLIENT_SECRET
ARG CASHFREE_TEST_OTP=111000
ARG MAIN_BACKEND_URL
ARG FEATURE_AADHAAR=true
ARG FEATURE_PAN=false
ARG FEATURE_BANK=false
ARG FEATURE_FACE=false
ARG FEATURE_LIVENESS=false

# Set environment variables from build arguments
ENV NODE_ENV=${NODE_ENV}
ENV PORT=${PORT}
ENV LOG_LEVEL=${LOG_LEVEL}
ENV RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS}
ENV RATE_LIMIT_MAX_REQUESTS=${RATE_LIMIT_MAX_REQUESTS}
ENV CORS_ORIGIN=${CORS_ORIGIN}
ENV MONGODB_URI=${MONGODB_URI}
ENV SERVICE_AUTH_TOKEN=${SERVICE_AUTH_TOKEN}
ENV VERIFICATION_PROVIDER=${VERIFICATION_PROVIDER}
ENV CASHFREE_ENV=${CASHFREE_ENV}
ENV CASHFREE_CLIENT_ID=${CASHFREE_CLIENT_ID}
ENV CASHFREE_CLIENT_SECRET=${CASHFREE_CLIENT_SECRET}
ENV CASHFREE_TEST_OTP=${CASHFREE_TEST_OTP}
ENV MAIN_BACKEND_URL=${MAIN_BACKEND_URL}
ENV FEATURE_AADHAAR=${FEATURE_AADHAAR}
ENV FEATURE_PAN=${FEATURE_PAN}
ENV FEATURE_BANK=${FEATURE_BANK}
ENV FEATURE_FACE=${FEATURE_FACE}
ENV FEATURE_LIVENESS=${FEATURE_LIVENESS}

# Copy production dependencies from dependencies stage
COPY --from=dependencies --chown=nodeuser:nodejs /app/node_modules ./node_modules

# Copy application code from build stage
COPY --from=build --chown=nodeuser:nodejs /app/ ./

# Create logs directory with proper permissions
RUN mkdir -p logs && chown -R nodeuser:nodejs logs

# Remove unnecessary files for production
RUN rm -rf \
    .git \
    .gitignore \
    .env.example \
    *.md \
    .dockerignore \
    Dockerfile \
    test-*.js \
    test-*.sh

# Switch to non-root user
USER nodeuser

# Expose port
EXPOSE 4004

# Health check - Check localhost inside container
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:4004/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]

